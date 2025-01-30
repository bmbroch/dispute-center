import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const email = searchParams.get('email');
    const authHeader = req.headers.get('Authorization');

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    if (!authHeader) {
      return NextResponse.json({ error: 'Authorization header is required' }, { status: 401 });
    }

    const accessToken = authHeader.split(' ')[1];
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Search for the most recent email in the thread
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `to:${email} OR from:${email}`,
      maxResults: 1
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      return NextResponse.json({ lastEmailTime: null });
    }

    const message = await gmail.users.messages.get({
      userId: 'me',
      id: response.data.messages[0].id!,
      format: 'metadata',
      metadataHeaders: ['From']
    });

    const fromHeader = message.data.payload?.headers?.find(h => h.name === 'From');
    const fromEmail = fromHeader?.value?.match(/<(.+)>/)?.[1] || fromHeader?.value || '';
    const isFromCustomer = fromEmail.toLowerCase().includes(email.toLowerCase());

    const lastEmailTime = message.data.internalDate 
      ? new Date(parseInt(message.data.internalDate)).toISOString()
      : null;

    return NextResponse.json({ 
      lastEmailTime,
      isFromCustomer
    });
  } catch (error) {
    console.error('Error fetching last email time:', error);
    return NextResponse.json(
      { error: 'Failed to fetch last email time' },
      { status: 500 }
    );
  }
} 