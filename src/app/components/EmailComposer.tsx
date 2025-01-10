'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';

interface Props {
  customerEmail: string;
  onClose: () => void;
  onEmailSent: () => void;
  latestEmail?: {
    subject: string;
    body: string;
    date: string;
    from: string;
  };
}

export default function EmailComposer({ customerEmail, onClose, onEmailSent, latestEmail }: Props) {
  const { user, gmailAccessToken } = useAuth();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (latestEmail) {
      // Format subject as a reply if it doesn't already start with Re:
      const replySubject = latestEmail.subject.startsWith('Re:') 
        ? latestEmail.subject 
        : `Re: ${latestEmail.subject}`;
      setSubject(replySubject);

      // Format the quoted text exactly like Gmail
      const formattedDate = new Date(latestEmail.date).toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      });

      // Gmail style quoted text with proper line breaks and formatting
      const quotedText = `

On ${formattedDate}, ${latestEmail.from} wrote:
> ${latestEmail.body.split('\n').join('\n> ')}`;
      
      setBody(quotedText);
    }
  }, [latestEmail]);

  const handleSend = async () => {
    if (!gmailAccessToken) {
      setError('Gmail access not granted');
      return;
    }

    if (!subject.trim() || !body.trim()) {
      setError('Subject and body are required');
      return;
    }

    setIsSending(true);
    setError('');

    try {
      const response = await fetch('/api/gmail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject,
          body: body.trim(),
          to: customerEmail,
          accessToken: gmailAccessToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      onEmailSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
        <div className="p-4 border-b">
          <h2 className="text-lg font-medium">Reply</h2>
          <p className="text-sm text-gray-500">To: {customerEmail}</p>
          {latestEmail && (
            <p className="text-sm text-gray-500 mt-1">Subject: {subject}</p>
          )}
        </div>

        <div className="p-4">
          <textarea
            autoFocus
            placeholder="Write your reply here..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full h-[60vh] px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              lineHeight: '1.5'
            }}
          />

          {error && (
            <div className="text-red-600 text-sm mt-2">{error}</div>
          )}
        </div>

        <div className="p-4 border-t flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
} 