import React from 'react';
import { Loader2, Mail, Brain, CheckCircle2, ArrowRight } from 'lucide-react';

interface AnalysisProgressProps {
  stage: 'fetching_emails' | 'analyzing' | 'complete';
  progress: number;
  currentEmail?: number;
  totalEmails?: number;
  model?: string;
  estimatedTimeRemaining?: number;
}

const stages = [
  { id: 'fetching_emails', label: 'Fetching Emails', icon: Mail },
  { id: 'analyzing', label: 'AI Analysis', icon: Brain },
  { id: 'complete', label: 'Complete', icon: CheckCircle2 },
];

export default function AnalysisProgress({
  stage,
  progress,
  currentEmail,
  totalEmails,
  model = 'OpenAI GPT-3.5',
  estimatedTimeRemaining
}: AnalysisProgressProps) {
  const currentStageIndex = stages.findIndex(s => s.id === stage);

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)} seconds`;
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm p-8">
      {/* Main Progress Bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-medium text-gray-900">Analysis Progress</h3>
          <span className="text-sm font-medium text-gray-900">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-600 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stages */}
      <div className="flex justify-between mb-8">
        {stages.map((s, index) => {
          const Icon = s.icon;
          const isActive = index === currentStageIndex;
          const isComplete = index < currentStageIndex;
          
          return (
            <React.Fragment key={s.id}>
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                  isActive ? 'bg-blue-100 text-blue-600 animate-pulse' :
                  isComplete ? 'bg-green-100 text-green-600' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {isActive ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                <span className={`text-sm font-medium ${
                  isActive ? 'text-blue-600' :
                  isComplete ? 'text-green-600' :
                  'text-gray-400'
                }`}>
                  {s.label}
                </span>
              </div>
              {index < stages.length - 1 && (
                <div className="flex-1 flex items-center justify-center">
                  <ArrowRight className={`w-4 h-4 ${
                    index < currentStageIndex ? 'text-green-600' : 'text-gray-300'
                  }`} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Current Status */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Current Stage</span>
          <span className="font-medium text-gray-900">
            {stage === 'fetching_emails' ? 'Fetching Emails from Gmail' :
             stage === 'analyzing' ? `Analyzing with ${model}` :
             'Analysis Complete'}
          </span>
        </div>
        {currentEmail !== undefined && totalEmails !== undefined && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Emails Processed</span>
            <span className="font-medium text-gray-900">{currentEmail} of {totalEmails}</span>
          </div>
        )}
        {estimatedTimeRemaining !== undefined && estimatedTimeRemaining > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Estimated Time Remaining</span>
            <span className="font-medium text-gray-900">{formatTime(estimatedTimeRemaining)}</span>
          </div>
        )}
      </div>

      {/* Keep Tab Open Notice */}
      <div className="mt-6 bg-blue-50 rounded-lg p-4 flex items-start gap-3">
        <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-blue-600 text-xs">i</span>
        </div>
        <div>
          <p className="text-sm text-blue-800">
            Please keep this tab open while we process your emails. You can switch to other tabs, and we'll notify you when the analysis is complete.
          </p>
        </div>
      </div>
    </div>
  );
} 