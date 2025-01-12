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
    // First split by quoted content and only take the first part
    const parts = body.split(/On .* wrote:|On .* at .* Ben Broch/);
    const mainContent = parts[0];
    
    // Clean up the content while preserving original line breaks
    let cleaned = mainContent
      .replace(/^>.*$/gm, '') // Remove quoted lines starting with >
      .replace(/`image: .*`/g, '') // Remove image placeholders
      .replace(/-Interview sidekick/g, '') // Remove signature
      .replace(/ben@interviewsidekick\.com/g, '') // Remove email addresses
      .replace(/\r\n/g, '\n') // Normalize Windows line endings to Unix
      .trim();
    
    // Preserve consecutive line breaks but limit to max 2
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    return cleaned;
  };

  const formatEmailBody = (body: string) => {
    // Debug: Log the original body
    console.log('Original body:', body);
    
    let formattedBody = cleanEmailBody(body);
    
    // Debug: Log the cleaned body
    console.log('Cleaned body:', formattedBody);
    
    // Split into paragraphs (double line breaks)
    const paragraphs = formattedBody.split(/\n\n+/);
    
    // Process each paragraph
    const htmlContent = paragraphs
      .map(paragraph => {
        const lines = paragraph
          .split('\n')
          .filter(line => line.trim() !== '');

        // Debug: Log each line before processing
        console.log('Lines before processing:', lines);

        const processedLines = lines.map(line => {
          const processed = line
            .replace(/\*([^*]+)\*/g, (match, p1) => {
              // Debug: Log each bold text replacement
              console.log('Found bold text:', match, '→', p1);
              return `<strong>${p1}</strong>`;
            });
          // Debug: Log the processed line
          console.log('Processed line:', processed);
          return processed;
        });

        return `<p style="margin-bottom: 1.5em; line-height: 1.4;">${processedLines.join('<br>')}</p>`;
      })
      .join('');

    // Debug: Log final HTML
    console.log('Final HTML:', htmlContent);

    return `<div class="email-content">${htmlContent}</div>`;
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
                              
                              {/* Only show the formatted email content */}
                              <div className="mt-4 p-4 bg-white rounded overflow-x-auto">
                                <div 
                                  className="email-wrapper text-base leading-relaxed"
                                  dangerouslySetInnerHTML={{ 
                                    __html: formatEmailBody(email.body)
                                  }} 
                                />
                              </div>
                            </div>

                            {index < emails[dispute.userEmail].length - 1 && (
                              <div className="relative py-8">
                                <div className="absolute inset-0 flex items-center">
                                  <div className="border-t border-gray-200 w-full"></div>
                                </div>
                                <div className="relative flex justify-center w-full">
                                  {(() => {
                                    const currentDate = new Date(email.date);
                                    const nextDate = new Date(emails[dispute.userEmail][index + 1].date);
                                    const diffTime = Math.abs(nextDate.getTime() - currentDate.getTime());
                                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                    
                                    if (diffDays > 0) {
                                      return (
                                        <div className="absolute left-1/2 transform -translate-x-1/2">
                                          <span className="px-4 py-2 bg-white text-sm text-gray-500 border border-gray-300 rounded-full shadow-sm flex items-center space-x-2">
                                            <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                              <path d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"/>
                                            </svg>
                                            <span>
                                              {diffDays} {diffDays === 1 ? 'day' : 'days'} between messages
                                            </span>
                                          </span>
                                        </div>
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