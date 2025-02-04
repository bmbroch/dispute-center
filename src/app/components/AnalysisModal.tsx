import React from 'react';
import { SavedEmailAnalysis } from '@/types/analysis';
import AnalysisSummary from './AnalysisSummary';

interface Props {
  analysis: SavedEmailAnalysis;
  onClose: () => void;
  showCloseButton?: boolean;
}

export default function AnalysisModal({ analysis, onClose, showCloseButton = true }: Props) {
  if (!analysis) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold">Analysis Details</h2>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Summary</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Total Emails</p>
                  <p className="text-xl font-semibold">{analysis.totalEmails}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">Support Emails</p>
                  <p className="text-xl font-semibold">
                    {analysis.emails.filter(email => email.isSupport).length}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Customer Sentiment</h3>
              <div className="bg-gray-50 p-4 rounded">
                <p className="font-medium">{analysis.aiInsights.customerSentiment.overall}</p>
                <p className="text-sm text-gray-600 mt-2">
                  {analysis.aiInsights.customerSentiment.details}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Common Questions</h3>
              <div className="space-y-4">
                {analysis.aiInsights.commonQuestions.map((faq, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded">
                    <p className="font-medium">{faq.question}</p>
                    <p className="text-sm text-gray-600 mt-1">{faq.typicalAnswer}</p>
                    <p className="text-xs text-gray-500 mt-2">
                      Frequency: {Math.round(faq.frequency * 100)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Recommended Actions</h3>
              <ul className="list-disc pl-5 space-y-2">
                {analysis.aiInsights.recommendedActions.map((action, index) => (
                  <li key={index} className="text-gray-700">{action}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 