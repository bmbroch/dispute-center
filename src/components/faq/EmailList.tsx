'use client';

import React from 'react';
import { Email, GenericFAQ } from '@/types/faq';

interface EmailListProps {
  emails: Email[];
  emailQuestions: Map<string, GenericFAQ[]>;
  onAutoReply: (email: Email) => void;
  onMarkNotRelevant: (email: Email) => void;
  showNotRelevantButton?: boolean;
}

export function EmailList({
  emails,
  emailQuestions,
  onAutoReply,
  onMarkNotRelevant,
  showNotRelevantButton = true
}: EmailListProps) {
  return (
    <div className="space-y-6">
      {emails.map((email) => (
        <div
          key={email.id}
          className="bg-white shadow rounded-lg overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-medium text-gray-900">
                  {email.subject}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  From: {email.sender}
                </p>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => onAutoReply(email)}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Auto Reply
                </button>
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
                <p className="text-gray-700">{email.content}</p>
              </div>
            </div>
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
      ))}
    </div>
  );
} 