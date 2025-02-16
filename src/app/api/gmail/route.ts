import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google, gmail_v1 } from 'googleapis';
import { isGmailError } from '@/lib/types/gmail';

// Add these functions before processMessagePart
function cleanQuotedText(content: string, isHtml: boolean): string {
  if (!content) return '';

  if (isHtml) {
    // Remove Gmail quote markers and redundant content
    return content
      .replace(/<div class="gmail_quote"[\s\S]*?<\/div>/g, '') // Remove Gmail quotes
      .replace(/<blockquote class="gmail_quote"[\s\S]*?<\/blockquote>/g, '') // Remove blockquotes
      .replace(/On.*wrote:[\s\S]*$/gm, '') // Remove attribution lines
      .trim();
  } else {
    // Remove plain text quotes
    return content
      .replace(/^>.*$/gm, '') // Remove quoted lines
      .replace(/On.*wrote:[\s\S]*$/gm, '') // Remove attribution lines
      .trim();
  }
}

function processMessagePart(part: gmail_v1.Schema$MessagePart): { text: string; html: string } {
  let text = '';
  let html = '';

  // Function to decode base64 content
  const decodeBase64 = (data: string) => {
    try {
      return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    } catch (error) {
      console.error('Error decoding base64:', error);
      return '';
    }
  };

  // Function to process a single part
  const processPart = (part: gmail_v1.Schema$MessagePart) => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text = cleanQuotedText(decodeBase64(part.body.data), false);
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html = cleanQuotedText(decodeBase64(part.body.data), true);
    }

    // Recursively process multipart messages
    if (part.parts) {
      part.parts.forEach(subPart => {
        const { text: subText, html: subHtml } = processPart(subPart);
        if (subText) text = text || subText;
        if (subHtml) html = html || subHtml;
      });
    }

    return { text, html };
  };

  // Process the main part
  return processPart(part);
}

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
            format: 'full',  // Ensure we get full message content
            metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Message-ID', 'References', 'In-Reply-To']
          });

          console.log('🔍 STEP 1 - Raw thread data from Gmail API:', {
            threadId: thread.id,
            messageCount: threadData.data.messages?.length || 0,
            firstMessageHeaders: threadData.data.messages?.[0]?.payload?.headers,
            hasMessages: !!threadData.data.messages,
            messagesWithPayload: threadData.data.messages?.filter(m => !!m.payload).length || 0
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

    // Format threads with complete header info by scanning all messages
    const formattedThreads = validThreads.map(thread => {
      if (!thread.messages) {
        console.log('Thread has no messages:', thread.id);
        return null;
      }

      console.log(`Processing thread ${thread.id} with ${thread.messages.length} messages`);

      // Sort messages chronologically (oldest to newest)
      const sortedMessages = thread.messages.sort(
        (a, b) => parseInt(a.internalDate || '0') - parseInt(b.internalDate || '0')
      );

      // Process each message in the thread
      const processedMessages = sortedMessages.map(message => {
        if (!message.payload?.headers) return null;

        // Create header map for this specific message
        const headers = new Map(
          message.payload.headers.map(header => [
            header.name?.toLowerCase() || '',
            header.value || ''
          ])
        );

        // Extract message content
        const { text, html } = processMessagePart(message.payload);
        const content = html || text || message.snippet || '';

        return {
          id: message.id || '',
          subject: headers.get('subject') || 'No Subject',
          sender: headers.get('from') || '',
          content: content,
          receivedAt: headers.get('date') ||
            (message.internalDate ? new Date(parseInt(message.internalDate)).toISOString() : new Date().toISOString())
        };
      }).filter((msg): msg is NonNullable<typeof msg> => msg !== null);

      // Use the most recent message as the main thread content
      const latestMessage = processedMessages[processedMessages.length - 1];

      return {
        id: thread.id || '',
        threadId: thread.id || '',
        subject: latestMessage.subject,
        sender: latestMessage.sender,
        content: latestMessage.content,
        receivedAt: latestMessage.receivedAt,
        threadMessages: processedMessages
      };
    }).filter((thread): thread is NonNullable<typeof thread> => thread !== null);

    // Sort threads by the date of their most recent message (newest first)
    formattedThreads.sort((a, b) =>
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    );

    // Add final debug log before returning
    console.log('Final formatted threads:', formattedThreads.map(t => ({
      threadId: t.threadId,
      messageCount: t.threadMessages.length,
      messageIds: t.threadMessages.map(m => m.id)
    })));

    return NextResponse.json({
      threads: formattedThreads,
      count: formattedThreads.length
    });
  } catch (error: unknown) {
    console.error('Error fetching email threads:', error);

    if (!isGmailError(error)) {
      return NextResponse.json({
        error: 'Failed to fetch email threads',
        details: error instanceof Error ? error.message : 'An unexpected error occurred'
      }, { status: 500 });
    }

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
      const apiError = error.response.data.error;
      return NextResponse.json({
        error: 'Gmail API error',
        details: apiError.message || 'An error occurred while fetching emails',
        code: apiError.code
      }, { status: error.response.status || 500 });
    }

    // Network or other errors
    return NextResponse.json({
      error: 'Failed to fetch email threads',
      details: error.message || 'An unexpected error occurred while fetching emails'
    }, { status: 500 });
  }
}
