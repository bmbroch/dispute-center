import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google } from 'googleapis';
import { isGmailError } from '@/lib/types/gmail';

export async function POST(request: NextRequest) {
  try {
    const { to, subject, content, threadId, inReplyTo, references } = await request.json();
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    const accessToken = authHeader.replace('Bearer ', '');

    if (!to || !subject || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Initialize OAuth2 client
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });

    // Create Gmail client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Convert HTML content to RFC 2822 format
    const emailLines = [];
    emailLines.push('MIME-Version: 1.0');
    emailLines.push('Content-Type: text/html; charset=UTF-8');
    emailLines.push('Content-Transfer-Encoding: quoted-printable');
    
    // Add threading headers if this is a reply
    if (threadId) {
      if (inReplyTo) {
        emailLines.push(`In-Reply-To: ${inReplyTo}`);
      }
      if (references) {
        emailLines.push(`References: ${references}`);
      }
    }
    
    emailLines.push(`To: ${to}`);
    emailLines.push(`Subject: ${subject}`);
    emailLines.push('');

    // Create HTML email with proper Gmail structure
    const htmlEmail = `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="format-detection" content="telephone=no">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
.gmail_message {
  margin: 20px 0;
  padding: 0;
}
.gmail_header {
  color: #555;
  font-size: 13px;
  margin: 10px 0;
}
.gmail_content {
  margin: 10px 0 10px 20px;
  padding-left: 10px;
  border-left: 1px solid #ccc;
  color: #222;
}
</style>
</head>
<body style="margin:0;padding:0;word-spacing:normal;background-color:white">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:0;padding:20px;background-color:white;color:#222222">
${content}
</div>
</body>
</html>`;

    emailLines.push(htmlEmail);

    const email = emailLines.join('\r\n');

    // Encode the email in base64
    const encodedEmail = Buffer.from(email).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send the email using Gmail API
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail,
        ...(threadId && { threadId })
      }
    });

    if (!response.data) {
      throw new Error('Failed to send email: No response data');
    }

    return NextResponse.json({ 
      success: true,
      messageId: response.data.id,
      threadId: response.data.threadId
    });
  } catch (error: unknown) {
    console.error('Error sending email:', error);
    
    if (!isGmailError(error)) {
      return NextResponse.json({ 
        error: 'Failed to send email',
        details: error instanceof Error ? error.message : 'An unexpected error occurred'
      }, { status: 500 });
    }
    
    // Check if error is due to invalid credentials
    if (error.response?.status === 401) {
      return NextResponse.json({ 
        error: 'Token expired',
        details: 'Please refresh your access token'
      }, { status: 401 });
    }

    // Check for rate limiting
    if (error.response?.status === 429) {
      return NextResponse.json({
        error: 'Rate limit exceeded',
        details: 'Too many requests. Please try again in a few minutes.'
      }, { status: 429 });
    }

    // Check for Gmail API specific errors
    if (error.response?.data?.error) {
      const apiError = error.response.data.error;
      return NextResponse.json({
        error: 'Gmail API error',
        details: apiError.message || 'An error occurred while sending email',
        code: apiError.code
      }, { status: error.response.status || 500 });
    }

    // Network or other errors
    return NextResponse.json({ 
      error: 'Failed to send email',
      details: error.message || 'An unexpected error occurred while sending email'
    }, { status: 500 });
  }
} 