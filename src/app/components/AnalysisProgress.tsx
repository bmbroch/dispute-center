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

const ModelLogo = ({ model }: { model: string }) => {
  if (model.toLowerCase().includes('openai')) {
    return (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" fill="currentColor"/>
      </svg>
    );
  }
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L3 9V23L12 30L21 23V9L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 2V16M12 30V16M3 9L12 16M21 9L12 16" stroke="currentColor" strokeWidth="2"/>
    </svg>
  );
};

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
    <div className="max-w-2xl mx-auto">
      {/* Header with Model Info */}
      <div className="bg-white rounded-t-2xl p-6 border border-b-0 border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-gray-900">Analysis Progress</h3>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full border border-gray-200">
            <ModelLogo model={model} />
            <span className="text-sm font-medium text-gray-700">{model}</span>
          </div>
        </div>
        <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
          <div 
            className="absolute inset-y-0 left-0 bg-blue-600 transition-all duration-500 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-sm">
          <span className="font-medium text-gray-900">{Math.round(progress)}% Complete</span>
          {estimatedTimeRemaining && estimatedTimeRemaining > 0 && (
            <span className="text-gray-500">{formatTime(estimatedTimeRemaining)} remaining</span>
          )}
        </div>
      </div>

      {/* Stages */}
      <div className="bg-white px-6 py-8 border-x border-gray-200">
        <div className="flex justify-between">
          {stages.map((s, index) => {
            const Icon = s.icon;
            const isActive = index === currentStageIndex;
            const isComplete = index < currentStageIndex;
            
            return (
              <React.Fragment key={s.id}>
                <div className="flex flex-col items-center">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors ${
                    isActive ? 'bg-blue-100 text-blue-600 animate-pulse' :
                    isComplete ? 'bg-green-100 text-green-600' :
                    'bg-gray-100 text-gray-400'
                  }`}>
                    {isActive ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (
                      <Icon className="w-6 h-6" />
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
                    <div className={`h-0.5 w-full ${
                      index < currentStageIndex ? 'bg-green-600' : 'bg-gray-200'
                    }`} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Current Status */}
      <div className="bg-white rounded-b-2xl border border-t-0 border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Current Stage</span>
            <span className="font-medium text-gray-900">
              {stage === 'fetching_emails' ? 'Fetching Emails from Gmail' :
               stage === 'analyzing' ? `Analyzing with ${model}` :
               'Analysis Complete'}
            </span>
          </div>
        </div>
        {currentEmail !== undefined && totalEmails !== undefined && (
          <div className="px-6 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Emails Processed</span>
              <span className="font-medium text-gray-900">{currentEmail} of {totalEmails}</span>
            </div>
          </div>
        )}

        {/* Keep Tab Open Notice */}
        <div className="p-4">
          <div className="bg-blue-50 rounded-lg p-4 flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-blue-600 text-xs">i</span>
            </div>
            <p className="text-sm text-blue-800">
              Please keep this tab open while we process your emails. You can switch to other tabs, and we&apos;ll notify you when the analysis is complete.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
} 