import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google, gmail_v1 } from 'googleapis';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const disputeEmail = request.headers.get('X-Dispute-Email');
  
  if (!authHeader || !disputeEmail) {
    return NextResponse.json({ 
      error: 'Missing required headers',
      details: !authHeader ? 'Authorization header is missing' : 'X-Dispute-Email header is missing'
    }, { status: 401 });
  }

  const accessToken = authHeader.replace('Bearer ', '');

  try {
    // Initialize OAuth2 client
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send'
      ].join(' ')
    });

    // Query Gmail API for email threads related to this dispute
    const query = `from:${disputeEmail} OR to:${disputeEmail}`;
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch threads
    const threadsResponse = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: 10
    });

    if (!threadsResponse.data.threads || !Array.isArray(threadsResponse.data.threads)) {
      return NextResponse.json({ threads: [] });
    }

    // Fetch full thread data for each thread
    const threads = await Promise.all(
      threadsResponse.data.threads.map(async (thread) => {
        if (!thread.id) {
          console.error('Thread missing ID:', thread);
          return null;
        }

        try {
          const threadData = await gmail.users.threads.get({
            userId: 'me',
            id: thread.id,
            format: 'full'
          });
          return threadData.data;
        } catch (error) {
          console.error('Failed to fetch thread:', {
            threadId: thread.id,
            error
          });
          return null;
        }
      })
    );

    // Filter out any failed thread fetches and ensure type safety
    const validThreads = threads.filter((thread): thread is gmail_v1.Schema$Thread => thread !== null);

    // Process and format the email threads
    const formattedThreads = validThreads.map(thread => {
      if (!thread.messages) return null;

      const messages = thread.messages
        .map(message => {
          if (!message.payload?.headers) return null;

          // Function to decode base64 content
          const decodeBody = (data: string) => {
            try {
              return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
            } catch (error) {
              console.error('Error decoding email body:', error);
              return '';
            }
          };

          // Get headers
          const headers = message.payload.headers.reduce<Record<string, string>>((acc, header) => {
            if (header.name) {
              acc[header.name.toLowerCase()] = header.value || '';
            }
            return acc;
          }, {});

          // Extract email body
          let body = '';
          let contentType = '';

          const getBodyPart = (part: gmail_v1.Schema$MessagePart): { body: string, contentType: string } | null => {
            if (part.body?.data) {
              return {
                body: decodeBody(part.body.data),
                contentType: part.mimeType || 'text/plain'
              };
            }
            
            if (part.parts) {
              for (const subPart of part.parts) {
                const result = getBodyPart(subPart);
                if (result) return result;
              }
            }
            return null;
          };

          const bodyPart = getBodyPart(message.payload);
          if (bodyPart) {
            body = bodyPart.body;
            contentType = bodyPart.contentType;
          }

          return {
            id: message.id || '',
            threadId: thread.id || '',
            historyId: message.historyId || '',
            internalDate: message.internalDate || '',
            snippet: message.snippet || '',
            subject: headers.subject || 'No Subject',
            from: headers.from || '',
            to: headers.to || '',
            date: headers.date || (message.internalDate ? new Date(parseInt(message.internalDate)).toISOString() : new Date().toISOString()),
            body,
            contentType,
            references: headers['references'] || '',
            inReplyTo: headers['in-reply-to'] || '',
            messageId: headers['message-id'] || ''
          };
        })
        .filter((message): message is NonNullable<typeof message> => message !== null)
        // Filter messages to only include those actually involving the dispute email
        .filter(message => {
          const fromEmail = message.from.toLowerCase();
          const toEmail = message.to.toLowerCase();
          const disputeEmailLower = disputeEmail.toLowerCase();
          return fromEmail.includes(disputeEmailLower) || toEmail.includes(disputeEmailLower);
        });

      // Only include threads that have messages after filtering
      if (messages.length === 0) return null;

      // Sort messages within thread by date
      messages.sort((a, b) => parseInt(a.internalDate) - parseInt(b.internalDate));

      return {
        id: thread.id || '',
        historyId: thread.historyId || '',
        messages
      };
    })
    .filter((thread): thread is NonNullable<typeof thread> => thread !== null);

    // Sort threads by the date of their most recent message
    formattedThreads.sort((a, b) => {
      const aDate = parseInt(a.messages[a.messages.length - 1].internalDate);
      const bDate = parseInt(b.messages[b.messages.length - 1].internalDate);
      return bDate - aDate;
    });

    return NextResponse.json({ 
      threads: formattedThreads,
      count: formattedThreads.length 
    });
  } catch (error) {
    console.error('Error fetching email threads:', error);
    
    // Check if error is due to invalid credentials
    if (error.response?.status === 401) {
      return NextResponse.json({ 
        error: 'Authentication failed',
        details: 'Your session has expired. Please sign in again.'
      }, { status: 401 });
    }

    // Check for rate limiting
    if (error.response?.status === 429) {
      return NextResponse.json({
        error: 'Rate limit exceeded',
        details: 'Too many requests. Please try again in a few minutes.'
      }, { status: 429 });
    }

    // Check for Gmail API specific errors
    if (error.response?.data?.error) {
      const gmailError = error.response.data.error;
      return NextResponse.json({
        error: 'Gmail API error',
        details: gmailError.message || 'An error occurred while fetching emails',
        code: gmailError.code
      }, { status: error.response.status || 500 });
    }

    // Network or other errors
    return NextResponse.json({ 
      error: 'Failed to fetch email threads',
      details: error instanceof Error 
        ? error.message 
        : 'An unexpected error occurred while fetching emails'
    }, { status: 500 });
  }
} 