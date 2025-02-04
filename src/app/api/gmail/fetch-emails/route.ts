import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';

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

    // Get only 100 emails for testing
    const response = await gmail.users.messages.list({
      auth: oauth2Client,
      userId: 'me',
      maxResults: 100,
    });

    const messages = response.data.messages || [];
    const emailDetails = [];

    // Fetch details for each email
    for (const message of messages) {
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
        const textPart = emailData.data.payload.parts.find(
          part => part.mimeType === 'text/plain'
        );
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString();
        }
      } else if (emailData.data.payload?.body?.data) {
        body = Buffer.from(emailData.data.payload.body.data, 'base64').toString();
      }

      emailDetails.push({
        id: message.id,
        subject,
        from,
        to,
        date,
        body,
      });
    }

    return NextResponse.json({ emails: emailDetails });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    );
  }
} 