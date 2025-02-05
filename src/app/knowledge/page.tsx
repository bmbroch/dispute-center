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
import { collection, query, orderBy, limit, getDocs, addDoc, where } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import Image from 'next/image';
import AnalysisModal from '../components/AnalysisModal';
import AnalysisSummary from '../components/AnalysisSummary';
import { SavedEmailAnalysis, FAQ, EmailData, ThreadSummary, AIInsights, TokenUsage, CustomerSentiment } from '@/types/analysis';
import { toast } from 'react-hot-toast';

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
  results?: SavedEmailAnalysis;
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
interface ThreadSummary {
  subject: string;
  content: string;
  sentiment: string;
  key_points: string[];
}

interface SavedEmailAnalysis {
  id: string;
  timestamp: number;
  totalEmails: number;
  supportEmails: number;
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
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [emailCountToAnalyze, setEmailCountToAnalyze] = useState(20);
  const [processingStatus, setProcessingStatus] = useState<{
    stage: 'idle' | 'fetching_emails' | 'filtering' | 'analyzing' | 'complete';
    progress: number;
    currentEmail?: number;
    totalEmails?: number;
  }>({ stage: 'idle', progress: 0 });
  const [result, setResult] = useState<SavedEmailAnalysis | null>(null);
  const [analyzedEmails, setAnalyzedEmails] = useState<EmailAnalysis[]>([]);
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

      // Sort all emails by date first
      const sortedEmails = [...emails].sort((a, b) => {
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        return dateB.getTime() - dateA.getTime();
      });

      // First try to get unique thread emails
      const threadMap = new Map();
      sortedEmails.forEach(email => {
        const normalizedSubject = normalizeSubject(email.subject || '');
        if (!threadMap.has(normalizedSubject)) {
          threadMap.set(normalizedSubject, email);
        }
      });
      let emailsToProcess = Array.from(threadMap.values());

      // If we don't have enough unique threads, add more recent emails until we reach the requested count
      if (emailsToProcess.length < emailCountToAnalyze) {
        const remainingCount = emailCountToAnalyze - emailsToProcess.length;
        const existingSubjects = new Set(emailsToProcess.map(e => normalizeSubject(e.subject || '')));
        
        // Add more recent emails that weren't included in threads
        const additionalEmails = sortedEmails.filter(email => 
          !existingSubjects.has(normalizeSubject(email.subject || ''))
        ).slice(0, remainingCount);
        
        emailsToProcess = [...emailsToProcess, ...additionalEmails];
      }

      const totalEmails = Math.min(emailsToProcess.length, emailCountToAnalyze);

      setProcessingStatus({ 
        stage: 'analyzing', 
        progress: 0,
        totalEmails 
      });

      // Prepare emails for analysis
      const emailsToAnalyze = emailsToProcess.slice(0, emailCountToAnalyze).map(email => ({
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
        // Update progress as each email is processed
        setProcessingStatus(prev => ({
          ...prev,
          progress: Math.round((index + 1) / totalEmails * 100)
        }));

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
      
      // Keep the loading state until everything is complete
      if (supportEmails.length > 0) {
      setProcessingStatus(prev => ({
        ...prev,
          stage: 'analyzing',
          progress: 90
      }));

        // AI Insights generation
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

        // Create new analysis object and save
        const emailsWithSummary: EmailData[] = analyzedEmails
          .filter(email => email.isSupport)
          .map(email => {
            const originalEmail = emailData.find(e => 
              normalizeSubject(e.subject) === normalizeSubject(email.subject)
            );
            return {
              subject: email.subject || '',
              from: originalEmail?.from || '',
              body: originalEmail?.body || '',
              date: originalEmail?.date || new Date().toISOString(),
              isSupport: true,
              confidence: email.confidence || 0,
              reason: email.reason || '',
              summary: {
                subject: email.subject || '',
                content: originalEmail?.body?.slice(0, 200) || '',
                sentiment: 'neutral',
                key_points: [email.reason || '']
              }
            };
          });

        const newAnalysis: SavedEmailAnalysis = {
          id: result.id,
          timestamp: Date.now(),
          totalEmails: result.totalEmails,
          emails: emailsWithSummary,
          totalEmailsAnalyzed: result.totalEmailsAnalyzed,
          supportEmails: emailsWithSummary,
          tokenUsage: {
            totalTokens: result.tokenUsage.totalTokens,
            promptTokens: result.tokenUsage.promptTokens,
            completionTokens: result.tokenUsage.completionTokens
          },
          aiInsights: {
            keyCustomerPoints: result.aiInsights.keyCustomerPoints,
            commonQuestions: result.aiInsights.commonQuestions,
            customerSentiment: result.aiInsights.customerSentiment,
            recommendedActions: result.aiInsights.recommendedActions
          }
        };

        // Final save to Firebase
        try {
          const analysesRef = collection(db, 'emailAnalyses');
          await addDoc(analysesRef, {
            ...newAnalysis,
            userId: user.email,
            createdAt: new Date().toISOString()
          });

        setLatestAnalysis(newAnalysis);
          setSavedAnalyses(prev => [newAnalysis, ...prev].slice(0, 5));
        } catch (error) {
          console.error('Error saving analysis to Firebase:', error);
          setLatestAnalysis(newAnalysis);
        }

        setResult(newAnalysis);
      }

      // Only set complete after everything is done
      setProcessingStatus(prev => ({
        ...prev,
        stage: 'complete',
        progress: 100
      }));

    } catch (error) {
      console.error('Error processing emails:', error);
      setError(error instanceof Error ? error.message : 'Failed to process emails');
      setProcessingStatus({ stage: 'idle', progress: 0 });
    } finally {
      // Only stop loading after a short delay to ensure smooth transition
      setTimeout(() => {
      setLoading(false);
      }, 1000);
    }
  };

  useEffect(() => {
    // Start a timer to wait for auth state to settle
    const timer = setTimeout(() => {
    if (!user && !loading) {
      setShowLoginSplash(true);
      }
      setIsCheckingAuth(false);
    }, 1000); // Wait 1 second before showing login splash

    // If user is logged in, hide the splash screen
    if (user) {
      setShowLoginSplash(false);
      setIsCheckingAuth(false);
    }

    return () => clearTimeout(timer);
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

  // Update the Last Analysis card section
  const renderLastAnalysis = () => {
    if (!latestSavedAnalysis) return null;

    return (
      <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl border border-blue-100/50 p-6 mb-8 hover:shadow-lg transition-all duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-white/80 backdrop-blur-sm rounded-lg p-3 shadow-sm">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
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
    );
  };

  // Add this useEffect to load saved analyses with debugging
  useEffect(() => {
    const loadSavedAnalyses = async () => {
      try {
        if (!db || !user?.email) {
          console.log('Debug: Missing db or user email', { db: !!db, userEmail: user?.email });
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
          
          // Ensure all required fields are present with proper types
          const analysis: SavedEmailAnalysis = {
            id: doc.id,
            timestamp: data.timestamp || Date.parse(data.createdAt) || Date.now(),
            totalEmails: data.totalEmails || 0,
            totalEmailsAnalyzed: data.totalEmailsAnalyzed || data.totalEmails || 0,
            supportEmails: data.supportEmails || 0,
            emails: (data.emails || []).map((email: any) => ({
              subject: email.subject || '',
              from: email.from || '',
              body: email.body || '',
              date: email.date || '',
              isSupport: email.isSupport || false,
              confidence: email.confidence || 0,
              reason: email.reason || '',
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
          
          analyses.push(analysis);
        });
        
        // Sort in memory by timestamp (newest first)
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
        setError('Failed to load saved analyses. Please check console for details.');
      }
    };

    if (user?.email) {
      loadSavedAnalyses();
    }
  }, [user, db]);

  // Update the view details click handler
  const handleViewDetails = (analysis: SavedEmailAnalysis) => {
    console.log('Viewing analysis:', analysis);
    setLatestAnalysis(analysis);
  };

  // Add this function before the return statement
  const handleSaveAnalysis = async () => {
    if (!result || !db) return;

    try {
      const emailsWithSummary: EmailData[] = analyzedEmails
        .filter(email => email.isSupport)
        .map(email => {
          const originalEmail = emailData.find(e => 
            normalizeSubject(e.subject) === normalizeSubject(email.subject)
          );
          return {
            subject: email.subject || '',
            from: originalEmail?.from || '',
            body: originalEmail?.body || '',
            date: originalEmail?.date || new Date().toISOString(),
            isSupport: true,
            confidence: email.confidence || 0,
            reason: email.reason || '',
            summary: {
              subject: email.subject || '',
              content: originalEmail?.body?.slice(0, 200) || '',
              sentiment: 'neutral',
              key_points: [email.reason || '']
            }
          };
        });

      const newAnalysis: SavedEmailAnalysis = {
        id: result.id,
        timestamp: Date.now(),
        totalEmails: result.totalEmails,
        emails: emailsWithSummary,
        totalEmailsAnalyzed: result.totalEmailsAnalyzed,
        supportEmails: emailsWithSummary,
        tokenUsage: {
          totalTokens: result.tokenUsage.totalTokens,
          promptTokens: result.tokenUsage.promptTokens,
          completionTokens: result.tokenUsage.completionTokens
        },
        aiInsights: {
          keyCustomerPoints: result.aiInsights.keyCustomerPoints,
          commonQuestions: result.aiInsights.commonQuestions,
          customerSentiment: result.aiInsights.customerSentiment,
          recommendedActions: result.aiInsights.recommendedActions
        }
      };

      // Save to Firestore
      const analysisRef = collection(db, 'analyses');
      const userEmail = user?.email;
      if (!userEmail) throw new Error('User email not found');

      await addDoc(analysisRef, {
        ...newAnalysis,
        userId: userEmail,
        createdAt: new Date()
      });

      setLatestSavedAnalysis(newAnalysis);
      saveAnalysis(newAnalysis);
      
      // Show success message
      toast.success('Analysis saved successfully!');
    } catch (error) {
      console.error('Error saving analysis:', error);
      toast.error('Failed to save analysis');
    }
  };

  // Add this test function before the return statement
  const testFirebaseSave = async () => {
    if (!user || !db) {
      console.error('No user or db not initialized');
      return;
    }

    try {
      // Create a simple test document
      const testAnalysis = {
        id: 'test-' + Date.now(),
        timestamp: Date.now(),
        userId: user.email,
        totalEmails: 1,
        supportEmails: 1,
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

      console.log('Attempting to save test analysis:', testAnalysis);
      
      const analysesRef = collection(db, 'emailAnalyses');
      const docRef = await addDoc(analysesRef, testAnalysis);
      
      console.log('Successfully saved test document with ID:', docRef.id);
      alert('Test save successful! Document ID: ' + docRef.id);
    } catch (error) {
      console.error('Error in test save:', error);
      alert('Test save failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="pl-64">
        <main className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold">Knowledge Base Generator</h1>
            <div className="flex gap-2">
              <button
                onClick={testFirebaseSave}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Test Firebase Save
              </button>
            <button
              onClick={() => setShowRunTestModal(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Run New Analysis
            </button>
            </div>
          </div>

          {!latestAnalysis && processingStatus.stage === 'idle' && !loading && renderLastAnalysis()}

          {latestAnalysis && (
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
                showCloseButton={false}
              />
            </div>
          )}

          {!latestAnalysis && (
            <>
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
                        id: result.id,
                        timestamp: result.timestamp,
                        totalEmails: result.totalEmails,
                        totalEmailsAnalyzed: result.totalEmailsAnalyzed,
                        supportEmails: result.supportEmails,
                        faqs: result.aiInsights.commonQuestions,
                        keyCustomerPoints: result.aiInsights.keyPoints,
                        customerSentiment: result.aiInsights.customerSentiment,
                        recommendedActions: result.aiInsights.suggestedActions,
                        tokenUsage: result.tokenUsage,
                        emails: result.emails,
                        analyzedEmails: analyzedEmails
                          .filter(email => email.isSupport)
                          .map(email => {
                            const originalEmail = emailData.find(e => 
                              normalizeSubject(e.subject) === normalizeSubject(email.subject)
                            );
                            return {
                              subject: email.subject,
                              from: originalEmail?.from || '',
                              body: originalEmail?.body || '',
                              date: originalEmail?.date || new Date().toISOString(),
                              isSupport: true,
                              confidence: email.confidence || 0,
                              reason: email.reason || ''
                            };
                          })
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
                    supportEmails={result.supportEmails}
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

                      <div className="flex justify-between items-center max-w-sm mx-auto mb-8">
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${
                            processingStatus.stage === 'fetching_emails' 
                              ? 'bg-orange-500 text-white'
                              : processingStatus.stage === 'analyzing' || processingStatus.stage === 'complete'
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-200'
                          }`}>
                            1
                    </div>
                          <span className="text-sm text-gray-600">Fetch</span>
                        </div>
                        <div className="h-px w-20 bg-gray-200" />
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${
                            processingStatus.stage === 'analyzing'
                              ? 'bg-orange-500 text-white'
                              : processingStatus.stage === 'complete'
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-200'
                          }`}>
                            2
                  </div>
                          <span className="text-sm text-gray-600">Analyze</span>
                        </div>
                        <div className="h-px w-20 bg-gray-200" />
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${
                            processingStatus.stage === 'complete'
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-200'
                          }`}>
                            3
                          </div>
                          <span className="text-sm text-gray-600">Complete</span>
                        </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                      <div className="bg-gray-50 rounded-xl p-4">
                        <div className="text-4xl font-bold text-gray-900 mb-1">
                      {processingStatus.totalEmails || 0}
                  </div>
                          <div className="text-sm text-gray-600">Total Emails</div>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-4">
                          <div className="text-4xl font-bold text-gray-900 mb-1">
                      {supportEmailCount}
                  </div>
                          <div className="text-sm text-gray-600">Support Emails</div>
                        </div>
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

              {latestAnalysis && latestAnalysis.aiInsights && latestAnalysis.emails?.length > 0 && (
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                  <h2 className="text-2xl font-semibold mb-4">Latest Analysis Results</h2>
                  <div className="text-sm text-gray-600 mb-4">
                    Analyzed on{' '}
                    {new Date(latestAnalysis.timestamp).toLocaleDateString()}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h3 className="text-lg font-medium mb-2">Analysis Overview</h3>
                      <p className="text-gray-700 mb-2">
                        {latestAnalysis.emails.length} support emails analyzed
                      </p>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h3 className="text-lg font-medium mb-2">Key Customer Points</h3>
                      <ul className="list-disc list-inside text-gray-700">
                        {latestAnalysis.aiInsights.keyCustomerPoints?.map((point, index) => (
                          <li key={index} className="mb-1">{point}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h3 className="text-lg font-medium mb-2">Customer Sentiment</h3>
                      <p className="text-blue-800 font-medium mb-2">{latestAnalysis.aiInsights.customerSentiment.overall}</p>
                      <p className="text-blue-700">{latestAnalysis.aiInsights.customerSentiment.details}</p>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h3 className="text-lg font-medium mb-2">Common Questions</h3>
                      <ul className="list-disc list-inside text-gray-700">
                        {latestAnalysis.aiInsights.commonQuestions?.map((qa, index) => (
                          <li key={index} className="mb-1">
                            <span className="font-medium">{qa.question}</span>
                            <br />
                            <span className="text-sm text-gray-600">
                              Frequency: {qa.frequency}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg col-span-2">
                      <h3 className="text-lg font-medium mb-2">Recommended Actions</h3>
                      <ul className="list-disc list-inside text-gray-700">
                        {latestAnalysis.aiInsights.recommendedActions?.map((action, index) => (
                          <li key={index} className="mb-1">{action}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
          
              {result && (
            <>
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

              {savedAnalyses.length > 0 && !processingStatus.stage && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4">Previous Analyses</h2>
              <div className="space-y-4">
                {savedAnalyses.slice(0, visibleAnalysesCount).map((analysis) => (
                  <div key={analysis.id} 
                    className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow duration-200">
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
                          onClick={() => handleViewDetails(analysis)}
                          className="px-4 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors duration-200 flex items-center gap-2"
                        >
                          View Details
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-sm text-gray-600 mb-1">Support Rate</p>
                        <p className="text-xl font-semibold text-gray-900">
                          {Math.round((analysis.supportEmails / analysis.totalEmails) * 100)}%
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-sm text-gray-600 mb-1">Common Topics</p>
                        <p className="text-xl font-semibold text-gray-900">
                          {analysis.aiInsights.commonQuestions.length}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-sm text-gray-600 mb-1">Token Usage</p>
                        <p className="text-xl font-semibold text-gray-900">
                          {analysis.tokenUsage.totalTokens.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                
                {savedAnalyses.length > visibleAnalysesCount && (
                  <div className="text-center mt-6">
                    <button
                      onClick={() => setVisibleAnalysesCount(prev => prev + 3)}
                      className="px-6 py-3 bg-white text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors duration-200 flex items-center gap-2 mx-auto"
                    >
                      Show More
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                )}
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

      {isCheckingAuth && (
        <div className="fixed inset-0 bg-white flex items-center justify-center">
          <div className="w-16 h-16">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-orange-100 rounded-full" />
              <div className="absolute top-0 left-0 w-16 h-16 border-4 border-orange-500 rounded-full border-t-transparent animate-spin" />
            </div>
          </div>
        </div>
      )}

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