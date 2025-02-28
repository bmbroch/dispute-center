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

    // Convert timestamp to readable format for debugging
    const lastEmailDate = new Date(lastEmailTimestamp);
    console.log(`DEBUG: Looking for emails newer than timestamp ${lastEmailTimestamp} (${lastEmailDate.toISOString()})`);
    console.log(`DEBUG: Current existing thread count: ${existingThreadIds.length}`);

    // Add a very clear log message about the cutoff date
    console.log(`=== IMPORTANT: Searching for emails NEWER THAN ${lastEmailDate.toLocaleString()} ===`);

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
    // Add a small buffer (1 second) to prevent edge cases with identical timestamps
    const dateFilter = new Date(lastEmailTimestamp + 1000);
    const formattedDate = dateFilter.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Build a more precise query using both after: and newer_than: parameters
    // The newer_than parameter uses X as a value where X is the number of days
    // We'll calculate this dynamically based on the last email timestamp
    const daysSinceLastEmail = Math.ceil((Date.now() - lastEmailTimestamp) / (1000 * 60 * 60 * 24));
    const query = `after:${Math.floor(dateFilter.getTime() / 1000)} newer_than:${daysSinceLastEmail}d`;

    console.log(`DEBUG: Checking for emails with query: ${query}`);
    console.log(`DEBUG: Search timeframe: After ${dateFilter.toISOString()} (Unix: ${Math.floor(dateFilter.getTime() / 1000)})`);
    console.log(`DEBUG: Days since last email: ${daysSinceLastEmail}`);

    try {
      // List threads matching our criteria
      const response = await gmail.users.threads.list({
        userId: 'me',
        q: query,
        maxResults: 50 // Limit to avoid processing too many at once
      });

      const threads = response.data.threads || [];

      console.log(`DEBUG: Total threads found by Gmail API: ${threads.length}`);

      // Filter out threads we already have
      const newThreads = threads.filter(thread =>
        thread.id && !existingThreadIds.includes(thread.id)
      );

      // Get the thread IDs from the new threads
      const newThreadIds = newThreads.map(thread => thread.id!);

      console.log(`DEBUG: New threads after filtering: ${newThreads.length}`);

      // If we found any threads, make an additional call to get the first thread's details
      // This will help us debug the timestamp issue
      if (newThreads.length > 0 && newThreads[0].id) {
        try {
          const threadDetails = await gmail.users.threads.get({
            userId: 'me',
            id: newThreads[0].id
          });

          if (threadDetails.data.messages && threadDetails.data.messages.length > 0) {
            const message = threadDetails.data.messages[0];
            const internalDate = message.internalDate ? parseInt(message.internalDate) : 0;

            console.log(`DEBUG: First new thread details:`);
            console.log(`DEBUG: Thread ID: ${newThreads[0].id}`);
            console.log(`DEBUG: Internal date: ${internalDate} (${new Date(internalDate).toISOString()})`);
            console.log(`DEBUG: Subject: ${message.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || 'Unknown'}`);
            console.log(`DEBUG: Time difference from last email: ${internalDate - lastEmailTimestamp}ms`);

            // Add more details about timestamps
            const dateHeader = message.payload?.headers?.find(h => h.name.toLowerCase() === 'date')?.value;
            if (dateHeader) {
              const headerDate = new Date(dateHeader).getTime();
              console.log(`DEBUG: Date header: ${dateHeader} (${new Date(headerDate).toISOString()})`);
              console.log(`DEBUG: Difference between internalDate and Date header: ${internalDate - headerDate}ms`);
            }

            if (internalDate <= lastEmailTimestamp) {
              console.log(`!!! WARNING: This email (${internalDate}) is NOT actually newer than the cutoff date (${lastEmailTimestamp})!`);
              console.log(`!!! This might indicate a problem with timestamp handling`);
            }
          }
        } catch (detailsError) {
          console.error('Error fetching thread details for debugging:', detailsError);
        }
      }

      // Add a final summary log message
      console.log(`=== SUMMARY: Found ${newThreads.length} emails newer than ${lastEmailDate.toLocaleString()} ===`);

      return NextResponse.json({
        newEmailsCount: newThreads.length,
        totalFound: threads.length,
        hasMore: Boolean(response.data.nextPageToken),
        newThreadIds, // Include the new thread IDs in the response
        cutoffDate: lastEmailDate.toISOString() // Add the cutoff date to the response
      });
    } catch (apiError: any) {
      // Check if this is an authentication error
      if (apiError.code === 401 ||
        (apiError.response && apiError.response.status === 401) ||
        apiError.message === 'Invalid Credentials') {
        console.error('Authentication error in Gmail API:', apiError);

        // Log more detailed information about the error
        console.error('Error details:', {
          message: apiError.message,
          code: apiError.code,
          response: apiError.response ? {
            status: apiError.response.status,
            statusText: apiError.response.statusText,
            data: apiError.response.data
          } : 'No response object'
        });

        return NextResponse.json(
          {
            error: 'TOKEN_EXPIRED',
            details: 'Your authentication token has expired',
            message: apiError.message,
            code: apiError.code || 401
          },
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
