import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const headersList = headers();
  const origin = headersList.get('origin') || process.env.NEXTAUTH_URL || '';

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  try {
    // Create HTML that will send the code to the parent window and close
    const html = `
      <html>
        <head>
          <title>Authentication Callback</title>
        </head>
        <body>
          <script>
            function isValidOrigin(origin) {
              return origin === 'http://localhost:3002' || 
                     origin === 'https://dispute-center-leli.vercel.app' ||
                     origin.endsWith('.vercel.app');
            }

            function sendMessage() {
              if (window.opener) {
                const validOrigins = [
                  'http://localhost:3002',
                  'https://dispute-center-leli.vercel.app'
                ];

                for (const origin of validOrigins) {
                  if (isValidOrigin(origin)) {
                    try {
                      window.opener.postMessage({ 
                        type: 'auth-success',
                        code: '${code}'
                      }, origin);
                    } catch (e) {
                      console.error('Failed to send to origin:', origin, e);
                    }
                  }
                }
              }
              window.close();
            }

            // Attempt to send the message
            sendMessage();
          </script>
        </body>
      </html>
    `;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cross-Origin-Opener-Policy': 'unsafe-none',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
    });
  } catch (error) {
    console.error('Error in callback:', error);
    return NextResponse.json({ error: 'Failed to process callback' }, { status: 500 });
  }
} 