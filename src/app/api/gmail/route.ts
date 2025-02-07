import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google, gmail_v1 } from 'googleapis';
import { isGmailError } from '@/lib/types/gmail';

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
    const query = `{from:${disputeEmail} OR to:${disputeEmail}} in:anywhere`;
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch threads with increased limit
    const threadsResponse = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: 50 // Increased from 10 to ensure we catch all correspondence
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
          // First get the thread to get all message IDs
          const threadData = await gmail.users.threads.get({
            userId: 'me',
            id: thread.id,
            format: 'full'
          });

          console.log('🔍 STEP 1 - Raw thread data from Gmail API:', {
            threadId: thread.id,
            messageCount: threadData.data.messages?.length || 0,
            firstMessageHeaders: threadData.data.messages?.[0]?.payload?.headers
          });

          // Get thread metadata from the first message that has valid headers
          const firstMessage = threadData.data.messages?.[0];
          if (firstMessage?.payload?.headers) {
            console.log('🔍 STEP 2 - First message headers:', firstMessage.payload.headers.map(h => ({
              name: h.name,
              value: h.value
            })));
          }

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

    // Format threads with complete header info by scanning all messages
    const formattedThreads = validThreads.map(thread => {
      if (!thread.messages) return null;

      // Sort messages chronologically first
      const sortedMessages = thread.messages.sort(
        (a, b) => parseInt(a.internalDate || '0') - parseInt(b.internalDate || '0')
      );

      // Get the first message
      const firstMessage = sortedMessages[0];
      if (!firstMessage?.payload?.headers) return null;

      // Get thread metadata from first message headers
      const getHeader = (name: string): string => {
        const header = firstMessage.payload.headers.find(
          h => h.name?.toLowerCase() === name.toLowerCase()
        );
        const value = header?.value || '';
        console.log(`Thread header "${name}":`, { found: !!header, value });
        return value;
      };

      // Extract thread metadata from the first message
      const rawSubject = getHeader('subject');
      const threadSubject = rawSubject.replace(/^Re:\s+/i, '');
      const threadFrom = getHeader('from');
      
      console.log('Thread metadata from first message:', {
        threadId: thread.id,
        rawSubject,
        cleanedSubject: threadSubject,
        from: threadFrom,
        messageCount: thread.messages.length
      });

      // Process all messages
      const messages = sortedMessages.map(message => {
        if (!message.payload?.headers) return null;

        // Create header map for this specific message
        const headers = new Map();
        message.payload.headers.forEach(header => {
          if (header.name && header.value) {
            // Store both original case and lowercase versions
            headers.set(header.name.toLowerCase(), header.value);
            headers.set(header.name, header.value);  // Keep original case version too
            console.log(`Setting header: ${header.name} = ${header.value}`);
          }
        });

        // Get message-specific headers - try both cases
        const messageSubject = headers.get('Subject') || headers.get('subject') || '';
        const messageFrom = headers.get('From') || headers.get('from') || '';
        const messageTo = headers.get('To') || headers.get('to') || '';

        // Log the actual values we're using
        console.log('Header extraction:', {
          messageId: message.id,
          foundSubject: messageSubject,
          foundFrom: messageFrom,
          foundTo: messageTo,
          allHeaderKeys: Array.from(headers.keys())
        });

        // Use thread metadata for first message, message-specific for others
        const isFirstMessage = message.id === firstMessage.id;
        const finalSubject = (isFirstMessage ? threadSubject : messageSubject.replace(/^Re:\s+/i, '')) || threadSubject || messageSubject;
        const finalFrom = (isFirstMessage ? threadFrom : messageFrom) || threadFrom || messageFrom;

        console.log('Final header values:', {
          messageId: message.id,
          isFirstMessage,
          finalSubject,
          finalFrom,
          threadSubject,
          threadFrom
        });

        // Extract message metadata with better logging
        const messageId = headers.get('message-id') || '';
        const references = headers.get('references') || '';
        const inReplyTo = headers.get('in-reply-to') || '';
        const date = headers.get('date');

        console.log('Extracted headers for message:', message.id, {
          messageId,
          from: finalFrom,
          subject: finalSubject,
          date,
          references,
          inReplyTo,
          allHeaders: Object.fromEntries(headers)
        });

        // Only fall back to defaults if we truly have no value
        const finalDate = date || 
          (message.internalDate ? new Date(parseInt(message.internalDate)).toISOString() : new Date().toISOString());

        // Process message body
        let body = '';
        let contentType = 'text/plain';
        let htmlContent = '';
        let plainContent = '';

        const processMessagePart = (part: gmail_v1.Schema$MessagePart) => {
          console.log('Processing message part:', {
            mimeType: part.mimeType,
            hasBody: !!part.body,
            bodySize: part.body?.data?.length,
            partCount: part.parts?.length
          });

          if (part.mimeType?.toLowerCase() === 'text/html' && part.body?.data) {
            htmlContent = Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
          } else if (part.mimeType?.toLowerCase() === 'text/plain' && part.body?.data) {
            plainContent = Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
          }

          // Recursively process multipart messages
          if (part.parts) {
            part.parts.forEach(processMessagePart);
          }
        };

        // Process the message payload
        processMessagePart(message.payload);

        // Log content processing results
        console.log('Content processing results:', {
          messageId: message.id,
          hasHtmlContent: !!htmlContent,
          hasPlainContent: !!plainContent,
          htmlLength: htmlContent.length,
          plainLength: plainContent.length
        });

        // Prefer HTML content if available
        if (htmlContent) {
          body = htmlContent;
          contentType = 'text/html';
        } else {
          body = plainContent;
          contentType = 'text/plain';
        }

        // Clean up quoted text to avoid duplication
        const originalLength = body.length;
        if (contentType === 'text/html') {
          // Remove Gmail quote markers and redundant content
          body = body
            .replace(/<div class="gmail_quote"[\s\S]*?<\/div>/g, '') // Remove Gmail quotes
            .replace(/<blockquote class="gmail_quote"[\s\S]*?<\/blockquote>/g, '') // Remove blockquotes
            .trim();
        } else {
          // Remove plain text quotes
          body = body
            .replace(/^>.*$/gm, '') // Remove quoted lines
            .replace(/On.*wrote:[\s\S]*$/gm, '') // Remove attribution lines
            .trim();
        }

        console.log('Content cleanup results:', {
          messageId: message.id,
          originalLength,
          newLength: body.length,
          contentType
        });

        return {
          id: message.id || '',
          threadId: thread.id || '',
          subject: finalSubject,
          from: finalFrom,
          to: messageTo,
          date: finalDate,
          body,
          contentType,
          messageId,
          references,
          inReplyTo
        };
      }).filter((msg): msg is NonNullable<typeof msg> => msg !== null);

      return {
        id: thread.id || '',
        subject: threadSubject,
        from: threadFrom,
        messages,
        messageCount: messages.length
      };
    }).filter((thread): thread is NonNullable<typeof thread> => thread !== null);

    // Sort threads by the date of their most recent message
    formattedThreads.sort((a, b) => {
      const aDate = new Date(a.messages[a.messages.length - 1].date).getTime();
      const bDate = new Date(b.messages[b.messages.length - 1].date).getTime();
      return bDate - aDate;
    });

    return NextResponse.json({
      threads: formattedThreads,
      count: formattedThreads.length
    });
  } catch (error: any) {
    console.error('Error fetching emails:', error);

    // Handle Gmail API errors
    if (isGmailError(error)) {
      return NextResponse.json({
        error: 'Gmail API error',
        details: error.message || 'An error occurred while fetching emails',
        code: error.response?.status || 500
      }, { status: error.response?.status || 500 });
    }

    // Network or other errors
    return NextResponse.json({ 
      error: 'Failed to fetch email threads',
      details: error.message || 'An unexpected error occurred'
    }, { status: 500 });
  }
} 