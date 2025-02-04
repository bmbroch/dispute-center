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
    let response: { emails: any[]; nextPageToken?: string } = { emails: [] };

    // Keep fetching emails until we have enough valid ones or hit the max batch limit
    while (emailDetails.length < 50 && batchCount < MAX_BATCHES) {
      const response = await gmail.users.messages.list({
        auth: oauth2Client,
        userId: 'me',
        maxResults: BATCH_SIZE,
        pageToken: pageToken,
      });

      const messages = response.data.messages || [];
      pageToken = response.data.nextPageToken;

      // Fetch details for each email
      for (const message of messages) {
        if (emailDetails.length >= 50) break;

        const emailData = await gmail.users.messages.get({
          auth: oauth2Client,
          userId: 'me',
          id: message.id!,
          format: 'full',
        });

        const headers = emailData.data.payload?.headers;
        const subject = headers?.find(h => h.name === 'Subject')?.value;
        const from = headers?.find(h => h.name === 'From')?.value;
        const to = headers?.find(h => h.name === 'To')?.value;
        const date = headers?.find(h => h.name === 'Date')?.value;

        // Get email body
        let body = '';
        if (emailData.data.payload?.parts) {
          // Try to find text/plain part first
          const textPart = emailData.data.payload.parts.find(
            part => part.mimeType === 'text/plain'
          );
          // Fallback to text/html if no plain text
          const htmlPart = !textPart ? emailData.data.payload.parts.find(
            part => part.mimeType === 'text/html'
          ) : null;
          
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString();
          } else if (htmlPart?.body?.data) {
            body = Buffer.from(htmlPart.body.data, 'base64').toString();
          }
        } else if (emailData.data.payload?.body?.data) {
          body = Buffer.from(emailData.data.payload.body.data, 'base64').toString();
        }

        // Only add emails that have a body
        if (body.trim()) {
          emailDetails.push({
            id: message.id,
            subject,
            from,
            to,
            date,
            body,
          });
        }
      }

      batchCount++;
      if (!pageToken) break;
    }

    if (emailDetails.length === 0) {
      return NextResponse.json(
        { error: 'No valid emails found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      emails: emailDetails,
      totalFetched: emailDetails.length,
      batchesUsed: batchCount
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    );
  }
} 