import React from 'react';
import { SavedEmailAnalysis } from '@/types/analysis';
import FAQPieChart from './FAQPieChart';

interface Props {
  analysis: SavedEmailAnalysis;
}

export default function AnalysisSummary({ analysis }: Props) {
  const renderKeyPoints = (points: string[]) => {
    return (
      <ul className="list-disc pl-5 space-y-2">
        {points.map((point, index) => (
          <li key={index} className="text-gray-700">
            {point}
          </li>
        ))}
      </ul>
    );
  };

  const renderCommonQuestions = (questions: FAQ[], onDelete: (index: number) => void) => {
    return questions.map((qa: FAQ, index: number) => (
      <div key={index} className="border-b border-green-200 pb-3 last:border-0 last:pb-0">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <p className="font-medium mb-2">
              Q: {qa?.question || ''}
              <span className="ml-2 text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full">
                Asked {qa?.frequency || 1}x
              </span>
            </p>
            {qa?.typicalAnswer && (
              <p className="text-green-700 pl-4">
                A: {qa.typicalAnswer}
              </p>
            )}
          </div>
        </div>
      </div>
    ));
  };

  const renderSuggestedActions = (actions: string[], onDelete: (index: number) => void) => {
    return actions.map((action: string, index: number) => (
      <li key={index} className="text-amber-800">→ {action}</li>
    ));
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-gray-800">Analysis Summary</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">Total Emails</p>
            <p className="text-2xl font-semibold text-blue-600">{analysis.totalEmails}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">Support Emails Found</p>
            <p className="text-2xl font-semibold text-green-600">
              {analysis.emails.filter(email => email.isSupport).length}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-800">Key Points</h3>
        {renderKeyPoints(analysis.aiInsights.keyPoints)}
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-800">Customer Insights</h3>
        {renderKeyPoints(analysis.aiInsights.keyCustomerPoints)}
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-800">Common Questions</h3>
        <ul className="list-disc pl-5 space-y-2">
          {analysis.aiInsights.commonQuestions.map((faq, index) => (
            <li key={index} className="text-gray-700">
              <p className="font-medium">{faq.question}</p>
              <p className="text-sm text-gray-600">{faq.typicalAnswer}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-800">Customer Sentiment</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="font-medium text-gray-800">{analysis.aiInsights.customerSentiment.overall}</p>
          <p className="text-sm text-gray-600 mt-2">{analysis.aiInsights.customerSentiment.details}</p>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-800">Recommended Actions</h3>
        {renderKeyPoints(analysis.aiInsights.recommendedActions)}
      </div>
    </div>
  );
} 