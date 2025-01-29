import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

const ALLOWED_ORIGINS = [
  'http://localhost:3002',
  'https://dispute-center-leli.vercel.app'
];

const GOOGLE_OAUTH_CONFIG = {
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  scope: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
  ].join(' '),
  response_type: 'code',
  access_type: 'offline',
  prompt: 'consent select_account'
};

export async function POST(request: NextRequest) {
  try {
    // Check origin
    const origin = request.headers.get('origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new NextResponse(JSON.stringify({ error: 'Invalid origin' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const { redirectUri } = await request.json();

    // Build auth URL
    const params = new URLSearchParams({
      client_id: GOOGLE_OAUTH_CONFIG.client_id,
      redirect_uri: redirectUri,
      scope: GOOGLE_OAUTH_CONFIG.scope,
      response_type: GOOGLE_OAUTH_CONFIG.response_type,
      access_type: GOOGLE_OAUTH_CONFIG.access_type,
      prompt: GOOGLE_OAUTH_CONFIG.prompt
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return new NextResponse(JSON.stringify({ url }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    console.error('Auth error:', error);
    return new NextResponse(JSON.stringify({ error: 'Authentication failed' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
} 