import React, { useMemo } from 'react';
import { GenericFAQ } from '@/types/faq';

interface FAQExpansionListProps {
  faqs: GenericFAQ[];
  onAddToLibrary: (faq: GenericFAQ) => void;
  onIgnore: (faq: GenericFAQ) => void;
}

export const FAQExpansionList: React.FC<FAQExpansionListProps> = ({
  faqs,
  onAddToLibrary,
  onIgnore,
}) => {
  const sortedFaqs = useMemo(() => 
    [...faqs]
      .sort((a, b) => (b.emailIds?.length || 0) - (a.emailIds?.length || 0))
  , [faqs]);

  return (
    <div className="space-y-4">
      {sortedFaqs.map((faq, index) => (
        <div key={index} className="border rounded-lg p-4 bg-white shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h3 className="text-lg font-medium text-gray-900">{faq.question}</h3>
              <p className="text-sm text-gray-500">
                Would help {faq.emailIds?.length || 0} {(faq.emailIds?.length || 0) === 1 ? 'email' : 'emails'}
              </p>
            </div>
            <button
              onClick={() => onAddToLibrary(faq)}
              className="ml-4 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-full shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Add to FAQ Library
            </button>
          </div>
          {faq.similarPatterns && faq.similarPatterns.length > 0 && (
            <div className="mt-2">
              <h4 className="text-sm font-medium text-gray-700 mb-1">Similar Questions:</h4>
              <div className="space-y-1">
                {faq.similarPatterns.map((pattern: string, index: number) => (
                  <p key={index} className="text-sm text-gray-600">{pattern}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}; 