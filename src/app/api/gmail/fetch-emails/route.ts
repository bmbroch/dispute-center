import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailListResponse {
  data: {
    messages?: GmailMessage[];
    nextPageToken?: string;
  };
}

interface GmailMessageResponse {
  data: {
    id: string;
    threadId: string;
    snippet: string;
    payload: {
      headers: Array<{
        name: string;
        value: string;
      }>;
      parts?: Array<{
        mimeType: string;
        body: {
          data?: string;
        };
      }>;
      body?: {
        data?: string;
      };
    };
  };
}

export async function POST(request: Request) {
  try {
    const { token, count = 10, query = '' } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 400 });
    }

    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({ access_token: token });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    const gmailResponse: GmailListResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: count,
      q: query
    });

    if (!gmailResponse.data.messages) {
      return NextResponse.json({ emails: [] });
    }

    const emails = await Promise.all(
      gmailResponse.data.messages.map(async (message) => {
        const response: GmailMessageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        });

        const headers = response.data.payload.headers;
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
        const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

        let body = '';
        if (response.data.payload.parts) {
          for (const part of response.data.payload.parts) {
            if (part.mimeType === 'text/plain' && part.body.data) {
              body += Buffer.from(part.body.data, 'base64').toString();
            }
          }
        } else if (response.data.payload.body?.data) {
          body = Buffer.from(response.data.payload.body.data, 'base64').toString();
        }

        return {
          id: response.data.id,
          threadId: response.data.threadId,
          subject,
          from,
          date,
          body: body || response.data.snippet || 'No content available',
          snippet: response.data.snippet
        };
      })
    );

    return NextResponse.json({ emails });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    );
  }
} 