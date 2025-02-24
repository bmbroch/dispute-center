import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Get the session with the correct auth options
    const session = await getServerSession(authOptions);

    if (!session?.user?.accessToken) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Initialize the People API client with the correct scopes
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({ access_token: session.user.accessToken });

    const people = google.people({ version: 'v1', auth: oauth2Client });

    try {
      // First try to get the profile directly
      const { data } = await people.people.get({
        resourceName: `people/${email}`,
        personFields: 'photos'
      });

      if (data.photos?.[0]?.url) {
        return NextResponse.json({ pictureUrl: data.photos[0].url });
      }
    } catch (e) {
      // If direct lookup fails, try search
      const { data } = await people.people.searchDirectoryPeople({
        query: email,
        readMask: 'photos',
        sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE']
      });

      if (data.people?.[0]?.photos?.[0]?.url) {
        return NextResponse.json({ pictureUrl: data.people[0].photos[0].url });
      }
    }

    // If no photo found, return 404
    return NextResponse.json({ error: 'No profile picture available' }, { status: 404 });
  } catch (error) {
    console.error('Error fetching profile picture:', error);
    return NextResponse.json({ error: 'Failed to fetch profile picture' }, { status: 500 });
  }
}
