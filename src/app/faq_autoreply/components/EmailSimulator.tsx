'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { EmailSimulationResult, FAQ } from '@/types/faq';
import { useAuth } from '@/lib/hooks/useAuth';
import toast from 'react-hot-toast';
import { Dialog } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { Editor as TinyMCEEditor } from '@tinymce/tinymce-react';

// Dynamically import TinyMCE with no SSR to avoid hydration issues
const Editor = dynamic(
  () => import('@tinymce/tinymce-react').then((mod) => {
    const { Editor } = mod;
    return function EditorWrapper(props: any) {
      return <Editor {...props} />;
    };
  }),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse bg-gray-200 rounded-lg h-[300px]"></div>
    ),
  }
);

interface EmailSimulatorProps {
  onSimulationResult: (result: EmailSimulationResult, emailContent: string) => void;
  confidenceThreshold: number;
  onAddNewFAQ?: (faq: { question: string; answer: string }) => void;
  existingFaqs?: FAQ[];
}

type LoadingStep = 'analyzing' | 'generating' | null;

export const EmailSimulator: React.FC<EmailSimulatorProps> = ({
  onSimulationResult,
  confidenceThreshold,
  onAddNewFAQ,
  existingFaqs = [],
}) => {
  const { user } = useAuth();
  const [emailContent, setEmailContent] = useState('');
  const [loadingStep, setLoadingStep] = useState<LoadingStep>(null);
  const [simulationResult, setSimulationResult] = useState<EmailSimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAddFAQModalOpen, setIsAddFAQModalOpen] = useState(false);
  const [newFAQAnswer, setNewFAQAnswer] = useState('');
  const [showHumanNeededPrompt, setShowHumanNeededPrompt] = useState(false);

  const handleSimulate = async () => {
    if (!emailContent.trim()) return;
    if (!user?.email) {
      setError('Please sign in to use the email simulator');
      return;
    }

    // Clean HTML tags from the content before sending
    const cleanContent = emailContent.replace(/<[^>]*>/g, '');

    // Check if this question matches any existing FAQ
    const matchingFaq = existingFaqs.find(faq => {
      const normalizedQuestion = faq.question.toLowerCase().trim();
      const normalizedInput = cleanContent.toLowerCase().trim();
      return normalizedQuestion === normalizedInput;
    });

    if (matchingFaq) {
      // If we find a match, create a simulation result from the existing FAQ
      const result: EmailSimulationResult = {
        matches: [{
          faq: matchingFaq,
          confidence: 100,
          suggestedReply: matchingFaq.replyTemplate
        }],
        requiresHumanResponse: false,
        reason: '',
        analysis: {
          sentiment: 'neutral',
          keyPoints: ['Matched existing FAQ template'],
          concepts: []
        }
      };
      setSimulationResult(result);
      onSimulationResult(result, emailContent);
      toast.success('Matched existing FAQ template');
      return;
    }

    setLoadingStep('analyzing');
    setError(null);
    try {
      // First delay to show "Analyzing question..."
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const response = await fetch('/api/faq/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailContent: cleanContent,
          email: user.email,
        }),
      });

      if (!response.ok) {
        throw new Error('Simulation failed');
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      // Second delay to show "Generating response..."
      setLoadingStep('generating');
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setSimulationResult(result);
      
      // Only pass the result to parent if confidence is above threshold
      if (result.matches.length > 0 && result.matches[0].confidence >= confidenceThreshold) {
        onSimulationResult(result, emailContent);
        toast.success('AI response generated successfully');
      } else {
        setShowHumanNeededPrompt(true);
      }
    } catch (error) {
      console.error('Error simulating email:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to simulate email';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoadingStep(null);
    }
  };

  const handleNevermind = () => {
    setShowHumanNeededPrompt(false);
    setSimulationResult(null);
    setEmailContent('');
    setNewFAQAnswer('');
  };

  const handleAddToFAQ = () => {
    if (!simulationResult) return;
    
    onAddNewFAQ?.({
      question: emailContent,
      answer: newFAQAnswer || ''
    });
    
    setIsAddFAQModalOpen(false);
    setNewFAQAnswer('');
    setShowHumanNeededPrompt(false);
    setSimulationResult(null);
    setEmailContent('');
  };

  const handleEditorChange = (content: string) => {
    setEmailContent(content);
  };

  const LoadingButton = () => (
    <button
      disabled
      className="mt-4 px-6 py-2 bg-gray-300 text-gray-700 rounded inline-flex items-center space-x-2"
    >
      <div className="w-5 h-5 border-t-2 border-b-2 border-gray-700 rounded-full animate-spin" />
      <span className="inline-block">
        {loadingStep === 'analyzing' ? 'Analyzing question...' : 'Generating response...'}
      </span>
    </button>
  );

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b">
        <h3 className="text-lg font-semibold text-gray-900">Email Response Simulator</h3>
        <p className="text-sm text-gray-600 mt-1">
          Test how our AI would respond to an incoming customer email
        </p>
        {user?.email && (
          <p className="text-sm text-gray-500 mt-1">
            Testing as: {user.email}
          </p>
        )}
      </div>
      
      <div className="p-6">
        <Editor
          apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
          value={emailContent}
          onEditorChange={handleEditorChange}
          init={{
            height: 300,
            menubar: false,
            plugins: [
              'advlist', 'autolink', 'lists', 'link', 'charmap', 'preview',
              'searchreplace', 'visualblocks', 'code', 'fullscreen',
              'insertdatetime', 'table', 'code', 'help', 'wordcount'
            ],
            toolbar: 'undo redo | formatselect | ' +
              'bold italic | alignleft aligncenter ' +
              'alignright alignjustify | bullist numlist | ' +
              'removeformat | help',
            content_style: `
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                font-size: 14px;
                line-height: 1.6;
                color: #333;
                margin: 1rem;
              }
              p {
                margin: 0 0 1rem 0;
              }
            `
          }}
        />
        
        {loadingStep ? (
          <LoadingButton />
        ) : (
          <button
            onClick={handleSimulate}
            disabled={!emailContent.trim()}
            className={`mt-4 px-4 py-2 rounded ${
              !emailContent.trim()
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            Test Email
          </button>
        )}

        {error && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 rounded">
            {error}
          </div>
        )}

        {simulationResult && !error && (
          <div className="mt-6 border-t pt-6">
            <h4 className="font-medium text-lg mb-4 text-gray-900">AI Response</h4>
            
            {showHumanNeededPrompt ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                <div className="font-medium text-yellow-800">
                  Human Response Needed
                </div>
                <div className="text-sm text-yellow-700 mt-1">
                  {simulationResult.reason}
                </div>
              </div>
            ) : simulationResult.matches.length > 0 ? (
              <div className="space-y-4">
                {/* Analysis Section */}
                {simulationResult.analysis && (
                  <div className="border rounded-lg p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 mb-4">
                    <div className="flex items-center justify-between mb-4">
                      <h5 className="text-lg font-semibold text-blue-900">AI Analysis</h5>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-blue-700">Confidence Score:</span>
                        <div className="flex items-center">
                          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                simulationResult.matches[0].confidence >= confidenceThreshold ? 'bg-green-500' :
                                simulationResult.matches[0].confidence >= 70 ? 'bg-yellow-500' :
                                'bg-red-500'
                              }`}
                              style={{ width: `${simulationResult.matches[0].confidence}%` }}
                            />
                          </div>
                          <span className={`ml-2 text-sm font-medium ${
                            simulationResult.matches[0].confidence >= confidenceThreshold ? 'text-green-700' :
                            'text-yellow-700'
                          }`}>
                            {simulationResult.matches[0].confidence}%
                          </span>
                        </div>
                      </div>
                    </div>
                    {simulationResult.matches[0].confidence < confidenceThreshold && (
                      <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                        ⚠️ This response is below your confidence threshold of {confidenceThreshold}%. Consider reviewing before sending.
                      </div>
                    )}
                    <div className="space-y-4 mt-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                        <span className="text-sm font-medium text-blue-900">Sentiment:</span>
                        <span className="text-sm text-blue-700">{simulationResult.analysis.sentiment}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 rounded-full bg-blue-400" />
                          <span className="text-sm font-medium text-blue-900">Key Points:</span>
                        </div>
                        <ul className="ml-4 space-y-2">
                          {simulationResult.analysis.keyPoints.map((point: string, index: number) => (
                            <li key={index} className="text-sm text-blue-700 flex items-start gap-2">
                              <span className="text-blue-400">•</span>
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
                {/* Response Preview */}
                <div className={`border rounded-lg p-6 ${
                  simulationResult.matches[0].confidence >= confidenceThreshold
                    ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200'
                    : 'bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-200'
                }`}>
                  <h5 className={`font-semibold text-lg mb-4 ${
                    simulationResult.matches[0].confidence >= confidenceThreshold
                      ? 'text-green-900'
                      : 'text-yellow-900'
                  }`}>Generated Response</h5>
                  <div className="prose prose-sm max-w-none">
                    <div
                      className="text-gray-700"
                      dangerouslySetInnerHTML={{ __html: simulationResult.matches[0].suggestedReply }}
                    />
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={() => onSimulationResult(simulationResult, emailContent)}
                      className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors"
                    >
                      Deny Response
                    </button>
                    <button
                      onClick={() => onSimulationResult(simulationResult, emailContent)}
                      className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                        simulationResult.matches[0].confidence >= confidenceThreshold
                          ? 'bg-green-500 hover:bg-green-600'
                          : 'bg-yellow-500 hover:bg-yellow-600'
                      }`}
                    >
                      {simulationResult.matches[0].confidence >= confidenceThreshold
                        ? 'Add to Pending Replies'
                        : 'Add to Pending Replies (Review Needed)'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded p-4">
                <div className="text-gray-700">
                  No response generated. Please try again.
                </div>
              </div>
            )}

            {showHumanNeededPrompt && simulationResult && simulationResult.matches.length > 0 && (
              <div className="mt-6 p-6 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0">
                    <span className="text-2xl">🤔</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-medium text-blue-900 mb-2">
                      New Question Detected! 
                      <span className="ml-2 text-sm font-normal text-blue-700">
                        (Confidence: {simulationResult.matches[0].confidence}%)
                      </span>
                    </h4>
                    <p className="text-blue-800 mb-4">
                      This seems like a unique question that we haven&apos;t encountered before. Please help us create a template for similar questions in the future.
                    </p>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-blue-900 mb-2">
                          General Question Template 📝
                        </label>
                        <input
                          type="text"
                          value={emailContent.replace(/<[^>]*>/g, '')}
                          onChange={(e) => setEmailContent(e.target.value)}
                          className="w-full rounded-lg border border-blue-200 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                          placeholder="Enter a generalized version of this question..."
                        />
                        <p className="text-sm text-blue-700 mt-1">
                          Tip: Make the question template general enough to match similar future questions
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-blue-900 mb-2">
                          Response Template 📝
                        </label>
                        <textarea
                          value={newFAQAnswer}
                          onChange={(e) => setNewFAQAnswer(e.target.value)}
                          rows={4}
                          className="w-full rounded-lg border border-blue-200 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                          placeholder="Enter your response template..."
                        />
                        <p className="text-sm text-blue-700 mt-1">
                          Tip: Use placeholders like {'{customer_name}'} for dynamic content
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleAddToFAQ}
                          disabled={!emailContent.trim() || !newFAQAnswer.trim()}
                          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <span>Add to FAQ Templates</span>
                          <span>✨</span>
                        </button>
                        <button
                          onClick={handleNevermind}
                          className="px-6 py-2 text-blue-700 bg-blue-100 rounded-lg hover:bg-blue-200"
                        >
                          Nevermind
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Add to FAQ Modal */}
        <Dialog
          open={isAddFAQModalOpen}
          onClose={() => setIsAddFAQModalOpen(false)}
          className="relative z-50"
        >
          <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
          
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Panel className="mx-auto max-w-2xl w-full rounded-lg bg-white p-6 shadow-xl">
              <div className="flex justify-between items-start mb-4">
                <Dialog.Title className="text-lg font-semibold">
                  Add New FAQ Template
                </Dialog.Title>
                <button
                  onClick={() => setIsAddFAQModalOpen(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Question
                  </label>
                  <div className="bg-gray-50 rounded p-3 text-gray-700">
                    {emailContent}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Answer Template
                  </label>
                  <div className="relative">
                    {simulationResult && simulationResult.matches && simulationResult.matches[0] && (
                      <Editor
                        apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
                        initialValue={simulationResult.matches[0].suggestedReply}
                        onEditorChange={(content: string) => setNewFAQAnswer(content)}
                        init={{
                          height: 300,
                          menubar: false,
                          plugins: [
                            'advlist', 'autolink', 'lists', 'link', 'charmap',
                            'searchreplace', 'visualblocks', 'code', 'fullscreen',
                            'insertdatetime', 'table', 'code', 'help', 'wordcount'
                          ],
                          toolbar: 'undo redo | formatselect | ' +
                            'bold italic | alignleft aligncenter ' +
                            'alignright alignjustify | bullist numlist | ' +
                            'removeformat | help',
                        }}
                      />
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => setIsAddFAQModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddToFAQ}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    Add to Templates
                  </button>
                </div>
              </div>
            </Dialog.Panel>
          </div>
        </Dialog>
      </div>
    </div>
  );
}; 