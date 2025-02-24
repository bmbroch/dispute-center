import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google } from 'googleapis';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { extractEmailBody } from '@/lib/utils/email';
import { Firestore } from 'firebase/firestore';

// Batch processing constants matching existing patterns
const BATCH_SIZE = 20;
const RATE_LIMIT_DELAY = 1000;

export async function POST(request: NextRequest) {
  try {
    // Authentication check (same as single endpoint)
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }
    const accessToken = authHeader.split(' ')[1];

    // Get threadIds from request body
    const { threadIds } = await request.json();
    if (!Array.isArray(threadIds) || threadIds.length === 0) {
      return NextResponse.json({ error: 'Array of thread IDs is required' }, { status: 400 });
    }

    // Initialize clients (same pattern as single endpoint)
    const oauth2Client = await getOAuth2Client({
      access_token: accessToken,
      token_type: 'Bearer'
    });
    if (!oauth2Client) {
      return NextResponse.json({ error: 'Failed to initialize OAuth2 client' }, { status: 500 });
    }
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const firebaseApp = getFirebaseAdmin();
    if (!firebaseApp) {
      return NextResponse.json({ error: 'Failed to initialize Firebase Admin' }, { status: 500 });
    }
    const db = firebaseApp.firestore();

    // Process threads in batches matching existing rate limits
    const allRefreshedEmails = [];
    const errors = [];

    for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
      const batch = threadIds.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (threadId) => {
        try {
          const threadDetails = await gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'full'
          });

          if (!threadDetails.data.messages?.length) {
            throw new Error('No messages found in thread');
          }

          // Reuse single refresh processing logic
          const messages = threadDetails.data.messages;
          const mostRecentMessage = messages[messages.length - 1];
          const { content, contentType } = extractEmailBody(mostRecentMessage);

          // Prepare Firestore data (same structure as single refresh)
          const emailMetadata = {
            threadId,
            subject: mostRecentMessage.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
            sender: mostRecentMessage.payload?.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
            receivedAt: parseInt(mostRecentMessage.internalDate || '0'),
            lastUpdated: Date.now(),
            hasLargeContent: (content || '').length > 500000
          };

          // Batch write to Firestore
          const batch = db.batch();
          const emailDocRef = db.collection('email_cache').doc(mostRecentMessage.id!);
          const threadDocRef = db.collection('thread_cache').doc(threadId);

          batch.set(emailDocRef, emailMetadata, { merge: true });
          batch.set(threadDocRef, {
            ...emailMetadata,
            emailId: mostRecentMessage.id!
          }, { merge: true });

          await batch.commit();

          return {
            id: mostRecentMessage.id!,
            ...emailMetadata,
            content,
            contentType,
            threadMessages: messages.map(message => ({
              id: message.id!,
              content: extractEmailBody(message).content
            }))
          };
        } catch (error) {
          console.error(`Error refreshing thread ${threadId}:`, error);
          return { threadId, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      });

      // Process batch and collect results
      const batchResults = await Promise.all(batchPromises);
      allRefreshedEmails.push(...batchResults.filter(result => !result.error));
      errors.push(...batchResults.filter(result => result.error));

      // Rate limiting delay between batches
      if (i + BATCH_SIZE < threadIds.length) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    return NextResponse.json({
      refreshedEmails: allRefreshedEmails,
      successCount: allRefreshedEmails.length,
      errorCount: errors.length,
      errors
    });

  } catch (error) {
    console.error('Error in batch refresh:', error);
    return NextResponse.json(
      { error: 'Failed to process batch refresh', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
