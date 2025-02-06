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

    // Process messages with better error handling
    const processedMessages = await Promise.all(
      gmailResponse.data.messages.map(async (message, index) => {
        try {
          console.log(`\nProcessing message ${index + 1}/${gmailResponse.data.messages.length} (ID: ${message.id})`);
          
          if (!message.id) {
            console.error('Message missing ID:', message);
            failedCount++;
            return null;
          }

          const response = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'full'
          }).catch(error => {
            console.error(`Failed to fetch message ${message.id}:`, error);
            throw error;
          });

          if (!response.data.payload) {
            console.error('Message missing payload:', message.id);
            failedCount++;
            return null;
          }

          const headers = response.data.payload.headers || [];
          if (headers.length === 0) {
            console.error('Message has no headers:', message.id);
            failedCount++;
            return null;
          }

          console.log('Message headers found:', {
            messageId: message.id,
            headerCount: headers.length,
            headerNames: headers.map(h => h.name)
          });

          // Enhanced header extraction with detailed logging
          const getHeader = (name: string): string => {
            const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
            const value = header?.value || '';
            console.log(`Header "${name}":`, { found: !!header, value });
            return value;
          };

          // Extract and clean subject line with detailed logging
          let subject = getHeader('subject');
          console.log('Raw subject:', subject);

          // If no subject found, try to extract from References or In-Reply-To
          if (!subject) {
            const references = getHeader('references');
            const inReplyTo = getHeader('in-reply-to');
            console.log('No subject, checking references:', { references, inReplyTo });
            if (references || inReplyTo) {
              subject = 'Re: (No Subject)';
            } else {
              subject = 'No Subject';
            }
          }

          // Clean up common subject prefixes
          subject = subject
            .replace(/^(Re|RE|Fwd|FWD|Fw|FW):\s*/g, '')  // Remove Re:/Fwd: prefixes
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .trim();

          console.log('Cleaned subject:', subject);

          // Extract and clean from address with detailed logging
          const from = getHeader('from');
          console.log('Raw from:', from);

          // Enhanced from parsing
          let cleanFrom = 'Unknown Sender';
          if (from) {
            // Try to extract email from various formats
            const emailMatch = from.match(/(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)/);
            console.log('From parsing:', {
              original: from,
              matchResult: emailMatch,
              groups: emailMatch ? emailMatch.slice(1) : []
            });
            
            if (emailMatch) {
              const [, name, email] = emailMatch;
              cleanFrom = name?.trim() || email?.trim() || from.trim();
              console.log('Parsed from components:', { name, email, cleanFrom });
            } else {
              cleanFrom = from.trim();
            }
          }

          // Extract date with validation
          const date = getHeader('date');
          console.log('Raw date:', date);
          const validDate = date ? new Date(date).toISOString() : new Date().toISOString();
          console.log('Validated date:', validDate);

          console.log('Message details:', {
            messageId: message.id,
            threadId: response.data.threadId,
            subject,
            from,
            date,
            hasPayload: !!response.data.payload,
            hasHeaders: headers.length > 0
          });

          // Check if email is from the authenticated user or contains a reply from them
          const isFromUser = from.toLowerCase().includes(userEmail.toLowerCase());
          const hasUserQuote = response.data.snippet?.toLowerCase().includes('wrote:') && 
            response.data.snippet?.toLowerCase().includes(userEmail.toLowerCase());
          const isReplyToUser = response.data.snippet?.toLowerCase().includes('on') && 
            response.data.snippet?.toLowerCase().includes(userEmail.toLowerCase());
          
          const isUserInteraction = isFromUser || hasUserQuote || isReplyToUser;
          
          console.log('User interaction check:', {
            messageId: message.id,
            isFromUser,
            hasUserQuote,
            isReplyToUser,
            isUserInteraction
          });

          let body = '';
          let htmlBody = '';
          let contentType = 'text/plain';
          
          const decodeBase64 = (data: string) => {
            try {
              // Handle base64url encoding
              const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
              return Buffer.from(normalized, 'base64').toString();
            } catch (error) {
              console.error('Error decoding base64:', error);
              return '';
            }
          };

          const processMessagePart = (part: Schema$MessagePart) => {
            console.log('Processing part:', {
              mimeType: part.mimeType,
              hasBody: !!part.body,
              hasData: !!part.body?.data,
              hasParts: !!part.parts,
              partCount: part.parts?.length
            });

            // Handle different MIME types
            if (part.mimeType) {
              switch (part.mimeType.toLowerCase()) {
                case 'text/plain':
                  if (part.body?.data) {
                    body += decodeBase64(part.body.data);
                  }
                  break;
                case 'text/html':
                  if (part.body?.data) {
                    // Prioritize HTML content
                    htmlBody += decodeBase64(part.body.data);
                  }
                  break;
                case 'multipart/alternative':
                case 'multipart/mixed':
                case 'multipart/related':
                  if (part.parts) {
                    // Process parts in order, so HTML takes precedence over plain text
                    part.parts.forEach(processMessagePart);
                  }
                  break;
                default:
                  // Log unhandled MIME types for debugging
                  if (!part.mimeType.startsWith('image/')) {
                    console.log('Unhandled MIME type:', part.mimeType);
                  }
              }
            }

            // Handle nested parts
            if (part.parts) {
              part.parts.forEach(processMessagePart);
            }
          };

          if (response.data.payload) {
            processMessagePart(response.data.payload);
          }

          // Use HTML body if available, otherwise use plain text
          let finalBody = htmlBody || body;

          // Fallback to payload body if no content found
          if (!finalBody && response.data.payload?.body?.data) {
            console.log('Using payload body data as fallback');
            finalBody = decodeBase64(response.data.payload.body.data);
          }

          // Final fallback to snippet
          if (!finalBody) {
            console.log('Using snippet as fallback body');
            finalBody = response.data.snippet || 'No content available';
          }

          // Clean up the body text but preserve HTML structure
          finalBody = finalBody
            .replace(/\r\n/g, '\n') // Normalize line endings
            .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
            .trim();

          console.log('Body extraction result:', {
            hasBody: !!finalBody,
            bodyLength: finalBody.length,
            bodyPreview: finalBody.substring(0, 50) + '...',
            hadHtmlContent: !!htmlBody,
            hadPlainText: !!body
          });

          // Get or create thread entry
          let threadEntry = threadMap.get(response.data.threadId || '');
          if (!threadEntry) {
            console.log(`Creating new thread entry for ${response.data.threadId}`);
            threadEntry = {
              messages: [],
              hasUserReply: false,
              threadId: response.data.threadId || '',
              latestDate: date
            };
            threadMap.set(response.data.threadId || '', threadEntry);
          } else {
            console.log(`Adding to existing thread ${response.data.threadId}`);
          }

          // Update thread information with better content handling
          threadEntry.messages.push({
            id: response.data.id || message.id || '',
            subject: subject || 'No Subject',
            from: cleanFrom,
            date: date || new Date().toISOString(),
            body: finalBody,
            snippet: response.data.snippet || undefined,
            contentType: htmlBody ? 'text/html' : 'text/plain'
          });

          // Update hasUserReply if this message shows user interaction
          if (isUserInteraction) {
            threadEntry.hasUserReply = true;
            console.log(`Marked thread ${response.data.threadId} as having user reply (${isFromUser ? 'from user' : hasUserQuote ? 'has quote' : 'reply to user'})`);
          }

          processedCount++;

          return {
            id: response.data.id || message.id || '',
            threadId: response.data.threadId || '',
            subject,
            from,
            date,
            body: finalBody,
            contentType,
            snippet: response.data.snippet || undefined
          };
        } catch (error) {
          console.error(`Failed to process message ${message.id}:`, error);
          failedCount++;
          processingErrors.push({
            messageId: message.id,
            error: error.message,
            stage: 'message_processing'
          });
          return null;
        }
      })
    );

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