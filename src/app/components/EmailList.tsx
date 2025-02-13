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

const EmailSkeleton = () => (
  <div className="space-y-6">
    {[1, 2, 3].map((i) => (
      <div key={i} className="bg-white shadow rounded-lg overflow-hidden animate-pulse">
        <div className="p-6">
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-3 bg-gray-100 rounded w-1/2"></div>
            <div className="h-16 bg-gray-50 rounded w-full mt-4"></div>
            <div className="flex justify-end space-x-3">
              <div className="h-8 bg-gray-200 rounded w-24"></div>
              <div className="h-8 bg-gray-100 rounded w-24"></div>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

export default function EmailList() {
  const { user } = useAuth();
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<string[]>([]);

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
    return <EmailSkeleton />;
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

  const toggleThread = (threadId: string) => {
    setExpandedThreads((prev) =>
      prev.includes(threadId)
        ? prev.filter((id) => id !== threadId)
        : [...prev, threadId]
    );
  };

  return (
    <div className="container mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Your Recent Emails</h2>
      <div className="space-y-6">
        {emails.map((email) => {
          const isExpanded = expandedThreads.includes(email.id);

          return (
            <div
              key={email.id}
              className="bg-white shadow rounded-lg overflow-hidden"
            >
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900">
                  {getHeader(email, 'Subject') || 'No Subject'}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  From: {getHeader(email, 'From')} •&nbsp;
                  {new Date(getHeader(email, 'Date') || '').toLocaleString()}
                </p>
                <div className="mt-4 text-gray-800 whitespace-pre-wrap">
                  {email.snippet}
                </div>

                <button
                  onClick={() => toggleThread(email.id)}
                  className="mt-4 inline-flex items-center px-4 py-2 border 
                    border-transparent text-sm font-medium rounded-md 
                    shadow-sm text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                >
                  {isExpanded ? 'Hide Thread' : 'Show Thread'}
                </button>
              </div>

              {isExpanded && (
                <div className="px-6 pb-6">
                  {emails.map((msg) => (
                    <div key={msg.id} className="border-b border-gray-200 pt-4 pb-4">
                      <p className="text-sm text-gray-500">
                        From: {getHeader(msg, 'From')} • {new Date(getHeader(msg, 'Date') || '').toLocaleString()}
                      </p>
                      <p className="mt-2 text-gray-700 whitespace-pre-wrap">
                        {msg.snippet}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
} 