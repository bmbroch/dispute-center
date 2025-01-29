import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  'http://localhost:3002',
  'https://dispute-center-leli.vercel.app'
];

export async function GET(request: NextRequest) {
  try {
    const origin = request.headers.get('origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new NextResponse(JSON.stringify({ error: 'Invalid origin' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      return new NextResponse(
        `<script>
          window.opener.postMessage({ error: "${error}" }, "${origin}");
          window.close();
        </script>`,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
          },
        }
      );
    }

    if (!code) {
      return new NextResponse(
        `<script>
          window.opener.postMessage({ error: "No authorization code received" }, "${origin}");
          window.close();
        </script>`,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
          },
        }
      );
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${origin}/auth/callback`,
        grant_type: 'authorization_code',
        code,
      }),
    });

    const tokens = await tokenResponse.json();

    // Get user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    const userInfo = await userInfoResponse.json();

    // Return HTML that:
    // 1. Posts message to opener (popup's parent)
    // 2. Stores tokens in localStorage
    // 3. Updates parent's window location
    return new NextResponse(
      `<script>
        // First, send data to parent window
        window.opener.postMessage({ 
          tokens: ${JSON.stringify(tokens)}, 
          userInfo: ${JSON.stringify(userInfo)} 
        }, "${origin}");

        // Store tokens in parent window's localStorage
        window.opener.localStorage.setItem('auth_tokens', JSON.stringify(${JSON.stringify(tokens)}));
        window.opener.localStorage.setItem('user_info', JSON.stringify(${JSON.stringify(userInfo)}));

        // Trigger parent window reload to update UI
        window.opener.location.reload();

        // Close popup
        window.close();
      </script>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': origin,
        },
      }
    );
  } catch (error) {
    console.error('Callback error:', error);
    return new NextResponse(
      `<script>
        window.opener.postMessage({ error: "Authentication failed" }, "*");
        window.close();
      </script>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      }
    );
  }
} 