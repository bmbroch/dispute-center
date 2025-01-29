"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  attachments?: Array<{
    id: string;
    mimeType: string;
    filename: string;
    contentId: string;
    size: number;
    data?: string;
    isInline?: boolean;
    partId?: string;
    contentLocation?: string;
  }>;
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
  initialThreads?: EmailThread[];
  showEmailHistory?: boolean;
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
  onEmailSent,
  initialThreads = [],
  showEmailHistory = false
}: EmailCorrespondenceProps) {
  const { user } = useAuth();
  const [threads, setThreads] = useState<EmailThread[]>(initialThreads);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<EmailMessage | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<string[]>([]);
  const [processedContent, setProcessedContent] = useState<Record<string, string>>({});

  // Memoize threads to prevent unnecessary re-renders
  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      const aDate = new Date(a.messages[a.messages.length - 1].date);
      const bDate = new Date(b.messages[b.messages.length - 1].date);
      return bDate.getTime() - aDate.getTime();
    });
  }, [threads]);

  // Enhanced content processing to handle images
  const processEmailContent = useCallback((message: EmailMessage) => {
    if (processedContent[message.id]) {
      return processedContent[message.id];
    }

    const isHtml = message.contentType.includes('html');
    let content = message.body || message.snippet || '';

    if (!content.trim()) {
      return '<div class="text-gray-500 italic">No content available</div>';
    }

    // Process inline images if they exist
    if (message.attachments?.length) {
      message.attachments.forEach(attachment => {
        if (attachment.isInline && attachment.data) {
          // Replace content ID references with actual image data
          const cidRef = `cid:${attachment.contentId}`;
          const imgData = `data:${attachment.mimeType};base64,${attachment.data}`;
          content = content.replace(cidRef, imgData);
        }
      });
    }

    // Simple and fast HTML sanitization while preserving image tags
    if (isHtml) {
      content = content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/g, '')
        .replace(/javascript:/gi, '')
        // Preserve image dimensions but add max-width
        .replace(/<img([^>]*)>/gi, (match, attributes) => {
          // Add loading="lazy" and class for styling
          return `<img ${attributes} loading="lazy" class="email-image">`;
        });
    } else {
      content = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>');
    }

    // Cache the processed content
    setProcessedContent(prev => ({
      ...prev,
      [message.id]: content
    }));

    return content;
  }, [processedContent]);

  // Handle thread expansion
  const toggleThread = useCallback((threadId: string) => {
    setExpandedThreads(prev => 
      prev.includes(threadId) 
        ? prev.filter(id => id !== threadId)
        : [...prev, threadId]
    );
  }, []);

  // Memoize the email fetch function
  const fetchEmails = useCallback(async () => {
    if (!user?.accessToken || !customerEmail) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/gmail', {
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'X-Dispute-Email': customerEmail
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch email threads');
      }

      const data = await response.json();
      setThreads(data.threads || []);
    } catch (err) {
      console.error('Error fetching emails:', err);
      setError({
        message: 'Failed to load email threads',
        details: err instanceof Error ? err.message : undefined
      });
    } finally {
      setIsLoading(false);
    }
  }, [user?.accessToken, customerEmail]);

  // Only fetch if we don't have initial threads
  useEffect(() => {
    if (initialThreads.length === 0) {
      fetchEmails();
    }
  }, [fetchEmails, initialThreads.length]);

  const handleSendEmail = async (content: string, subject?: string) => {
    if (!user?.accessToken || !customerEmail) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          to: customerEmail,
          subject: subject || `Re: Dispute ${disputeId}`,
          content
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send email');
      }

      // Refresh emails after sending
      await fetchEmails();
      setReplyToMessage(null);
      onEmailSent?.();
    } catch (err) {
      console.error('Error sending email:', err);
      setError({
        message: 'Failed to send email',
        details: err instanceof Error ? err.message : undefined
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSent = async () => {
    // Immediately fetch new emails
    await fetchEmails();
    // Notify parent component if callback exists
    if (onEmailSent) {
      onEmailSent();
    }
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

  const handleReply = (message: EmailMessage) => {
    setReplyToMessage(message);
  };

  const isLastMessageFromCurrentUser = (messages: EmailMessage[]) => {
    if (!messages.length || !user?.email) return false;
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
      <style jsx global>{`
        .email-content {
          overflow-wrap: break-word;
          word-wrap: break-word;
        }
        .email-content img.email-image {
          max-width: 100%;
          height: auto;
          margin: 8px 0;
          display: block;
          border-radius: 4px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .email-content a {
          color: #2563eb;
          text-decoration: underline;
        }
        .email-content p {
          margin-bottom: 1em;
        }
      `}</style>
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
        {showEmailHistory && sortedThreads.map((thread) => {
          const latestMessage = thread.messages[thread.messages.length - 1];
          const isExpanded = expandedThreads.includes(thread.id);
          const showFollowUpButton = isLastMessageFromCurrentUser(thread.messages);

          return (
            <div key={thread.id} className="bg-white rounded-lg shadow">
              {/* Thread Header */}
              <div 
                className="flex items-center justify-between px-4 py-3 border-b border-gray-200 cursor-pointer hover:bg-gray-50"
                onClick={() => toggleThread(thread.id)}
              >
                <div>
                  <h2 className="text-lg font-medium text-gray-900">
                    {decodeHtmlEntities(latestMessage.subject)}
                  </h2>
                  <div className="mt-1 text-sm text-gray-500">
                    {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''} • Last update {getTimeSinceLastEmail(latestMessage.date)}
                  </div>
                </div>
                <div className="text-gray-400">
                  {isExpanded ? '▼' : '▶'}
                </div>
              </div>

              {/* Follow Up Button */}
              {showFollowUpButton && isExpanded && (
                <div className="p-4 bg-gray-50 border-b border-gray-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setReplyToMessage(latestMessage);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 transition-colors"
                  >
                    Send Follow Up ✉️
                  </button>
                </div>
              )}

              {/* Email Messages */}
              {isExpanded && (
                <div className="divide-y divide-gray-100">
                  {[...thread.messages].reverse().map((message, index) => {
                    const isFromCustomer = message.from.toLowerCase().includes(customerEmail.toLowerCase());
                    
                    return (
                      <div 
                        key={message.id}
                        className={`p-4 ${isFromCustomer ? 'bg-blue-50' : 'bg-white'}`}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{message.from}</span>
                              <span className="text-sm text-gray-500">
                                {new Date(message.date).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReply(message);
                            }}
                            className="text-gray-500 hover:text-gray-700"
                          >
                            Reply
                          </button>
                        </div>
                        <div 
                          className="email-content prose max-w-none"
                          dangerouslySetInnerHTML={{ __html: processEmailContent(message) }}
                        />
                        {message.attachments?.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {message.attachments.map(attachment => (
                              !attachment.isInline && (
                                <div key={attachment.id} className="flex items-center space-x-2 text-sm">
                                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                  </svg>
                                  <span className="text-gray-600">{attachment.filename}</span>
                                  <span className="text-gray-400">({Math.round(attachment.size / 1024)}KB)</span>
                                </div>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
} 