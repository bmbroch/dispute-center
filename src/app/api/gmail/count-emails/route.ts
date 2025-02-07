import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { headers } from 'next/headers';
import { getOAuth2Client } from '@/lib/google/auth';

const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000; // 1 second

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryOperation<T>(
  operation: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delay: number = INITIAL_DELAY
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (retries <= 0) throw error;
    await wait(delay);
    return retryOperation(operation, retries - 1, delay * 2);
  }
}

export async function GET() {
  try {
    // Get authorization header
    const headersList = await headers();
    const authHeader = headersList.get('Authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Authentication required - please sign in again' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Invalid access token - please sign in again' },
        { status: 401 }
      );
    }

    // Initialize OAuth2 client
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get total email count with retry logic
    const response = await retryOperation(async () => {
      try {
        const result = await gmail.users.messages.list({
          userId: 'me',
          maxResults: 1,
        });
        return result;
      } catch (error: any) {
        if (error.code === 401) {
          throw new Error('Access token expired - please sign in again');
        }
        if (error.code === 403) {
          throw new Error('Gmail API access denied - please check permissions');
        }
        throw error;
      }
    });

    const totalEmails = response.data.resultSizeEstimate || 0;

    return NextResponse.json({ totalEmails });
  } catch (error: any) {
    console.error('Error counting emails:', error);
    
    // Handle specific error cases
    if (error.message.includes('access token expired')) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      );
    }
    
    if (error.message.includes('API access denied')) {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to count emails - please try again' },
      { status: 500 }
    );
  }
} 