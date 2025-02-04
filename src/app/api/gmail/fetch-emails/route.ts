import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';

const MAX_FETCH_ATTEMPTS = 3; // Maximum number of fetch attempts to avoid infinite loops
const EMAILS_PER_FETCH = 100; // Number of emails to fetch per request

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = authHeader.replace('Bearer ', '');

    // Initialize OAuth2 client using the existing setup
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
    const validEmails = [];
    let pageToken = undefined;
    let attempts = 0;

    while (validEmails.length < 50 && attempts < MAX_FETCH_ATTEMPTS) {
      attempts++;

      // Fetch batch of emails
      const response = await gmail.users.messages.list({
        auth: oauth2Client,
        userId: 'me',
        maxResults: EMAILS_PER_FETCH,
        pageToken: pageToken,
      });

      const messages = response.data.messages || [];
      pageToken = response.data.nextPageToken;

      // Fetch details for each email
      for (const message of messages) {
        if (validEmails.length >= 50) break;

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

        // Only add emails that have actual body content
        if (body.trim()) {
          validEmails.push({
            id: message.id,
            subject: subject || 'No Subject',
            from: from || 'No Sender',
            to: to || 'No Recipient',
            date: date || new Date().toISOString(),
            body,
          });
        }
      }

      // If no more emails to fetch, break the loop
      if (!pageToken) break;
    }

    if (validEmails.length === 0) {
      return NextResponse.json(
        { error: 'No valid emails found with body content' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      emails: validEmails,
      totalFetched: validEmails.length,
      reachedTarget: validEmails.length >= 50
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    );
  }
} 