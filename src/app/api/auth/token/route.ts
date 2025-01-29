import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GOOGLE_OAUTH_CONFIG } from '@/lib/firebase/firebase';

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();
    console.log('Received auth code:', code ? 'Present' : 'Missing');

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

    // Get the redirect URI from the environment or construct it from the origin
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/callback/google`;
    console.log('Using redirect URI:', redirectUri);

    const tokenRequestBody = {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    } as const;

    console.log('Token request config:', {
      hasClientId: !!tokenRequestBody.client_id,
      hasClientSecret: !!tokenRequestBody.client_secret,
      redirectUri: tokenRequestBody.redirect_uri,
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(tokenRequestBody),
    });

    const responseText = await response.text();
    console.log('Google OAuth response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseText,
    });

    if (!response.ok) {
      console.error('Token exchange failed:', responseText);
      return NextResponse.json({ 
        error: 'Failed to exchange code for tokens',
        details: responseText
      }, { status: response.status });
    }

    const tokens = JSON.parse(responseText);
    
    // Create the response with the tokens
    const responseToSend = NextResponse.json(tokens);

    // Set the auth cookie
    const cookieStore = await cookies();
    cookieStore.set('auth', 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Expire in 30 days
      maxAge: 60 * 60 * 24 * 30,
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