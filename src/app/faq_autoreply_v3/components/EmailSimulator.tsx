'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { EmailSimulationResult, FAQ } from '@/types/faq';
import { useAuth } from '@/lib/hooks/useAuth';
import { toast } from 'sonner';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { Editor as TinyMCEEditor } from '@tinymce/tinymce-react';
import { Fragment } from 'react';

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
  emailFormatting?: {
    greeting: string;
    listStyle: 'numbered' | 'bullet';
    spacing: 'compact' | 'normal' | 'spacious';
    signatureStyle: string;
    customPrompt: string;
  };
}

const DEFAULT_EMAIL_FORMATTING = {
  greeting: "Hi [Name]!",
  listStyle: 'numbered' as const,
  spacing: 'normal' as const,
  signatureStyle: "Best,\n[Name]",
  customPrompt: "Please keep responses friendly but professional."
};

type LoadingStep = 'analyzing' | 'generating' | null;

export const EmailSimulator: React.FC<EmailSimulatorProps> = ({
  onSimulationResult,
  confidenceThreshold,
  onAddNewFAQ,
  existingFaqs = [],
  emailFormatting = DEFAULT_EMAIL_FORMATTING,
}) => {
  const { user } = useAuth();
  const [emailContent, setEmailContent] = useState('');
  const [loadingStep, setLoadingStep] = useState<LoadingStep>(null);
  const [simulationResult, setSimulationResult] = useState<EmailSimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAddFAQModalOpen, setIsAddFAQModalOpen] = useState(false);
  const [newFAQAnswer, setNewFAQAnswer] = useState('');
  const [showHumanNeededPrompt, setShowHumanNeededPrompt] = useState(false);

  const normalizeText = (text: string): string => {
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[.,!?]+$/, '') // Remove trailing punctuation
      .replace(/^(how|what|when|where|why|who|can|could|would|do|does|did|is|are|was|were)\s+(do|does|did|is|are|was|were|can|could|would|i|you|we|they)\s+/i, '') // Remove common question prefixes
      .replace(/\?+$/, ''); // Remove question marks
  };

  const handleSimulate = async () => {
    if (!emailContent.trim()) return;
    if (!user?.email) {
      setError('Please sign in to use the email simulator');
      return;
    }

    // Reset previous state
    setSimulationResult(null);
    setNewFAQAnswer('');
    setError(null);
    setLoadingStep('analyzing');
    
    try {
      // First, let's get an AI-generated analysis of the email content
      const response = await fetch('/api/faq/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailContent,
          email: user.email,
          existingFaqs: existingFaqs.map(faq => ({
            question: faq.question,
            replyTemplate: faq.replyTemplate
          })),
          emailFormatting: emailFormatting
        }),
      });

      if (!response.ok) {
        throw new Error('Simulation failed');
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      setLoadingStep('generating');
      await new Promise(resolve => setTimeout(resolve, 800));

      // If we have matches above threshold, generate a natural response
      if (result.matches.length > 0 && result.matches[0].confidence >= confidenceThreshold) {
        // Generate a natural email response using the AI's understanding
        const emailResponse = result.matches[0].suggestedReply;

        const finalResult: EmailSimulationResult = {
          matches: result.matches,
          requiresHumanResponse: false,
          reason: 'AI generated response based on FAQ matches',
          analysis: {
            sentiment: result.analysis.sentiment,
            keyPoints: [
              'AI generated response',
              `Confidence: ${result.matches[0].confidence}%`,
              'Based on FAQ library matches'
            ],
            concepts: result.analysis.concepts || []
          }
        };
        
        setSimulationResult(finalResult);
        onSimulationResult(finalResult, emailContent);
        toast.success('Generated response added to auto-replies for review');
        return;
      }

      // If no good matches, show FAQ creation UI
      setSimulationResult({
        matches: [],
        requiresHumanResponse: true,
        reason: 'No matching template found. Please create a new FAQ template.',
        analysis: {
          sentiment: 'neutral',
          keyPoints: ['No matching template found', 'New template needed'],
          concepts: []
        }
      });
      setNewFAQAnswer('');
      
    } catch (error) {
      console.error('Error simulating email:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to simulate email';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoadingStep(null);
    }
  };

  const handleAddToFAQ = () => {
    if (!simulationResult) return;
    
    onAddNewFAQ?.({
      question: emailContent,
      answer: newFAQAnswer || ''
    });
    
    // Reset all state after adding to FAQ
    setSimulationResult(null);
    setNewFAQAnswer('');
    setEmailContent('');
    setShowHumanNeededPrompt(false);
    toast.success('Added to FAQ Library 📚');
  };

  const handleNevermind = () => {
    // Reset all state when canceling
    setShowHumanNeededPrompt(false);
    setSimulationResult(null);
    setEmailContent('');
    setNewFAQAnswer('');
  };

  const handleEditorChange = (content: string) => {
    // Reset previous results when content changes
    if (simulationResult) {
      setSimulationResult(null);
      setNewFAQAnswer('');
    }
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
      <div className="p-4 border-b">
        <h3 className="text-base font-medium text-gray-900">Email Response Simulator</h3>
        <p className="text-sm text-gray-600 mt-0.5">
          Test how our AI would respond to an incoming customer email
        </p>
        {user?.email && (
          <p className="text-xs text-gray-500 mt-0.5">
            Testing as: {user.email}
          </p>
        )}
      </div>
      
      <div className="p-4">
        <Editor
          apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
          value={emailContent}
          onEditorChange={handleEditorChange}
          init={{
            height: 200,
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

        <div className="mt-4 flex justify-between items-center">
          <div className="flex-1">
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {loadingStep ? (
              <LoadingButton />
            ) : (
              <button
                onClick={handleSimulate}
                disabled={!emailContent.trim()}
                className={`px-6 py-2 text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
                  !emailContent.trim() ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                Test Response
              </button>
            )}
          </div>
        </div>

        {simulationResult && (
          <div className="mt-6 border-t pt-6">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Analysis Results</h4>
            <div className="space-y-4">
              {simulationResult.matches.map((match, index) => (
                <div key={index} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      match.confidence >= confidenceThreshold
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {match.confidence}% Match
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">{match.suggestedReply}</p>
                </div>
              ))}

              {simulationResult.requiresHumanResponse && (
                <div className="p-4 bg-yellow-50 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    {simulationResult.reason}
                  </p>
                  {onAddNewFAQ && (
                    <div className="mt-4">
                      <button
                        onClick={() => setIsAddFAQModalOpen(true)}
                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                      >
                        Create New FAQ
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add FAQ Modal */}
      <Dialog
        open={isAddFAQModalOpen}
        onClose={() => setIsAddFAQModalOpen(false)}
        className="fixed inset-0 z-10 overflow-y-auto"
      >
        <div className="flex items-center justify-center min-h-screen">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-30" />
          </Transition.Child>

          <div className="relative bg-white rounded-lg max-w-2xl w-full mx-4 p-6">
            <div className="absolute top-0 right-0 pt-4 pr-4">
              <button
                onClick={() => setIsAddFAQModalOpen(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="mt-3 text-center sm:mt-0 sm:text-left">
              <Dialog.Title
                as="h3"
                className="text-lg font-medium leading-6 text-gray-900"
              >
                Create New FAQ
              </Dialog.Title>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700">
                  Question
                </label>
                <div className="mt-1">
                  <textarea
                    value={emailContent}
                    readOnly
                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    rows={3}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700">
                  Answer Template
                </label>
                <div className="mt-1">
                  <textarea
                    value={newFAQAnswer}
                    onChange={(e) => setNewFAQAnswer(e.target.value)}
                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                    rows={4}
                    placeholder="Enter a template answer for this type of question..."
                  />
                </div>
              </div>

              <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleAddToFAQ}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Add to FAQ Library
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddFAQModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}; 