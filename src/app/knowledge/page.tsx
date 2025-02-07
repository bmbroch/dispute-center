'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import FAQList from '../components/FAQList';
import { Sidebar } from '../components/Sidebar';
import LoginSplashScreen from '../components/LoginSplashScreen';
import { BookOpen, Mail, CheckCircle2, XCircle, Loader2, Download, X } from 'lucide-react';
import EmailThread from '../components/EmailThread';
import SaveAnalysisButton from '../components/SaveAnalysisButton';
import DebugPanel from '../components/DebugPanel';
import RunTestModal from '../components/RunTestModal';
import FAQPieChart from '../components/FAQPieChart';
import { collection, query, orderBy, limit, getDocs, addDoc, where, onSnapshot } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import Image from 'next/image';
import AnalysisModal from '../components/AnalysisModal';
import AnalysisSummary from '../components/AnalysisSummary';
import { EmailData, AIInsights, CustomerSentiment, TokenUsage, SavedEmailAnalysis, AnalysisResult, CommonQuestion, EmailMessage } from '@/types/analysis';
import { toast } from 'react-hot-toast';
import AnalysisErrorModal from '../components/AnalysisErrorModal';
import AnalysisProgress from '../components/AnalysisProgress';

// Add helper functions
const STORAGE_KEY = 'savedEmailAnalyses';

// Add response rate logging function
function logResponseRateCalculation(stage: string, data: any) {
  console.log(`[Response Rate ${stage}]:`, data);
  debugLog(`response_rate_${stage}`, data);
}

function getSavedAnalyses(): SavedEmailAnalysis[] {
  if (typeof window === 'undefined') return [];
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : [];
}

function saveAnalysis(analysis: SavedEmailAnalysis) {
  const saved = getSavedAnalyses();
  const updatedAnalyses = [analysis, ...saved].slice(0, 5); // Keep only last 5 analyses
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedAnalyses));
}

function normalizeSubject(subject: string): string {
  // Remove Re:, Fwd:, etc. and trim whitespace
  return subject
    .replace(/^(re|fwd|fw|r|f):\s*/gi, '')
    .trim()
    .toLowerCase();
}

function truncateEmailBody(body: string, maxTokens: number = 3500): string {
  // Rough estimation: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4;
  if (body.length <= maxChars) return body;
  
  // Take first portion of the email, leaving room for truncation notice
  const truncatedBody = body.slice(0, maxChars - 100);
  return `${truncatedBody}\n\n[Email truncated due to length...]`;
}

// Function to prepare analysis for Firebase
function prepareAnalysisForFirebase(analysis: AnalysisResult) {
  // Calculate response rate before saving
  const customerThreads = analysis.emails?.filter(e => e.isCustomer) || [];
  const threadsWithReplies = customerThreads.filter(thread => thread.hasUserReply).length;
  const responseRate = customerThreads.length > 0 
    ? Math.round((threadsWithReplies / customerThreads.length) * 100) 
    : 0;

  logResponseRateCalculation('calculation', {
    totalThreads: analysis.emails?.length || 0,
    customerThreads: customerThreads.length,
    threadsWithReplies,
    responseRate,
    sampleThread: customerThreads[0]
  });

  // Ensure no undefined values in support emails
  const sanitizedSupportEmails = (analysis.supportEmails || []).map(email => ({
    threadId: email.threadId || `thread-${Date.now()}-${Math.random()}`,
    subject: email.subject || 'No Subject',
    from: email.from || 'Unknown Sender',
    date: email.date || new Date().toISOString(),
    isCustomer: Boolean(email.isCustomer),
    confidence: email.confidence || 0,
    reason: email.reason || '',
    category: email.category || 'uncategorized',
    hasUserReply: Boolean(email.hasUserReply)
  }));

  // Ensure no undefined values in email metrics
  const emailMetrics = {
    customerThreads: customerThreads.length,
    nonCustomerThreads: (analysis.emails?.length || 0) - customerThreads.length,
    averageConfidence: analysis.emails?.reduce((acc, e) => acc + (e.confidence || 0), 0) / (analysis.emails?.length || 1) || 0,
    categories: analysis.emails?.reduce((acc, e) => {
      const category = e.category || 'uncategorized';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {}
  };

  // Ensure no undefined values in token usage
  const tokenUsage = {
    promptTokens: analysis.tokenUsage?.promptTokens || 0,
    completionTokens: analysis.tokenUsage?.completionTokens || 0,
    totalTokens: analysis.tokenUsage?.totalTokens || 0
  };

  // Ensure no undefined values in AI insights
  const aiInsights = {
    keyPoints: analysis.aiInsights?.keyPoints || [],
    keyCustomerPoints: analysis.aiInsights?.keyCustomerPoints || [],
    commonQuestions: (analysis.aiInsights?.commonQuestions || []).map(q => ({
      question: q.question || '',
      typicalAnswer: q.typicalAnswer || '',
      frequency: q.frequency || 1
    })),
    customerSentiment: {
      overall: analysis.aiInsights?.customerSentiment?.overall || 'Analysis complete',
      details: analysis.aiInsights?.customerSentiment?.details || ''
    },
    recommendedActions: analysis.aiInsights?.recommendedActions || []
  };

  const prepared = {
    id: analysis.id || `analysis-${Date.now()}`,
    timestamp: analysis.timestamp || Date.now(),
    totalEmails: analysis.totalEmails || 0,
    totalEmailsAnalyzed: analysis.totalEmailsAnalyzed || 0,
    supportEmailCount: sanitizedSupportEmails.length,
    responseRate, // Explicitly include response rate
    hasUserReplies: threadsWithReplies > 0, // Add this flag
    replyMetrics: { // Add detailed metrics
      totalCustomerThreads: customerThreads.length,
      threadsWithReplies,
      responseRate
    },
    supportEmails: sanitizedSupportEmails,
    emailMetrics,
    tokenUsage,
    aiInsights
  };

  logResponseRateCalculation('firebase_save', {
    responseRate: prepared.responseRate,
    replyMetrics: prepared.replyMetrics,
    sampleSupportEmail: prepared.supportEmails[0]
  });

  return prepared;
}

// Debug logging
const DEBUG_LOG: any[] = [];

function debugLog(stage: string, data: any) {
  const log = {
    timestamp: new Date().toISOString(),
    stage,
    data
  };
  DEBUG_LOG.push(log);
  console.log(`[DEBUG] ${stage}:`, data);
}

interface EmailAnalysis {
  subject: string;
  isSupport: boolean;
  confidence?: number;
  reason?: string;
  timestamp: number;
  error?: string;
  status?: string;
  debug?: Array<{
    timestamp: string;
    stage: string;
    data: any;
  }>;
}

interface AnalysisJob {
  id: string;
  userId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  totalEmails: number;
  analyzedEmails: number;
  supportEmailsFound: number;
  results?: AnalysisResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface User {
  uid?: string;
  email: string | null;
  accessToken?: string;
  picture?: string;
}

interface SupportEmail {
  subject: string;
  from: string;
  body: string;
  date: string;
  analysis?: {
    isSupport: boolean;
    confidence: number;
    reason: string;
  };
}

const ReanalysisActionGroup = ({ onReanalyze, changedEmailsCount }: { onReanalyze: () => void, changedEmailsCount: number }) => {
  return (
    <div className="fixed bottom-8 right-8 z-50">
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-100 p-6 max-w-md">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {changedEmailsCount} Email{changedEmailsCount !== 1 ? 's' : ''} Reclassified
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              You&apos;ve made changes to email classifications. Would you like to update your analysis with these changes?
            </p>
            <button
              onClick={onReanalyze}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 font-medium"
            >
              Run Analysis Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const KnowledgePage: React.FC = () => {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLoginSplash, setShowLoginSplash] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [emailCountToAnalyze, setEmailCountToAnalyze] = useState(20);
  const [processingStatus, setProcessingStatus] = useState<{
    stage: 'fetching_emails' | 'analyzing' | 'complete';
    progress: number;
    currentEmail?: number;
    totalEmails?: number;
    originalCount?: number;
  }>({ stage: 'fetching_emails', progress: 0 });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzedThreads, setAnalyzedThreads] = useState<EmailData[]>([]);
  const [supportEmailCount, setSupportEmailCount] = useState(0);
  const [activeJob, setActiveJob] = useState<AnalysisJob | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  });
  const [selectedEmail, setSelectedEmail] = useState<EmailData | null>(null);
  const [latestAnalysis, setLatestAnalysis] = useState<SavedEmailAnalysis | null>(null);
  const [emailData, setEmailData] = useState<EmailData[]>([]);
  const [currentEmailIndex, setCurrentEmailIndex] = useState<number>(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number>(0);
  const [analysisStartTime, setAnalysisStartTime] = useState<number>(0);
  const [showRunTestModal, setShowRunTestModal] = useState(false);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedEmailAnalysis[]>([]);
  const [currentAnalysis, setCurrentAnalysis] = useState<SavedEmailAnalysis | null>(null);
  const [latestSavedAnalysis, setLatestSavedAnalysis] = useState<SavedEmailAnalysis | null>(null);
  const [visibleAnalysesCount, setVisibleAnalysesCount] = useState(3);
  const [supportEmails, setSupportEmails] = useState<EmailData[]>([]);
  const [currentView, setCurrentView] = useState<'config' | 'analysis'>('config');
  const [emailOverrides, setEmailOverrides] = useState<Record<string, boolean>>({});
  const [hasOverrides, setHasOverrides] = useState(false);
  const [hasReanalyzed, setHasReanalyzed] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('openai');
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [showAnalysisError, setShowAnalysisError] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<SavedEmailAnalysis | null>(null);

  // Calculate changed emails count at component level
  const changedEmailsCount = Object.keys(emailOverrides).length;

  const db = useMemo(() => getFirebaseDB(), []);

  useEffect(() => {
    if (!user?.email || !db) return;

    let isSubscribed = true;  // Add mounted check
    const jobsRef = collection(db, 'analysisJobs');
    
    const q = query(
      jobsRef,
      where('userId', '==', user.email),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!isSubscribed) return;  // Don't update state if unmounted
      
      if (!snapshot.empty) {
        const jobData = snapshot.docs[0].data() as AnalysisJob;
        setActiveJob(jobData);
        
        if (jobData.status === 'completed' && jobData.results) {
          setResult(jobData.results);
          setShowErrorModal(false);
        } else if (jobData.status === 'failed' && jobData.error) {
          setError(jobData.error);
          setShowErrorModal(true);
        }
      }
    }, (error) => {
      console.error('Firebase listener error:', error);
      if (!isSubscribed) return;  // Don't update state if unmounted
      
      let errorMessage = 'Error listening to analysis updates';
      
      if (error.message.includes('requires an index')) {
        const indexUrl = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/)?.[0];
        errorMessage = `Database index required. Please create the index by visiting: ${indexUrl}`;
      }
      
      setError(errorMessage);
      setShowErrorModal(true);
    });

    // Cleanup function
    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, [user?.email, db]);

  const MODEL_OPTIONS = [
    { 
      value: 'openai', 
      label: 'OpenAI GPT-3.5',
      logo: '/openai.svg',
      description: 'Faster, more reliable responses',
      speed: 'Fast',
      reliability: 'High'
    },
    { 
      value: 'llama', 
      label: 'Meta Llama 3 (Coming Soon)',
      logo: '/metalogo.png',
      description: 'Next generation open source model',
      speed: 'Medium',
      reliability: 'Good',
      disabled: true
    }
  ];

  const EMAIL_COUNT_OPTIONS = [
    { value: 5, label: '5 emails', icon: '📧', description: 'Quick test run' },
    { value: 20, label: '20 emails', icon: '📨', description: 'Recommended for most cases' },
    { value: 50, label: '50 emails', icon: '📬', description: 'Deep analysis' },
    { value: 100, label: '100 emails', icon: '📮', description: 'Comprehensive analysis' },
    { value: 300, label: '300 emails', icon: '📪', description: 'Full inbox analysis' }
  ];

  const MAX_INPUT_TOKENS = 4096;

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const retryOperation = async <T,>(
    operation: () => Promise<T>,
    retries = 3,
    delay = 1000,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<T> => {
    let lastError: Error;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (onRetry) onRetry(attempt, lastError);
        if (attempt === retries) throw lastError;
        await wait(delay * attempt);
      }
    }
    throw lastError!;
  };

  const processEmails = async () => {
    setLoading(true);
    setError(null);
    setAnalysisStartTime(Date.now());
    setEstimatedTimeRemaining((emailCountToAnalyze * 2)); // Initial rough estimate of 2 seconds per email
    setProcessingStatus(prev => ({
      ...prev,
      stage: 'fetching_emails',
      progress: 0,
      currentEmail: 0,
      totalEmails: 0
    }));
    
    const BATCH_SIZE = 20;
    let processedEmails = 0;
    let allResults: any[] = [];
    let failedBatches: { batchIndex: number; error: string }[] = [];
    
    try {
      // Get total count with retry
      const { totalEmails } = await retryOperation(
        async () => {
          const response = await fetch('/api/gmail/count-emails', {
            method: 'GET',
            headers: {
              'Authorization': user?.accessToken ? `Bearer ${user.accessToken}` : '',
            }
          });
          
          if (!response.ok) {
            throw new Error('Failed to get email count');
          }
          
          return response.json();
        },
        3,
        1000,
        (attempt, error) => {
          console.log(`Retry ${attempt} getting email count:`, error);
          toast.error(`Retrying to get email count (attempt ${attempt}/3)`);
        }
      );

      const batchCount = Math.ceil(emailCountToAnalyze / BATCH_SIZE);
      
      // Process emails in batches with retry logic
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const batchStart = batchIndex * BATCH_SIZE;
        const batchSize = Math.min(BATCH_SIZE, emailCountToAnalyze - batchStart);
        
        try {
          // Update status for current batch
          setProcessingStatus(prev => ({
            ...prev,
            stage: 'fetching_emails',
            progress: Math.round((batchIndex / batchCount) * 100),
            currentEmail: processedEmails,
            totalEmails: emailCountToAnalyze,
            originalCount: totalEmails
          }));

          // Fetch batch with retry
          const { threads } = await retryOperation(
            async () => {
              const response = await fetch('/api/gmail/fetch-emails', {
                method: 'POST',
                headers: {
                  'Authorization': user?.accessToken ? `Bearer ${user.accessToken}` : '',
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  count: batchSize,
                  skip: batchStart
                })
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to fetch emails');
              }

              return response.json();
            },
            3,
            2000,
            (attempt, error) => {
              console.log(`Retry ${attempt} fetching batch ${batchIndex}:`, error);
              toast.error(`Retrying to fetch emails (attempt ${attempt}/3)`);
            }
          );

          if (!threads || !Array.isArray(threads)) {
            throw new Error('Invalid response format from email fetch');
          }

          // Check for user replies in each thread before analysis
          const threadsWithReplyInfo = threads.map(thread => {
            const userEmail = user?.email?.toLowerCase();
            const hasUserReply = thread.messages?.some((message: EmailMessage) => {
              if (!userEmail) return false;
              
              // Check if message is from the user
              const isFromUser = message.from?.toLowerCase().includes(userEmail);
              
              // Check if message contains a quoted reply from the user
              const hasUserQuote = message.body?.toLowerCase().includes(`wrote:`) && 
                message.body?.toLowerCase().includes(userEmail);
              
              // Check if message references a reply from the user
              const isReplyToUser = message.body?.toLowerCase().includes(`on`) && 
                message.body?.toLowerCase().includes(userEmail);
              
              return isFromUser || hasUserQuote || isReplyToUser;
            });

            return {
              ...thread,
              hasUserReply: Boolean(hasUserReply)
            };
          });

          // Update progress for analysis phase
          setProcessingStatus(prev => ({
            ...prev,
            stage: 'analyzing',
            currentEmail: processedEmails + 1,
            totalEmails: emailCountToAnalyze,
            progress: Math.round(((batchIndex * BATCH_SIZE + 1) / emailCountToAnalyze) * 100)
          }));

          // Analyze batch with retry
          const analysisData = await retryOperation(
            async () => {
              const analysisResponse = await fetch(
                selectedModel === 'openai' 
                  ? '/api/openai/analyze-email'
                  : '/api/replicate/analyze-email', 
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ 
                    threads: threadsWithReplyInfo,  // Use threads with reply info
                    model: selectedModel,
                    batchIndex,
                    totalBatches: batchCount
                  })
                }
              );

              if (!analysisResponse.ok) {
                throw new Error('Failed to analyze emails');
              }

              const data = await analysisResponse.json();
              if (!data || !data.results) {
                throw new Error('Invalid analysis response format');
              }

              // Ensure hasUserReply is preserved in results
              const resultsWithReplyInfo = data.results.map((result: any, index: number) => ({
                ...result,
                hasUserReply: threadsWithReplyInfo[index]?.hasUserReply || false
              }));

              return {
                ...data,
                results: resultsWithReplyInfo
              };
            },
            3,
            3000,
            (attempt, error) => {
              console.log(`Retry ${attempt} analyzing batch ${batchIndex}:`, error);
              toast.error(`Retrying to analyze emails (attempt ${attempt}/3)`);
            }
          );

          // Accumulate results
          allResults = [...allResults, ...analysisData.results];
          processedEmails += threads.length;

          // Update progress
          setProcessingStatus(prev => ({
            ...prev,
            currentEmail: processedEmails,
            progress: Math.round((processedEmails / emailCountToAnalyze) * 100)
          }));

          // Add delay between batches
          await wait(1000);

          // Update time estimation
          if (processedEmails > 0) {
            const timeElapsed = (Date.now() - analysisStartTime) / 1000; // in seconds
            const emailsRemaining = emailCountToAnalyze - processedEmails;
            const timePerEmail = timeElapsed / processedEmails;
            const estimatedTimeLeft = timePerEmail * emailsRemaining;
            setEstimatedTimeRemaining(estimatedTimeLeft);
          }

        } catch (error) {
          console.error(`Error processing batch ${batchIndex}:`, error);
          failedBatches.push({
            batchIndex,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          // Show toast for failed batch
          toast.error(`Failed to process batch ${batchIndex + 1}/${batchCount}`);
          
          // Continue with next batch instead of stopping completely
          continue;
        }
      }

      // If we have any results, proceed with processing them
      if (allResults.length > 0) {
        const supportThreads = allResults.filter((r: any) => r.isCustomer && r.confidence >= 0.50);
        
        const analyzedEmailData = allResults.flatMap((thread: any, index: number) => {
          // Ensure thread has messages array
          const messages = Array.isArray(thread.messages) ? thread.messages : [];
          
          // If no messages, create a single message from thread data
          if (messages.length === 0) {
            const uniqueId = `thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${index}`;
            return [{
              subject: thread.subject || 'No Subject',
              from: thread.from || 'Unknown Sender',
              body: thread.body || '',
              date: thread.date || new Date().toISOString(),
              threadId: thread.threadId || uniqueId,
              messages: [{
                subject: thread.subject || 'No Subject',
                from: thread.from || 'Unknown Sender',
                body: thread.body || '',
                date: thread.date || new Date().toISOString()
              }],
              isCustomer: thread.isCustomer || false,
              confidence: thread.confidence || 0,
              reason: thread.reason || '',
              category: thread.category || '',
              priority: thread.priority || 2,
              hasUserReply: thread.hasUserReply || false
            }];
          }
          
          // Map each message in the thread
          return [{
            subject: thread.subject || messages[0].subject || 'No Subject',
            from: thread.from || messages[0].from || 'Unknown Sender',
            body: messages[0].body || '',
            date: messages[0].date || thread.date || new Date().toISOString(),
            threadId: thread.threadId || `thread-${Date.now()}-${Math.random()}`,
            messages: messages.map((message: EmailMessage) => ({
              subject: message.subject || thread.subject || 'No Subject',
              from: message.from || 'Unknown Sender',
              body: message.body || '',
              date: message.date || new Date().toISOString()
            })),
            isCustomer: thread.isCustomer || false,
            confidence: thread.confidence || 0,
            reason: thread.reason || '',
            category: thread.category || '',
            priority: thread.priority || 2,
            hasUserReply: thread.hasUserReply || false
          }];
        });

        setAnalyzedThreads(analyzedEmailData);
        setSupportEmailCount(supportThreads.length);

        // Generate insights with retry
        try {
          const aiInsights = await retryOperation(
            async () => {
              const response = await fetch('/api/knowledge/generate-insights', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': user?.accessToken ? `Bearer ${user.accessToken}` : '',
                },
                body: JSON.stringify({ 
                  supportEmails: supportThreads,
                  totalEmailsAnalyzed: emailCountToAnalyze
                }),
              });

              if (!response.ok) {
                throw new Error('Failed to generate insights');
              }

              return response.json();
            },
            3,
            2000,
            (attempt, error) => {
              console.log(`Retry ${attempt} generating insights:`, error);
              toast.error(`Retrying to generate insights (attempt ${attempt}/3)`);
            }
          );

          // Create the final analysis result
          const newAnalysis: AnalysisResult = {
            id: `analysis-${Date.now()}`,
            timestamp: Date.now(),
            totalEmails: emailCountToAnalyze,
            totalEmailsAnalyzed: processedEmails,
            emails: allResults,
            supportEmails: supportThreads,
            tokenUsage: {
              totalTokens: 0,
              promptTokens: 0,
              completionTokens: 0
            },
            aiInsights: {
              keyPoints: aiInsights.keyPoints || [],
              keyCustomerPoints: aiInsights.keyCustomerPoints || [],
              commonQuestions: aiInsights.commonQuestions || [],
              customerSentiment: aiInsights.customerSentiment || {
                overall: 'Analysis complete',
                details: ''
              },
              recommendedActions: aiInsights.recommendedActions || []
            }
          };

          // Save to Firebase
          if (db && user?.email) {
            try {
              const analysesRef = collection(db, 'emailAnalyses');
              const metadata = {
                threadsAnalyzed: processedEmails,
                requestedThreads: emailCountToAnalyze,
                model: selectedModel,
                // Only include failedBatches if there are any
                ...(failedBatches.length > 0 && {
                  failedBatches: failedBatches.map(batch => ({
                    batchIndex: batch.batchIndex,
                    error: batch.error || 'Unknown error'
                  }))
                })
              };

              await addDoc(analysesRef, {
                ...prepareAnalysisForFirebase(newAnalysis),
                userId: user.email,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                metadata
              });
            } catch (error) {
              console.error('Error saving to Firebase:', error);
              toast.error('Failed to save analysis results');
            }
          }

          setResult(newAnalysis);
          
          // If we had some failed batches but overall analysis succeeded
          if (failedBatches.length > 0) {
            setError(`Analysis completed with ${failedBatches.length} failed batch(es). Some emails may be missing.`);
            setShowErrorModal(true);
          } else {
            setCurrentView('analysis');
          }
        } catch (error) {
          console.error('Error generating insights:', error);
          throw new Error('Failed to generate insights from analyzed emails');
        }
      } else {
        throw new Error('No emails were successfully processed');
      }

    } catch (error) {
      console.error('Error in email analysis:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred');
      setShowErrorModal(true);
    } finally {
      setLoading(false);
    }
  };

  // Add an effect to monitor state changes
  useEffect(() => {
    console.log('State changed:', {
      currentView,
      hasResult: !!result,
      loading,
      analyzedThreadsCount: analyzedThreads.length
    });
  }, [currentView, result, loading, analyzedThreads]);

  useEffect(() => {
    // Since /knowledge is a public path, we don't need to check auth
    // Just set isCheckingAuth to false immediately
    setIsCheckingAuth(false);
    
    // Only show login splash if user tries to perform an action that requires auth
    setShowLoginSplash(false);
  }, [user]);

  // Memoize checkForActiveJob
  const checkForActiveJob = useCallback(async () => {
    try {
      const response = await fetch('/api/knowledge/job-status', {
        headers: {
          'Authorization': `Bearer ${user?.accessToken}`,
        },
      });
      
      if (response.ok) {
        const job = await response.json();
        if (job) {
          setActiveJob(job);
          if (job.status === 'completed' && job.results) {
            setResult(job.results);
          }
        }
      } else {
        const errorData = await response.json();
        if (errorData.error?.includes('Firebase Admin SDK not initialized')) {
          toast.error('Firebase connection issue. Please try again in a few minutes.');
          console.error('Firebase initialization error:', errorData.error);
        }
      }
    } catch (error) {
      console.error('Error checking job status:', error);
      toast.error('Unable to check analysis status. Please refresh the page.');
    }
  }, [user?.accessToken]);

  useEffect(() => {
    if (user?.email) {
      checkForActiveJob();
    }
  }, [user?.email, checkForActiveJob]);

  const handleStartAnalysis = (model?: string, count?: number) => {
    if (!user) {
      setShowLoginSplash(true);
      return;
    }
    if (model) setSelectedModel(model);
    if (count) setEmailCountToAnalyze(count);
    processEmails();
  };

  const handleCloseLogin = () => {
    setShowLoginSplash(false);
  };

  const downloadDebugLogs = () => {
    const debugData = JSON.stringify(DEBUG_LOG, null, 2);
    const blob = new Blob([debugData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-analysis-debug-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleViewDetails = (analysis: SavedEmailAnalysis) => {
    if (!analysis) return;
    
    // Set the result first
    setResult(analysis);
    // Then change the view
    setCurrentView('analysis');
  };

  const renderLastAnalysis = () => {
    if (!latestSavedAnalysis) return null;

    return (
      <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl border border-blue-100/50 p-6 mb-8 hover:shadow-lg transition-all duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-white/80 backdrop-blur-sm rounded-lg p-3 shadow-sm">
              <BookOpen className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Last Analysis</h2>
                <span className="text-sm text-blue-600">
                  {latestSavedAnalysis.totalEmailsAnalyzed || latestSavedAnalysis.totalEmails} emails analyzed
                </span>
              </div>
              <p className="text-sm text-gray-600">
                {new Date(latestSavedAnalysis.timestamp).toLocaleDateString()} at {new Date(latestSavedAnalysis.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <button
            onClick={() => handleViewDetails(latestSavedAnalysis)}
            className="group px-4 py-2 bg-white/80 backdrop-blur-sm text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all duration-300 flex items-center gap-2 shadow-sm hover:shadow"
          >
            View Details
            <svg 
              className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const loadSavedAnalyses = async () => {
      try {
        if (!db || !user?.email) {
          console.log('Debug: Missing db or user email', { db: !!db, userEmail: user?.email });
          if (!db) {
            toast.error('Unable to connect to database. Please refresh the page.');
          }
          return;
        }

        console.log('Debug: Loading analyses for user:', user.email);
        
        const analysesRef = collection(db, 'emailAnalyses');
        const q = query(
          analysesRef,
          where('userId', '==', user.email)
        );

        console.log('Debug: Executing query');
        const querySnapshot = await getDocs(q);
        console.log('Debug: Got query snapshot, size:', querySnapshot.size);

        const analyses: SavedEmailAnalysis[] = [];
        
        querySnapshot.forEach((doc) => {
          console.log('Debug: Processing doc:', doc.id);
          const data = doc.data();
          
          // Log the raw data from Firebase
          logResponseRateCalculation('firebase_load', {
            docId: doc.id,
            responseRate: data.responseRate,
            replyMetrics: data.replyMetrics,
            rawData: data
          });

          const analysis: SavedEmailAnalysis = {
            id: doc.id,
            timestamp: data.timestamp || Date.parse(data.createdAt) || Date.now(),
            totalEmails: data.totalEmails || 0,
            totalEmailsAnalyzed: data.totalEmailsAnalyzed || data.totalEmails || 0,
            supportEmails: data.supportEmails || [],
            responseRate: data.responseRate || data.replyMetrics?.responseRate || 0,
            replyMetrics: data.replyMetrics || {
              totalCustomerThreads: data.emailMetrics?.customerThreads || 0,
              threadsWithReplies: 0,
              responseRate: data.responseRate || 0
            },
            emails: (data.emails || []).map((email: any) => ({
              threadId: email.threadId,
              subject: email.subject || '',
              from: email.from || '',
              body: email.body || '',
              date: email.date || '',
              isSupport: email.isSupport || false,
              confidence: email.confidence || 0,
              reason: email.reason || '',
              category: email.category || 'uncategorized',
              priority: email.priority || 2,
              hasUserReply: email.hasUserReply || false,
              summary: email.summary || {
                subject: email.subject || '',
                content: email.body?.slice(0, 200) || '',
                sentiment: 'neutral',
                key_points: [email.reason || '']
              }
            })),
            tokenUsage: {
              promptTokens: data.tokenUsage?.promptTokens || 0,
              completionTokens: data.tokenUsage?.completionTokens || 0,
              totalTokens: data.tokenUsage?.totalTokens || 0
            },
            aiInsights: {
              keyPoints: data.aiInsights?.keyCustomerPoints || [],
              keyCustomerPoints: data.aiInsights?.keyCustomerPoints || [],
              commonQuestions: (data.aiInsights?.commonQuestions || []).map((q: any) => ({
                question: q.question || '',
                typicalAnswer: q.typicalAnswer || '',
                frequency: q.frequency || 1
              })),
              customerSentiment: {
                overall: data.aiInsights?.customerSentiment?.overall || 'Analysis complete',
                details: data.aiInsights?.customerSentiment?.details || ''
              },
              recommendedActions: data.aiInsights?.recommendedActions || []
            }
          };
          
          logResponseRateCalculation('analysis_conversion', {
            docId: doc.id,
            responseRate: analysis.responseRate,
            replyMetrics: analysis.replyMetrics
          });
          
          analyses.push(analysis);
        });
        
        const sortedAnalyses = analyses.sort((a, b) => b.timestamp - a.timestamp);
        
        console.log('Debug: Processed analyses:', sortedAnalyses.length);
        
        setSavedAnalyses(sortedAnalyses);
        if (sortedAnalyses.length > 0) {
          console.log('Debug: Setting latest analysis:', sortedAnalyses[0]);
          setLatestSavedAnalysis(sortedAnalyses[0]);
        }
      } catch (error) {
        console.error('Debug: Error in loadSavedAnalyses:', {
          error,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        toast.error('Failed to load previous analyses. Please refresh the page.');
        setError('Failed to load saved analyses. Please check console for details.');
      }
    };

    if (user?.email) {
      loadSavedAnalyses();
    }
  }, [user, db]);

  useEffect(() => {
    if (result) {
      // Ensure we have all required properties before transitioning
      if (
        result.aiInsights &&
        result.aiInsights.commonQuestions &&
        result.aiInsights.recommendedActions
      ) {
        setCurrentView('analysis');
      }
    }
  }, [result]);

  const handleSaveAnalysis = async () => {
    if (!result || !db || !user) return;

    const analysisToSave: SavedEmailAnalysis = {
      id: result.id,
      timestamp: result.timestamp,
      totalEmails: result.totalEmails,
      totalEmailsAnalyzed: result.totalEmailsAnalyzed,
      supportEmails: result.supportEmails,
      emails: result.emails,
      tokenUsage: result.tokenUsage,
      responseRate: result.replyMetrics?.responseRate || 0,
      replyMetrics: result.replyMetrics || {
        totalCustomerThreads: 0,
        threadsWithReplies: 0,
        responseRate: 0
      },
      aiInsights: {
        keyPoints: result.aiInsights.keyPoints,
        keyCustomerPoints: result.aiInsights.keyCustomerPoints,
        commonQuestions: result.aiInsights.commonQuestions,
        customerSentiment: result.aiInsights.customerSentiment,
        recommendedActions: result.aiInsights.recommendedActions || []
      }
    };

    try {
      const analysisRef = collection(db, 'analyses');
      const userEmail = user.email;
      if (!userEmail) throw new Error('User email not found');

      await addDoc(analysisRef, {
        ...prepareAnalysisForFirebase(analysisToSave),
        userId: userEmail,
        createdAt: new Date()
      });

      setLatestSavedAnalysis(analysisToSave);
      saveAnalysis(analysisToSave);
      toast.success('Analysis saved successfully!');
    } catch (error) {
      console.error('Error saving analysis:', error);
      toast.error('Failed to save analysis');
    }
  };

  const testFirebaseSave = async () => {
    if (!user || !db) {
      console.error('No user or db not initialized');
      return;
    }

    try {
      const analysisJob = {
        id: 'test-job-' + Date.now(),
        userId: user.email,
        status: 'completed' as const,
        progress: 100,
        totalEmails: 1,
        analyzedEmails: 1,
        supportEmailsFound: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const jobsRef = collection(db, 'analysisJobs');
      await addDoc(jobsRef, analysisJob);

      const analysisResult = {
        id: 'test-analysis-' + Date.now(),
        timestamp: Date.now(),
        userId: user.email,
        totalEmails: 1,
        totalEmailsAnalyzed: 1,
        supportEmails: [{
          subject: 'Test Email',
          from: 'test@example.com',
          body: 'Test body',
          date: new Date().toISOString(),
          isSupport: true,
          confidence: 0.9,
          reason: 'Test reason'
        }],
        emails: [{
          subject: 'Test Email',
          from: 'test@example.com',
          body: 'Test body',
          date: new Date().toISOString(),
          isSupport: true,
          confidence: 0.9,
          reason: 'Test reason'
        }],
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 100,
          totalTokens: 200
        },
        aiInsights: {
          keyPoints: ['Test point'],
          keyCustomerPoints: ['Test point'],
          commonQuestions: [{
            question: 'Test question?',
            typicalAnswer: 'Test answer',
            frequency: 1
          }],
          customerSentiment: {
            overall: 'Test sentiment',
            details: 'Test details'
          },
          recommendedActions: ['Test action']
        }
      };

      const analysesRef = collection(db, 'emailAnalyses');
      const analysisDocRef = await addDoc(analysesRef, analysisResult);
      
      console.log('Successfully saved test documents:', {
        jobId: analysisJob.id,
        analysisId: analysisDocRef.id
      });
      alert('Test save successful! Analysis ID: ' + analysisDocRef.id);
    } catch (error) {
      console.error('Error in test save:', error);
      alert('Test save failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDebugGmail = async () => {
    if (!user) {
      setShowLoginSplash(true);
      return;
    }
    if (!user?.accessToken) {
      toast.error('Please sign in first');
      return;
    }

    try {
      const response = await fetch('/api/gmail/debug', {
        headers: {
          'Authorization': `Bearer ${user.accessToken}`
        }
      });

      const data = await response.json();
      console.log('Gmail Debug Results:', data);

      if (data.status === 'success') {
        toast.success(`Gmail API connected successfully! Found ${data.debug.apiTest.messagesTotal} messages for ${data.debug.apiTest.emailAddress}`);
      } else {
        toast.error('Gmail API connection failed. Check console for details.');
      }
    } catch (error) {
      console.error('Gmail debug error:', error);
      toast.error('Failed to test Gmail API connection');
    }
  };

  const renderConfigurationView = () => {
    return (
      <div className="space-y-8">
        {latestSavedAnalysis && (
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl border border-blue-100/50 p-6 hover:shadow-lg transition-all duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-white/80 backdrop-blur-sm rounded-lg p-3 shadow-sm">
                  <BookOpen className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-gray-900">Last Analysis</h2>
                    <span className="text-sm text-blue-600">
                      {latestSavedAnalysis.totalEmailsAnalyzed || latestSavedAnalysis.totalEmails} emails analyzed
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {new Date(latestSavedAnalysis.timestamp).toLocaleDateString()} at {new Date(latestSavedAnalysis.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleViewDetails(latestSavedAnalysis)}
                className="group px-4 py-2 bg-white/80 backdrop-blur-sm text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all duration-300 flex items-center gap-2 shadow-sm hover:shadow"
              >
                View Details
                <svg 
                  className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-8">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <BookOpen className="w-8 h-8 text-orange-600" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                Generate Knowledge Base
              </h2>
              <p className="text-gray-600">
                Analyze your emails to generate insights about customer support patterns.
              </p>
            </div>
            
            <div className="mb-12">
              <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
                Select AI Model
              </label>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 max-w-4xl mx-auto">
                {MODEL_OPTIONS.map(model => (
                  <div
                    key={model.value}
                    onClick={() => !model.disabled && setSelectedModel(model.value)}
                    className={`relative p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                      model.disabled 
                        ? 'border-gray-200 opacity-80 cursor-not-allowed'
                        : selectedModel === model.value
                        ? 'border-orange-500 bg-orange-50 shadow-lg hover:scale-[1.02]'
                        : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/50 hover:scale-[1.02]'
                    }`}
                  >
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-12 h-12 relative bg-white rounded-lg p-2 shadow-sm flex items-center justify-center">
                        <Image
                          src={model.logo}
                          alt={model.label}
                          width={32}
                          height={32}
                          className={`object-contain ${model.value === 'openai' ? 'dark' : ''}`}
                          style={{ filter: model.value === 'openai' ? 'brightness(0.2)' : 'none' }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 mb-1">{model.label}</h3>
                        <p className="text-sm text-gray-500 line-clamp-2">{model.description}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                        Speed: {model.speed}
                      </span>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Reliability: {model.reliability}
                      </span>
                    </div>
                    {model.disabled && (
                      <div className="absolute -top-3 right-3 z-10">
                        <span className="px-3 py-1.5 bg-purple-100 text-purple-800 text-sm font-medium rounded-full shadow-sm">
                          Coming Soon
                        </span>
                      </div>
                    )}
                    {selectedModel === model.value && (
                      <div className="absolute top-3 right-3">
                        <div className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center shadow-sm">
                          <CheckCircle2 className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-12">
              <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
                Number of emails to analyze
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
                {EMAIL_COUNT_OPTIONS.map(option => (
                  <div
                    key={option.value}
                    onClick={() => setEmailCountToAnalyze(option.value)}
                    className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
                      emailCountToAnalyze === option.value
                        ? 'border-orange-500 bg-orange-50 shadow-lg'
                        : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/50'
                    }`}
                  >
                    <div className="text-center">
                      <span className="text-3xl mb-3 block">{option.icon}</span>
                      <h3 className="font-medium text-gray-900 mb-1">{option.label}</h3>
                      <p className="text-xs text-gray-500">{option.description}</p>
                    </div>
                    {emailCountToAnalyze === option.value && (
                      <div className="absolute top-2 right-2">
                        <div className="w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center shadow-sm">
                          <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="text-center">
              <button
                onClick={() => handleStartAnalysis(selectedModel, emailCountToAnalyze)}
                disabled={loading || !user}
                className={`px-8 py-4 rounded-xl font-medium text-white text-lg transition-all duration-200 ${
                  loading || !user 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-orange-500 hover:bg-orange-600 shadow-lg hover:shadow-xl hover:-translate-y-0.5'
                }`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Starting Analysis...
                  </span>
                ) : (
                  'Start New Analysis'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleEmailOverride = (emailId: string, isCustomer: boolean) => {
    setEmailOverrides(prev => ({
      ...prev,
      [emailId]: isCustomer
    }));
    setHasOverrides(true);
  };

  const reanalyzeWithOverrides = async () => {
    if (!result || hasReanalyzed) return;
    
    setLoading(true);
    if (!result) return;

    // Update the analyzed threads with overrides
    const updatedThreads = analyzedThreads.map(thread => {
      const emailId = thread.threadId;
      if (emailId && emailId in emailOverrides) {
    return {
          ...thread,
          isCustomer: emailOverrides[emailId],
          confidence: emailOverrides[emailId] ? 0.95 : 0.05,
          reason: emailOverrides[emailId] 
            ? "Manually marked as customer thread" 
            : "Manually marked as non-customer thread"
        };
      }
      return thread;
    });

    // Recalculate support threads
    const updatedSupportThreads = updatedThreads.filter(thread => thread.isCustomer);

    // Create updated analysis result
    const updatedAnalysis: AnalysisResult = {
      ...result,
      emails: updatedThreads,
      supportEmails: updatedSupportThreads,
      timestamp: Date.now(),
    };

    // If we have support threads, generate new insights
    if (updatedSupportThreads.length > 0) {
      try {
        const aiInsightsResponse = await fetch('/api/knowledge/generate-insights', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': user?.accessToken ? `Bearer ${user.accessToken}` : '',
          },
          body: JSON.stringify({ 
            supportEmails: updatedSupportThreads,
            totalEmailsAnalyzed: updatedThreads.length
          }),
        });

        if (aiInsightsResponse.ok) {
          const aiInsights = await aiInsightsResponse.json();
          updatedAnalysis.aiInsights = {
            keyPoints: aiInsights.keyPoints || [],
            keyCustomerPoints: aiInsights.keyCustomerPoints || [],
            commonQuestions: aiInsights.commonQuestions || [],
            customerSentiment: aiInsights.customerSentiment || {
              overall: 'Analysis complete',
              details: ''
            },
            recommendedActions: aiInsights.recommendedActions || []
          };
        }
      } catch (error) {
        console.error('Error generating new insights:', error);
      }
    }

    // Save to Firebase if available
    try {
      if (db) {
        const analysesRef = collection(db, 'emailAnalyses');
        await addDoc(analysesRef, {
          ...prepareAnalysisForFirebase(updatedAnalysis),
          userId: user?.email,
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error saving updated analysis:', error);
    }

    // Update state
    setResult(updatedAnalysis);
    setAnalyzedThreads(updatedThreads);
    setSupportEmailCount(updatedSupportThreads.length);
    setHasReanalyzed(true);
    setLoading(false);
    toast.success('Analysis updated with your changes');
  };

  const renderEmailSection = () => {
    if (!analyzedThreads.length) return null;

    return (
      <div className="bg-white rounded-2xl p-8 shadow-sm">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <span className="text-4xl mb-4 block">📨</span>
            <h2 className="text-2xl font-semibold mb-4">Email Threads</h2>
            <p className="text-gray-600">Analysis of each conversation thread</p>
          </div>
          
          <div className="space-y-4">
            {analyzedThreads.map((thread) => {
              const emailId = thread.threadId;
              const messages = thread.messages;
              
              if (!emailId || !messages || messages.length === 0) return null;
              
              const isCustomerOverride = emailId in emailOverrides;
              const isCustomer = isCustomerOverride ? emailOverrides[emailId] : thread.isCustomer;
              const firstMessage = messages[0];
              const lastMessage = messages[messages.length - 1];
              
              if (!firstMessage || !lastMessage) return null;
              
              return (
                <div 
                  key={emailId}
                  className="bg-white border border-gray-100 rounded-xl p-6 hover:shadow-md transition-all duration-300"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center gap-2">
                      <button
                        onClick={() => handleEmailOverride(emailId, true)}
                        className={`w-16 h-16 rounded-xl flex flex-col items-center justify-center transition-colors p-2 ${
                          isCustomer
                            ? 'bg-green-100 text-green-600 ring-2 ring-green-500 ring-offset-2'
                            : 'bg-gray-100 text-gray-400 hover:bg-green-50 hover:text-green-500'
                        }`}
                        title={isCustomer ? "Currently marked as customer thread" : "Mark as customer thread"}
                      >
                        <CheckCircle2 className="w-6 h-6 mb-1.5" />
                        <span className="text-[11px] leading-none">Customer</span>
                      </button>
                      <button
                        onClick={() => handleEmailOverride(emailId, false)}
                        className={`w-16 h-16 rounded-xl flex flex-col items-center justify-center transition-colors p-2 ${
                          !isCustomer
                            ? 'bg-gray-200 text-gray-700 ring-2 ring-gray-400 ring-offset-2'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-700'
                        }`}
                        title={!isCustomer ? "Currently marked as non-customer thread" : "Mark as non-customer thread"}
                      >
                        <XCircle className="w-6 h-6 mb-1.5" />
                        <span className="text-[11px] leading-none">Other</span>
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <h3 className="text-lg font-medium text-gray-900">
                          {firstMessage.subject || 'No Subject'}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          isCustomer ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {isCustomer ? 'Customer Thread' : 'Non-Customer Thread'}
                        </span>
                        {thread.category && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {thread.category}
                          </span>
                        )}
                        {!isCustomerOverride && thread.confidence && (
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                            thread.confidence >= 0.8 ? 'bg-green-100 text-green-800' :
                            thread.confidence >= 0.5 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {Math.round(thread.confidence * 100)}% Confidence
                          </span>
                        )}
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          {messages.length} message{messages.length !== 1 ? 's' : ''}
                        </span>
                        {thread.hasUserReply && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Replied
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-3">
                        {isCustomerOverride 
                          ? (isCustomer ? 'Manually marked as customer thread' : 'Manually marked as non-customer thread')
                          : (thread.reason || 'No reason provided')}
                      </p>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => handleViewThread(thread)}
                          className="text-sm text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1"
                        >
                          <Mail className="w-4 h-4" />
                          View Thread ({messages.length} messages)
                        </button>
                        <span className="text-sm text-gray-500">
                          Latest: {new Date(lastMessage.date).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderAnalysisView = () => {
    if (!result) return null;

    // Calculate response rate from the stored metrics if available
    const responseRate = result.replyMetrics?.responseRate ?? (() => {
      const customerThreads = analyzedThreads.filter(thread => thread.isCustomer);
      const threadsWithReplies = customerThreads.filter(thread => thread.hasUserReply).length;
      return customerThreads.length > 0 
        ? Math.round((threadsWithReplies / customerThreads.length) * 100) 
        : 0;
    })();

    logResponseRateCalculation('render_view', {
      storedResponseRate: result.responseRate,
      calculatedResponseRate: responseRate,
      replyMetrics: result.replyMetrics,
      threadCount: analyzedThreads.length
    });

    // Parse sentiment data
    const parseSentiment = (sentiment: any) => {
      if (typeof sentiment === 'string') return sentiment;
      try {
        if (typeof sentiment === 'object') {
          if (sentiment.positive || sentiment.negative) {
            return {
              positive: sentiment.positive,
              negative: sentiment.negative
            };
          }
          return JSON.stringify(sentiment);
        }
        const parsed = JSON.parse(sentiment);
        return parsed;
      } catch (e) {
        return sentiment;
      }
    };

    const sentimentData = parseSentiment(result.aiInsights.customerSentiment.details);
    const overallSentiment = parseSentiment(result.aiInsights.customerSentiment.overall);

    return (
      <div className="space-y-8 relative">
        {/* Back Button */}
        <div className="mb-4">
          <button
            onClick={() => setCurrentView('config')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Configuration
          </button>
        </div>

        {hasOverrides && changedEmailsCount > 0 && !hasReanalyzed && (
          <ReanalysisActionGroup 
            onReanalyze={reanalyzeWithOverrides}
            changedEmailsCount={changedEmailsCount}
          />
        )}
        {/* Overview Section with Pie Chart */}
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl p-8 shadow-sm">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-semibold text-gray-900 text-center mb-6">Email Analysis Overview 📊</h2>
            <FAQPieChart
              faqs={result.aiInsights.commonQuestions.map(q => ({
                question: q.question,
                frequency: q.frequency || 1,
                category: 'Support'
              }))}
              totalEmails={result.totalEmails || 0}
              supportEmails={result.supportEmails?.length || 0}
            />
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📧</span>
              <h3 className="text-lg font-medium text-gray-900">Total Emails</h3>
            </div>
            <p className="text-3xl font-semibold text-blue-600">{result.totalEmails || 0}</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🎯</span>
              <h3 className="text-lg font-medium text-gray-900">Support Emails</h3>
            </div>
            <p className="text-3xl font-semibold text-blue-600">{result.supportEmails?.length || 0}</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">⚡️</span>
              <h3 className="text-lg font-medium text-gray-900">Response Rate</h3>
            </div>
            <p className="text-3xl font-semibold text-blue-600">{responseRate}%</p>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="bg-white rounded-2xl p-8 shadow-sm">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8">
              <span className="text-4xl mb-4 block">❓</span>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Frequently Asked Questions</h2>
              <p className="text-gray-600">Common questions from your customer support emails</p>
            </div>
            
            <div className="space-y-6">
              {result.aiInsights.commonQuestions.map((faq, index) => (
                <div 
                  key={index}
                  className="border-b border-gray-100 last:border-0 pb-6 last:pb-0"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-sm text-blue-600 font-medium">{index + 1}</span>
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">{faq.question}</h3>
                      <p className="text-gray-600 text-sm mb-2">{faq.typicalAnswer}</p>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Asked {faq.frequency || 1}x
                        </span>
                        <span className="text-xs text-gray-500">
                          {result.totalEmails > 0 
                            ? `${Math.round(((faq.frequency || 1) / result.totalEmails) * 100)}% of emails`
                            : '0% of emails'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Action Items Section */}
        <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-8 shadow-sm">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8">
              <span className="text-4xl mb-4 block">✨</span>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Recommended Actions</h2>
              <p className="text-gray-600">Key improvements to enhance customer support</p>
            </div>
            
            <div className="space-y-4">
              {result.aiInsights.recommendedActions.map((action, index) => (
                <div 
                  key={index}
                  className="bg-white/80 backdrop-blur-sm rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-300"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-sm text-orange-600 font-medium">{index + 1}</span>
                    </div>
                    <div>
                      <p className="text-gray-900">{action}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sentiment Analysis Section */}
        <div className="bg-gradient-to-br from-green-50 to-teal-50 rounded-2xl p-8 shadow-sm">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8">
              <span className="text-4xl mb-4 block">🎭</span>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Customer Sentiment</h2>
              <p className="text-gray-600">Understanding customer emotions and feedback</p>
            </div>
            
            <div className="space-y-6">
              <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 shadow-sm">
                <h3 className="text-lg font-medium text-gray-900 mb-3">Overall Sentiment</h3>
                <p className="text-gray-700">{typeof overallSentiment === 'string' ? overallSentiment : JSON.stringify(overallSentiment)}</p>
              </div>
              
              <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 shadow-sm">
                <h3 className="text-lg font-medium text-gray-900 mb-3">Detailed Analysis</h3>
                {typeof sentimentData === 'object' && sentimentData.positive && sentimentData.negative ? (
                  <div className="space-y-4">
                    <div className="bg-red-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">😕</span>
                        <h4 className="font-medium text-red-900">Areas of Concern</h4>
                      </div>
                      <p className="text-gray-700 text-sm">{sentimentData.negative}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">😊</span>
                        <h4 className="font-medium text-green-900">Positive Aspects</h4>
                      </div>
                      <p className="text-gray-700 text-sm">{sentimentData.positive}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-700">{typeof sentimentData === 'string' ? sentimentData : JSON.stringify(sentimentData)}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Key Customer Points Section */}
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-8 shadow-sm">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8">
              <span className="text-4xl mb-4 block">💡</span>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Key Customer Insights</h2>
              <p className="text-gray-600">Important patterns and observations</p>
            </div>
            
            <div className="space-y-4">
              {result.aiInsights.keyCustomerPoints.map((point, index) => (
                <div 
                  key={index}
                  className="bg-white/80 backdrop-blur-sm rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-300"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-sm text-purple-600 font-medium">{index + 1}</span>
                    </div>
                    <p className="text-gray-900">{point}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Individual Email Analysis Section */}
        {renderEmailSection()}
      </div>
    );
  };

  useEffect(() => {
    if (loading) {
      setIsTransitioning(true);
    } else {
      const timer = setTimeout(() => {
        setIsTransitioning(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  const handleRetryAnalysis = async () => {
    try {
      setShowErrorModal(false);
      setError(null);
      
      // Create new analysis job
      if (!db) {
        throw new Error('Firestore not initialized');
      }
      const jobsRef = collection(db, 'analysisJobs');
      const newJob = await addDoc(jobsRef, {
        userId: user?.email,
        status: 'pending',
        progress: 0,
        model: selectedModel,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Start analysis process
      const response = await fetch('/api/gmail/fetch-emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user?.accessToken}`
        },
        body: JSON.stringify({
          count: emailCountToAnalyze,
          model: selectedModel
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start analysis');
      }

      // Reset UI state
      setProcessingStatus({ stage: 'fetching_emails', progress: 0 });
      setCurrentEmailIndex(0);
      setAnalysisStartTime(Date.now());
      
    } catch (error: any) {
      console.error('Error retrying analysis:', error);
      setError(error.message || 'Failed to retry analysis');
      setShowErrorModal(true);
    }
  };

  const handleViewThread = (thread: EmailData) => {
    console.log('Raw thread data:', thread);
    
    if (!thread.messages || thread.messages.length === 0) {
      // Single message handling
      const singleMessage = {
        subject: thread.subject || 'No Subject',
        from: thread.from || 'Unknown Sender',
        body: thread.body || '',
        date: thread.date || new Date().toISOString(),
        contentType: thread.contentType || (thread.body?.includes('<') ? 'text/html' : 'text/plain'),
        snippet: thread.snippet,
        debug: {
          stage: 'Initial Processing',
          originalSubject: thread.subject,
          originalFrom: thread.from,
          originalDate: thread.date,
          originalContentType: thread.contentType,
          bodyLength: thread.body?.length || 0,
          hadHtmlContent: thread.body?.includes('<'),
          hadPlainText: !thread.body?.includes('<'),
          mimeType: thread.contentType || 'text/plain',
          isFromUser: false,
          hasUserQuote: thread.body?.toLowerCase().includes('wrote:') || false,
          isReplyToUser: thread.body?.toLowerCase().includes('on') || false,
          processing: {
            subjectCleaned: thread.subject?.replace(/^(Re|RE|Fwd|FWD|Fw|FW):\s*/g, '').trim(),
            fromCleaned: thread.from?.trim(),
            dateParsed: new Date(thread.date || Date.now()).toISOString(),
            contentTypeDetected: thread.body?.includes('<') ? 'text/html' : 'text/plain'
          }
        }
      };

      console.log('Processed single message:', singleMessage);
      
      setSelectedEmail({
        ...thread,
        subject: singleMessage.subject,
        from: singleMessage.from,
        messages: [singleMessage]
      });
    } else {
      // Process all messages in the thread
      console.log('Processing thread with multiple messages');
      
      const processedMessages = thread.messages.map((msg, index) => {
        const processedMessage = {
          ...msg,
          subject: msg.subject || thread.subject || 'No Subject',
          from: msg.from || 'Unknown Sender',
          contentType: msg.contentType || (msg.body?.includes('<') ? 'text/html' : 'text/plain'),
          debug: {
            stage: `Message Processing (${index + 1}/${thread.messages?.length})`,
            originalSubject: msg.subject,
            originalFrom: msg.from,
            originalDate: msg.date,
            originalContentType: msg.contentType,
            bodyLength: msg.body?.length || 0,
            hadHtmlContent: msg.body?.includes('<'),
            hadPlainText: !msg.body?.includes('<'),
            mimeType: msg.contentType || 'text/plain',
            isFromUser: false,
            hasUserQuote: msg.body?.toLowerCase().includes('wrote:') || false,
            isReplyToUser: msg.body?.toLowerCase().includes('on') || false,
            processing: {
              subjectCleaned: msg.subject?.replace(/^(Re|RE|Fwd|FWD|Fw|FW):\s*/g, '').trim(),
              fromCleaned: msg.from?.trim(),
              dateParsed: new Date(msg.date || Date.now()).toISOString(),
              contentTypeDetected: msg.body?.includes('<') ? 'text/html' : 'text/plain',
              threadPosition: index + 1,
              isFirstMessage: index === 0,
              isLastMessage: index === (thread.messages?.length || 1) - 1
            }
          }
        };

        console.log(`Processed message ${index + 1}:`, processedMessage);
        return processedMessage;
      });

      const processedThread = {
        ...thread,
        subject: thread.subject || processedMessages[0].subject || 'No Subject',
        from: thread.from || processedMessages[0].from || 'Unknown Sender',
        messages: processedMessages,
        debug: {
          stage: 'Thread Processing',
          messageCount: processedMessages.length,
          originalSubject: thread.subject,
          originalFrom: thread.from,
          processing: {
            firstMessageDate: processedMessages[0]?.date,
            lastMessageDate: processedMessages[processedMessages.length - 1]?.date,
            subjectVariations: [...new Set(processedMessages.map(m => m.subject))],
            fromAddresses: [...new Set(processedMessages.map(m => m.from))]
          }
        }
      };

      console.log('Final processed thread:', processedThread);
      setSelectedEmail(processedThread);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {!user && <LoginSplashScreen onClose={handleCloseLogin} />}
      
      <div className="flex">
        <Sidebar />
        
        <main className="flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            {loading ? (
              <div className="min-h-[60vh] flex flex-col items-center justify-center">
                <AnalysisProgress
                  stage={processingStatus.stage}
                  progress={processingStatus.progress}
                  currentEmail={processingStatus.currentEmail}
                  totalEmails={processingStatus.totalEmails}
                  model={selectedModel === 'openai' ? 'OpenAI GPT-3.5' : 'Meta Llama 3'}
                  estimatedTimeRemaining={estimatedTimeRemaining}
                />
              </div>
            ) : (
              <>
                {currentView === 'config' && renderConfigurationView()}
                {currentView === 'analysis' && (
                  <>
                    {renderAnalysisView()}
                    {renderEmailSection()}
                  </>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {showRunTestModal && (
        <RunTestModal 
          onClose={() => setShowRunTestModal(false)}
          onRunTest={handleStartAnalysis}
        />
      )}

      {showAnalysisModal && selectedAnalysis && (
        <AnalysisModal
          analysis={selectedAnalysis}
          onClose={() => setShowAnalysisModal(false)}
        />
      )}

      {showAnalysisError && (
        <AnalysisErrorModal
          isOpen={showAnalysisError}
          error={analysisError || 'An unknown error occurred'}
          onClose={() => setShowAnalysisError(false)}
          onRetry={handleRetryAnalysis}
        />
      )}

      {showDebugPanel && (
        <DebugPanel
          logs={DEBUG_LOG}
          downloadLogs={downloadDebugLogs}
          closePanel={() => setShowDebugPanel(false)}
        />
      )}

      {changedEmailsCount > 0 && (
        <ReanalysisActionGroup
          onReanalyze={reanalyzeWithOverrides}
          changedEmailsCount={changedEmailsCount}
        />
      )}
    </div>
  );
};

export default KnowledgePage; 