'use client';

import { useState } from 'react';
import { GmailService } from '@/lib/services/gmailService';
import { useAuth } from '@/lib/hooks/useAuth';

interface Email {
  id: string;
  snippet: string;
  payload: {
    headers: {
      name: string;
      value: string;
    }[];
    parts?: {
      mimeType: string;
      body: {
        data?: string;
      };
    }[];
    body?: {
      data?: string;
    };
  };
  internalDate: string;
}

export default function EmailDisplay({ userEmail }: { userEmail: string }) {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const { gmailAccessToken } = useAuth();

  const fetchEmails = async () => {
    if (!gmailAccessToken) return;
    
    setLoading(true);
    try {
      const gmailService = new GmailService(gmailAccessToken);
      const messageList = await gmailService.listEmails(10); // Fetch last 10 emails
      
      const emailDetails = await Promise.all(
        messageList.map((msg: { id: string }) => gmailService.getEmail(msg.id))
      );
      
      setEmails(emailDetails);
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      setLoading(false);
    }
  };

  const getHeader = (email: Email, headerName: string) => {
    return email.payload.headers.find(h => h.name.toLowerCase() === headerName.toLowerCase())?.value || '';
  };

  const decodeEmailBody = (email: Email) => {
    let body = '';
    
    if (email.payload.parts) {
      // Handle multipart message
      const textPart = email.payload.parts.find(part => 
        part.mimeType === 'text/plain' || part.mimeType === 'text/html'
      );
      if (textPart?.body?.data) {
        body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
    } else if (email.payload.body?.data) {
      // Handle single part message
      body = atob(email.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }
    
    return body;
  };

  const formatDate = (dateString: string) => {
    return new Date(parseInt(dateString)).toLocaleString();
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">
          Email Correspondence with {userEmail}
        </h2>
        <button
          onClick={fetchEmails}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          {loading ? 'Loading...' : 'Refresh Emails'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-4">Loading emails...</div>
      ) : (
        <div className="space-y-4">
          {emails.map((email) => (
            <div
              key={email.id}
              className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow bg-white"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-semibold">
                    From: {getHeader(email, 'From')}
                  </div>
                  <div className="text-sm text-gray-600">
                    To: {getHeader(email, 'To')}
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  {formatDate(email.internalDate)}
                </div>
              </div>
              
              <div className="font-medium mb-2">
                Subject: {getHeader(email, 'Subject')}
              </div>
              
              <div className="mt-2 text-gray-700 whitespace-pre-wrap">
                {decodeEmailBody(email)}
              </div>
            </div>
          ))}

          {emails.length === 0 && !loading && (
            <div className="text-center py-8 text-gray-500">
              No emails found. Click refresh to load emails.
            </div>
          )}
        </div>
      )}
    </div>
  );
} 