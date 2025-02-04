import { useState } from 'react';
import { X } from 'lucide-react';

interface RunTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunTest: (model: string, emailCount: number) => void;
  currentModel: string;
  currentEmailCount: number;
}

const EMAIL_COUNT_OPTIONS = [
  { value: 5, label: '5 most recent emails' },
  { value: 20, label: '20 most recent emails' },
  { value: 50, label: '50 most recent emails' },
  { value: 100, label: '100 most recent emails' },
  { value: 300, label: '300 most recent emails' },
];

const MODEL_OPTIONS = [
  { 
    value: 'openai', 
    label: 'OpenAI GPT-3.5',
    description: 'Faster, more reliable responses',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" fill="currentColor"/>
      </svg>
    )
  },
  { 
    value: 'deepseek', 
    label: 'Deepseek 67B',
    description: 'Open source model, may be slower',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none">
        <path d="M16 2L3 9V23L16 30L29 23V9L16 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M16 2V16M16 30V16M3 9L16 16M29 9L16 16" stroke="currentColor" strokeWidth="2"/>
      </svg>
    )
  }
];

export default function RunTestModal({ isOpen, onClose, onRunTest, currentModel, currentEmailCount }: RunTestModalProps) {
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const [emailCount, setEmailCount] = useState(currentEmailCount);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Run New Analysis</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Model Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select AI Model
            </label>
            <div className="space-y-3">
              {MODEL_OPTIONS.map((model) => (
                <div
                  key={model.value}
                  className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    selectedModel === model.value
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedModel(model.value)}
                >
                  <div className={`text-gray-700 ${selectedModel === model.value ? 'text-red-600' : ''}`}>
                    {model.logo}
                  </div>
                  <div className="ml-3">
                    <h3 className="font-medium text-gray-900">{model.label}</h3>
                    <p className="text-sm text-gray-500">{model.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Email Count Selection */}
          <div className="mb-6">
            <label htmlFor="emailCount" className="block text-sm font-medium text-gray-700 mb-2">
              Number of Emails
            </label>
            <select
              id="emailCount"
              value={emailCount}
              onChange={(e) => setEmailCount(Number(e.target.value))}
              className="block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500"
            >
              {EMAIL_COUNT_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onRunTest(selectedModel, emailCount);
                onClose();
              }}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
            >
              Start Analysis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 