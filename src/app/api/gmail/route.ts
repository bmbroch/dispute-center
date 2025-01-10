import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const disputeEmail = request.headers.get('X-Dispute-Email');
  
  if (!authHeader || !disputeEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = authHeader.replace('Bearer ', '');

  try {
    // Query Gmail API for emails related to this dispute
    const query = `from:${disputeEmail} OR to:${disputeEmail}`;
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch emails');
    }

    const data = await response.json();
    const emails = await Promise.all(
      data.messages.slice(0, 10).map(async (message: { id: string }) => {
        const emailResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );
        return emailResponse.json();
      })
    );

    // Process and format the emails
    const formattedEmails = await Promise.all(emails.map(async email => {
      // Get the email body parts
      const parts = email.payload.parts || [email.payload];
      let body = '';

      // Function to decode base64 content
      const decodeBody = (data: string) => {
        try {
          return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
        } catch (error) {
          console.error('Error decoding email body:', error);
          return '';
        }
      };

      // Recursively find text/plain or text/html parts
      const findBody = (parts: any[]): string => {
        for (const part of parts) {
          if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
            return decodeBody(part.body.data || '');
          }
          if (part.parts) {
            const foundBody = findBody(part.parts);
            if (foundBody) return foundBody;
          }
        }
        return '';
      };

      // Try to get the body from parts or from the payload directly
      if (parts) {
        body = findBody(parts);
      } else if (email.payload.body.data) {
        body = decodeBody(email.payload.body.data);
      }

      return {
        id: email.id,
        subject: email.payload.headers.find((h: any) => h.name === 'Subject')?.value || 'No Subject',
        from: email.payload.headers.find((h: any) => h.name === 'From')?.value || '',
        to: email.payload.headers.find((h: any) => h.name === 'To')?.value || '',
        date: email.payload.headers.find((h: any) => h.name === 'Date')?.value || '',
        body: body || email.snippet || ''
      };
    }));

    return NextResponse.json({ emails: formattedEmails });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
  }
} 