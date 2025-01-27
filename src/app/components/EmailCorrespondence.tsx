"use client";

import React, { useState, useEffect, useCallback } from 'react';
import EmailComposer from './EmailComposer';
import { useAuth } from '@/lib/hooks/useAuth';

export interface EmailMessage {
  id: string;
  threadId: string;
  historyId: string;
  internalDate: string;
  snippet: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  contentType: string;
  references: string;
  inReplyTo: string;
  messageId: string;
}

export interface EmailThread {
  id: string;
  historyId: string;
  messages: EmailMessage[];
}

interface EmailCorrespondenceProps {
  customerEmail: string;
  disputeId: string;
  onEmailSent?: () => void;
}

// Add a helper function to decode HTML entities
const decodeHtmlEntities = (text: string) => {
  const textArea = document.createElement('textarea');
  textArea.innerHTML = text;
  return textArea.value;
};

export default function EmailCorrespondence({ 
  customerEmail, 
  disputeId,
  onEmailSent
}: EmailCorrespondenceProps) {
  const { user, refreshAccessToken } = useAuth();
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [expandedThreads, setExpandedThreads] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [replyToMessage, setReplyToMessage] = useState<EmailMessage | null>(null);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);

  const fetchEmails = useCallback(async () => {
    if (!user?.accessToken || !customerEmail) {
      setError({
        message: 'Authentication Required',
        details: !user?.accessToken 
          ? 'Please sign in to view emails'
          : 'Customer email is required'
      });
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/gmail', {
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'X-Dispute-Email': customerEmail
        }
      });

      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          throw new Error('Failed to refresh access token');
        }
        // Retry with new token
        const retryResponse = await fetch('/api/gmail', {
          headers: {
            'Authorization': `Bearer ${user.accessToken}`,
            'X-Dispute-Email': customerEmail
          }
        });
        if (!retryResponse.ok) {
          const errorData = await retryResponse.json();
          throw new Error(errorData.details || 'Failed to fetch emails after token refresh');
        }
        const data = await retryResponse.json();
        setThreads(data.threads || []);
      } else if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to fetch emails');
      } else {
        const data = await response.json();
        setThreads(data.threads || []);
      }
    } catch (err) {
      console.error('Error fetching emails:', err);
      setError({
        message: err instanceof Error ? err.message : 'Failed to fetch emails',
        details: typeof err === 'object' && err !== null && 'details' in err 
          ? String((err as { details: unknown }).details)
          : 'Please try again or contact support if the issue persists'
      });
    } finally {
      setIsLoading(false);
    }
  }, [user?.accessToken, customerEmail, refreshAccessToken]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const handleEmailSent = async () => {
    // Immediately fetch new emails
    await fetchEmails();
    // Notify parent component if callback exists
    if (onEmailSent) {
      onEmailSent();
    }
  };

  const toggleThreadExpansion = (threadId: string) => {
    setExpandedThreads(prev => 
      prev.includes(threadId)
        ? prev.filter(id => id !== threadId)
        : [...prev, threadId]
    );
  };

  const getTimeDifference = (date1: string, date2: string) => {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffDays > 0) {
      return `⏰ ${diffDays} day${diffDays === 1 ? '' : 's'} later`;
    }
    if (diffHours > 0) {
      return `⏰ ${diffHours} hour${diffHours === 1 ? '' : 's'} later`;
    }
    if (diffMinutes > 0) {
      return `⏰ ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} later`;
    }
    return '⏰ Just now';
  };

  const getTimeSinceLastEmail = (date: string) => {
    const now = new Date();
    const emailDate = new Date(date);
    const diffTime = Math.abs(now.getTime() - emailDate.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffDays > 0) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }
    if (diffHours > 0) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    }
    if (diffMinutes > 0) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    }
    return 'Just now';
  };

  const formatEmailContent = (message: EmailMessage) => {
    const isHtml = message.contentType.includes('html');
    let content = message.body;

    if (isHtml) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;
      
      // Remove script tags for security
      const scripts = tempDiv.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        scripts[i].remove();
      }

      // Remove quoted content
      const quotes = tempDiv.getElementsByTagName('blockquote');
      for (let i = quotes.length - 1; i >= 0; i--) {
        quotes[i].remove();
      }

      // Remove "On [date], [person] wrote:" lines
      const paragraphs = tempDiv.getElementsByTagName('p');
      for (let i = paragraphs.length - 1; i >= 0; i--) {
        const text = paragraphs[i].textContent || '';
        if (text.match(/On .+ wrote:/)) {
          paragraphs[i].remove();
        }
      }

      // Get only the first part of the email (before any quoted content)
      content = tempDiv.innerHTML.split(/On .+ wrote:/)[0];
    } else {
      // For plain text, split on common quote patterns and take first part
      content = content
        .split(/On .+ wrote:/)[0] // Split on "On ... wrote:"
        .split(/\n>/)[0] // Split on quoted text (lines starting with >)
        .split(/\n{2,}From:/)[0] // Split on "From:" headers
        .trim();

      content = content
        .replace(/\n/g, '<br>')
        .replace(
          /(https?:\/\/[^\s]+)/g,
          '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">$1</a>'
        );
    }

    return (
      <div className="space-y-2">
        <div 
          className="email-content text-gray-800 text-[14px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    );
  };

  const handleReply = (message: EmailMessage) => {
    setReplyToMessage(message);
  };

  const isLastMessageFromCurrentUser = (messages: EmailMessage[]) => {
    if (messages.length === 0 || !user?.email) return false;
    const lastMessage = messages[messages.length - 1];
    return lastMessage.from.toLowerCase().includes(user.email.toLowerCase());
  };

  // Add error display component
  const ErrorDisplay = () => {
    if (!error) return null;

    return (
      <div className="rounded-md bg-red-50 p-4 mb-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">{error.message}</h3>
            {error.details && (
              <div className="mt-2 text-sm text-red-700">{error.details}</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="text-center text-gray-500 py-4">
        <p>No email correspondence found for this customer.</p>
        <button
          onClick={() => {
            setReplyToMessage(null);
          }}
          className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <span className="mr-2">✉️</span>
          Send New Email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorDisplay />
      {replyToMessage && (
        <EmailComposer
          customerEmail={customerEmail}
          onClose={() => setReplyToMessage(null)}
          onEmailSent={handleEmailSent}
          replyToMessage={replyToMessage}
          threads={threads}
        />
      )}
      <div className="space-y-6">
        {threads.map((thread) => {
          const reversedMessages = [...thread.messages].reverse();
          const showFollowUpButton = isLastMessageFromCurrentUser(thread.messages);
          const latestMessage = thread.messages[thread.messages.length - 1];

          return (
            <div key={thread.id} className="bg-white rounded-lg shadow">
              {/* Subject and Actions Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <div>
                  <h2 className="text-lg font-medium text-gray-900">
                    {decodeHtmlEntities(latestMessage.subject)}
                  </h2>
                  <div className="mt-1 text-sm text-gray-500">
                    {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''} in conversation
                  </div>
                </div>
              </div>

              {/* Follow Up Button (if applicable) */}
              {showFollowUpButton && (
                <div className="p-4 bg-gray-50 border-b border-gray-100">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-sm text-gray-500">
                      Last email sent {getTimeSinceLastEmail(latestMessage.date)} • No response yet
                    </div>
                    <button
                      onClick={() => {
                        setReplyToMessage(latestMessage);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-colors"
                    >
                      Send Follow Up ✉️
                    </button>
                  </div>
                </div>
              )}

              {/* Email Messages */}
              <div className="divide-y divide-gray-100">
                {reversedMessages.map((message, index, array) => {
                  const isFromCustomer = message.from.toLowerCase().includes(customerEmail.toLowerCase());
                  const previousMessage = array[index - 1];
                  
                  return (
                    <React.Fragment key={message.id}>
                      {previousMessage && (
                        <div className="flex items-center justify-center py-3 px-4">
                          <div className="h-px bg-gray-200 flex-grow"></div>
                          <div className="mx-4 text-sm font-medium text-gray-500 bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm">
                            {getTimeDifference(message.date, previousMessage.date)}
                          </div>
                          <div className="h-px bg-gray-200 flex-grow"></div>
                        </div>
                      )}
                      
                      <div 
                        className={`p-4 ${
                          isFromCustomer ? 'bg-blue-50' : 'bg-white'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{decodeHtmlEntities(message.from)}</span>
                              <span className="text-sm text-gray-500">
                                {new Date(message.date).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-sm text-gray-500">
                              to {decodeHtmlEntities(message.to)}
                            </div>
                          </div>
                          <button
                            onClick={() => handleReply(message)}
                            className="text-gray-500 hover:text-gray-700"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                          </button>
                        </div>
                        {formatEmailContent(message)}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
} 