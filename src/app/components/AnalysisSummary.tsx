import React from 'react';
import { SavedEmailAnalysis, FAQ } from '@/types/analysis';
import FAQPieChart from './FAQPieChart';

interface AnalysisSummaryProps {
  analysis: SavedEmailAnalysis;
  onClose?: () => void;
  showCloseButton?: boolean;
}

export default function AnalysisSummary({ analysis, onClose, showCloseButton = true }: AnalysisSummaryProps) {
  const renderKeyPoints = (points: string[], onDelete: (index: number) => void) => {
    return points.map((point: string, index: number) => (
      <li key={index} className="text-purple-800">• {point}</li>
    ));
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
    <div className="bg-white rounded-xl shadow-lg max-w-4xl w-full mx-auto">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Analysis Results</h2>
            <p className="text-sm text-gray-600 mt-1">
              {new Date(analysis.timestamp).toLocaleDateString()} at {new Date(analysis.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex gap-4 mb-8">
          <div className="bg-blue-50 rounded-lg px-3 py-2">
            <span className="text-sm text-blue-600">
              {analysis.totalEmailsAnalyzed || analysis.totalEmails || 0} emails analyzed
            </span>
          </div>
          <div className="bg-green-50 rounded-lg px-3 py-2">
            <span className="text-sm text-green-600">
              {analysis.supportEmails.length || 0} support emails found
            </span>
          </div>
          <div className="bg-purple-50 rounded-lg px-3 py-2">
            <span className="text-sm text-purple-600">
              {analysis.aiInsights?.commonQuestions?.length || 0} common topics identified
            </span>
          </div>
        </div>

        {/* Email Distribution */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4">Email Distribution</h3>
          <div className="flex gap-2 mb-4">
            <button className="px-3 py-1 rounded-lg bg-red-50 text-red-600">All Emails</button>
            <button className="px-3 py-1 rounded-lg text-gray-600">Support Only</button>
          </div>
          <FAQPieChart
            faqs={analysis.aiInsights?.commonQuestions?.map(q => ({
              question: q?.question || '',
              frequency: q?.frequency || 1,
              answer: q?.typicalAnswer || ''
            })) || []}
            totalEmails={analysis.totalEmailsAnalyzed || analysis.totalEmails || 0}
            supportEmails={analysis.supportEmails || 0}
          />
        </div>

        {/* Key Customer Points */}
        {analysis.aiInsights?.keyCustomerPoints?.length > 0 && (
          <div className="bg-purple-50 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">✏️</span>
              <h3 className="text-lg font-semibold text-purple-900">Key Customer Points</h3>
            </div>
            <ul className="space-y-2">
              {renderKeyPoints(analysis.aiInsights.keyCustomerPoints, () => {})}
            </ul>
          </div>
        )}

        {/* Customer Sentiment */}
        {analysis.aiInsights?.customerSentiment && (
          <div className="bg-blue-50 rounded-lg p-4 mb-4">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">Customer Sentiment</h3>
            <p className="text-blue-800">{analysis.aiInsights.customerSentiment.overall}</p>
            {analysis.aiInsights.customerSentiment.details && (
              <p className="text-blue-700 mt-2">{analysis.aiInsights.customerSentiment.details}</p>
            )}
          </div>
        )}

        {/* Frequently Asked Questions */}
        {analysis.aiInsights?.commonQuestions?.length > 0 && (
          <div className="bg-green-50 rounded-lg p-4 mb-4">
            <h3 className="text-lg font-semibold text-green-900 mb-3">Frequently Asked Questions</h3>
            <div className="space-y-4">
              {renderCommonQuestions(analysis.aiInsights.commonQuestions, () => {})}
            </div>
          </div>
        )}

        {/* Recommended Actions */}
        {analysis.aiInsights?.recommendedActions?.length > 0 && (
          <div className="bg-amber-50 rounded-lg p-4 mb-4">
            <h3 className="text-lg font-semibold text-amber-900 mb-2">Recommended Actions</h3>
            <ul className="space-y-2">
              {renderSuggestedActions(analysis.aiInsights.recommendedActions, () => {})}
            </ul>
          </div>
        )}

        {/* Token Usage */}
        {analysis.tokenUsage && (
          <div className="text-sm text-gray-500 mt-6">
            Token Usage: {analysis.tokenUsage.totalTokens?.toLocaleString() || 0} total tokens 
            ({analysis.tokenUsage.promptTokens?.toLocaleString() || 0} prompt, {analysis.tokenUsage.completionTokens?.toLocaleString() || 0} completion)
          </div>
        )}
      </div>
    </div>
  );
} 