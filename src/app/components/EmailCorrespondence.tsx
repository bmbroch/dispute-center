"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { CalendarDays, Clock } from 'lucide-react';
import EmailComposer from './EmailComposer';
import he from 'he';

interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  snippet: string;
}

interface Props {
  customerEmail: string;
}

const getDaysBetween = (date1: string, date2: string) => {
  console.log('Calculating days between:', { date1, date2 });
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  // Check if dates are valid
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
    console.error('Invalid date detected:', { date1, date2, d1, d2 });
    return 0;
  }
  
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  console.log('Days difference:', diffDays);
  return diffDays;
};

const decodeEmailBody = (body: string) => {
  let decodedBody = he.decode(body);
  
  decodedBody = decodedBody
    .replace(/<img/g, '<img style="max-width: 100%; height: auto;"')
    .replace(/\n/g, '<br>');
  
  return decodedBody;
};

export default function EmailCorrespondence({ customerEmail }: Props) {
  const { user, gmailAccessToken } = useAuth();
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);

  const fetchEmails = useCallback(async () => {
    if (!user || !gmailAccessToken || !customerEmail) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/gmail', {
        headers: {
          'X-Gmail-Access-Token': gmailAccessToken,
          'X-Customer-Email': customerEmail,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch emails');
      }

      // Sort messages by date in ascending order (oldest first)
      const sortedMessages = data.messages.sort((a: EmailMessage, b: EmailMessage) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      setMessages(sortedMessages);
    } catch (err) {
      console.error('Error fetching emails:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch emails');
    } finally {
      setLoading(false);
    }
  }, [user, gmailAccessToken, customerEmail]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  if (!user || !gmailAccessToken) {
    return (
      <div className="p-4 text-gray-600">
        <p>Please sign in with your Google account to view email correspondence.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        <p>Error loading email correspondence: {error}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden max-w-[800px] mx-auto">
      <div className="p-4 border-b bg-gray-50">
        <h3 className="text-lg font-medium text-gray-900">
          Email Correspondence with {customerEmail}
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          {messages.length} messages found
        </p>
      </div>

      <div className="p-4 space-y-8">
        {messages.map((message, index) => {
          const isFromCustomer = message.from.includes(customerEmail);
          const formattedDate = new Date(message.date).toLocaleString();
          const nextMessage = messages[index + 1];
          
          console.log('Rendering message:', {
            index,
            date: message.date,
            nextMessageDate: nextMessage?.date,
            hasNextMessage: !!nextMessage
          });

          return (
            <React.Fragment key={message.id}>
              <div className={`flex ${isFromCustomer ? 'justify-start' : 'justify-end'}`}>
                <div 
                  className={`relative max-w-[600px] w-full px-6 py-4 mb-12 ${
                    isFromCustomer 
                      ? 'bg-blue-600 text-white rounded-[24px] rounded-bl-none' 
                      : 'bg-gray-100 text-gray-900 rounded-[24px] rounded-br-none'
                  } shadow-lg`}
                >
                  <div className="mb-3 border-b border-opacity-20 pb-2 border-current">
                    <p className={`text-xs ${isFromCustomer ? 'text-blue-50' : 'text-gray-500'}`}>
                      {isFromCustomer ? 'From' : 'To'}: {customerEmail}
                    </p>
                    <p className={`text-xs ${isFromCustomer ? 'text-blue-50' : 'text-gray-500'}`}>
                      {formattedDate}
                    </p>
                  </div>
                  {message.subject && (
                    <h4 className={`text-sm font-medium mb-2 ${isFromCustomer ? 'text-white' : 'text-gray-900'}`}>
                      {message.subject}
                    </h4>
                  )}
                  <div 
                    className={`text-sm ${isFromCustomer ? 'text-white' : 'text-gray-700'} email-content break-words`}
                    dangerouslySetInnerHTML={{ __html: decodeEmailBody(message.body) }}
                  />
                </div>
              </div>
              
              {nextMessage && (
                <div className="w-full text-center my-8">
                  <div className="inline-block bg-gray-100 text-gray-600 px-4 py-2 rounded-full text-sm">
                    {getDaysBetween(message.date, nextMessage.date)} days between messages
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="p-4 border-t bg-gray-50">
        <button
          onClick={() => setShowComposer(true)}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Reply
        </button>
      </div>

      {showComposer && (
        <EmailComposer
          customerEmail={customerEmail}
          onClose={() => setShowComposer(false)}
          onEmailSent={() => {
            setShowComposer(false);
            fetchEmails();
          }}
          latestEmail={messages[0]}
        />
      )}
    </div>
  );
} 