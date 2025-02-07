'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { EmailSimulationResult } from '@/types/faq';
import { useAuth } from '@/lib/hooks/useAuth';
import toast from 'react-hot-toast';

// Dynamically import TinyMCE with no SSR to avoid hydration issues
const Editor = dynamic(() => import('@tinymce/tinymce-react').then(mod => mod.Editor), {
  ssr: false,
  loading: () => (
    <div className="animate-pulse bg-gray-200 rounded-lg h-[300px]"></div>
  ),
});

interface EmailSimulatorProps {
  onSimulationResult: (result: EmailSimulationResult, emailContent: string) => void;
}

export const EmailSimulator: React.FC<EmailSimulatorProps> = ({
  onSimulationResult,
}) => {
  const { user } = useAuth();
  const [emailContent, setEmailContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [simulationResult, setSimulationResult] = useState<EmailSimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSimulate = async () => {
    if (!emailContent.trim()) return;
    if (!user?.email) {
      setError('Please sign in to use the email simulator');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/faq/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailContent,
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
      
      setSimulationResult(result);
      onSimulationResult(result, emailContent);

      // Show success message
      toast.success('AI response generated successfully');
    } catch (error) {
      console.error('Error simulating email:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to simulate email';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b">
        <h3 className="text-lg font-semibold">Email Response Simulator</h3>
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
          onEditorChange={(content) => setEmailContent(content)}
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
          }}
        />
        
        <button
          onClick={handleSimulate}
          disabled={isLoading || !emailContent.trim()}
          className={`mt-4 px-4 py-2 rounded ${
            isLoading || !emailContent.trim()
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-green-500 hover:bg-green-600 text-white'
          }`}
        >
          {isLoading ? 'Generating Response...' : 'Test Email'}
        </button>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {simulationResult && !error && (
          <div className="mt-6 border-t pt-6">
            <h4 className="font-medium text-lg mb-4">AI Response</h4>
            
            {simulationResult.requiresHumanResponse ? (
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
                  <div className="border rounded p-4 bg-blue-50 border-blue-200 mb-4">
                    <h5 className="font-medium text-blue-800 mb-2">Analysis</h5>
                    <div className="text-sm text-blue-700">
                      <p><strong>Sentiment:</strong> {simulationResult.analysis.sentiment}</p>
                      <p className="mt-2"><strong>Key Points:</strong></p>
                      <ul className="list-disc list-inside mt-1">
                        {simulationResult.analysis.keyPoints.map((point, index) => (
                          <li key={index}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {/* Response Preview */}
                <div className="border rounded p-4 bg-green-50 border-green-200">
                  <h5 className="font-medium text-green-800 mb-2">Generated Response</h5>
                  <div className="prose prose-sm max-w-none">
                    <div
                      className="text-gray-700"
                      dangerouslySetInnerHTML={{ __html: simulationResult.matches[0].suggestedReply }}
                    />
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
          </div>
        )}
      </div>
    </div>
  );
}; 