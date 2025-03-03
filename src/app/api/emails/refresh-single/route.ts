import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google } from 'googleapis';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { extractEmailBody } from '@/lib/utils/email';

export async function POST(request: NextRequest) {
  try {
    // Get access token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }
    const accessToken = authHeader.split(' ')[1];

    // Get threadId from request body
    const { threadId } = await request.json();
    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 });
    }

    // Initialize Gmail client
    const oauth2Client = await getOAuth2Client({
      access_token: accessToken,
      token_type: 'Bearer'
    });

    if (!oauth2Client) {
      return NextResponse.json({ error: 'Failed to initialize OAuth2 client' }, { status: 500 });
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get thread details
    const threadDetails = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    if (!threadDetails.data.messages || threadDetails.data.messages.length === 0) {
      return NextResponse.json({ error: 'No messages found in thread' }, { status: 404 });
    }

    // Get the most recent message
    const messages = threadDetails.data.messages;
    const mostRecentMessage = messages[messages.length - 1];

    // Extract the internalDate (received timestamp) - critical for timestamp preservation
    const internalDate = mostRecentMessage.internalDate || '0';
    const receivedAt = parseInt(internalDate);

    // Extract email content
    const { content, contentType } = extractEmailBody(mostRecentMessage);

    // Get thread messages for context
    const threadMessages = messages.map(message => {
      const { content: messageContent } = extractEmailBody(message);
      return {
        id: message.id!,
        threadId: threadId,
        subject: message.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
        sender: message.payload?.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
        content: messageContent || '',
        receivedAt: parseInt(message.internalDate || '0')
      };
    }).reverse(); // Reverse to get oldest first

    // Create response object
    const refreshedEmail = {
      id: mostRecentMessage.id!,
      threadId: threadId,
      subject: mostRecentMessage.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
      sender: mostRecentMessage.payload?.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
      content: content || '',
      contentType: contentType || 'text/plain',
      receivedAt: receivedAt,
      sortTimestamp: receivedAt, // Add explicit sortTimestamp
      threadMessages
    };

    return NextResponse.json(refreshedEmail);
  } catch (error) {
    console.error('Error refreshing email:', error);
    return NextResponse.json(
      { error: 'Failed to refresh email', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
