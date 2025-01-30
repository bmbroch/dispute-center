import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GOOGLE_OAUTH_CONFIG, getAllowedRedirectUris } from '@/lib/firebase/firebase';

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();
    console.log('Received auth code:', code ? code.substring(0, 10) + '...' : 'Missing');

    if (!code) {
      return NextResponse.json({ error: 'No authorization code provided' }, { status: 400 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error('Missing required environment variables:', {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret
      });
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Get the origin from the request
    const origin = request.headers.get('origin') || 'http://localhost:3002';
    
    // Find the matching redirect URI based on the origin
    const redirectUri = getAllowedRedirectUris().find(uri => uri.startsWith(origin)) || 
                       `${origin}/api/auth/callback/google`;

    console.log('Token exchange configuration:', {
      clientIdPrefix: clientId.substring(0, 10) + '...',
      hasClientSecret: !!clientSecret,
      redirectUri,
      origin
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const responseText = await tokenResponse.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse token response:', responseText);
      return NextResponse.json({ 
        error: 'Invalid response from Google',
        details: responseText
      }, { status: 500 });
    }

    console.log('Google OAuth response:', {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      hasAccessToken: !!responseData.access_token,
      hasRefreshToken: !!responseData.refresh_token,
      hasIdToken: !!responseData.id_token,
      error: responseData.error,
      errorDescription: responseData.error_description
    });

    if (!tokenResponse.ok) {
      return NextResponse.json({ 
        error: 'Failed to exchange code for tokens',
        details: responseData.error_description || responseData.error || 'Unknown error'
      }, { status: tokenResponse.status });
    }

    // Validate the response has required fields
    if (!responseData.access_token || !responseData.id_token) {
      console.error('Invalid token response:', responseData);
      return NextResponse.json({ 
        error: 'Invalid token response',
        details: 'Missing required tokens'
      }, { status: 500 });
    }

    // Create the response with the tokens
    const responseToSend = NextResponse.json(responseData);

    // Set the auth cookie
    const cookieStore = cookies();
    cookieStore.set('auth', 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return responseToSend;
  } catch (error) {
    console.error('Token exchange error:', error);
    return NextResponse.json({ 
      error: 'Token exchange failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 