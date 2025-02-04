'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import FAQList from '../components/FAQList';
import { Sidebar } from '../components/Sidebar';
import LoginSplashScreen from '../components/LoginSplashScreen';
import { BookOpen, Mail, CheckCircle2, XCircle } from 'lucide-react';
import EmailThread from '../components/EmailThread';
import SaveAnalysisButton from '../components/SaveAnalysisButton';
import DebugPanel from '../components/DebugPanel';
import RunTestModal from '../components/RunTestModal';
import FAQPieChart from '../components/FAQPieChart';
import { collection, query, orderBy, limit, getDocs, addDoc } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import Image from 'next/image';

interface FAQ {
  question: string;
  answer: string;
  frequency: number;
  category: string;
}

interface ProcessingResult {
  totalEmails: number;
  supportEmails: number;
  faqs: FAQ[];
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
  results?: ProcessingResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Add token tracking interface
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Add these interfaces at the top with the other interfaces
interface SavedEmailAnalysis {
  id: string;
  timestamp: number;
  emails: Array<{
    subject: string;
    from: string;
    body: string;
    date: string;
    summary: ThreadSummary | null;
    isSupport: boolean;
    confidence: number;
    reason: string;
    fullData?: {
      subject: string;
      from: string;
      body: string;
      date: string;
    };
  }>;
  totalEmailsAnalyzed: number;
  tokenUsage: TokenUsage;
  aiInsights: {
    keyCustomerPoints: string[];
    commonQuestions: Array<{
      question: string;
      typicalAnswer: string;
      frequency: number;
    }>;
    customerSentiment: {
      overall: string;
      details: string;
    };
    recommendedActions: string[];
  };
}

// Add this function before the KnowledgePage component
const STORAGE_KEY = 'savedEmailAnalyses';

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

// Add this helper function at the top with other helper functions
function normalizeSubject(subject: string): string {
  // Remove Re:, Fwd:, etc. and trim whitespace
  return subject
    .replace(/^(re|fwd|fw|r|f):\s*/gi, '')
    .trim()
    .toLowerCase();
}

function groupEmailsByThread(emails: any[]): any[] {
  const threadMap = new Map();
  
  // Sort emails by date in descending order (most recent first)
  const sortedEmails = [...emails].sort((a, b) => {
    const dateA = new Date(a.date || 0);
    const dateB = new Date(b.date || 0);
    return dateB.getTime() - dateA.getTime();
  });

  // Group emails by normalized subject
  sortedEmails.forEach(email => {
    const normalizedSubject = normalizeSubject(email.subject || '');
    // Only keep the most recent email from each thread
    if (!threadMap.has(normalizedSubject)) {
      threadMap.set(normalizedSubject, email);
    }
  });

  return Array.from(threadMap.values());
}

// Add debug logging function at the top
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

// Add this helper function at the top level
function formatDuration(startTime: number): string {
  const duration = Math.round((Date.now() - startTime) / 1000); // duration in seconds
  if (duration < 60) {
    return `${duration} seconds`;
  }
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes} minute${minutes !== 1 ? 's' : ''} ${seconds} seconds`;
}

// Add this helper function near the top with other helper functions
function truncateEmailBody(body: string, maxTokens: number = 3500): string {
  // Rough estimation: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4;
  if (body.length <= maxChars) return body;
  
  // Take first portion of the email, leaving room for truncation notice
  const truncatedBody = body.slice(0, maxChars - 100);
  return `${truncatedBody}\n\n[Email truncated due to length...]`;
}

export default function KnowledgePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLoginSplash, setShowLoginSplash] = useState(false);
  const [emailCountToAnalyze, setEmailCountToAnalyze] = useState(20);
  const [processingStatus, setProcessingStatus] = useState<{
    stage: 'idle' | 'fetching_emails' | 'filtering' | 'analyzing' | 'complete';
    progress: number;
    currentEmail?: number;
    totalEmails?: number;
  }>({ stage: 'idle', progress: 0 });
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [analyzedEmails, setAnalyzedEmails] = useState<EmailAnalysis[]>([]);
  const [supportEmailCount, setSupportEmailCount] = useState(0);
  const [activeJob, setActiveJob] = useState<AnalysisJob | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  });
  const [selectedEmail, setSelectedEmail] = useState<{
    subject: string;
    from: string;
    body: string;
    date: string;
  } | null>(null);
  const [latestAnalysis, setLatestAnalysis] = useState<SavedEmailAnalysis | null>(null);
  const [emailData, setEmailData] = useState<Array<{
    subject: string;
    from: string;
    body: string;
    date: string;
  }>>([]);
  const [currentEmailIndex, setCurrentEmailIndex] = useState<number>(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number>(0);
  const [analysisStartTime, setAnalysisStartTime] = useState<number>(0);
  const [showRunTestModal, setShowRunTestModal] = useState(false);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedEmailAnalysis[]>([]);

  // Get Firestore instance
  const db = getFirebaseDB();

  // Update the MODEL_OPTIONS to include logos
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
      value: 'deepseek', 
      label: 'Deepseek 67B',
      logo: '/deepseek-logo-icon.png',
      description: 'Open source model, may be slower',
      speed: 'Medium',
      reliability: 'Medium'
    }
  ];

  // Update the EMAIL_COUNT_OPTIONS to include visual elements
  const EMAIL_COUNT_OPTIONS = [
    { value: 5, label: '5 emails', icon: '📧', description: 'Quick test run' },
    { value: 20, label: '20 emails', icon: '📨', description: 'Recommended for most cases' },
    { value: 50, label: '50 emails', icon: '📬', description: 'Deep analysis' },
    { value: 100, label: '100 emails', icon: '📮', description: 'Comprehensive analysis' },
    { value: 300, label: '300 emails', icon: '📪', description: 'Full inbox analysis' }
  ];

  const [selectedModel, setSelectedModel] = useState('openai');

  const MAX_INPUT_TOKENS = 4096; // Deepseek model token limit

  const processEmails = async () => {
    if (!user?.accessToken) return;
    
    setLoading(true);
    setError(null);
    setAnalyzedEmails([]);
    setSupportEmailCount(0);
    setTokenUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    setProcessingStatus({ stage: 'fetching_emails', progress: 0 });
    setAnalysisStartTime(Date.now());
    
    try {
      // Check if Firebase is initialized
      if (!db) {
        throw new Error('Database not initialized');
      }

      const response = await fetch('/api/gmail/fetch-emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch emails' }));
        throw new Error(errorData.error || 'Failed to fetch emails');
      }

      const data = await response.json();
      const { emails } = data;
      if (!emails || !Array.isArray(emails)) {
        throw new Error('Invalid email data received');
      }

      setEmailData(emails);

      const uniqueThreadEmails = groupEmailsByThread(emails);
      const totalEmails = Math.min(uniqueThreadEmails.length, emailCountToAnalyze);

      setProcessingStatus({ 
        stage: 'analyzing', 
        progress: 0,
        totalEmails 
      });

      // Prepare emails for analysis
      const emailsToAnalyze = uniqueThreadEmails.slice(0, totalEmails).map(email => ({
        subject: email.subject || 'No Subject',
        from: email.from || 'No Sender',
        body: typeof email.body === 'string' ? truncateEmailBody(email.body.trim()) : '',
        date: email.date || new Date().toISOString()
      }));

      // Skip empty emails early
      const validEmails = emailsToAnalyze.filter(email => email.body);
      
      if (validEmails.length === 0) {
        throw new Error('No valid emails to analyze');
      }

      // Send all emails for analysis in one request
      const analysisResponse = await fetch('/api/replicate/analyze-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          emails: validEmails,
          model: selectedModel
        })
      });

      if (!analysisResponse.ok) {
        const errorData = await analysisResponse.json();
        throw new Error(errorData.error || 'Failed to analyze emails');
      }

      const analysisData = await analysisResponse.json();
      const { results, usage } = analysisData;

      // Update token usage from the API response
      setTokenUsage(usage || {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      });

      // Process results
      const supportEmails = [];
      const newAnalyzedEmails = results.map((result: any, index: number) => {
        const email = validEmails[index];
        if (result.isSupport && result.confidence >= 0.70) {
          supportEmails.push({
            ...email,
            analysis: result
          });
        }
        return {
          subject: email.subject,
          isSupport: result.isSupport,
          confidence: result.confidence,
          reason: result.reason,
          timestamp: new Date(email.date).getTime(),
          wasGenerated: result.wasGenerated
        };
      });

      setAnalyzedEmails(newAnalyzedEmails);
      setSupportEmailCount(supportEmails.length);
      
      setProcessingStatus(prev => ({
        ...prev,
        stage: 'complete',
        progress: 100
      }));

      // After successful analysis, save to Firebase
      if (supportEmails.length > 0) {
        const aiInsightsResponse = await fetch('/api/knowledge/generate-insights', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.accessToken}`,
          },
          body: JSON.stringify({ 
            supportEmails,
            totalEmailsAnalyzed: totalEmails
          }),
        });

        const aiInsights = await aiInsightsResponse.json();

        // Create new analysis object
        const newAnalysis: SavedEmailAnalysis = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          emails: supportEmails.map(email => ({
            ...email,
            fullData: emails.find(e => normalizeSubject(e.subject) === normalizeSubject(email.subject))
          })),
          totalEmailsAnalyzed: totalEmails,
          tokenUsage: {
            ...tokenUsage,
            totalTokens: tokenUsage.totalTokens
          },
          aiInsights
        };

        // Save to Firebase
        try {
          const analysesRef = collection(db, 'emailAnalyses');
          await addDoc(analysesRef, {
            ...newAnalysis,
            userId: user.uid,
            createdAt: new Date().toISOString()
          });
          
          // Update local state
          setLatestAnalysis(newAnalysis);
          setSavedAnalyses(prev => [newAnalysis, ...prev].slice(0, 5));
          
        } catch (error) {
          console.error('Error saving analysis to Firebase:', error);
          // Still set the latest analysis even if saving fails
          setLatestAnalysis(newAnalysis);
        }

        setResult({
          totalEmails: totalEmails,
          supportEmails: supportEmails.length,
          faqs: aiInsights.commonQuestions
        });
      }

    } catch (error) {
      console.error('Error processing emails:', error);
      setError(error instanceof Error ? error.message : 'Failed to process emails');
      setProcessingStatus({ stage: 'idle', progress: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only show login splash if user is not logged in and not loading
    if (!user && !loading) {
      setShowLoginSplash(true);
    } else if (user) {
      // Hide login splash when user is logged in
      setShowLoginSplash(false);
    }
    // Don't do anything while loading to prevent flashing
  }, [user, loading]);

  useEffect(() => {
    if (user?.email) {
      checkForActiveJob();
    }
  }, [user]);

  const checkForActiveJob = async () => {
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
      }
    } catch (error) {
      console.error('Error checking job status:', error);
    }
  };

  const handleStartAnalysis = (model?: string, count?: number) => {
    if (model) setSelectedModel(model);
    if (count) setEmailCountToAnalyze(count);
    processEmails();
  };

  const handleCloseLogin = () => {
    if (user) {
      setShowLoginSplash(false);
    }
  };

  // Add a download debug logs button after analysis
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

  // Add this useEffect to load saved analyses
  useEffect(() => {
    const loadSavedAnalyses = async () => {
      try {
        if (!db) {
          console.error('Firebase database not initialized');
          setError('Database connection error. Please try again later.');
          return;
        }

        const analysesRef = collection(db, 'emailAnalyses');
        const q = query(analysesRef, orderBy('timestamp', 'desc'), limit(5));
        const querySnapshot = await getDocs(q);
        const analyses: SavedEmailAnalysis[] = [];
        
        querySnapshot.forEach((doc) => {
          analyses.push({ id: doc.id, ...doc.data() } as SavedEmailAnalysis);
        });
        
        setSavedAnalyses(analyses);
        if (analyses.length > 0) {
          setLatestAnalysis(analyses[0]);
        }
      } catch (error) {
        console.error('Error loading saved analyses:', error);
        setError('Failed to load saved analyses. Please try again later.');
      }
    };

    loadSavedAnalyses();
  }, [user]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="pl-64">
        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold">Knowledge Base Generator</h1>
            <button
              onClick={() => setShowRunTestModal(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Run New Analysis
            </button>
          </div>
          
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

          {processingStatus.stage !== 'idle' && processingStatus.stage !== 'complete' && (
            <div className="bg-white rounded-lg shadow-sm p-8 mb-8">
              <div className="max-w-xl mx-auto">
                <div className="flex flex-col items-center text-center mb-8">
                  <div className="relative w-24 h-24 mb-6">
                    {processingStatus.stage === 'fetching_emails' ? (
                      // Email fetching animation
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Mail className="w-12 h-12 text-red-500 animate-bounce" />
                      </div>
                    ) : (
                      // Analysis animation
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  
                  <h2 className="text-2xl font-semibold mb-2">Analysis in Progress</h2>
                  <p className="text-gray-600 mb-6">
                    {processingStatus.stage === 'fetching_emails' 
                      ? 'Fetching your emails...'
                      : `Analyzing email ${currentEmailIndex} of ${processingStatus.totalEmails || 0}`
                    }
                  </p>

                  {/* Progress bar */}
                  <div className="w-full bg-gray-100 rounded-full h-3 mb-4 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-red-500 to-red-600 transition-all duration-500 ease-out rounded-full"
                      style={{ 
                        width: `${processingStatus.progress}%`,
                        transition: 'width 0.5s ease-out'
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between w-full text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        processingStatus.stage === 'fetching_emails' ? 'bg-blue-500' : 'bg-gray-300'
                      }`} />
                      <span className={processingStatus.stage === 'fetching_emails' ? 'text-blue-600' : 'text-gray-400'}>
                        Fetch Emails
                      </span>
                    </div>
                    <div className="h-px w-16 bg-gray-200" />
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        processingStatus.stage === 'analyzing' ? 'bg-red-500' : 'bg-gray-300'
                      }`} />
                      <span className={processingStatus.stage === 'analyzing' ? 'text-red-600' : 'text-gray-400'}>
                        Analyze Content
                      </span>
                    </div>
                  </div>

                  {estimatedTimeRemaining > 0 && (
                    <p className="text-sm text-gray-500 mt-4">
                      Estimated time remaining: {Math.ceil(estimatedTimeRemaining / 60)} min {estimatedTimeRemaining % 60} sec
                    </p>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-2xl font-semibold text-gray-900">
                      {processingStatus.totalEmails || 0}
                    </p>
                    <p className="text-sm text-gray-600">Total Emails</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-2xl font-semibold text-gray-900">
                      {supportEmailCount}
                    </p>
                    <p className="text-sm text-gray-600">Support Emails Found</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Show initial modal by default */}
          {(!latestAnalysis || !latestAnalysis.aiInsights || !latestAnalysis.emails?.length) && processingStatus.stage === 'idle' && (
            <div className="bg-white rounded-2xl shadow-sm p-8 mb-8">
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

                {/* Model selection */}
                <div className="mb-12">
                  <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
                    Select AI Model
                  </label>
                  <div className="grid grid-cols-2 gap-6">
                    {MODEL_OPTIONS.map(model => (
                      <div
                        key={model.value}
                        onClick={() => setSelectedModel(model.value)}
                        className={`relative p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
                          selectedModel === model.value
                            ? 'border-orange-500 bg-orange-50 shadow-lg'
                            : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/50'
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

                {/* Email count selection */}
                <div className="mb-12">
                  <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
                    Number of emails to analyze
                  </label>
                  <div className="grid grid-cols-3 gap-4">
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
          )}

          {/* Only show analysis if it's complete with all required data */}
          {latestAnalysis && latestAnalysis.aiInsights && latestAnalysis.emails?.length > 0 && (
            <div className="mb-8">
              <div className="bg-white rounded-lg shadow-sm">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Latest Analysis Results</h2>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">
                        {new Date(latestAnalysis.timestamp).toLocaleDateString()}
                      </span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {latestAnalysis?.emails?.length || 0} support emails analyzed
                      </span>
                    </div>
                  </div>
                  
                  {/* Analyzed emails section */}
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-3">Analyzed Support Emails</h3>
                    <div className="space-y-3">
                      {latestAnalysis?.emails?.map((email, index) => (
                        <div 
                          key={index}
                          className="p-3 rounded-lg bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                          onClick={() => {
                            if (email.fullData) {
                              console.log('Opening email:', email.fullData);
                              setSelectedEmail({
                                subject: email.fullData.subject,
                                from: email.fullData.from,
                                body: email.fullData.body,
                                date: email.fullData.date
                              });
                            }
                          }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="font-medium text-gray-900">{email.subject}</h4>
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                              {Math.round(email.confidence * 100)}% confidence
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">{email.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* AI Insights Section */}
                  <div className="space-y-6">
                    {/* Key Customer Points */}
                    <div className="bg-purple-50 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-2xl">🪄</span>
                        <h3 className="text-lg font-semibold text-purple-900">Key Customer Points</h3>
                      </div>
                      <ul className="space-y-2">
                        {latestAnalysis?.aiInsights?.keyCustomerPoints?.map((point, index) => (
                          <li key={index} className="text-purple-800">• {point}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Customer Sentiment */}
                    <div className="bg-blue-50 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-blue-900 mb-2">Customer Sentiment</h3>
                      <p className="text-blue-800 font-medium mb-2">{latestAnalysis?.aiInsights?.customerSentiment?.overall}</p>
                      <p className="text-blue-700">{latestAnalysis?.aiInsights?.customerSentiment?.details}</p>
                    </div>

                    {/* Common Questions and Answers */}
                    <div className="bg-green-50 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-green-900 mb-3">Frequently Asked Questions</h3>
                      <div className="space-y-4">
                        {latestAnalysis?.aiInsights?.commonQuestions?.map((qa, index) => (
                          <div key={index} className="border-b border-green-200 pb-3 last:border-0 last:pb-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-green-700 font-medium">Q:</span>
                              <p className="text-green-800 font-medium">{qa.question}</p>
                              <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full ml-auto">
                                Asked {qa.frequency}x
                              </span>
                            </div>
                            <div className="flex gap-2 pl-6">
                              <span className="text-green-700 font-medium">A:</span>
                              <p className="text-green-700">{qa.typicalAnswer}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Recommended Actions */}
                    <div className="bg-amber-50 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-amber-900 mb-2">Recommended Actions</h3>
                      <ul className="space-y-2">
                        {latestAnalysis?.aiInsights?.recommendedActions?.map((action, index) => (
                          <li key={index} className="text-amber-800">→ {action}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Analysis Results Section */}
          {result && (
            <>
              <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-700 mb-1">
                      Analysis complete! Found {result.supportEmails} support emails after analyzing {result.totalEmails} emails in {formatDuration(analysisStartTime)}.
                    </p>
                    <p className="text-sm text-blue-600">
                      Token usage: {(tokenUsage?.totalTokens || 0).toLocaleString()} total tokens ({(tokenUsage?.promptTokens || 0).toLocaleString()} prompt, {(tokenUsage?.completionTokens || 0).toLocaleString()} completion)
                    </p>
                    <p className="text-xs text-blue-500 mt-1">
                      Using batched processing: {Math.ceil(result.totalEmails / 5)} API calls for {result.totalEmails} emails
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={downloadDebugLogs}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700"
                    >
                      Download Debug Logs
                    </button>
                    <SaveAnalysisButton
                      analysis={{
                        isSupport: true,
                        confidence: latestAnalysis?.emails[0]?.confidence || 0,
                        reason: latestAnalysis?.emails[0]?.reason || ''
                      }}
                      email={{
                        subject: latestAnalysis?.emails[0]?.subject || '',
                        from: latestAnalysis?.emails[0]?.from || '',
                        body: latestAnalysis?.emails[0]?.body || '',
                        date: latestAnalysis?.emails[0]?.date || new Date().toISOString()
                      }}
                      tokenCounts={{
                        input_tokens: tokenUsage.promptTokens,
                        output_tokens: tokenUsage.completionTokens,
                        total_tokens: tokenUsage.totalTokens
                      }}
                    />
                    <button
                      onClick={() => setShowRunTestModal(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                    >
                      Run Test Again
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <FAQPieChart
                  faqs={result.faqs}
                  totalEmails={result.totalEmails}
                  supportEmails={result.supportEmails}
                />
                <FAQList
                  faqs={result.faqs}
                  totalEmails={result.totalEmails}
                  supportEmails={result.supportEmails}
                />
              </div>

              {/* Individual Emails Section */}
              {analyzedEmails.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-6 mt-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Individual Email Analysis</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">
                        Found {supportEmailCount} support emails
                        {processingStatus.currentEmail !== undefined && (
                          <span className="text-gray-400 ml-1">
                            (analyzed {processingStatus.currentEmail} emails)
                          </span>
                        )}
                      </span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Test Mode</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {analyzedEmails.map((email, index) => {
                      const originalEmail = emailData.find(e => normalizeSubject(e.subject) === normalizeSubject(email.subject));
                      return (
                        <div key={email.timestamp} className="mb-4">
                          <div 
                            className={`flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors ${
                              index === 0 && processingStatus.stage !== 'complete' ? 'bg-gray-50 animate-pulse' : ''
                            }`}
                            onClick={() => {
                              if (originalEmail) {
                                setSelectedEmail(originalEmail);
                              }
                            }}
                          >
                            {email.error ? (
                              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                            ) : email.isSupport ? (
                              <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                            ) : (
                              <Mail className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-gray-600">
                                  {email.subject}
                                </span>
                                {!email.error && (
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    email.confidence && email.confidence > 0.7 
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                  }`}>
                                    {email.confidence ? `${Math.round(email.confidence * 100)}% confidence` : 'No confidence score'}
                                  </span>
                                )}
                                {email.status && (
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    email.status === 'completed' 
                                      ? 'bg-blue-100 text-blue-700'
                                      : email.status === 'failed'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-gray-100 text-gray-700'
                                  }`}>
                                    {email.status}
                                  </span>
                                )}
                              </div>
                              {(email.reason || email.error) && (
                                <p className={`text-xs mt-1 ${
                                  email.error ? 'text-red-500' : 
                                  email.isSupport ? 'text-green-600' : 'text-gray-500'
                                }`}>
                                  {email.error || email.reason || 'No reason provided'}
                                </p>
                              )}
                            </div>
                          </div>
                          {/* Add debug panel */}
                          {email.debug && <DebugPanel logs={email.debug} />}
                        </div>
                      );
                    })}
                  </div>
                  {processingStatus.stage === 'complete' && supportEmailCount === 0 && (
                    <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
                      <p className="text-sm text-yellow-700 mb-2">
                        <strong>Debugging Tip:</strong> Review the classifications above. If you see any emails that should have been marked as customer-related but weren't, you may want to consider the following:
                      </p>
                      <div className="ml-5">
                        <ul className="list-disc text-sm text-yellow-700">
                          <li>Check if the confidence threshold (50%) is too high</li>
                          <li>Verify if the email content is being properly extracted</li>
                          <li>Review if any customer-related patterns are being missed</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Show saved analyses if available */}
          {savedAnalyses.length > 0 && !processingStatus.stage && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4">Previous Analyses</h2>
              <div className="space-y-4">
                {savedAnalyses.map((analysis) => (
                  <div key={analysis.id} className="bg-white rounded-lg shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">
                          Analysis from {new Date(analysis.timestamp).toLocaleDateString()}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {analysis.supportEmails} support emails found in {analysis.totalEmails} analyzed
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setLatestAnalysis(analysis)}
                          className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                        >
                          View Details
                        </button>
                      </div>
                    </div>

                    {/* Quick stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-sm text-gray-600">Support Rate</p>
                        <p className="text-xl font-semibold">
                          {Math.round((analysis.supportEmails / analysis.totalEmails) * 100)}%
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-sm text-gray-600">Common Topics</p>
                        <p className="text-xl font-semibold">
                          {analysis.aiInsights.commonQuestions.length}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-sm text-gray-600">Token Usage</p>
                        <p className="text-xl font-semibold">
                          {analysis.tokenUsage.totalTokens.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      <LoginSplashScreen
        isOpen={showLoginSplash}
        onClose={handleCloseLogin}
        message="Sign in to access the Knowledge Base Generator"
      />

      {/* Email Thread Modal */}
      {selectedEmail && (
        <EmailThread
          email={selectedEmail}
          onClose={() => {
            console.log('Closing email thread');
            setSelectedEmail(null);
          }}
        />
      )}

      {/* Run Test Modal */}
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