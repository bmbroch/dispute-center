'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import FAQList from '../components/FAQList';
import { Sidebar } from '../components/Sidebar';
import LoginSplashScreen from '../components/LoginSplashScreen';
import { BookOpen, Mail, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import EmailThread from '../components/EmailThread';
import SaveAnalysisButton from '../components/SaveAnalysisButton';
import DebugPanel from '../components/DebugPanel';
import RunTestModal from '../components/RunTestModal';
import FAQPieChart from '../components/FAQPieChart';
import { collection, query, orderBy, limit, getDocs, addDoc, where, Firestore } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import Image from 'next/image';
import AnalysisModal from '../components/AnalysisModal';
import AnalysisSummary from '../components/AnalysisSummary';
import { SavedEmailAnalysis, EmailData, ThreadSummary, TokenUsage, AIInsights } from '@/types/analysis';
import { v4 as uuidv4 } from 'uuid';

interface ProcessingResult {
  totalEmails: number;
  totalEmailsAnalyzed: number;
  emails: EmailData[];
  tokenUsage: TokenUsage;
  aiInsights: AIInsights;
}

export default function KnowledgePage() {
  const [latestAnalysis, setLatestAnalysis] = useState<SavedEmailAnalysis | null>(null);
  const [showRunTestModal, setShowRunTestModal] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailData | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzedEmails, setAnalyzedEmails] = useState<EmailData[]>([]);
  const [processingStatus, setProcessingStatus] = useState<{
    stage: 'idle' | 'fetching_emails' | 'analyzing';
    progress: number;
    totalEmails?: number;
  }>({ stage: 'idle', progress: 0 });
  const [selectedModel, setSelectedModel] = useState('gpt-4');
  const [emailCountToAnalyze, setEmailCountToAnalyze] = useState(50);
  const [analysisStartTime, setAnalysisStartTime] = useState(Date.now());
  const [currentEmailIndex, setCurrentEmailIndex] = useState(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState(0);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ 
    promptTokens: 0, 
    completionTokens: 0, 
    totalTokens: 0 
  });
  const [showLoginSplash, setShowLoginSplash] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const { user } = useAuth();
  const router = useRouter();
  const db = getFirebaseDB();

  useEffect(() => {
    // Check authentication status
    if (user) {
      setIsCheckingAuth(false);
      setShowLoginSplash(false);
    } else {
      setIsCheckingAuth(false);
    }
  }, [user]);

  const handleCloseLogin = () => {
    setShowLoginSplash(false);
  };

  const handleStartAnalysis = async (model: string, count: number) => {
    setSelectedModel(model);
    setEmailCountToAnalyze(count);
    setAnalysisStartTime(Date.now());
    setLoading(true);
    setError(null);
    setProcessingStatus({ stage: 'fetching_emails', progress: 0 });
    // ... rest of the function implementation
  };

  const handleSaveAnalysis = async (analysis: SavedEmailAnalysis) => {
    if (!db) return;
    
    try {
      const analysisRef = collection(db, 'analyses');
      await addDoc(analysisRef, analysis);
      // ... rest of the function implementation
    } catch (error) {
      console.error('Error saving analysis:', error);
      setError('Failed to save analysis');
    }
  };

  const downloadDebugLogs = () => {
    // ... implementation
  };

  const supportEmailCount = result?.emails.filter(email => email.isSupport).length || 0;

  if (isCheckingAuth) {
    return (
      <div className="fixed inset-0 bg-white flex items-center justify-center">
        <div className="w-16 h-16">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-orange-100 rounded-full" />
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-orange-500 rounded-full border-t-transparent animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="pl-64">
        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold">Knowledge Base Generator</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRunTestModal(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Run New Analysis
              </button>
            </div>
          </div>

          {latestAnalysis ? (
            <div>
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={() => setLatestAnalysis(null)}
                  className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to Knowledge Base
                </button>
              </div>
              <AnalysisSummary 
                analysis={latestAnalysis}
              />
            </div>
          ) : (
            <>
              {!loading && !result && !error && (
                <div className="bg-white rounded-lg shadow-sm p-6 text-center">
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">Welcome to Knowledge Base Generator</h2>
                  <p className="text-gray-600 mb-6">Click "Run New Analysis" to analyze your email data and generate insights.</p>
                </div>
              )}

              {result && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 mb-8">
                  <div className="flex flex-col gap-2">
                    <div className="text-lg text-blue-800 font-medium">
                      Analysis complete! Found {supportEmailCount} support emails after analyzing {processingStatus.totalEmails} emails
                      in {Math.floor((Date.now() - analysisStartTime) / 60000)} minutes {Math.floor(((Date.now() - analysisStartTime) % 60000) / 1000)} seconds.
                    </div>
                    <div className="text-sm text-blue-600">
                      Token usage: {tokenUsage.totalTokens} total tokens ({tokenUsage.promptTokens} prompt, {tokenUsage.completionTokens} completion)
                    </div>
                    <div className="text-sm text-blue-600">
                      Using batched processing: {Math.ceil(processingStatus.totalEmails! / 5)} API calls for {processingStatus.totalEmails} emails
                    </div>
                  </div>
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => downloadDebugLogs()}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Download Debug Logs
                    </button>
                    <SaveAnalysisButton
                      analysis={{
                        id: uuidv4(),
                        timestamp: Date.now(),
                        totalEmails: result.totalEmails,
                        totalEmailsAnalyzed: result.totalEmailsAnalyzed,
                        emails: result.emails,
                        tokenUsage: result.tokenUsage,
                        aiInsights: result.aiInsights
                      }}
                      onSave={handleSaveAnalysis}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Save Analysis
                    </SaveAnalysisButton>
                    <button
                      onClick={() => setShowRunTestModal(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Run Test Again
                    </button>
                  </div>
                </div>
              )}

              {result && (
                <div className="mb-8">
                  <FAQPieChart
                    faqs={result.aiInsights.commonQuestions}
                    totalEmails={result.totalEmails}
                    supportEmails={result.emails.filter(email => email.isSupport).length}
                  />
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
                  <div className="flex items-center gap-2 text-red-700">
                    <XCircle className="w-5 h-5 flex-shrink-0" />
                    <p>{error}</p>
                  </div>
                  {analyzedEmails.length > 0 && (
                    <p className="mt-2 text-sm text-red-600">
                      Scroll down to review the analyzed emails and verify the classifications.
                    </p>
                  )}
                </div>
              )}

              {loading && (
                <div className="bg-white rounded-2xl shadow-sm p-8 mb-8">
                  <div className="max-w-2xl mx-auto">
                    <div className="text-center mb-8">
                      <div className="w-16 h-16 mx-auto mb-4">
                        <div className="relative">
                          <div className="w-16 h-16 border-4 border-orange-100 rounded-full" />
                          <div className="absolute top-0 left-0 w-16 h-16 border-4 border-orange-500 rounded-full border-t-transparent animate-spin" />
                        </div>
                      </div>
                      <h2 className="text-xl font-semibold text-gray-900 mb-2">
                        {processingStatus.stage === 'fetching_emails' 
                          ? 'Fetching Emails' 
                          : processingStatus.stage === 'analyzing'
                          ? 'Analyzing Content'
                          : 'Processing...'}
                      </h2>
                      <p className="text-gray-600 mb-2">
                        {processingStatus.stage === 'fetching_emails'
                          ? 'Retrieving your recent emails...'
                          : processingStatus.stage === 'analyzing'
                          ? `Analyzing email ${currentEmailIndex + 1} of ${processingStatus.totalEmails}`
                          : 'Please wait while we process your request...'}
                      </p>
                      <div className="text-sm text-gray-500 bg-gray-100 rounded-lg p-3 mb-6 flex items-center gap-2">
                        <div className="min-w-0">
                          <p className="font-medium mb-1">Please keep this tab open</p>
                          <p>You can switch to other tabs but don't close this one until the analysis is complete (max 10 minutes).</p>
                        </div>
                      </div>

                      <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
                        <div 
                          className="h-full bg-orange-500 rounded-full transition-all duration-500"
                          style={{ width: `${processingStatus.progress}%` }}
                        />
                      </div>

                      {estimatedTimeRemaining > 0 && (
                        <p className="text-sm text-gray-500 mt-6">
                          Estimated time remaining: {Math.ceil(estimatedTimeRemaining / 60)} min {estimatedTimeRemaining % 60} sec
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <LoginSplashScreen
        isOpen={!isCheckingAuth && showLoginSplash}
        onClose={handleCloseLogin}
        message="Sign in to access the Knowledge Base Generator"
      />

      {selectedEmail && (
        <EmailThread
          email={selectedEmail}
          onClose={() => {
            console.log('Closing email thread');
            setSelectedEmail(null);
          }}
        />
      )}

      <RunTestModal
        isOpen={showRunTestModal}
        onClose={() => setShowRunTestModal(false)}
        onRunTest={(model, count) => {
          handleStartAnalysis(model, count);
          setShowRunTestModal(false);
        }}
        currentModel={selectedModel}
        currentEmailCount={emailCountToAnalyze}
      />
    </div>
  );
} 