import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';

const BATCH_SIZE = 100; // Number of emails to fetch per batch
const MAX_BATCHES = 5; // Maximum number of batches to prevent infinite loops

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = authHeader.replace('Bearer ', '');
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send'
      ].join(' ')
    });

    const gmail = google.gmail('v1');
    const emailDetails = [];
    let pageToken = undefined;
    let batchCount = 0;

    // Keep fetching emails until we have enough valid ones or hit the max batch limit
    while (emailDetails.length < 50 && batchCount < MAX_BATCHES) {
      const gmailResponse = await gmail.users.messages.list({
        auth: oauth2Client,
        userId: 'me',
        maxResults: BATCH_SIZE,
        pageToken: pageToken,
      });

      const messages = gmailResponse.data.messages || [];
      pageToken = gmailResponse.data.nextPageToken;

      // Fetch details for each email
      for (const message of messages) {
        if (emailDetails.length >= 50) break;

        const emailData = await gmail.users.messages.get({
          auth: oauth2Client,
          userId: 'me',
          id: message.id || '',
          format: 'full'
        });

        // Extract email details
        const headers = emailData.data.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
        const date = headers.find(h => h.name === 'Date')?.value || new Date().toISOString();

        // Extract email body
        let body = '';
        if (emailData.data.payload?.parts) {
          // Multipart email
          for (const part of emailData.data.payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body += Buffer.from(part.body.data, 'base64').toString();
            }
          }
        } else if (emailData.data.payload?.body?.data) {
          // Simple email
          body = Buffer.from(emailData.data.payload.body.data, 'base64').toString();
        }

        emailDetails.push({
          subject,
          from,
          body,
          date
        });
      }

      batchCount++;
    }

    return NextResponse.json({ emails: emailDetails });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch emails' },
      { status: 500 }
    );
  }
} 