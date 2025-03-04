import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google } from 'googleapis';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { extractEmailBody } from '@/lib/utils/email';
import { getFirestore } from 'firebase-admin/firestore';

// Constants for processing
const BATCH_SIZE = 20;
const RATE_LIMIT_DELAY = 1000;
const DEFAULT_LIMIT = 50; // Default number of emails to refresh

export async function GET(request: NextRequest) {
  try {
    // Get access token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }
    const accessToken = authHeader.split(' ')[1];

    // Get limit from query parameters (optional)
    const searchParams = new URL(request.url).searchParams;
    const limit = parseInt(searchParams.get('limit') || `${DEFAULT_LIMIT}`);

    // Initialize Gmail client
    const oauth2Client = await getOAuth2Client({
      access_token: accessToken,
      token_type: 'Bearer'
    });

    if (!oauth2Client) {
      return NextResponse.json({ error: 'Failed to initialize OAuth2 client' }, { status: 500 });
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Initialize Firestore
    const firebaseApp = getFirebaseAdmin();
    if (!firebaseApp) {
      return NextResponse.json({ error: 'Failed to initialize Firebase Admin' }, { status: 500 });
    }
    const db = getFirestore(firebaseApp);

    // Build the query string
    const queryString = 'in:inbox -label:automated-reply';

    // Fetch threads
    const response = await gmail.users.threads.list({
      userId: 'me',
      maxResults: limit,
      q: queryString,
    });

    const threads = response.data.threads || [];
    const nextPageToken = response.data.nextPageToken;

    console.log(`Retrieved ${threads.length} threads from Gmail`);

    // Process threads with rate limiting
    const processedThreads = [];
    for (let i = 0; i < threads.length; i += BATCH_SIZE) {
      const batch = threads.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (thread) => {
        try {
          const threadDetails = await gmail.users.threads.get({
            userId: 'me',
            id: thread.id!,
            format: 'full', // Get full message details
          });

          // Get the most recent message from the thread
          const messages = threadDetails.data.messages || [];
          const mostRecentMessage = messages[messages.length - 1];

          if (!mostRecentMessage || !mostRecentMessage.payload) {
            return null;
          }

          // Extract email content and check for HTML
          const extractResult = extractEmailBody(mostRecentMessage);
          const { content, contentType } = extractResult;

          // Check if content is HTML
          const isHtml = content?.includes('<div') || content?.includes('<html') || content?.includes('<body');

          // Format content properly for the EmailRenderNew component
          const formattedContent = (contentType === 'text/html' || isHtml) ? content : { text: content, html: null };

          // Get thread messages for context
          const threadMessages = messages.map(message => {
            const { content: messageContent, contentType: messageContentType } = extractEmailBody(message);
            const messageIsHtml = messageContent?.includes('<div') || messageContent?.includes('<html') || messageContent?.includes('<body');

            // Format thread message content
            const formattedMessageContent = (messageContentType === 'text/html' || messageIsHtml) ? messageContent : { text: messageContent, html: null };

            return {
              id: message.id!,
              threadId: thread.id!,
              subject: message.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
              sender: message.payload?.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
              content: formattedMessageContent,
              contentType: messageContentType || 'text/plain',
              receivedAt: parseInt(message.internalDate || '0')
            };
          }).reverse(); // Reverse to get oldest first

          // Create response object
          const refreshedEmail = {
            id: mostRecentMessage.id!,
            threadId: thread.id!,
            subject: mostRecentMessage.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
            sender: mostRecentMessage.payload?.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
            content: formattedContent,
            contentType: contentType || mostRecentMessage.payload?.mimeType || 'text/plain',
            receivedAt: parseInt(mostRecentMessage.internalDate || '0'),
            sortTimestamp: parseInt(mostRecentMessage.internalDate || '0'),
            threadMessages
          };

          return refreshedEmail;
        } catch (error) {
          console.error(`Error processing thread ${thread.id}:`, error);
          return null;
        }
      });

      // Process batch and collect results
      const batchResults = await Promise.all(batchPromises);
      processedThreads.push(...batchResults.filter(result => result !== null));

      // Rate limiting delay between batches
      if (i + BATCH_SIZE < threads.length) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    // Filter out failed threads
    const validThreads = processedThreads.filter((thread): thread is NonNullable<typeof thread> => {
      return thread !== null &&
        typeof thread === 'object' &&
        'id' in thread &&
        'threadId' in thread &&
        'subject' in thread &&
        'sender' in thread &&
        'content' in thread &&
        'receivedAt' in thread &&
        'threadMessages' in thread;
    });

    return NextResponse.json({
      emails: validThreads,
      count: validThreads.length,
      nextPageToken
    });

  } catch (error) {
    console.error('Error refreshing all emails:', error);
    return NextResponse.json(
      { error: 'Failed to refresh all emails', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
