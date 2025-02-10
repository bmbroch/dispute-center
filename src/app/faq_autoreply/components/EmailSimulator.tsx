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
                line-height: 1.5;
                color: #333;
                margin: 0.5rem;
              }
              p {
                margin: 0 0 1em 0;
              }
            `,
            formats: {
              // Override default formats
              alignleft: { selector: 'p,h1,h2,h3,h4,h5,h6,td,th,div,ul,ol,li,table,img', classes: 'text-left' },
              aligncenter: { selector: 'p,h1,h2,h3,h4,h5,h6,td,th,div,ul,ol,li,table,img', classes: 'text-center' },
              alignright: { selector: 'p,h1,h2,h3,h4,h5,h6,td,th,div,ul,ol,li,table,img', classes: 'text-right' },
              alignjustify: { selector: 'p,h1,h2,h3,h4,h5,h6,td,th,div,ul,ol,li,table,img', classes: 'text-justify' }
            },
            entity_encoding: 'raw',
            forced_root_block: 'p',
            remove_trailing_brs: false,
            convert_newlines_to_brs: true,
            br_in_pre: false,
            keep_styles: true,
            setup: (editor: any) => {
              editor.on('BeforeSetContent', (e: { content: string }) => {
                // Convert plain text with newlines to paragraphs
                if (e.content) {
                  e.content = e.content
                    .split('\n')
                    .map((line: string) => line.trim() ? `<p>${line}</p>` : '<p><br></p>')
                    .join('');
                }
              });
              
              editor.on('GetContent', (e: { content: string }) => {
                // Preserve line breaks when getting content
                if (e.content) {
                  e.content = e.content
                    .replace(/<p>/g, '')
                    .replace(/<\/p>/g, '\n')
                    .replace(/<br \/>/g, '\n')
                    .replace(/\n\n+/g, '\n\n')
                    .trim();
                }
              });
            }
          }}
        />
        
        {loadingStep ? (
          <LoadingButton />
        ) : (
          <button
            onClick={handleSimulate}
            disabled={!emailContent.trim()}
            className={`mt-3 px-3 py-1.5 rounded text-sm ${
              !emailContent.trim()
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            Test Email
          </button>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-50 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        {simulationResult && !error && (
          <div className="mt-4 border-t pt-4">
            <h4 className="font-medium text-base mb-3 text-gray-900">AI Response</h4>
            
            {simulationResult.requiresHumanResponse ? (
              <div className="space-y-4 p-6 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">🤔</span>
                  <div>
                    <h4 className="text-lg font-medium text-blue-900">New Question Detected!</h4>
                    <p className="text-sm text-blue-800 mt-1">
                      This seems like a unique question that we haven&apos;t encountered before. Please help us create a template for similar questions in the future.
                    </p>
                  </div>
                </div>

                <div className="space-y-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-blue-900 mb-2">
                      Question Template 📝
                    </label>
                    <input
                      type="text"
                      value={emailContent.replace(/<[^>]*>/g, '')}
                      onChange={(e) => setEmailContent(e.target.value)}
                      className="w-full rounded-lg border border-blue-200 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                      placeholder="What&apos;s your question about?"
                    />
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
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleAddToFAQ}
                      disabled={!emailContent.trim() || !newFAQAnswer.trim()}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Add to FAQ Templates
                    </button>
                    <button
                      onClick={handleNevermind}
                      className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200"
                    >
                      Nevermind
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                {/* Top section with confidence and match type */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span className="text-sm font-medium text-blue-900">
                        {simulationResult.matches[0].confidence === 100 ? 'Exact FAQ Match' : 'AI Generated Response'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-blue-700">Confidence:</span>
                    <div className="flex items-center">
                      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            simulationResult.matches[0].confidence === 100 ? 'bg-green-500' :
                            simulationResult.matches[0].confidence >= confidenceThreshold ? 'bg-blue-500' :
                            'bg-yellow-500'
                          }`}
                          style={{ width: `${simulationResult.matches[0].confidence}%` }}
                        />
                      </div>
                      <span className={`ml-1.5 text-sm font-medium ${
                        simulationResult.matches[0].confidence === 100 ? 'text-green-700' :
                        simulationResult.matches[0].confidence >= confidenceThreshold ? 'text-blue-700' :
                        'text-yellow-700'
                      }`}>
                        {simulationResult.matches[0].confidence}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Key points as tags */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {simulationResult.analysis.keyPoints.map((point, index) => (
                    <span 
                      key={index}
                      className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded-full"
                    >
                      {point}
                    </span>
                  ))}
                </div>

                {/* Response content */}
                <div className="bg-white rounded-lg p-4 border border-blue-100">
                  <div className="prose prose-sm max-w-none">
                    <div
                      className="text-sm text-gray-700"
                      dangerouslySetInnerHTML={{ __html: simulationResult.matches[0].suggestedReply }}
                    />
                  </div>
                </div>

                {/* Dismiss button */}
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => {
                      setSimulationResult(null);
                      setEmailContent('');
                    }}
                    className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200 transition-colors"
                  >
                    Sounds Good
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}; 