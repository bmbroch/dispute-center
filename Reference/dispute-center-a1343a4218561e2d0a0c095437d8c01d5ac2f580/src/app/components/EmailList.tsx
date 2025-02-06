'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';

interface EmailMessage {
  id: string;
  snippet: string;
  payload: {
    headers: {
      name: string;
      value: string;
    }[];
  };
}

export default function EmailList() {
  const { user } = useAuth();
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEmails = async () => {
      if (!user?.accessToken) return;
      
      try {
        const response = await fetch('/api/gmail', {
          headers: {
            'Authorization': `Bearer ${user.accessToken}`
          }
        });

        const data = await response.json();
        console.log('API Response:', data);

        if (!response.ok) {
          const errorMessage = data.details ? `${data.error}: ${data.details}` : data.error;
          throw new Error(errorMessage || 'Failed to fetch emails');
        }

        if (Array.isArray(data.messages)) {
          console.log('Received emails:', data.messages.length);
          setEmails(data.messages);
        } else {
          console.error('Invalid response format:', data);
          throw new Error('Invalid response format from Gmail API');
        }
      } catch (err) {
        console.error('Error fetching emails:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch emails');
      } finally {
        setLoading(false);
      }
    };

    fetchEmails();
  }, [user]);

  if (!user) {
    return <div className="p-4">Please sign in to view your emails.</div>;
  }

  if (loading) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center space-x-2">
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse"></div>
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse delay-75"></div>
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse delay-150"></div>
        </div>
        <div className="text-center mt-2">Loading your recent emails...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-500 mb-2">Error: {error}</div>
        <button 
          onClick={() => window.location.reload()}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="p-4 text-center">
        <div className="text-gray-500">No emails found</div>
      </div>
    );
  }

  const getHeader = (email: EmailMessage, headerName: string) => {
    return email.payload.headers.find(h => h.name.toLowerCase() === headerName.toLowerCase())?.value || '';
  };

  return (
    <div className="container mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Your Recent Emails</h2>
      <div className="space-y-4">
        {emails.map((email) => (
          <div key={email.id} className="border rounded-lg p-4 hover:bg-gray-50">
            <div className="font-semibold">{getHeader(email, 'Subject')}</div>
            <div className="text-sm text-gray-600">
              From: {getHeader(email, 'From')}
            </div>
            <div className="text-sm text-gray-500 mt-2">{email.snippet}</div>
          </div>
        ))}
      </div>
    </div>
  );
} 