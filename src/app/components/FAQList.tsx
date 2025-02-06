'use client';

import { useState, useEffect, useMemo } from 'react';

interface FAQ {
  question: string;
  answer?: string;
  frequency: number;
  category?: string;
}

interface FAQListProps {
  faqs: FAQ[];
  totalEmails: number;
  supportEmails: number;
}

export default function FAQList({ faqs = [], totalEmails = 0, supportEmails = 0 }: FAQListProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    if (faqs) {
      const uniqueCategories = Array.from(new Set(faqs.map(faq => faq.category || 'Uncategorized')));
      setCategories(uniqueCategories);
    }
  }, [faqs]);

  const filteredFAQs = useMemo(() => {
    if (!faqs) return [];
    return selectedCategory === 'all'
      ? faqs
      : faqs.filter(faq => faq.category === selectedCategory);
  }, [faqs, selectedCategory]);

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Frequently Asked Questions</h2>
          <span className="text-sm text-gray-500">
            Found in {supportEmails} of {totalEmails} emails
          </span>
        </div>

        {categories.length > 0 && (
          <div className="mb-6">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1 rounded-full text-sm ${
                  selectedCategory === 'all'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                key="all-categories"
              >
                All Categories
              </button>
              {categories.map((category) => (
                <button
                  key={`category-${category}`}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-1 rounded-full text-sm ${
                    selectedCategory === category
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {filteredFAQs.map((faq) => (
            <div 
              key={`faq-${faq.question}-${faq.frequency}`}
              className="p-4 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900 mb-2">{faq.question}</h3>
                  {faq.answer && (
                    <p className="text-sm text-gray-600">{faq.answer}</p>
                  )}
                </div>
                <div className="flex-shrink-0">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                    {faq.frequency}x
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredFAQs.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">No questions found in this category.</p>
          </div>
        )}
      </div>
    </div>
  );
} 