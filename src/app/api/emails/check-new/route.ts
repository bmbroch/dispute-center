import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google } from 'googleapis';

export async function POST(request: NextRequest) {
  try {
    // Get access token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }
    const accessToken = authHeader.split(' ')[1];

    // Get parameters from request body
    const { lastEmailTimestamp, existingThreadIds } = await request.json();
    if (!lastEmailTimestamp || !Array.isArray(existingThreadIds)) {
      return NextResponse.json({ error: 'lastEmailTimestamp and existingThreadIds array are required' }, { status: 400 });
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

    // Create a date filter for emails after the last timestamp
    const dateFilter = new Date(lastEmailTimestamp);
    const query = `after:${Math.floor(dateFilter.getTime() / 1000)}`; // Convert to Unix timestamp

    try {
      // List threads matching our criteria
      const response = await gmail.users.threads.list({
        userId: 'me',
        q: query,
        maxResults: 50 // Limit to avoid processing too many at once
      });

      const threads = response.data.threads || [];

      // Filter out threads we already have
      const newThreads = threads.filter(thread =>
        thread.id && !existingThreadIds.includes(thread.id)
      );

      // Get the thread IDs from the new threads
      const newThreadIds = newThreads.map(thread => thread.id!);

      return NextResponse.json({
        newEmailsCount: newThreads.length,
        totalFound: threads.length,
        hasMore: Boolean(response.data.nextPageToken),
        newThreadIds // Include the new thread IDs in the response
      });
    } catch (apiError: any) {
      // Check if this is an authentication error
      if (apiError.code === 401 ||
        (apiError.response && apiError.response.status === 401) ||
        apiError.message === 'Invalid Credentials') {
        console.error('Authentication error in Gmail API:', apiError);
        return NextResponse.json(
          { error: 'TOKEN_EXPIRED', details: 'Your authentication token has expired' },
          { status: 401 }
        );
      }

      // For other API errors, pass them through
      throw apiError;
    }
  } catch (error) {
    console.error('Error checking for new emails:', error);
    return NextResponse.json(
      { error: 'Failed to check for new emails', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
