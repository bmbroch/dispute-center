import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { isGmailError } from '@/lib/types/gmail';
import { gmail_v1 } from 'googleapis';

type Schema$Message = gmail_v1.Schema$Message;
type Schema$MessagePart = gmail_v1.Schema$MessagePart;
type Schema$MessagePartHeader = gmail_v1.Schema$MessagePartHeader;

interface EmailResponse {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet?: string;
}

interface ProcessedMessagePart {
  text?: string;
  html?: string;
}

// Add batch processing constants
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Add retry helper function
const retryWithExponentialBackoff = async <T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = RETRY_DELAY
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithExponentialBackoff(operation, retries - 1, delay * 2);
    }
    throw error;
  }
};

// Add this helper function at the top of the file
const decodeBase64UrlSafe = (data: string): string => {
  try {
    // Replace URL-safe characters and add padding
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    return Buffer.from(paddedBase64, 'base64').toString('utf-8');
  } catch (error) {
    console.error('Error decoding base64:', error);
    return '';
  }
};

// Update message fetching to use batching and retries
const fetchMessageBatch = async (gmail: gmail_v1.Gmail, messageIds: string[], userId = 'me') => {
  const results = await Promise.all(
    messageIds.map(id =>
      retryWithExponentialBackoff(async () => {
        try {
          console.log(`Fetching message ${id} in FULL format`);
          // First try FULL format
          const response = await gmail.users.messages.get({
            userId,
            id,
            format: 'full'
          });

          // Log the response structure
          console.log(`Message ${id} FULL format response:`, {
            hasPayload: !!response.data.payload,
            mimeType: response.data.payload?.mimeType,
            hasBody: !!response.data.payload?.body,
            hasBodyData: !!response.data.payload?.body?.data,
            hasParts: !!response.data.payload?.parts,
            partsCount: response.data.payload?.parts?.length,
            hasSnippet: !!response.data.snippet
          });

          // If no content in FULL format or content is incomplete, try RAW format
          if (!response.data.payload?.body?.data &&
            (!response.data.payload?.parts ||
              !response.data.payload.parts.some(p => p.body?.data || p.parts))) {
            console.log(`No content found in FULL format for message ${id}, trying RAW format`);
            const rawResponse = await gmail.users.messages.get({
              userId,
              id,
              format: 'raw'
            });

            // Log the RAW format response
            console.log(`Message ${id} RAW format response:`, {
              hasRaw: !!rawResponse.data.raw,
              rawLength: rawResponse.data.raw?.length
            });

            if (!rawResponse.data.raw) {
              console.warn(`No raw content found for message ${id}`);
              // If both formats fail, try one last time with metadata format
              const metadataResponse = await gmail.users.messages.get({
                userId,
                id,
                format: 'metadata',
                metadataHeaders: ['From', 'To', 'Subject', 'Date']
              });

              console.log(`Falling back to metadata format for message ${id}:`, {
                hasHeaders: !!metadataResponse.data.payload?.headers,
                headerCount: metadataResponse.data.payload?.headers?.length,
                hasSnippet: !!metadataResponse.data.snippet
              });

              return metadataResponse;
            }

            return rawResponse;
          }

          return response;
        } catch (error) {
          console.error(`Failed to fetch message ${id}:`, error);
          throw error;
        }
      })
    )
  );
  return results;
};

// Update the message processing function
const processMessagePart = (part: Schema$MessagePart): ProcessedMessagePart => {
  console.log('Processing message part:', {
    mimeType: part.mimeType,
    hasBody: !!part.body,
    hasData: part.body?.data ? 'yes' : 'no',
    hasParts: part.parts ? `yes (${part.parts.length})` : 'no'
  });

  if (part.mimeType === 'text/plain' && part.body?.data) {
    return {
      text: Buffer.from(part.body.data, 'base64').toString()
    };
  }

  if (part.mimeType === 'text/html' && part.body?.data) {
    return {
      html: Buffer.from(part.body.data, 'base64').toString()
    };
  }

  if (part.parts) {
    const results: ProcessedMessagePart[] = part.parts.map(processMessagePart);
    return results.reduce((acc: ProcessedMessagePart, curr: ProcessedMessagePart) => ({
      text: acc.text || curr.text,
      html: acc.html || curr.html
    }), { text: undefined, html: undefined });
  }

  return {};
};

interface GmailErrorResponse extends Error {
  code?: number;
  status?: number;
  statusText?: string;
}

export async function POST(request: NextRequest) {
  try {
    console.log('=== Starting Gmail API Request ===');

    // Get authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return NextResponse.json({ error: 'No authorization header' }, { status: 401 });
    }

    // Extract the token from the Authorization header
    const token = authHeader.replace('Bearer ', '');

    // Initialize Gmail client
    const oauth2Client = await getOAuth2Client({ access_token: token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get query parameters from request body with defaults
    const { count = 20, offset = 0 } = await request.json().catch(() => ({}));
    console.log('Request parameters:', { count, offset });

    // First, get list of threads with expanded fields
    console.log('Fetching thread list...');
    const threadsResponse = await gmail.users.threads.list({
      userId: 'me',
      maxResults: count,
      pageToken: typeof offset === 'string' ? offset : undefined,
      q: 'in:inbox -category:{promotions OR social OR updates OR forums}',
      includeSpamTrash: false
    });

    console.log('Threads response:', {
      threadCount: threadsResponse.data.threads?.length || 0,
      hasNextPage: !!threadsResponse.data.nextPageToken,
      resultSizeEstimate: threadsResponse.data.resultSizeEstimate
    });

    if (!threadsResponse.data.threads || threadsResponse.data.threads.length === 0) {
      return NextResponse.json({
        emails: [],
        nextPageToken: null,
        debug: {
          message: 'No threads found',
          response: threadsResponse.data
        }
      });
    }

    // Fetch full thread data for each thread
    console.log('Fetching full thread data...');
    const threads = await Promise.all(
      threadsResponse.data.threads.map(async (thread) => {
        if (!thread.id) {
          console.warn('Thread missing ID:', thread);
          return null;
        }

        try {
          // Get the complete thread with all messages and maximum metadata
          const threadData = await gmail.users.threads.get({
            userId: 'me',
            id: thread.id,
            format: 'full',
            metadataHeaders: [
              'From', 'To', 'Subject', 'Date',
              'Message-ID', 'References', 'In-Reply-To',
              'Content-Type', 'Content-Transfer-Encoding',
              'Delivered-To', 'Received', 'Reply-To',
              'CC', 'BCC', 'List-Unsubscribe'
            ]
          });

          // Log the raw thread data
          console.log(`=== Raw Thread Data for ${thread.id} ===`);
          console.log(JSON.stringify({
            id: threadData.data.id,
            historyId: threadData.data.historyId,
            messages: threadData.data.messages?.map(msg => ({
              id: msg.id,
              threadId: msg.threadId,
              labelIds: msg.labelIds,
              snippet: msg.snippet,
              internalDate: msg.internalDate,
              payload: {
                mimeType: msg.payload?.mimeType,
                headers: msg.payload?.headers,
                parts: msg.payload?.parts?.map(part => ({
                  partId: part.partId,
                  mimeType: part.mimeType,
                  filename: part.filename,
                  headers: part.headers,
                  body: {
                    size: part.body?.size,
                    hasData: !!part.body?.data
                  }
                })),
                body: {
                  size: msg.payload?.body?.size,
                  hasData: !!msg.payload?.body?.data
                }
              }
            }))
          }, null, 2));

          console.log(`Thread ${thread.id} details:`, {
            messageCount: threadData.data.messages?.length || 0,
            historyId: threadData.data.historyId,
            hasMessages: !!threadData.data.messages,
            snippet: threadData.data.messages?.[0]?.snippet?.substring(0, 50) + '...'
          });

          return threadData.data;
        } catch (error) {
          console.error('Failed to fetch thread:', {
            threadId: thread.id,
            error: error instanceof Error ? {
              message: error.message,
              name: error.name,
              stack: error.stack
            } : error
          });
          return {
            error: true,
            threadId: thread.id,
            errorDetails: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    // Process threads into our email format with additional debug info
    console.log('Processing threads...');
    const processedEmails = threads
      .map(thread => {
        if (!thread || 'error' in thread) {
          return {
            error: true,
            threadData: thread
          };
        }

        if (!thread.messages || thread.messages.length === 0) {
          console.warn('Thread has no messages:', thread.id);
          return null;
        }

        // Sort messages chronologically (oldest first)
        const sortedMessages = thread.messages.sort(
          (a, b) => parseInt(a.internalDate || '0') - parseInt(b.internalDate || '0')
        );

        // Process each message in the thread
        const threadMessages = sortedMessages.map(message => {
          if (!message.payload?.headers) {
            console.warn('Message missing payload or headers:', message.id);
            return null;
          }

          // Create header map for this message
          const headers = new Map(
            message.payload.headers.map(header => [
              header.name?.toLowerCase() || '',
              header.value || ''
            ])
          );

          // Extract message content with detailed logging
          const { text, html } = processMessagePart(message.payload);
          console.log(`Message ${message.id} content types:`, {
            hasText: !!text,
            textLength: text?.length,
            hasHtml: !!html,
            htmlLength: html?.length,
            hasSnippet: !!message.snippet,
            labelIds: message.labelIds
          });

          const content = html || text || message.snippet || '';

          // Get timestamp from internalDate
          const timestamp = parseInt(message.internalDate || '0');

          return {
            id: message.id || '',
            subject: headers.get('subject') || 'No Subject',
            sender: headers.get('from') || '',
            content: content,
            receivedAt: timestamp,
            sortTimestamp: timestamp
          };
        }).filter((msg): msg is NonNullable<typeof msg> => msg !== null);

        // Use the first message as the main thread info, but include all messages
        const firstMessage = threadMessages[0];
        return {
          id: firstMessage.id,
          threadId: thread.id || '',
          subject: firstMessage.subject,
          sender: firstMessage.sender,
          content: firstMessage.content,
          receivedAt: firstMessage.receivedAt,
          sortTimestamp: firstMessage.sortTimestamp,
          threadMessages: threadMessages, // Include all messages in the thread
          debug: {
            historyId: thread.historyId,
            messageCount: threadMessages.length,
            originalMessageCount: thread.messages?.length,
            hasFullContent: threadMessages.every(msg => msg.content.length > 0)
          }
        };
      })
      .filter((email): email is NonNullable<typeof email> => email !== null);

    console.log('=== Gmail API Request Complete ===');
    console.log('Processed email summary:', {
      totalThreads: threads.length,
      successfullyProcessed: processedEmails.length,
      threadsWithErrors: processedEmails.filter(e => 'error' in e).length
    });

    return NextResponse.json({
      emails: processedEmails,
      nextPageToken: threadsResponse.data.nextPageToken || null,
      debug: {
        requestTimestamp: new Date().toISOString(),
        threadsFound: threadsResponse.data.threads?.length || 0,
        processedCount: processedEmails.length,
        estimatedTotal: threadsResponse.data.resultSizeEstimate,
        errors: processedEmails.filter(e => 'error' in e),
        apiVersion: 'v1',
        rawGmailResponse: {
          threads: threads.map(thread => {
            if (!thread || 'error' in thread) return thread;
            return {
              id: thread.id,
              historyId: thread.historyId,
              messageCount: thread.messages?.length || 0,
              messages: thread.messages?.map(msg => ({
                id: msg.id,
                threadId: msg.threadId,
                labelIds: msg.labelIds,
                snippet: msg.snippet,
                internalDate: msg.internalDate,
                payload: {
                  mimeType: msg.payload?.mimeType,
                  headers: msg.payload?.headers,
                  body: {
                    size: msg.payload?.body?.size,
                    hasData: !!msg.payload?.body?.data
                  },
                  parts: msg.payload?.parts?.map(part => ({
                    partId: part.partId,
                    mimeType: part.mimeType,
                    filename: part.filename,
                    headers: part.headers,
                    body: {
                      size: part.body?.size,
                      hasData: !!part.body?.data
                    }
                  }))
                }
              }))
            };
          })
        }
      }
    });

  } catch (error) {
    console.error('Error fetching emails:', error);
    const gmailError = error as GmailErrorResponse;
    return NextResponse.json({
      error: {
        message: gmailError.message,
        code: gmailError.code,
        status: gmailError.status,
        statusText: gmailError.statusText,
        stack: process.env.NODE_ENV === 'development' ? gmailError.stack : undefined
      }
    }, { status: gmailError.code || 500 });
  }
}
