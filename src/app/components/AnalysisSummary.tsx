import React from 'react';
import { SavedEmailAnalysis } from '@/types/analysis';
import FAQPieChart from './FAQPieChart';

interface Props {
  analysis: SavedEmailAnalysis;
}

interface FAQ {
  question: string;
  typicalAnswer: string;
  frequency: number;
}

export default function AnalysisSummary({ analysis }: Props) {
  const sortedFaqs = [...analysis.aiInsights.commonQuestions].sort((a: FAQ, b: FAQ) => b.frequency - a.frequency);

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
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Analysis Summary</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total Emails</p>
            <p className="text-2xl font-semibold">{analysis.totalEmails}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Support Emails</p>
            <p className="text-2xl font-semibold">{analysis.emails.filter(email => email.isSupport).length}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Common Questions</h2>
        <div className="space-y-4">
          {sortedFaqs.map((faq, index) => (
            <div key={index} className="border-b border-gray-100 last:border-0 pb-4 last:pb-0">
              <p className="font-medium text-gray-900 mb-1">Q: {faq.question}</p>
              <p className="text-gray-600 text-sm mb-2">A: {faq.typicalAnswer}</p>
              <p className="text-xs text-gray-500">Frequency: {Math.round(faq.frequency * 100)}%</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Customer Sentiment</h2>
        <div className="mb-4">
          <p className="font-medium text-gray-900 mb-1">Overall</p>
          <p className="text-gray-600">{analysis.aiInsights.customerSentiment.overall}</p>
        </div>
        <div>
          <p className="font-medium text-gray-900 mb-1">Details</p>
          <p className="text-gray-600">{analysis.aiInsights.customerSentiment.details}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Recommended Actions</h2>
        <ul className="list-disc pl-5 space-y-2">
          {analysis.aiInsights.recommendedActions.map((action, index) => (
            <li key={index} className="text-gray-600">{action}</li>
          ))}
        </ul>
      </div>
    </div>
  );
} 