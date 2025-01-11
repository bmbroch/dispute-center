"use client";

import { useState, Fragment } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';

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
  const { user } = useAuth();

  const fetchEmails = async (userEmail: string) => {
    if (loading[userEmail] || !user?.accessToken) return;
    
    setLoading(prev => ({ ...prev, [userEmail]: true }));
    try {
      const response = await fetch('/api/gmail', {
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'X-Dispute-Email': userEmail
        }
      });
      const data = await response.json();
      
      // Sort emails by date before setting state
      const sortedEmails = (data.messages || []).sort((a: Email, b: Email) => {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
      
      setEmails(prev => ({ ...prev, [userEmail]: sortedEmails }));
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
      .replace(/\r\n/g, '\n') // Normalize line endings
      .trim();
    
    return cleaned;
  };

  const formatEmailBody = (body: string) => {
    const cleanedBody = cleanEmailBody(body);
    
    // Process the body to handle all formatting cases
    let formattedBody = cleanedBody
      // Handle bold text (before line breaks)
      .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')  // Double asterisk
      .replace(/\*([^\*]+)\*/g, '<strong>$1</strong>')      // Single asterisk
      // Handle italics
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/\/([^\/]+)\//g, '<em>$1</em>')
      // Handle line breaks
      .replace(/\n/g, '<br>')
      .replace(/\s*<br>\s*/g, '<br>');

    // Wrap the content in a div with proper styling
    return `<div class="email-content">${formattedBody}</div>`;
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
                      <div className="space-y-8">
                        {emails[dispute.userEmail].map((email, index) => (
                          <div key={email.id}>
                            <div className="bg-white p-4 rounded shadow">
                              <div className="flex justify-between text-sm text-gray-600">
                                <span>From: {email.from}</span>
                                <span>{new Date(email.date).toLocaleDateString()}</span>
                              </div>
                              <div className="font-medium mt-1">{email.subject}</div>
                              <div className="mt-2 text-gray-700">
                                <div dangerouslySetInnerHTML={{ 
                                  __html: formatEmailBody(email.body)
                                }} />
                              </div>
                            </div>

                            {index < emails[dispute.userEmail].length - 1 && (
                              <div className="relative py-8">
                                <div className="absolute inset-0 flex items-center">
                                  <div className="border-t-2 border-gray-200 w-full"></div>
                                </div>
                                <div className="relative flex justify-center">
                                  {(() => {
                                    const currentDate = new Date(email.date);
                                    const nextDate = new Date(emails[dispute.userEmail][index + 1].date);
                                    const diffTime = Math.abs(nextDate.getTime() - currentDate.getTime());
                                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                    
                                    if (diffDays > 0) {
                                      return (
                                        <span className="px-4 py-2 bg-white text-sm text-gray-500 border border-gray-300 rounded-full shadow-sm flex items-center space-x-2">
                                          <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"/>
                                          </svg>
                                          <span>
                                            {diffDays} {diffDays === 1 ? 'day' : 'days'} between messages
                                          </span>
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              </div>
                            )}
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