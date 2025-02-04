import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getAuth } from '@/lib/firebase/firebaseUtils';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getOAuth2Client } from '@/lib/google/auth';

export async function POST(req: Request) {
  try {
    const { count } = await req.json();
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get user's Gmail credentials from Firestore
    const db = getFirebaseDB();
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const userData = userDoc.data();

    if (!userData?.googleTokens) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(userData.googleTokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // List emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: count,
    });

    const emails = [];
    for (const message of response.data.messages || []) {
      const email = await gmail.users.messages.get({
        userId: 'me',
        id: message.id!,
      });

      const headers = email.data.payload?.headers;
      const subject = headers?.find(h => h.name === 'Subject')?.value || '';
      const from = headers?.find(h => h.name === 'From')?.value || '';
      const date = headers?.find(h => h.name === 'Date')?.value || '';

      // Get email body
      let body = '';
      if (email.data.payload?.parts) {
        for (const part of email.data.payload.parts) {
          if (part.mimeType === 'text/plain') {
            body = Buffer.from(part.body?.data || '', 'base64').toString();
            break;
          }
        }
      } else if (email.data.payload?.body?.data) {
        body = Buffer.from(email.data.payload.body.data, 'base64').toString();
      }

      emails.push({
        subject,
        from,
        date,
        body,
      });
    }

    return NextResponse.json(emails);
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    );
  }
} 