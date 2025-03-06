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

    // Generate a boundary for multipart message
    const boundary = `----=_Part_${Math.random().toString(36).substr(2)}`;

    // Extract inline images from content
    const { processedContent, inlineImages } = extractInlineImages(content);

    // Start building email lines
    const emailLines = [];
    emailLines.push('MIME-Version: 1.0');

    // If we have inline images, use multipart/related
    if (inlineImages.length > 0) {
      emailLines.push(`Content-Type: multipart/related; boundary="${boundary}"`);
    } else {
      emailLines.push('Content-Type: text/html; charset=UTF-8');
    }

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

    // If we have inline images, create multipart message
    if (inlineImages.length > 0) {
      // First part - HTML content
      emailLines.push(`--${boundary}`);
      emailLines.push('Content-Type: text/html; charset=UTF-8');
      emailLines.push('Content-Transfer-Encoding: quoted-printable');
      emailLines.push('');
      emailLines.push(processedContent);

      // Add each inline image as a part
      inlineImages.forEach(({ contentId, mimeType, base64Data }) => {
        emailLines.push(`--${boundary}`);
        emailLines.push(`Content-Type: ${mimeType}`);
        emailLines.push('Content-Transfer-Encoding: base64');
        emailLines.push(`Content-ID: <${contentId}>`);
        emailLines.push('Content-Disposition: inline');
        emailLines.push('');
        emailLines.push(base64Data);
      });

      // Close the multipart message
      emailLines.push(`--${boundary}--`);
    } else {
      // No inline images - just add the HTML content
      emailLines.push(processedContent);
    }

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

// Helper function to extract and process inline images
function extractInlineImages(content: string) {
  const inlineImages: Array<{
    contentId: string;
    mimeType: string;
    base64Data: string;
  }> = [];

  // Find all img tags with base64 src
  let processedContent = content.replace(
    /<img[^>]+src="data:([^"]+);base64,([^"]+)"[^>]*>/g,
    (match, mimeType, base64Data) => {
      // Generate a unique content ID for this image
      const contentId = `img_${Math.random().toString(36).substr(2)}`;

      // Store the image data
      inlineImages.push({
        contentId,
        mimeType,
        base64Data: base64Data.replace(/\s/g, '') // Remove any whitespace from base64
      });

      // Replace the base64 src with a cid: reference
      return match.replace(/src="[^"]+"/, `src="cid:${contentId}"`);
    }
  );

  return { processedContent, inlineImages };
}
