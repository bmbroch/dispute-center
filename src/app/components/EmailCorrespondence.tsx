"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import EmailComposer from './EmailComposer';
import he from 'he';
import DOMPurify from 'dompurify';

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

const decodeEmailBody = (body: string) => {
  if (!body) return '';
  
  console.log('Raw email body:', body);
  console.log('Contains HTML?', /<[a-z][\s\S]*>/i.test(body));
  
  // First decode HTML entities
  let decodedBody = he.decode(body);
  console.log('After HTML entity decode:', decodedBody);
  
  // If the content is already HTML (contains HTML tags)
  if (/<[a-z][\s\S]*>/i.test(decodedBody)) {
    console.log('Treating as HTML content');
    // Clean the HTML content
    decodedBody = DOMPurify.sanitize(decodedBody, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'i', 'em', 'mark', 'small', 'del', 'ins', 'sub', 'sup', 'div', 'span', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'style'],
      ALLOW_DATA_ATTR: false
    });
    console.log('After HTML sanitization:', decodedBody);

    // Add classes after sanitization
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = decodedBody;
    tempDiv.querySelectorAll('blockquote').forEach(el => el.classList.add('gmail-quote'));
    tempDiv.querySelectorAll('pre').forEach(el => el.classList.add('gmail-code'));
    decodedBody = tempDiv.innerHTML;
    console.log('After adding classes:', decodedBody);
  } else {
    console.log('Treating as plain text content');
    // Handle plain text formatting
    decodedBody = decodedBody
      // Handle quoted text sections (lines starting with >)
      .replace(/^(&gt;|>)\s*(.*)$/gm, '<blockquote class="gmail-quote">$2</blockquote>')
      
      // Handle bold text
      .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')  // Double asterisk
      .replace(/\*([^\*]+)\*/g, '<strong>$1</strong>')      // Single asterisk
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')       // Double underscore
      
      // Handle italics
      .replace(/_([^_]+)_/g, '<em>$1</em>')                // Single underscore
      .replace(/\/([^\/]+)\//g, '<em>$1</em>')             // Forward slashes
      
      // Handle code blocks
      .replace(/```([^`]+)```/g, '<pre class="gmail-code">$1</pre>')  // Triple backticks
      .replace(/`([^`]+)`/g, '<code>$1</code>')                       // Single backticks
      
      // Handle lists
      .replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>')        // Unordered lists
      .replace(/^\s*\d+\.\s+(.*)$/gm, '<li>$1</li>')       // Ordered lists
      
      // Handle line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    console.log('After plain text formatting:', decodedBody);

    // Wrap in paragraphs if not already wrapped
    if (!decodedBody.startsWith('<p>')) {
      decodedBody = `<p>${decodedBody}</p>`;
    }

    // Clean the final HTML
    decodedBody = DOMPurify.sanitize(decodedBody);
    console.log('After final sanitization:', decodedBody);
  }

  const finalHtml = `<div class="email-content">
    <style>
      .email-content blockquote.gmail-quote {
        margin: 0.5em 0;
        padding-left: 1em;
        border-left: 2px solid #e5e7eb;
        color: #6b7280;
      }
      .email-content pre.gmail-code {
        background: #f3f4f6;
        padding: 0.75em;
        border-radius: 0.375rem;
        overflow-x: auto;
        font-family: ui-monospace, monospace;
      }
      .email-content code {
        background: #f3f4f6;
        padding: 0.2em 0.4em;
        border-radius: 0.25rem;
        font-family: ui-monospace, monospace;
      }
      .email-content p {
        margin: 0.75em 0;
      }
      .email-content ul, .email-content ol {
        margin: 0.75em 0;
        padding-left: 2em;
      }
      .email-content li {
        margin: 0.25em 0;
      }
      .email-content img {
        max-width: 100%;
        height: auto;
      }
    </style>
    ${decodedBody}
  </div>`;
  
  console.log('Final HTML output:', finalHtml);
  return finalHtml;
};

export default function EmailCorrespondence({ customerEmail }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);

  const fetchEmails = useCallback(async () => {
    if (!user?.accessToken) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/gmail', {
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'X-Dispute-Email': customerEmail
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch emails');
      }

      const data = await response.json();
      
      if (!data.messages) {
        console.error('No messages in response:', data);
        throw new Error('Invalid response format');
      }

      const sortedMessages = (data.messages || []).sort((a: EmailMessage, b: EmailMessage) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateA - dateB;
      });
      setMessages(sortedMessages);
    } catch (err) {
      console.error('Error fetching emails:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch emails');
    } finally {
      setLoading(false);
    }
  }, [user, customerEmail]);

  useEffect(() => {
    fetchEmails();
  }, [user, customerEmail, fetchEmails]);

  if (loading) {
    return <div className="py-4 text-center text-gray-500">Loading emails...</div>;
  }

  if (error) {
    return <div className="py-4 text-center text-red-500">{error}</div>;
  }

  if (!messages.length) {
    return <div className="py-4 text-center text-gray-500">No emails found</div>;
  }

  return (
    <div className="space-y-8">
      {messages.map((message, index) => {
        const isFromCustomer = message.from.includes(customerEmail);
        const nextMessage = messages[index + 1];

        const parseDate = (dateStr: string) => {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            const parts = dateStr.split(',')[1]?.trim().split(' ');
            if (parts) {
              return new Date(`${parts[1]} ${parts[0]} ${parts[2]} ${parts[3]}`);
            }
          }
          return date;
        };

        const currentDate = parseDate(message.date);
        const formattedDate = currentDate.toLocaleString();

        const getDaysBetweenMessages = () => {
          if (!nextMessage) return null;
          
          const nextDate = parseDate(nextMessage.date);
          
          const startDate = new Date(currentDate);
          const endDate = new Date(nextDate);
          startDate.setHours(0, 0, 0, 0);
          endDate.setHours(0, 0, 0, 0);
          
          const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          return diffDays;
        };

        return (
          <div key={message.id} className="relative">
            <div className={`flex ${isFromCustomer ? 'justify-start' : 'justify-end'} mb-8`}>
              <div 
                className={`relative max-w-[600px] w-full px-6 py-4 ${
                  isFromCustomer 
                    ? 'bg-blue-600 text-white rounded-[24px] rounded-bl-none' 
                    : 'bg-gray-100 text-gray-900 rounded-[24px] rounded-br-none'
                } shadow-sm`}
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
                  dangerouslySetInnerHTML={{ __html: message.body ? decodeEmailBody(message.body) : '' }}
                />
              </div>
            </div>

            {nextMessage && getDaysBetweenMessages() !== null && getDaysBetweenMessages()! > 0 && (
              <div className="relative py-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="border-t border-gray-200 w-full"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="px-4 py-2 rounded-full text-sm bg-gray-50 text-gray-500 border border-gray-200 shadow-sm">
                    {getDaysBetweenMessages()} {getDaysBetweenMessages() === 1 ? 'day' : 'days'} until next message
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-8 border-t pt-4">
        <button
          onClick={() => setShowComposer(true)}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm hover:shadow-md"
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