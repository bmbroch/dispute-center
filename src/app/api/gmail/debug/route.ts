import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  const debugInfo: any = {
    environmentCheck: {},
    oauthConfig: {},
    authHeader: null,
    error: null
  };

  try {
    // 1. Check environment variables
    const requiredVars = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI'
    ];

    requiredVars.forEach(varName => {
      debugInfo.environmentCheck[varName] = {
        exists: !!process.env[varName],
        value: process.env[varName] ? `${process.env[varName]?.substring(0, 8)}...` : null
      };
    });

    // 2. Get and check authorization header
    const authHeader = request.headers.get('Authorization');
    debugInfo.authHeader = {
      exists: !!authHeader,
      format: authHeader ? authHeader.startsWith('Bearer ') ? 'valid' : 'invalid' : null,
      token: authHeader ? `${authHeader.substring(0, 15)}...` : null
    };

    if (!authHeader) {
      throw new Error('No authorization header provided');
    }

    const accessToken = authHeader.replace('Bearer ', '');
    if (!accessToken) {
      throw new Error('No access token provided');
    }

    // 3. Test OAuth2 client initialization
    try {
      const oauth2Client = getOAuth2Client();
      debugInfo.oauthConfig.clientInitialized = true;
      debugInfo.oauthConfig.clientId = process.env.GOOGLE_CLIENT_ID?.substring(0, 8) + '...';
      debugInfo.oauthConfig.redirectUri = process.env.GOOGLE_REDIRECT_URI;

      // 4. Test setting credentials
      oauth2Client.setCredentials({ 
        access_token: accessToken,
        scope: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.send'
        ].join(' ')
      });
      debugInfo.oauthConfig.credentialsSet = true;

      // 5. Test Gmail API initialization
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      debugInfo.oauthConfig.gmailClientInitialized = true;

      // 6. Test API call
      const profile = await gmail.users.getProfile({ userId: 'me' });
      debugInfo.apiTest = {
        success: true,
        emailAddress: profile.data.emailAddress,
        messagesTotal: profile.data.messagesTotal,
        threadsTotal: profile.data.threadsTotal
      };

    } catch (error: any) {
      debugInfo.oauthConfig.error = {
        message: error.message,
        stack: error.stack
      };
      throw error;
    }

    return NextResponse.json({
      status: 'success',
      debug: debugInfo
    });

  } catch (error: any) {
    debugInfo.error = {
      message: error.message,
      stack: error.stack
    };

    return NextResponse.json({
      status: 'error',
      debug: debugInfo
    }, { status: 500 });
  }
} 