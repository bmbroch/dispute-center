import { NextRequest, NextResponse } from 'next/server';

const createResponse = (content: string, origin: string) => {
  return new NextResponse(
    `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Authentication Callback</title>
        <script>
          function sendMessageAndClose(data) {
            if (window.opener) {
              window.opener.postMessage(data, '${origin}');
              // Close after a short delay to ensure message is sent
              setTimeout(() => window.close(), 500);
            }
          }
        </script>
      </head>
      <body>
        <script>
          ${content}
        </script>
      </body>
    </html>
    `,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cross-Origin-Opener-Policy': 'unsafe-none'
      },
    }
  );
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    // Get origin from request or fallback to production URL
    const origin = request.headers.get('origin') || 
                  (request.headers.get('referer')?.includes('localhost') 
                    ? 'http://localhost:3002'
                    : 'https://dispute-center-leli.vercel.app');

    if (error) {
      return createResponse(`
        sendMessageAndClose({ error: "${error}" });
      `, origin);
    }

    if (!code) {
      return createResponse(`
        sendMessageAndClose({ error: "No authorization code received" });
      `, origin);
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

    if (!tokenResponse.ok) {
      return createResponse(`
        sendMessageAndClose({ error: "Failed to get access token" });
      `, origin);
    }

    // Get user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    const userInfo = await userInfoResponse.json();

    if (!userInfoResponse.ok) {
      return createResponse(`
        sendMessageAndClose({ error: "Failed to get user info" });
      `, origin);
    }

    // Return success response
    return createResponse(`
      const data = {
        tokens: ${JSON.stringify(tokens)},
        userInfo: ${JSON.stringify(userInfo)}
      };
      sendMessageAndClose(data);
    `, origin);

  } catch (error) {
    console.error('Callback error:', error);
    const origin = request.headers.get('origin') || 
                  (request.headers.get('referer')?.includes('localhost') 
                    ? 'http://localhost:3002'
                    : 'https://dispute-center-leli.vercel.app');
    return createResponse(`
      sendMessageAndClose({ error: "Authentication failed" });
    `, origin);
  }
} 