'use client';

import React from 'react';
import { GenericFAQ } from '@/types/faq';
import { PlusIcon, XIcon } from 'lucide-react';

interface FAQExpansionListProps {
  faqs: GenericFAQ[];
  onAddToLibrary: (faq: GenericFAQ) => void;
  onIgnore: (faq: GenericFAQ) => void;
}

export function FAQExpansionList({
  faqs,
  onAddToLibrary,
  onIgnore,
}: FAQExpansionListProps) {
  return (
    <div className="space-y-6">
      {faqs.map((faq) => (
        <div key={faq.question} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
                    Would help {faq.emailIds?.length || 0} {(faq.emailIds?.length || 0) === 1 ? 'email' : 'emails'}
                  </span>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">❓ {faq.question}</h3>
                {faq.similarPatterns && faq.similarPatterns.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Similar Questions</h4>
                    <ul className="space-y-2">
                      {faq.similarPatterns.map((pattern: string, index: number) => (
                        <li key={index} className="text-sm text-gray-600">• {pattern}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onAddToLibrary(faq)}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    Answer This Question
                  </button>
                  <button
                    onClick={() => onIgnore(faq)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Ignore
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
      {faqs.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No FAQ suggestions available</p>
        </div>
      )}
    </div>
  );
} 