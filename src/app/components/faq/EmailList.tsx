import React, { useState } from 'react';
import { XCircleIcon } from 'lucide-react';
import { Email, GenericFAQ } from '@/types/faq';
import { Email as EmailType } from '@/types/email';

interface ThreadMessage {
  id: string;
  subject?: string;
  from?: string;
  content: string;
  receivedAt: string;
  snippet?: string;
}

interface EmailThread {
  id: string;
  subject: string;
  from: string;
  content: string;
  receivedAt: string;
  length: number;
  snippet?: string;
}

interface ExtendedEmail extends EmailType {
  thread?: EmailThread;
  threadMessages?: ThreadMessage[];
  matchedFAQ?: any;
}

interface EmailListProps {
  emails: ExtendedEmail[];
  emailQuestions: Map<string, GenericFAQ[]>;
  onAutoReply: (email: ExtendedEmail) => void;
  onMarkNotRelevant: (email: ExtendedEmail) => void;
  showNotRelevantButton?: boolean;
}

export function EmailList({
  emails,
  emailQuestions,
  onAutoReply,
  onMarkNotRelevant,
  showNotRelevantButton = true
}: EmailListProps) {
  const [expandedThreads, setExpandedThreads] = useState<string[]>([]);

  // Helper function to format date
  const formatDate = (dateString: string) => {
    if (!dateString) return 'No date';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid date';
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid date';
    }
  };

  const toggleThread = (threadId: string) => {
    setExpandedThreads(prev => 
      prev.includes(threadId) 
        ? prev.filter(id => id !== threadId)
        : [...prev, threadId]
    );
  };

  return (
    <div className="space-y-6">
      {emails.map((email) => {
        if (!email.thread) {
          return null;
        }

        const isExpanded = expandedThreads.includes(email.threadId);
        const hasThread = email.thread.length > 1;

        return (
          <div
            key={email.id}
            className="bg-white shadow rounded-lg overflow-hidden"
          >
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-medium text-gray-900">
                    {email.thread.subject || 'No Subject'}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    From: {email.thread.from || 'Unknown'} • {formatDate(email.receivedAt)}
                    {hasThread && ` • ${email.thread.length} messages in thread`}
                  </p>
                </div>
                <div className="flex space-x-3">
                  {email.matchedFAQ && (
                    <button
                      onClick={() => onAutoReply(email)}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                      Auto Reply
                    </button>
                  )}
                  {showNotRelevantButton && (
                    <button
                      onClick={() => onMarkNotRelevant(email)}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Not Relevant
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-4">
                <div className="prose prose-sm max-w-none">
                  {email.thread.snippet ? (
                    <div>
                      <div className={`text-gray-700 whitespace-pre-wrap ${!isExpanded ? 'max-h-[60px] overflow-hidden relative' : ''}`}>
                        {email.thread.snippet}
                      </div>
                      {!isExpanded && hasThread && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleThread(email.threadId);
                          }}
                          className="mt-2 text-blue-600 hover:text-blue-800 text-sm font-medium focus:outline-none"
                        >
                          See Full Thread ({email.thread.length} messages)
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-500 italic">No preview available</p>
                  )}
                </div>
              </div>
              {isExpanded && hasThread && (
                <div className="mt-6 space-y-4 border-t pt-4">
                  {email.thread.slice(0, -1).map((threadMessage, index) => (
                    <div key={threadMessage.id} className="pl-4 border-l-2 border-gray-200">
                      <div className="text-sm text-gray-500">
                        From: {threadMessage.from} • {formatDate(threadMessage.receivedAt)}
                      </div>
                      <div className="mt-2 text-gray-700 whitespace-pre-wrap">
                        {threadMessage.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {emailQuestions.has(email.id) && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-gray-900">
                    Suggested Questions
                  </h4>
                  <ul className="mt-2 divide-y divide-gray-200">
                    {emailQuestions.get(email.id)?.map((question, index) => (
                      <li key={index} className="py-2">
                        <div className="flex items-start">
                          <div className="ml-3">
                            <p className="text-sm text-gray-700">
                              {question.question}
                            </p>
                            {question.answer && (
                              <p className="mt-1 text-sm text-gray-500">
                                {question.answer}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
} 