"use client";

import { useState, Fragment } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import createDOMPurifier from 'isomorphic-dompurify';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Dispute {
  userEmail: string;
  amount: number;
  reason: string;
  dueDate: string;
  status: 'Needs Response' | 'Response Required Soon';
  emails?: Email[];
}

interface Email {
  id: string;
  subject: string;
  body: string;
  date: string;
  from: string;
  to: string;
}

export default function DisputeTable() {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, Email[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const { gmailAccessToken } = useAuth();

  const fetchEmails = async (userEmail: string) => {
    if (loading[userEmail]) return;
    
    setLoading(prev => ({ ...prev, [userEmail]: true }));
    try {
      const response = await fetch('/api/gmail', {
        headers: {
          'Authorization': `Bearer ${gmailAccessToken}`,
          'X-Dispute-Email': userEmail
        }
      });
      const data = await response.json();
      setEmails(prev => ({ ...prev, [userEmail]: data.emails }));
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      setLoading(prev => ({ ...prev, [userEmail]: false }));
    }
  };

  const toggleRow = (userEmail: string) => {
    if (expandedRow === userEmail) {
      setExpandedRow(null);
    } else {
      setExpandedRow(userEmail);
      if (!emails[userEmail]) {
        fetchEmails(userEmail);
      }
    }
  };

  const cleanEmailBody = (body: string) => {
    // Remove quoted replies and correspondence markers
    const cleaned = body
      .split(/On .* wrote:|On .* at .* Ben Broch/)[0] // Remove quoted content
      .replace(/^>.*$/gm, '') // Remove quoted lines starting with >
      .replace(/`image: .*`/g, '') // Remove image placeholders
      .replace(/-Interview sidekick/g, '') // Remove signature
      .replace(/ben@interviewsidekick\.com/g, '') // Remove email addresses
      .replace(/\r?\n\s*\r?\n/g, '\n\n') // Normalize multiple newlines
      .trim();
    
    return cleaned;
  };

  const formatEmailBody = (body: string) => {
    const cleanedBody = cleanEmailBody(body);
    
    // Process the body to handle all formatting cases
    return cleanedBody
      // First handle any escaped characters
      .replace(/\\([*_])/g, '\\\\$1')
      // Convert Gmail's bold markers to HTML
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
      // Convert Gmail's italic markers to HTML
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      // Remove any remaining special formatting
      .replace(/\[([^\]]+)\]/g, '$1')
      // Clean up any remaining escape characters
      .replace(/\\\\([*_])/g, '$1');
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-white rounded-lg">
        <thead>
          <tr className="text-left text-gray-600 text-sm">
            <th className="py-3 px-4">USER EMAIL</th>
            <th className="py-3 px-4">AMOUNT</th>
            <th className="py-3 px-4">REASON</th>
            <th className="py-3 px-4">DUE DATE</th>
            <th className="py-3 px-4">STATUS</th>
            <th className="py-3 px-4">ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((dispute) => (
            <Fragment key={dispute.userEmail}>
              <tr className="border-t">
                <td className="py-3 px-4">{dispute.userEmail}</td>
                <td className="py-3 px-4">${dispute.amount.toFixed(2)}</td>
                <td className="py-3 px-4">{dispute.reason}</td>
                <td className="py-3 px-4">{dispute.dueDate}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded text-sm ${
                    dispute.status === 'Needs Response' 
                      ? 'bg-red-100 text-red-800' 
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {dispute.status}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <button
                    onClick={() => toggleRow(dispute.userEmail)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    {expandedRow === dispute.userEmail ? 'Hide Emails' : 'Show Emails'}
                  </button>
                </td>
              </tr>
              {expandedRow === dispute.userEmail && (
                <tr>
                  <td colSpan={6} className="bg-gray-50 p-4">
                    {loading[dispute.userEmail] ? (
                      <div className="text-center py-4">Loading emails...</div>
                    ) : emails[dispute.userEmail]?.length ? (
                      <div className="space-y-4">
                        {emails[dispute.userEmail].map((email) => (
                          <div key={email.id} className="bg-white p-4 rounded shadow">
                            <div className="flex justify-between text-sm text-gray-600">
                              <span>From: {email.from}</span>
                              <span>{new Date(email.date).toLocaleDateString()}</span>
                            </div>
                            <div className="font-medium mt-1">{email.subject}</div>
                            <div className="mt-2 text-gray-700">
                              <div dangerouslySetInnerHTML={{ 
                                __html: createDOMPurifier.sanitize(formatEmailBody(email.body)) 
                              }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        No emails found.
                        <button 
                          onClick={() => fetchEmails(dispute.userEmail)}
                          className="ml-2 text-blue-600 hover:text-blue-800"
                        >
                          Refresh
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const disputes: Dispute[] = [
  {
    userEmail: 'konatamkalyani22@gmail.com',
    amount: 25.00,
    reason: 'fraudulent',
    dueDate: '1/25/2025',
    status: 'Needs Response'
  },
  {
    userEmail: 'aswiniaturi@gmail.com',
    amount: 25.00,
    reason: 'general',
    dueDate: '1/27/2025',
    status: 'Response Required Soon'
  }
]; 