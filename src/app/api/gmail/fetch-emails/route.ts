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
const processMessagePart = (part: Schema$MessagePart) => {
  console.log('Processing message part:', {
    mimeType: part.mimeType,
    hasBody: !!part.body,
    hasData: !!part.body?.data,
    hasAttachment: !!part.filename,
    partId: part.partId,
    hasParts: !!part.parts,
    partsCount: part.parts?.length
  });

  if (!part.mimeType) {
    console.log('Part missing MIME type, skipping');
    return { text: '', html: '' };
  }

  const mimeType = part.mimeType.toLowerCase();
  let text = '';
  let html = '';

  // Handle multipart messages
  if (mimeType.startsWith('multipart/')) {
    console.log('Processing multipart message:', {
      type: mimeType,
      partsCount: part.parts?.length || 0
    });

    if (part.parts) {
      // Sort parts by priority
      const sortedParts = [...part.parts].sort((a, b) => {
        const getMimeTypePriority = (mime?: string) => {
          if (!mime) return 4;
          mime = mime.toLowerCase();
          if (mime === 'text/plain') return 1;
          if (mime === 'text/html') return 2;
          if (mime.startsWith('text/')) return 3;
          return 4;
        };
        return getMimeTypePriority(a.mimeType) - getMimeTypePriority(b.mimeType);
      });

      console.log('Sorted parts by priority:', sortedParts.map(p => ({
        mimeType: p.mimeType,
        hasBody: !!p.body,
        hasData: !!p.body?.data,
        size: p.body?.size
      })));

      // Process all parts and combine results
      const results = sortedParts.map(processMessagePart);
      return results.reduce((acc, curr) => ({
        text: acc.text + (curr.text ? '\\n' + curr.text : ''),
        html: acc.html + curr.html
      }), { text: '', html: '' });
    }
  }

  // Handle content
  if (part.body?.data) {
    console.log('Found body data for part:', {
      mimeType,
      dataLength: part.body.data.length,
      size: part.body.size
    });

    const content = decodeBase64(part.body.data);
    if (content) {
      console.log('Successfully decoded content:', {
        mimeType,
        contentLength: content.length,
        preview: content.substring(0, 100) + '...'
      });

      if (mimeType === 'text/plain') {
        text = content;
      } else if (mimeType === 'text/html') {
        html = content;
      }
    } else {
      console.warn('Failed to decode content for part:', {
        mimeType,
        dataLength: part.body.data.length
      });
    }
  } else {
    console.log('No body data found for part:', {
      mimeType,
      hasAttachment: !!part.filename,
      filename: part.filename
    });
  }

  // Handle nested parts
  if (part.parts) {
    console.log('Processing nested parts:', {
      parentMimeType: mimeType,
      nestedPartsCount: part.parts.length
    });

    const nestedResults = part.parts.map(processMessagePart);
    nestedResults.forEach(result => {
      text += result.text;
      html += result.html;
    });
  }

  return { text, html };
};

export async function POST(request: NextRequest) {
  try {
    // Get authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return NextResponse.json({ error: 'No authorization header provided' }, { status: 401 });
    }

    const accessToken = authHeader.replace('Bearer ', '');
    if (!accessToken) {
      console.error('No access token provided');
      return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
    }

    // Initialize OAuth2 client with detailed logging
    console.log('Initializing OAuth2 client with token:', accessToken.substring(0, 10) + '...');
    const oauth2Client = getOAuth2Client();
    
    // Log OAuth2 client configuration
    console.log('OAuth2 Client Config:', {
      clientId: process.env.GOOGLE_CLIENT_ID?.substring(0, 10) + '...',
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET
    });

    oauth2Client.setCredentials({ 
      access_token: accessToken,
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send'
      ].join(' ')
    });

    // Initialize Gmail client with validation
    console.log('Initializing Gmail client...');
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Validate Gmail client and get user email
    let userEmail: string;
    try {
      // Test the connection with a simple profile request
      const profile = await gmail.users.getProfile({ userId: 'me' });
      userEmail = profile.data.emailAddress || '';
      console.log('Gmail connection validated:', {
        email: userEmail,
        threadsTotal: profile.data.threadsTotal,
        historyId: profile.data.historyId
      });
    } catch (validationError) {
      console.error('Gmail client validation failed:', validationError);
      throw validationError;
    }
    
    // Get query parameters from request body with defaults
    const { count = 20, offset = 0 } = await request.json().catch(() => ({}));
    console.log('Request parameters:', { requestedThreadCount: count, offset });

    // Fetch email list with increased maxResults to ensure we get enough threads
    console.log('Fetching email list...');
    const gmailResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: Math.min(2000, count * 10), // Fetch more to ensure we get enough valid threads
      pageToken: typeof offset === 'string' ? offset : undefined,
      q: 'in:inbox -category:{promotions OR social OR updates OR forums}' // Only fetch primary inbox messages
    });

    // Log the raw Gmail response
    console.log('Gmail response:', {
      hasMessages: !!gmailResponse.data.messages,
      messageCount: gmailResponse.data.messages?.length || 0,
      nextPageToken: !!gmailResponse.data.nextPageToken
    });

    if (!gmailResponse.data.messages || gmailResponse.data.messages.length === 0) {
      console.log('No emails found in Gmail response');
      return NextResponse.json({ 
        error: 'No emails found in your Gmail account',
        details: {
          requestedCount: count,
          offset: offset,
          response: 'No messages returned from Gmail API'
        }
      }, { status: 404 });
    }

    console.log(`Found ${gmailResponse.data.messages.length} emails`);

    // Track threads and their messages
    const threadMap = new Map<string, {
      messages: {
        id: string;
        subject: string;
        from: string;
        date: string;
        body: string;
        snippet?: string;
        contentType: string;
      }[];
      hasUserReply: boolean;
      threadId: string;
      latestDate: string;
    }>();

    // Track processing success/failure
    let processedCount = 0;
    let failedCount = 0;
    let processingErrors: any[] = [];

    // Update the message processing in the main function
    const messages = gmailResponse.data.messages || [];
    const batches = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      batches.push(messages.slice(i, i + BATCH_SIZE));
    }

    const processedMessages = [];
    for (const batch of batches) {
      const messageIds = batch.map(m => m.id!);
      const responses = await fetchMessageBatch(gmail, messageIds);
      
      for (const response of responses) {
        if (!response?.data) continue;

        try {
          // Process message content
          const { text, html } = processMessagePart(response.data.payload!);
          
          // Use HTML content if available, otherwise use plain text
          const finalContent = html || text || response.data.snippet || '';
          
          // Add to processed messages...
          processedMessages.push({
            id: response.data.id!,
            threadId: response.data.threadId!,
            subject: response.data.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
            from: response.data.payload?.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
            date: response.data.payload?.headers?.find(h => h.name === 'Date')?.value || new Date().toISOString(),
            body: finalContent,
            contentType: response.data.payload?.mimeType || 'text/plain',
            snippet: response.data.snippet || undefined
          });

          // Get or create thread entry
          let threadEntry = threadMap.get(response.data.threadId || '');
          if (!threadEntry) {
            console.log(`Creating new thread entry for ${response.data.threadId}`);
            threadEntry = {
              messages: [],
              hasUserReply: false,
              threadId: response.data.threadId || '',
              latestDate: response.data.payload?.headers?.find(h => h.name === 'Date')?.value || new Date().toISOString()
            };
            threadMap.set(response.data.threadId || '', threadEntry);
          } else {
            console.log(`Adding to existing thread ${response.data.threadId}`);
          }

          // Update thread information with better content handling
          threadEntry.messages.push({
            id: response.data.id || '',
            subject: response.data.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
            from: response.data.payload?.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
            date: response.data.payload?.headers?.find(h => h.name === 'Date')?.value || new Date().toISOString(),
            body: finalContent,
            snippet: response.data.snippet || undefined,
            contentType: response.data.payload?.mimeType || 'text/plain'
          });

          // Check if email is from the authenticated user or contains a reply from them
          const isFromUser = response.data.payload?.headers?.find(h => h.name === 'From')?.value?.toLowerCase().includes(userEmail.toLowerCase()) || false;
          const hasUserQuote = response.data.snippet?.toLowerCase().includes('wrote:') && 
            response.data.snippet?.toLowerCase().includes(userEmail.toLowerCase());
          const isReplyToUser = response.data.snippet?.toLowerCase().includes('on') && 
            response.data.snippet?.toLowerCase().includes(userEmail.toLowerCase());
          
          const isUserInteraction = isFromUser || hasUserQuote || isReplyToUser;
          
          console.log('User interaction check:', {
            messageId: response.data.id,
            isFromUser,
            hasUserQuote,
            isReplyToUser,
            isUserInteraction
          });

          // Update hasUserReply if this message shows user interaction
          if (isUserInteraction) {
            threadEntry.hasUserReply = true;
            console.log(`Marked thread ${response.data.threadId} as having user reply (${isFromUser ? 'from user' : hasUserQuote ? 'has quote' : 'reply to user'})`);
          }

          processedCount++;
        } catch (error) {
          console.error(`Error processing message ${response.data.id}:`, error);
          failedCount++;
          processingErrors.push({
            messageId: response.data.id,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            stage: 'message_processing'
          });
        }
      }
      
      // Add delay between batches to respect rate limits
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Log processing summary
    console.log('Email processing summary:', {
      total: gmailResponse.data.messages.length,
      processed: processedCount,
      failed: failedCount,
      errors: processingErrors
    });

    // Filter out null results and group into threads
    const validMessages = processedMessages.filter(Boolean);

    if (validMessages.length === 0) {
      console.error('No valid messages after processing:', {
        initialCount: gmailResponse.data.messages.length,
        processedCount,
        failedCount,
        errors: processingErrors
      });
      return NextResponse.json({
        error: 'No valid email threads found',
        details: {
          initialMessageCount: gmailResponse.data.messages.length,
          processedCount,
          failedCount,
          errors: processingErrors
        }
      }, { status: 404 });
    }

    // Update the thread filtering logic
    let validThreads = Array.from(threadMap.values())
      .filter(thread => {
        // Keep threads that have at least one non-empty message
        return thread.messages.some(msg => 
          msg.body.trim().length > 0 || 
          (msg.snippet && msg.snippet.trim().length > 0)
        );
      })
      .sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime())
      .map(thread => ({
        threadId: thread.threadId,
        messages: thread.messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        hasUserReply: thread.hasUserReply
      }));

    // Log thread counts before slicing
    console.log('Thread counts:', {
      requested: count,
      found: validThreads.length,
      willReturn: Math.min(count, validThreads.length)
    });

    // Take only the requested number of threads
    validThreads = validThreads.slice(0, count);

    console.log('Final thread processing summary:', {
      initialMessageCount: gmailResponse.data.messages.length,
      uniqueThreads: threadMap.size,
      validThreads: validThreads.length,
      threadDetails: validThreads.map(t => ({
        threadId: t.threadId,
        messageCount: t.messages.length,
        hasReply: t.hasUserReply
      }))
    });

    // Before returning the response, add detailed logging
    console.log('\n=== Final Thread Output ===');
    console.log('Sample Thread Structure:', JSON.stringify({
      sampleThread: validThreads[0] ? {
        threadId: validThreads[0].threadId,
        hasUserReply: validThreads[0].hasUserReply,
        messageCount: validThreads[0].messages.length,
        messages: validThreads[0].messages.map(m => ({
          subject: m.subject,
          from: m.from,
          date: m.date,
          bodyPreview: m.body.substring(0, 100) + '...'
        }))
      } : null,
      totalThreads: validThreads.length
    }, null, 2));

    return NextResponse.json({ 
      threads: validThreads,
      nextPageToken: gmailResponse.data.nextPageToken || null,
      totalThreads: validThreads.length
    });

  } catch (error: unknown) {
    console.error('Error in fetch-emails route:', error);
    
    // Enhanced error logging
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause
      });
    }
    
    if (!isGmailError(error)) {
      return NextResponse.json({ 
        error: 'Failed to fetch emails',
        details: error instanceof Error ? error.message : 'An unexpected error occurred',
        errorType: error instanceof Error ? error.name : 'Unknown'
      }, { status: 500 });
    }
    
    // Check if error is due to invalid credentials
    if (error.response?.status === 401) {
      return NextResponse.json({ 
        error: 'Authentication failed',
        details: 'Your session has expired. Please sign in again.',
        errorType: 'AuthenticationError'
      }, { status: 401 });
    }

    // Check for rate limiting
    if (error.response?.status === 429) {
      return NextResponse.json({
        error: 'Rate limit exceeded',
        details: 'Too many requests. Please try again in a few minutes.',
        errorType: 'RateLimitError'
      }, { status: 429 });
    }

    // Check for Gmail API specific errors
    if (error.response?.data?.error) {
      const apiError = error.response.data.error;
      return NextResponse.json({
        error: 'Gmail API error',
        details: apiError.message || 'An error occurred while fetching emails',
        code: apiError.code,
        errorType: 'GmailAPIError'
      }, { status: error.response.status || 500 });
    }

    return NextResponse.json({ 
      error: 'Failed to fetch emails',
      details: error instanceof Error ? error.message : 'An unexpected error occurred',
      errorType: 'UnknownError'
    }, { status: 500 });
  }
} 