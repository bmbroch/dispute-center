'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Layout } from '../components/Layout';
import { useAuth } from '@/lib/hooks/useAuth';
import { toast } from 'sonner';
import {
  InboxIcon,
  MessageCircleIcon,
  CheckCircleIcon,
  LightbulbIcon,
  ClockIcon,
  XCircleIcon,
  ChevronRightIcon,
  BookOpenIcon,
  PencilIcon,
  TrashIcon,
  Info,
  Sparkles,
  List,
  Link,
  Bold,
  Italic,
  Rocket,
  ChevronUpIcon,
  ChevronDownIcon,
  RefreshCw,
  XIcon,
  SparklesIcon,
  Undo2Icon,
  Redo2Icon,
  ListIcon,
  LinkIcon,
  SmileIcon,
  User,
} from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, doc, setDoc, getDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import type { Email, ExtendedEmail, EmailContent, BaseEmail } from '@/types/email';
import { GenericFAQ, IrrelevanceAnalysis } from '@/types/faq';
import { calculatePatternSimilarity } from '@/lib/utils/similarity';
import { Firestore } from 'firebase/firestore';
import DOMPurify from 'dompurify';
import EmailRenderNew from '../components/EmailRenderNew';
import dynamic from 'next/dynamic';
import { TINYMCE_CONFIG } from '@/lib/config/tinymce';
import { Editor } from '@tinymce/tinymce-react';

// Dynamically import your email composer modal
const FAQEmailComposer = dynamic(() => import('../faq_autoreply/components/FAQEmailComposer'), {
  ssr: false,
});

interface PotentialFAQ {
  id: string;
  question: string;
  source: {
    emailId: string;
    subject: string;
    sender: string;
  };
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface AnsweredFAQ {
  id?: string;
  question: string;
  answer: string;
  category: string;
  confidence: number;
  updatedAt?: string;
}

interface FAQ {
  question: string;
  answer: string;
  emailIds: string[];
  // ... other properties ...
}

interface CacheData {
  suggestedReply?: string;
  questions?: Array<{ question: string }>;
  timestamp?: number;
  emails?: Email[];
  genericFAQs?: GenericFAQ[];
  answeredFAQs?: AnsweredFAQ[];
  matches?: { [key: string]: MatchedFAQ };
}

interface MatchedFAQ {
  questionId: string;
  question: string;
  answer?: string;
  category: string;
  confidence: number;
}

interface NewQuestion {
  question: string;
  category?: string;
  confidence?: number;
  requiresCustomerSpecificInfo?: boolean;
}

// Add cache helper functions at the top of the file
const CACHE_KEYS = {
  EMAILS: 'faq_emails_cache',
  QUESTIONS: 'faq_questions_cache',
  GENERIC_FAQS: 'faq_generic_faqs_cache',
  LAST_FETCH: 'faq_last_fetch_timestamp',
  AI_ANALYSIS: 'faq_ai_analysis_cache',
  ANSWERED_FAQS: 'faq_answered_faqs_cache',
  READY_TO_REPLY: 'faq_ready_to_reply_cache',
  FAQ_MATCHES: 'faq_matches_cache',
  REMOVED_EMAILS: 'removed_from_ready_emails'
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const ANSWERED_FAQS_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes for answered FAQs
const MIN_FETCH_INTERVAL = 30000; // 30 seconds in milliseconds
const SIMILARITY_THRESHOLD = 0.6; // Threshold for question similarity matching

const loadFromCache = (key: string): CacheData | null => {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    const duration = key === CACHE_KEYS.ANSWERED_FAQS
      ? ANSWERED_FAQS_CACHE_DURATION
      : CACHE_DURATION;

    if (Date.now() - timestamp > duration) {
      localStorage.removeItem(key);
      return null;
    }

    return data as CacheData;
  } catch (error) {
    console.error('Error loading from cache:', error);
    return null;
  }
};

const saveToCache = (key: string, data: any) => {
  try {
    const cacheData = {
      data,
      timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Error saving to cache:', error);
  }
};

const clearCache = () => {
  try {
    Object.values(CACHE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
  }
};

// Add this constant at the top with other constants
const MAX_QUESTION_LENGTH = 50; // Maximum length for displayed questions
const MAX_PREVIEW_LENGTH = 200; // Show first 200 characters by default

// Add back the isCacheValid function with timestamp-based validation
const isCacheValid = (key: string) => {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return false;

    const { timestamp } = JSON.parse(cached);
    const duration = key === CACHE_KEYS.ANSWERED_FAQS
      ? ANSWERED_FAQS_CACHE_DURATION
      : CACHE_DURATION;

    return Date.now() - timestamp < duration;
  } catch (error) {
    console.error('Error checking cache validity:', error);
    return false;
  }
};

interface EditingReply {
  emailId: string;
  reply: string;
}

// Add debounce helper at the top of the file
const debounce = (func: Function, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Add sleep helper function
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Add loading state tracking
const loadingState = {
  isLoading: false,
  lastFetchTime: 0,
  retryTimeout: null as NodeJS.Timeout | null,
};

const FIREBASE_CACHE_COLLECTION = 'email_cache';
const FIREBASE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Add isEmailReadyForReply helper function
const isEmailReadyForReply = (email: ExtendedEmail, emailQuestions: Map<string, GenericFAQ[]>) => {
  const questions = email.id ? emailQuestions.get(email.id) : undefined;
  return (
    (!email.matchedFAQ || !questions || questions.length === 0) &&
    !email.isNotRelevant &&
    !email.isReplied
  );
};

const FIREBASE_COLLECTIONS = {
  EMAILS: 'emails',
  QUESTIONS: 'questions',
  FAQS: 'faqs',
  CACHED_QUESTIONS: 'cached_questions',
  EMAIL_CACHE: 'email_cache',
  THREAD_CACHE: 'thread_cache',
  EMAIL_ANALYSIS: 'email_analysis',
  NOT_RELEVANT: 'not_relevant_emails',
  READY_TO_REPLY: 'ready_to_reply'
};

const loadEmailsFromFirebase = async () => {
  try {
    const db = getFirebaseDB();
    if (!db) return null;

    // Get emails from email_cache, thread_cache, and email_content
    const emailCacheRef = collection(db, FIREBASE_COLLECTIONS.EMAIL_CACHE);
    const threadCacheRef = collection(db, FIREBASE_COLLECTIONS.THREAD_CACHE);
    const emailContentRef = collection(db, 'email_content');

    const [emailCacheSnapshot, threadCacheSnapshot, emailContentSnapshot] = await Promise.all([
      getDocs(emailCacheRef),
      getDocs(threadCacheRef),
      getDocs(emailContentRef)
    ]);

    // Create maps to merge data
    const emailMap = new Map<string, ExtendedEmail>();
    const contentMap = new Map<string, any>();
    const threadMap = new Map<string, { lastMessageTimestamp: number }>();

    // Process thread cache documents first to get latest timestamps
    threadCacheSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      threadMap.set(doc.id, {
        lastMessageTimestamp: data.lastMessageTimestamp || 0
      });
    });

    // Process email content documents
    emailContentSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      contentMap.set(doc.id, data.content);
    });

    // Process email cache documents and merge with thread data
    emailCacheSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const content = contentMap.get(doc.id);
      const threadInfo = data.threadId ? threadMap.get(data.threadId) : null;

      const email: ExtendedEmail = {
        ...data,
        id: doc.id,
        threadId: data.threadId,
        subject: data.subject,
        sender: data.sender,
        receivedAt: data.receivedAt,
        content: content || data.content,
        // Use the thread's last message timestamp for sorting if available
        sortTimestamp: threadInfo?.lastMessageTimestamp || new Date(data.receivedAt).getTime(),
        isNotRelevant: data.status === 'not_relevant',
        status: data.status || 'pending'
      };

      emailMap.set(doc.id, email);
    });

    // Convert map to array and sort by sortTimestamp
    const allEmails = [...emailMap.values()]
      .sort((a, b) => (b.sortTimestamp || new Date(b.receivedAt).getTime()) - (a.sortTimestamp || new Date(a.receivedAt).getTime()));

    return allEmails;
  } catch (error) {
    console.error('Error loading emails from Firebase:', error);
    return null;
  }
};

const saveEmailsToFirebase = async (emails: Email[]) => {
  try {
    const db = getFirebaseDB();
    if (!db) return;

    const cacheRef = doc(db, FIREBASE_CACHE_COLLECTION, 'latest');
    await setDoc(cacheRef, {
      emails,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error saving emails to Firebase:', error);
  }
};

// Add this helper function near the top of the component
const copyEmailDebugInfo = (email: ExtendedEmail) => {
  const questions = email.questions || [];
  const debugText = `
=== Email Debug Info ===
Subject: ${email.subject}
From: ${email.sender}

Original Customer Question:
${email.content}

AI Generated Questions (${questions.length}):
${questions.map((q: GenericFAQ, i: number) => `${i + 1}. ${q.question}`).join('\n')}
`;

  navigator.clipboard.writeText(debugText).then(() => {
    toast.success('Debug info copied to clipboard');
  }).catch(() => {
    toast.error('Failed to copy debug info');
  });
};

// Add this helper function near the top of the component
const formatTimeRemaining = (milliseconds: number): string => {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
};

const FIREBASE_QUESTIONS_COLLECTION = 'email_questions';

// Add function to load questions from Firebase
const loadQuestionsFromFirebase = async () => {
  try {
    const db = getFirebaseDB();
    if (!db) return null;

    const questionsRef = collection(db, FIREBASE_QUESTIONS_COLLECTION);
    const querySnapshot = await getDocs(questionsRef);
    const questionsMap = new Map<string, GenericFAQ[]>();

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.questions) {
        questionsMap.set(doc.id, data.questions);
      }
    });

    return questionsMap;
  } catch (error) {
    console.error('Error loading questions from Firebase:', error);
    return null;
  }
};

// Add function to save questions to Firebase
const saveQuestionsToFirebase = async (emailId: string, questions: GenericFAQ[]) => {
  try {
    const db = getFirebaseDB();
    if (!db) return;

    const questionRef = doc(db, FIREBASE_QUESTIONS_COLLECTION, emailId);
    await setDoc(questionRef, {
      questions,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error saving questions to Firebase:', error);
  }
};

// Add type for cached FAQs
interface CachedFAQsData {
  answeredFAQs?: AnsweredFAQ[];
  timestamp?: number;
}

// Add this near the Firebase-related functions
const getDocRef = (db: Firestore | null, collection: string, docId: string) => {
  if (!db) return null;
  return doc(db, collection, docId);
};

// Update the saveExtractedQuestionsToFirebase function
const saveExtractedQuestionsToFirebase = async (emailId: string, questions: GenericFAQ[]) => {
  try {
    const db = getFirebaseDB();
    const docRef = getDocRef(db, FIREBASE_COLLECTIONS.CACHED_QUESTIONS, emailId);
    if (!docRef) return false;

    await setDoc(docRef, {
      questions,
      timestamp: Date.now(),
      emailId
    });
    return true;
  } catch (error) {
    console.error('Error saving questions to Firebase:', error);
    return false;
  }
};

// Update the getCachedQuestionsFromFirebase function
const getCachedQuestionsFromFirebase = async (emailId: string) => {
  try {
    const db = getFirebaseDB();
    const docRef = getDocRef(db, FIREBASE_COLLECTIONS.CACHED_QUESTIONS, emailId);
    if (!docRef) return null;

    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      // Check if cache is still valid (24 hours)
      if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        return data.questions;
      }
    }
    return null;
  } catch (error) {
    console.error('Error getting cached questions:', error);
    return null;
  }
};

// Add these utility functions back outside the component
const truncateText = (text: string, maxLength: number): string => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

const getCleanContent = (content: string | { html: string | null; text: string | null }) => {
  // Handle content object
  let textContent = '';
  if (typeof content === 'object') {
    textContent = content.html || content.text || '';
  } else {
    textContent = content;
  }

  // Split into lines
  const lines = textContent.split('\n');
  let cleanContent = [];

  // Process each line
  for (const line of lines) {
    const trimmedLine = line.trim();

    // Stop at common email reply indicators
    if (
      trimmedLine.match(/^On .+wrote:/) ||  // "On ... wrote:"
      trimmedLine.startsWith('>') ||        // Quoted text
      trimmedLine.match(/^-{3,}/) ||       // Horizontal rules
      trimmedLine.match(/^_{3,}/) ||       // Horizontal rules
      trimmedLine.match(/^From:/) ||       // Forwarded message headers
      trimmedLine.match(/^Date:/) ||
      trimmedLine.match(/^Subject:/) ||
      trimmedLine.match(/^To:/)
    ) {
      break;
    }

    // Skip empty signature indicators
    if (trimmedLine === '--' || trimmedLine === '__') {
      continue;
    }

    cleanContent.push(line);
  }

  // Join lines back together and trim any trailing whitespace
  return cleanContent.join('\n').trim();
};

const LoadingSkeleton = () => (
  <div className="animate-pulse space-y-8">
    <div className="flex items-center justify-between mb-3 sm:mb-5">
      <div>
        <div className="h-5 w-48 bg-gray-200 rounded mb-2"></div>
        <div className="h-3 w-64 bg-gray-100 rounded hidden sm:block"></div>
      </div>
      <div className="h-8 w-20 bg-gray-200 rounded"></div>
    </div>

    {/* Tab skeleton */}
    <div className="grid grid-cols-4 gap-4 mb-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-16 bg-gray-100 rounded-lg"></div>
      ))}
    </div>

    {/* Email skeletons */}
    {[...Array(3)].map((_, i) => (
      <div key={i} className="bg-white rounded-lg shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <div className="h-5 w-64 bg-gray-200 rounded"></div>
            <div className="h-4 w-48 bg-gray-100 rounded"></div>
          </div>
          <div className="h-8 w-24 bg-gray-200 rounded"></div>
        </div>
        <div className="h-24 bg-gray-100 rounded"></div>
      </div>
    ))}
  </div>
);

const EmailContentSkeleton = () => (
  <div className="animate-pulse space-y-3">
    <div className="h-4 bg-gray-100 rounded w-3/4"></div>
    <div className="h-4 bg-gray-100 rounded w-5/6"></div>
    <div className="h-4 bg-gray-100 rounded w-2/3"></div>
  </div>
);

// Add this helper function at the top level
const extractEmailAddress = (sender: string) => {
  const matches = sender.match(/<(.+?)>/) || [null, sender];
  return matches[1] || sender;
};

export default function FAQAutoReplyV2() {
  console.log('=== Component Render Start ===');
  const { user, checkGmailAccess, refreshAccessToken, loading: authLoading } = useAuth();
  const [emails, setEmails] = useState<ExtendedEmail[]>([]);
  const [potentialFAQs, setPotentialFAQs] = useState<PotentialFAQ[]>([]);
  const [genericFAQs, setGenericFAQs] = useState<GenericFAQ[]>([]);
  const [activeTab, setActiveTab] = useState<'unanswered' | 'suggested' | 'faq_library' | 'not_relevant' | 'all'>('unanswered');
  const [loading, setLoading] = useState(true);
  const [loadingFAQs, setLoadingFAQs] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  // Add new state for tracking loading states per email
  const [analyzingEmails, setAnalyzingEmails] = useState<Set<string>>(new Set());
  const [isAnalysisEnabled, setIsAnalysisEnabled] = useState(false);
  const [showAnswerModal, setShowAnswerModal] = useState(false);
  const [selectedFAQ, setSelectedFAQ] = useState<GenericFAQ | null>(null);
  const [answer, setAnswer] = useState('');
  const [emailQuestions, setEmailQuestions] = useState<Map<string, GenericFAQ[]>>(new Map());
  const [loadingCache, setLoadingCache] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [answeredFAQs, setAnsweredFAQs] = useState<AnsweredFAQ[]>([]);
  const [editingReply, setEditingReply] = useState<EditingReply | null>(null);
  const [lastFetchTimestamp, setLastFetchTimestamp] = useState<number>(0);
  const [timeUntilNextRefresh, setTimeUntilNextRefresh] = useState<number>(0);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const [hasRefreshedOnce, setHasRefreshedOnce] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [totalEmails, setTotalEmails] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // At the top of the component, with other state declarations
  const [showDebug, setShowDebug] = useState(false);
  // Add this near other state declarations
  const [lastRefreshTimestamp, setLastRefreshTimestamp] = useState<number | null>(null);
  // Add new state for content loading
  const [loadingContent, setLoadingContent] = useState<Set<string>>(new Set());
  const [newEmailsCount, setNewEmailsCount] = useState<number>(0);
  // Add state for new thread IDs
  const [newThreadIds, setNewThreadIds] = useState<string[]>([]);
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [processingNotRelevant, setProcessingNotRelevant] = useState<Set<string>>(new Set());
  // Add this state near other state declarations
  const [processingUndoNotRelevant, setProcessingUndoNotRelevant] = useState<Set<string>>(new Set());

  // Add readyToReplyCount calculation
  const readyToReplyCount = useMemo(() => emails.filter(e =>
    e.status === 'processed' &&
    e.matchedFAQ &&
    !e.isReplied &&
    e.suggestedReply
  ).length, [emails]);

  // Move isSubscribed ref before the useEffect
  const isSubscribed = useRef(true);

  // Helper function to calculate pattern similarity
  const calculatePatternSimilarity = useCallback((pattern1: string, pattern2: string): number => {
    const words1 = new Set(pattern1.toLowerCase().split(/\s+/));
    const words2 = new Set(pattern2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }, []);

  // Update the similarity threshold to be more aggressive in grouping
  const SIMILARITY_THRESHOLD = 0.6; // Lowered from 0.8 to group more aggressively

  // Add this helper function to get all related questions for a FAQ
  const getRelatedQuestions = useCallback((faq: GenericFAQ): string[] => {
    const allQuestions = new Set<string>();

    // Add the main question
    allQuestions.add(faq.question);

    // Add similar patterns if they exist
    if (faq.similarPatterns) {
      faq.similarPatterns.forEach(pattern => allQuestions.add(pattern));
    }

    // Look through all emails' questions to find similar ones
    emails.forEach(email => {
      const questions = emailQuestions.get(email.id) || [];
      questions.forEach(q => {
        if (calculatePatternSimilarity(q.question, faq.question) > SIMILARITY_THRESHOLD) {
          allQuestions.add(q.question);
        }
      });
    });

    return Array.from(allQuestions);
  }, [emails, emailQuestions, calculatePatternSimilarity]);

  // Update groupSimilarPatterns to be more aggressive in consolidating similar questions
  const groupSimilarPatterns = useCallback((patterns: GenericFAQ[]): GenericFAQ[] => {
    const groups: GenericFAQ[] = [];

    patterns.forEach(pattern => {
      // First try to find a group with very similar question
      const similarGroup = groups.find(group => {
        // Check if questions are essentially asking for the same thing
        const baseQuestion1 = group.question.toLowerCase().replace(/{email}|{username}/g, '').trim();
        const baseQuestion2 = pattern.question.toLowerCase().replace(/{email}|{username}/g, '').trim();

        // If both questions contain same key action words, treat them as similar
        const keyWords1 = new Set(baseQuestion1.match(/\b(cancel|end|stop|terminate|discontinue)\b/g) || []);
        const keyWords2 = new Set(baseQuestion2.match(/\b(cancel|end|stop|terminate|discontinue)\b/g) || []);

        const hasCommonKeyWord = [...keyWords1].some(word => keyWords2.has(word));
        const similarity = calculatePatternSimilarity(baseQuestion1, baseQuestion2);

        return hasCommonKeyWord && similarity > SIMILARITY_THRESHOLD;
      });

      if (similarGroup) {
        // Add as a pattern variation rather than a separate question
        if (!similarGroup.similarPatterns) {
          similarGroup.similarPatterns = [];
        }
        similarGroup.similarPatterns.push(pattern.question);
        similarGroup.emailIds = Array.from(new Set([
          ...(similarGroup.emailIds || []),
          ...(pattern.emailIds || [])
        ]));
      } else {
        groups.push({
          ...pattern,
          similarPatterns: [],
          emailIds: pattern.emailIds || []
        });
      }
    });

    return groups;
  }, [calculatePatternSimilarity]);

  // Add this helper function inside the component
  const truncateQuestion = (question: string) => {
    if (question.length <= MAX_QUESTION_LENGTH) return question;
    return question.substring(0, MAX_QUESTION_LENGTH) + '...';
  };

  // Add this helper function to check if a question matches any answered FAQ
  const findMatchingAnsweredFAQ = useCallback((question: string): AnsweredFAQ | null => {
    console.log('Finding match for question:', question);
    console.log('Current answeredFAQs:', answeredFAQs);

    // First try exact match
    const exactMatch = answeredFAQs.find(faq =>
      faq.question.toLowerCase() === question.toLowerCase()
    );

    if (exactMatch) {
      console.log('Found exact match:', exactMatch);
      return exactMatch;
    }

    // Then try similarity match
    const similarMatch = answeredFAQs.find(faq => {
      const similarity = calculatePatternSimilarity(faq.question, question);
      console.log(`Similarity between "${faq.question}" and "${question}": ${similarity}`);
      return similarity > SIMILARITY_THRESHOLD;
    });

    if (similarMatch) {
      console.log('Found similar match:', similarMatch);
      return similarMatch;
    }

    console.log('No match found for question:', question);
    return null;
  }, [answeredFAQs, calculatePatternSimilarity]);

  // Add this helper function to check if all email questions have been answered
  const checkEmailAnsweredStatus = useCallback((email: ExtendedEmail) => {
    console.log(`Checking status for email ${email.id}`);
    const questions = emailQuestions.get(email.id) || [];

    if (questions.length === 0) {
      console.log('No questions found for email');
      return null;
    }

    // Check if all questions have matching answered FAQs
    const questionsWithAnswers = questions.map(q => {
      const matchedFAQ = answeredFAQs.find(faq =>
        faq.answer &&
        faq.answer.trim() !== '' &&
        calculatePatternSimilarity(faq.question, q.question) > SIMILARITY_THRESHOLD
      );
      return { question: q, matchedFAQ };
    });

    const allQuestionsAnswered = questionsWithAnswers.every(q => q.matchedFAQ);
    console.log(`All questions answered: ${allQuestionsAnswered}`);

    if (allQuestionsAnswered) {
      // Find the best match (highest confidence)
      const bestMatch = questionsWithAnswers.reduce((best, current) => {
        if (!current.matchedFAQ) return best;
        if (!best || current.matchedFAQ.confidence > best.confidence) {
          return current.matchedFAQ;
        }
        return best;
      }, null as AnsweredFAQ | null);

      if (bestMatch) {
        console.log(`Found best match for email: ${bestMatch.question}`);
        return {
          question: bestMatch.question,
          answer: bestMatch.answer,
          confidence: bestMatch.confidence
        };
      }
    }

    console.log('No suitable match found');
    return null;
  }, [emailQuestions, answeredFAQs, calculatePatternSimilarity]);

  // Add this near the state declarations
  const lastLoadTime = useRef<number>(0);
  const loadTimeout = useRef<NodeJS.Timeout | null>(null);

  // Update the loadEmails function
  const loadEmails = useCallback(async (skipCache: boolean = false, pageNumber?: number) => {
    // Add debounce check
    const now = Date.now();
    if (now - lastLoadTime.current < MIN_FETCH_INTERVAL && !skipCache) {
      console.log('Skipping loadEmails due to rate limit');
      return;
    }

    // Clear any pending timeouts
    if (loadTimeout.current) {
      clearTimeout(loadTimeout.current);
    }

    try {
      setIsLoading(true);

      // Add cache check
      const cached = !skipCache ? loadFromCache(CACHE_KEYS.EMAILS) : null;
      if (cached) {
        // Cast the cached data to the correct type before setting
        setEmails(cached as ExtendedEmail[]);
        setLastFetchTimestamp(Date.now());
        return;
      }

      // Actual fetch logic here...

      // Update last load time
      lastLoadTime.current = Date.now();

    } finally {
      setIsLoading(false);
    }
  }, [user?.accessToken, page, MIN_FETCH_INTERVAL]);

  useEffect(() => {
    // Check if analysis is enabled via environment variable
    setIsAnalysisEnabled(process.env.NEXT_PUBLIC_OPENAI_API_KEY !== undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const initialize = async () => {
      if (!user?.accessToken) return;

      // Add minimum time between loads
      await new Promise(resolve => setTimeout(resolve, 500));

      if (controller.signal.aborted) return;

      try {
        setLoading(true);

        // First try to load from local cache
        const cachedData = loadFromCache(CACHE_KEYS.EMAILS);
        if (cachedData?.emails) {
          setEmails(cachedData.emails as ExtendedEmail[]);
        }

        // Then try Firebase cache and load refresh timestamp
        const db = getFirebaseDB();
        if (db) {
          // Load refresh timestamp
          const refreshMetadataRef = doc(db, 'email_metadata', 'refresh_timestamp');
          const refreshMetadata = await getDoc(refreshMetadataRef);
          if (refreshMetadata.exists()) {
            setLastRefreshTimestamp(refreshMetadata.data().lastRefreshTimestamp);
          }

          // Load emails and ready to reply data
          const firebaseEmails = await loadEmailsFromFirebase();
          const readyToReplyEmails = await loadReadyToReplyFromFirebase();

          if (firebaseEmails && firebaseEmails.length > 0) {
            setEmails(prevEmails => {
              const existingIds = new Set(prevEmails.map(e => e.id));
              const newEmails = firebaseEmails.filter(e => !existingIds.has(e.id));

              // Merge ready-to-reply data with emails
              if (readyToReplyEmails) {
                const readyToReplyMap = new Map(readyToReplyEmails.map((e: ExtendedEmail) => [e.id, e]));
                newEmails.forEach(email => {
                  const readyToReply = readyToReplyMap.get(email.id) as ExtendedEmail | undefined;
                  if (readyToReply) {
                    email.suggestedReply = readyToReply.suggestedReply;
                    email.matchedFAQ = readyToReply.matchedFAQ;
                    email.status = readyToReply.status;
                  }
                });
              }

              return [...prevEmails, ...newEmails];
            });
          }

          // Load cached questions from Firebase
          console.log('Loading cached questions from Firebase...');
          const cachedQuestions = await loadQuestionsFromFirebase();
          if (cachedQuestions) {
            console.log('Found cached questions:', cachedQuestions);
            setEmailQuestions(cachedQuestions);
          }

          // Also try to load cached questions for each email
          const allEmails = [...(cachedData?.emails || []), ...(firebaseEmails || [])];
          const uniqueEmails = Array.from(new Set(allEmails.map(e => e.id))).map(id =>
            allEmails.find(e => e.id === id)
          ).filter((e): e is ExtendedEmail => e !== undefined);

          console.log('Loading cached questions for each email...');
          const emailQuestionsPromises = uniqueEmails.map(async email => {
            const questions = await getCachedQuestionsFromFirebase(email.id);
            if (questions) {
              return [email.id, questions] as [string, GenericFAQ[]];
            }
            return null;
          });

          const emailQuestionsResults = await Promise.all(emailQuestionsPromises);
          const validResults = emailQuestionsResults.filter((result): result is [string, GenericFAQ[]] => result !== null);

          if (validResults.length > 0) {
            console.log(`Found cached questions for ${validResults.length} emails`);
            setEmailQuestions(prev => {
              const updated = new Map(prev);
              validResults.forEach(([emailId, questions]) => {
                updated.set(emailId, questions);
              });
              return updated;
            });
          }
        }

        // Finally, load fresh emails
        await loadEmails(true);

      } catch (error) {
        console.error('Error initializing:', error);
        toast.error('Failed to load emails');
      } finally {
        setLoading(false);
      }
    };

    initialize();

    return () => {
      controller.abort();
      if (loadTimeout.current) {
        clearTimeout(loadTimeout.current);
      }
    };
  }, [user?.accessToken, checkGmailAccess, loadEmails]);

  // Update the FAQ loading effect
  useEffect(() => {
    console.log('=== FAQ Loading Debug - Start ===');

    const loadFAQs = async () => {
      try {
        setLoadingFAQs(true);

        // Only fetch from API - remove cache logic to ensure fresh data
        console.log('Fetching FAQs from API');
        const response = await fetch('/api/faq/list');
        if (!response.ok) {
          throw new Error('Failed to fetch FAQs');
        }

        const data = await response.json();
        console.log('API Response:', data);

        if (data.faqs) {
          // Only include FAQs that have both a question and an answer
          const validFAQs = data.faqs.filter((faq: AnsweredFAQ) =>
            faq.question &&
            faq.answer &&
            faq.answer.trim() !== '' &&
            faq.question.trim() !== ''
          );

          console.log(`Loaded ${validFAQs.length} valid FAQs from API`);
          setAnsweredFAQs(validFAQs);
        } else {
          setAnsweredFAQs([]);
        }
      } catch (error) {
        console.error('Error loading FAQs:', error);
        toast.error('Failed to load FAQ library');
        setAnsweredFAQs([]);
      } finally {
        setLoadingFAQs(false);
      }
    };

    loadFAQs();

    return () => {
      console.log('Cleaning up FAQ loading effect');
    };
  }, []); // Remove answeredFAQs from dependencies to prevent loops

  // Update the email status effect to cache FAQ matches
  useEffect(() => {
    if (answeredFAQs.length === 0) return;

    const updateEmails = async () => {
      const updatedEmails = await Promise.all(emails.map(async (email) => {
        const questions = emailQuestions.get(email.id) || [];
        if (questions.length === 0) return email;

        const matchedFAQ = checkEmailAnsweredStatus(email);

        if (matchedFAQ) {
          const updatedEmail = {
            ...email,
            matchedFAQ,
            status: 'processed' as const
          };

          // Cache the FAQ match
          const faqMatches = loadFromCache(CACHE_KEYS.FAQ_MATCHES)?.matches || {};
          const matchedFAQWithRequired: MatchedFAQ = {
            questionId: email.id, // Use email ID as fallback if no faqId
            question: matchedFAQ.question,
            answer: matchedFAQ.answer || '',
            category: 'support', // Default category
            confidence: matchedFAQ.confidence
          };
          faqMatches[email.id] = matchedFAQWithRequired;
          saveToCache(CACHE_KEYS.FAQ_MATCHES, { matches: faqMatches, timestamp: Date.now() });

          const needsNewReply = !email.suggestedReply ||
            !email.matchedFAQ ||
            email.matchedFAQ.question !== matchedFAQ.question;

          if (needsNewReply) {
            try {
              const response = await fetch('/api/knowledge/generate-reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  emailId: email.id,
                  subject: email.subject,
                  content: email.content,
                  matchedFAQ: matchedFAQ,
                  questions: questions,
                  answeredFAQs: answeredFAQs.filter(faq =>
                    questions.some(q =>
                      calculatePatternSimilarity(q.question, faq.question) > SIMILARITY_THRESHOLD
                    )
                  )
                })
              });

              if (response.ok) {
                const data = await response.json();
                const emailWithReply = {
                  ...updatedEmail,
                  suggestedReply: data.reply
                };

                // Cache the ready to reply email
                const readyToReplyEmails = loadFromCache(CACHE_KEYS.READY_TO_REPLY)?.emails || [];
                const updatedReadyToReply = [...readyToReplyEmails, emailWithReply];
                saveToCache(CACHE_KEYS.READY_TO_REPLY, {
                  emails: updatedReadyToReply,
                  timestamp: Date.now()
                });
                saveReadyToReplyToFirebase(updatedReadyToReply);

                return emailWithReply;
              }
            } catch (error) {
              console.error('Error generating reply:', error);
            }
          }

          return updatedEmail;
        }
        return email;
      }));

      setEmails(updatedEmails);
    };

    updateEmails().catch(error => {
      console.error('Error updating emails:', error);
    });

  }, [answeredFAQs, checkEmailAnsweredStatus, emailQuestions, calculatePatternSimilarity]);

  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      loadEmails(false);
    }
  };

  const handleAutoReply = async (email: ExtendedEmail) => {
    try {
      // Get matched FAQs for this email
      const matchedFAQs = emailQuestions.get(email.id) || [];

      const response = await fetch('/api/emails/auto-reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          matchedFAQs,
          userEmail: user?.email || 'unknown'
        })
      });

      if (response.ok) {
        // Remove from ready to reply cache
        const readyToReplyEmails = loadFromCache(CACHE_KEYS.READY_TO_REPLY)?.emails || [];
        const updatedReadyToReply = readyToReplyEmails.filter(e => e.id !== email.id);
        saveToCache(CACHE_KEYS.READY_TO_REPLY, {
          emails: updatedReadyToReply,
          timestamp: Date.now()
        });
        saveReadyToReplyToFirebase(updatedReadyToReply);

        toast.success('Auto-reply sent successfully');
        loadEmails();
      } else {
        throw new Error('Failed to send auto-reply');
      }
    } catch (error) {
      toast.error('Failed to send auto-reply');
    }
  };

  const handleAddToFAQLibrary = (question: GenericFAQ) => {
    setSelectedFAQ(question);
    setAnswer('');
    setShowAnswerModal(true);
  };

  const handleEditLibraryFAQ = (faq: AnsweredFAQ) => {
    setSelectedFAQ({
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      confidence: faq.confidence,
      emailIds: [],
      updatedAt: faq.updatedAt
    });
    setAnswer(faq.answer);
    setShowAnswerModal(true);
  };

  const handleDeleteFAQ = async (faq: AnsweredFAQ) => {
    if (!faq.id) {
      toast.error('Cannot delete FAQ without an ID');
      return;
    }

    try {
      // Optimistically update UI
      setAnsweredFAQs(prev => {
        const updated = prev.filter(f => f.id !== faq.id);
        return updated.sort((a, b) => {
          const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return dateB - dateA;
        });
      });

      // Update cache immediately
      const cachedData = loadFromCache(CACHE_KEYS.ANSWERED_FAQS);
      if (cachedData?.answeredFAQs) {
        const updatedCache = {
          answeredFAQs: cachedData.answeredFAQs
            .filter(f => f.id !== faq.id)
            .sort((a, b) => {
              const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
              const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
              return dateB - dateA;
            })
        };
        saveToCache(CACHE_KEYS.ANSWERED_FAQS, updatedCache);
      }

      // Call the API to delete from Firebase
      const response = await fetch('/api/faq/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: faq.id
        })
      });

      if (!response.ok) {
        let errorMessage = 'Failed to delete FAQ';
        try {
          const errorData = await response.json();
          if (errorData && (errorData.error || errorData.details)) {
            errorMessage = errorData.error || errorData.details;
          }
        } catch (error) {
          errorMessage = 'Failed to delete FAQ: Network error';
        }
        throw new Error(errorMessage);
      }

      toast.success('FAQ deleted successfully');
    } catch (error) {
      console.error('Error deleting FAQ:', error);

      // Revert the optimistic update on error
      setAnsweredFAQs(prev => {
        if (faq) {
          const updated = prev.filter(f => f.id !== faq.id);
          return [...updated, faq].sort((a, b) => {
            const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return dateB - dateA;
          });
        }
        return prev;
      });

      toast.error(error instanceof Error ? error.message : 'Failed to delete FAQ');
    }
  };

  const handleSaveFAQ = async () => {
    if (!selectedFAQ || !answer.trim()) {
      toast.error('Please provide both question and answer');
      return;
    }

    try {
      // Create the FAQ object that will be used for both optimistic update and saving
      const newFAQ = {
        id: selectedFAQ.id,
        question: selectedFAQ.question,
        answer: answer.trim(),
        category: selectedFAQ.category || 'general',
        confidence: selectedFAQ.confidence || 1,
        updatedAt: new Date().toISOString()
      };

      // Update the UI immediately with sorted FAQs
      setAnsweredFAQs(prev => {
        const updated = prev.filter(faq => faq.id !== newFAQ.id);
        const newList = [...updated, newFAQ];
        // Sort by updatedAt (most recent first)
        return newList.sort((a, b) => {
          const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return dateB - dateA;
        });
      });

      // Update the cache immediately
      const cachedData = loadFromCache(CACHE_KEYS.ANSWERED_FAQS);
      if (cachedData?.answeredFAQs) {
        const updatedCache = {
          answeredFAQs: cachedData.answeredFAQs
            .filter(faq => faq.id !== newFAQ.id)
            .concat([newFAQ])
            .sort((a, b) => {
              const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
              const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
              return dateB - dateA;
            })
        };
        saveToCache(CACHE_KEYS.ANSWERED_FAQS, updatedCache);
      }

      // Close the modal immediately for better UX
      setShowAnswerModal(false);

      // Then save to FAQ library
      const response = await fetch('/api/faq/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: selectedFAQ.id,
          question: selectedFAQ.question,
          answer: answer.trim(),
          category: selectedFAQ.category || 'general',
          emailIds: selectedFAQ.emailIds || [],
          similarPatterns: selectedFAQ.similarPatterns || [],
          confidence: selectedFAQ.confidence || 1,
          requiresCustomerSpecificInfo: selectedFAQ.requiresCustomerSpecificInfo || false
        })
      });

      if (!response.ok) {
        let errorMessage = 'Failed to save FAQ';
        try {
          const errorData = await response.json();
          if (errorData && (errorData.error || errorData.details)) {
            errorMessage = errorData.error || errorData.details;
          }
        } catch (error) {
          errorMessage = 'Failed to save FAQ: Network error';
        }
        throw new Error(errorMessage);
      }

      const savedFAQ = await response.json();
      if (!savedFAQ || !savedFAQ.question) {
        throw new Error('Invalid response from server');
      }

      // Update the state with the server response to ensure consistency
      setAnsweredFAQs(prev => {
        const updated = prev.filter(faq => faq.id !== savedFAQ.id);
        const newList = [...updated, savedFAQ];
        // Sort by updatedAt (most recent first)
        return newList.sort((a, b) => {
          const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return dateB - dateA;
        });
      });

      // Update cache with server response
      const finalCachedData = loadFromCache(CACHE_KEYS.ANSWERED_FAQS);
      if (finalCachedData?.answeredFAQs) {
        const updatedCache = {
          answeredFAQs: finalCachedData.answeredFAQs
            .filter(faq => faq.id !== savedFAQ.id)
            .concat([savedFAQ])
            .sort((a, b) => {
              const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
              const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
              return dateB - dateA;
            })
        };
        saveToCache(CACHE_KEYS.ANSWERED_FAQS, updatedCache);
      }

      toast.success('FAQ saved successfully');
    } catch (error) {
      console.error('Error saving FAQ:', error);

      // Revert the optimistic update on error
      setAnsweredFAQs(prev => {
        const existing = prev.find(faq => faq.id === selectedFAQ.id);
        if (existing) {
          const updated = prev.filter(faq => faq.id !== selectedFAQ.id);
          return [...updated, existing].sort((a, b) => {
            const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return dateB - dateA;
          });
        }
        return prev;
      });

      toast.error(error instanceof Error ? error.message : 'Failed to save FAQ');
      setShowAnswerModal(true); // Reopen the modal on error
    }
  };

  const handleIgnoreFAQ = (faq: GenericFAQ) => {
    setGenericFAQs(prev => prev.filter(f => f.question !== faq.question));
    toast.success('FAQ ignored');
  };

  const handleMarkNotRelevant = async (email: ExtendedEmail) => {
    try {
      // Add email ID to processing set
      setProcessingNotRelevant(prev => new Set(prev).add(email.id));

      // Optimistically update UI state
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: true,
            status: 'not_relevant'
          }
          : e
      ));

      // Remove from questions if present
      const updatedQuestions = new Map(emailQuestions);
      updatedQuestions.delete(email.id);
      setEmailQuestions(updatedQuestions);

      // Update cache with the new state
      const cachedData = loadFromCache(CACHE_KEYS.ANSWERED_FAQS) || {};
      const updatedEmails = (cachedData.emails || []).map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: true,
            status: 'not_relevant'
          }
          : e
      );
      saveToCache(CACHE_KEYS.ANSWERED_FAQS, {
        ...cachedData,
        emails: updatedEmails,
        timestamp: Date.now()
      });

      // Get Firebase instance
      const db = getFirebaseDB();
      if (!db) throw new Error('Firebase DB not initialized');

      // Update the email in the email_cache collection instead of creating a new document
      const emailRef = doc(db, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
      await setDoc(emailRef, {
        isNotRelevant: true,
        status: 'not_relevant',
        markedNotRelevantAt: new Date().toISOString()
      }, { merge: true });

      // Now call analyze-irrelevant with threadId and userEmail
      const response = await fetch('/api/emails/analyze-irrelevant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: {
            threadId: email.threadId,
            subject: email.subject || 'No Subject',
            content: email.content || '',
            sender: email.sender || 'Unknown Sender'
          },
          userEmail: user?.email || 'unknown'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to analyze email');
      }

      const analysis = await response.json();

      // Update the email document with the analysis
      await setDoc(emailRef, {
        irrelevanceReason: analysis.reason,
        irrelevanceCategory: analysis.category,
        irrelevanceConfidence: analysis.confidence,
        irrelevanceDetails: analysis.details
      }, { merge: true });

      // Update local state with the analysis
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: true,
            status: 'not_relevant',
            irrelevanceReason: analysis.reason
          }
          : e
      ));

      // Update cache with the analysis
      const updatedCachedData = loadFromCache(CACHE_KEYS.ANSWERED_FAQS) || {};
      const updatedCachedEmails = (updatedCachedData.emails || []).map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: true,
            status: 'not_relevant',
            irrelevanceReason: analysis.reason
          }
          : e
      );
      saveToCache(CACHE_KEYS.ANSWERED_FAQS, {
        ...updatedCachedData,
        emails: updatedCachedEmails,
        timestamp: Date.now()
      });

      toast.success(`Removed: ${analysis.reason}`);
    } catch (error) {
      console.error('Error marking email as not relevant:', error);

      // Revert optimistic updates on error
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: false,
            status: 'pending'
          }
          : e
      ));

      // Revert cache on error
      const cachedData = loadFromCache(CACHE_KEYS.ANSWERED_FAQS) || {};
      const revertedEmails = (cachedData.emails || []).map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: false,
            status: 'pending'
          }
          : e
      );
      saveToCache(CACHE_KEYS.ANSWERED_FAQS, {
        ...cachedData,
        emails: revertedEmails,
        timestamp: Date.now()
      });

      toast.error('Error marking email as not relevant');
    } finally {
      // Remove email ID from processing set
      setProcessingNotRelevant(prev => {
        const next = new Set(prev);
        next.delete(email.id);
        return next;
      });
    }
  };

  // Add this function to check if an email is marked as not relevant
  const isEmailMarkedNotRelevant = async (emailId: string): Promise<boolean> => {
    try {
      const db = getFirebaseDB();
      if (!db) return false;

      const notRelevantRef = doc(db, 'not_relevant_emails', emailId);
      const docSnap = await getDoc(notRelevantRef);
      return docSnap.exists();
    } catch (error) {
      console.error('Error checking not relevant status:', error);
      return false;
    }
  };

  // Update the handleCreateFAQ function
  const handleCreateFAQ = async (email: ExtendedEmail) => {
    console.log('=== Starting FAQ Creation ===');

    // Get the content to analyze - prefer HTML content if available
    const contentToAnalyze = getCleanContent(email.content);
    console.log('Content to analyze:', {
      length: contentToAnalyze.length,
      preview: contentToAnalyze.substring(0, 200) + '...',
      emailId: email.id
    });

    if (!contentToAnalyze) {
      console.log('Error: No email content to analyze');
      toast.error('No email content to analyze');
      return;
    }

    // Update loading state for this specific email
    setAnalyzingEmails(prev => new Set([...prev, email.id]));

    try {
      console.log('Making API request to extract questions...');
      const response = await fetch('/api/knowledge/extract-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailId: email.id,
          emailContent: contentToAnalyze,
          maxQuestions: 5
        })
      });

      let errorData;
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error:', {
          status: response.status,
          statusText: response.statusText,
          errorText
        });
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('API response data:', data);

      const { matchedFAQs = [], newQuestions = [] } = data;

      // Only show "no questions" toast if this is a single email being processed
      // For batch processing, we'll handle notifications differently
      if (matchedFAQs.length === 0 && newQuestions.length === 0) {
        console.log('No questions were found or matched');
        // Check if this is part of a batch operation
        const isBatchOperation = analyzingEmails.size > 1;
        if (!isBatchOperation) {
          toast.info('No relevant questions found for this email');
        }
        return;
      }

      // Combine matched FAQs and new questions into a single array
      const allQuestions = [
        ...matchedFAQs.map((faq: MatchedFAQ) => ({
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          confidence: faq.confidence,
          emailIds: [email.id],
          isExistingFAQ: true,
          faqId: faq.questionId
        })),
        ...newQuestions.map((q: NewQuestion) => ({
          question: q.question,
          category: q.category || 'support',
          emailIds: [email.id],
          confidence: q.confidence || 1,
          requiresCustomerSpecificInfo: q.requiresCustomerSpecificInfo || false,
          isExistingFAQ: false
        }))
      ];

      // Update emailQuestions state
      setEmailQuestions(prev => {
        const updated = new Map(prev);
        updated.set(email.id, allQuestions);
        return updated;
      });

      // Save questions to Firebase in the background
      Promise.all([
        saveQuestionsToFirebase(email.id, allQuestions),
        saveExtractedQuestionsToFirebase(email.id, allQuestions)
      ]).catch(error => {
        console.error('Error saving questions to Firebase:', error);
      });

      // Update the email object with the questions
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? { ...e, questions: allQuestions }
          : e
      ));

      // Save to cache in the background
      const updatedQuestions = new Map(emailQuestions);
      updatedQuestions.set(email.id, allQuestions);
      saveToCache(CACHE_KEYS.QUESTIONS, Object.fromEntries(updatedQuestions));

      // Only show success toasts for single email operations
      const isBatchOperation = analyzingEmails.size > 1;
      if (!isBatchOperation) {
        if (matchedFAQs.length > 0) {
          toast.success(`Found ${matchedFAQs.length} matching FAQ${matchedFAQs.length > 1 ? 's' : ''}`);
        }
        if (newQuestions.length > 0) {
          toast.success(`Extracted ${newQuestions.length} new question${newQuestions.length > 1 ? 's' : ''}`);
        }
      }
    } catch (error) {
      console.error('Error creating FAQ:', error);
      // Only show error toast for single email operations
      const isBatchOperation = analyzingEmails.size > 1;
      if (!isBatchOperation) {
        toast.error('Failed to extract questions');
      }
    } finally {
      // Remove this email from loading state
      setAnalyzingEmails(prev => {
        const updated = new Set(prev);
        updated.delete(email.id);
        return updated;
      });
    }
  };

  // Update the generateContextualReply function to check for existing replies
  const generateContextualReply = async (email: ExtendedEmail) => {
    try {
      // Check if we already have a reply in Firebase
      const db = getFirebaseDB();
      if (db) {
        const replyRef = doc(db, 'email_replies', email.id);
        const replyDoc = await getDoc(replyRef);
        if (replyDoc.exists()) {
          const data = replyDoc.data();
          if (data.reply) {
            // Update email with cached reply
            setEmails(prev => prev.map(e =>
              e.id === email.id
                ? { ...e, suggestedReply: data.reply, isGeneratingReply: false }
                : e
            ));
            return;
          }
        }
      }

      // Set loading state
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? { ...e, isGeneratingReply: true, gmailError: undefined }
          : e
      ));

      const response = await fetch('/api/knowledge/generate-reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailId: email.id,
          subject: email.subject,
          content: email.content,
          matchedFAQ: email.matchedFAQ,
          questions: emailQuestions.get(email.id) || [],
          answeredFAQs: answeredFAQs.filter(faq => {
            const emailQuestionsList = emailQuestions.get(email.id) || [];
            return emailQuestionsList.some(q =>
              calculatePatternSimilarity(q.question, faq.question) > SIMILARITY_THRESHOLD
            );
          })
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate reply');
      }

      const data = await response.json();

      // Update email with generated reply and cache it
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? { ...e, suggestedReply: data.reply, isGeneratingReply: false }
          : e
      ));

      // Cache the reply in Firebase
      if (db) {
        const replyRef = doc(db, 'email_replies', email.id);
        await setDoc(replyRef, {
          reply: data.reply,
          timestamp: Date.now()
        });

        // Also update ready_to_reply collection
        const readyRef = doc(db, 'ready_to_reply', 'latest');
        const readyDoc = await getDoc(readyRef);
        if (readyDoc.exists()) {
          const readyEmails = readyDoc.data().emails || [];
          const updatedReadyEmails = readyEmails.filter((e: any) => e.id !== email.id);
          updatedReadyEmails.push({
            id: email.id,
            threadId: email.threadId,
            subject: email.subject,
            sender: email.sender,
            content: email.content,
            receivedAt: email.receivedAt,
            suggestedReply: data.reply,
            matchedFAQ: email.matchedFAQ,
            status: 'processed'
          });
          await setDoc(readyRef, {
            emails: updatedReadyEmails,
            timestamp: Date.now()
          });
        }
      }

    } catch (error) {
      console.error('Error generating reply:', error);
      toast.error('Failed to generate contextual reply');
      // Reset loading state on error
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? { ...e, isGeneratingReply: false }
          : e
      ));
    }
  };

  const handleEditReply = (email: ExtendedEmail) => {
    const reply = email.suggestedReply || generateDefaultReply(email);

    // Remove the subject line and any extra newlines after it
    const contentWithoutSubject = reply.replace(/^Subject:.*?\n+/m, '');

    // Convert line breaks to proper HTML paragraphs
    const formattedReply = contentWithoutSubject
      .split('\n\n')  // Split on double line breaks first
      .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)  // Handle single line breaks
      .join('');

    setEditingReply({
      emailId: email.id,
      reply: formattedReply
    });
  };

  const handleSaveReply = async (emailId: string) => {
    if (!editingReply) return;

    try {
      const response = await fetch('/api/emails/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailId,
          reply: editingReply.reply,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send email');
      }

      // Update local state
      setEmails(prev => prev.map(e => {
        if (e.id === emailId) {
          return { ...e, isReplied: true };
        }
        return e;
      }));

      toast.success('Email sent successfully');
      setEditingReply(null);
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error('Failed to send email');
    }
  };

  const generateDefaultReply = (email: ExtendedEmail) => {
    // Extract name more carefully
    const fullSender = email.sender;
    let senderName = '';

    if (fullSender.includes('<')) {
      // If format is "Name <email@domain.com>"
      senderName = fullSender.split('<')[0].trim();
    } else if (fullSender.includes('@')) {
      // If just email, use part before @
      senderName = fullSender.split('@')[0];
    } else {
      // Fallback to full sender
      senderName = fullSender;
    }

    // Capitalize first letter of each word in name
    senderName = senderName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    const question = email.matchedFAQ?.question?.replace('{email}', email.sender) || '';
    const answer = email.matchedFAQ?.answer || '';

    return `Dear ${senderName},

Thank you for your email regarding ${question}.

${answer}

Best regards,
Support Team`;
  };

  const toggleEmailContent = useCallback((emailId: string) => {
    setEmails(prev => prev.map(e =>
      e.id === emailId
        ? { ...e, showFullContent: !e.showFullContent }
        : e
    ));
  }, []);

  const toggleThreadExpansion = (threadId: string) => {
    setExpandedThreads(prev => {
      const newSet = new Set(prev);
      if (newSet.has(threadId)) {
        newSet.delete(threadId);
      } else {
        newSet.add(threadId);
      }
      return newSet;
    });
  };

  // Add this effect at the top level with other effects
  useEffect(() => {
    // Check all emails with questions for completion
    const updatedEmails = emails.map(email => {
      const questions = emailQuestions.get(email.id) || [];
      if (questions.length === 0) return email;

      const answeredQuestions = questions.filter(q =>
        answeredFAQs.some(faq =>
          faq.answer &&
          faq.answer.trim() !== '' &&
          calculatePatternSimilarity(faq.question, q.question) > SIMILARITY_THRESHOLD
        )
      );

      const progress = questions.length > 0 ? (answeredQuestions.length / questions.length) * 100 : 0;
      const isComplete = progress === 100;

      if (isComplete && !email.matchedFAQ && !email.isReplied && !email.isNotRelevant) {
        const bestMatch = answeredQuestions.reduce((best, current) => {
          const matchedFAQ = answeredFAQs.find(faq =>
            calculatePatternSimilarity(faq.question, current.question) > SIMILARITY_THRESHOLD
          );
          if (!matchedFAQ) return best;
          if (!best || matchedFAQ.confidence > (best.confidence || 0)) return matchedFAQ;
          return best;
        }, null as AnsweredFAQ | null);

        if (bestMatch) {
          return {
            ...email,
            matchedFAQ: {
              question: bestMatch.question,
              answer: bestMatch.answer,
              confidence: bestMatch.confidence
            },
            status: 'processed' as const
          };
        }
      }
      return email;
    });

    // Only update if there are changes
    if (JSON.stringify(updatedEmails) !== JSON.stringify(emails)) {
      setEmails(updatedEmails);
    }
  }, [emails, emailQuestions, answeredFAQs, calculatePatternSimilarity]);

  const handleEmailExpand = (emailId: string, expanded: boolean) => {
    setExpandedEmails(prev => {
      const next = new Set(prev);
      if (expanded) {
        next.add(emailId);
      } else {
        next.delete(emailId);
      }
      return next;
    });
  };

  const renderEmailContent = (email: ExtendedEmail) => {
    const isLoading = loadingContent.has(email.id);

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 hover:shadow-sm transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {new Date(email.receivedAt).toLocaleString()}
            <button
              onClick={() => refreshSingleEmail(email)}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-50 rounded-full"
              title="Refresh email content"
              disabled={loadingContent.has(email.id)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingContent.has(email.id) ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <EmailRenderNew
          content={email.content}
          showDebugInfo={true}
          className="email-content"
          isLoading={isLoading}
        />
      </div>
    );
  };

  const renderTabs = () => {
    const readyToReplyCount = emails.filter(e =>
      e.status === 'processed' &&
      e.matchedFAQ &&
      !e.isReplied &&
      e.suggestedReply
    ).length;

    const tabData = [
      {
        id: 'unanswered',
        label: 'Unanswered',
        mobileLabel: 'New',
        icon: MessageCircleIcon,
        count: emails.filter(e => !e.isReplied && !e.isNotRelevant && !e.matchedFAQ).length,
        description: 'Match FAQs to incoming customer emails'
      },
      {
        id: 'suggested',
        label: 'Ready to Reply',
        mobileLabel: 'Ready',
        icon: CheckCircleIcon,
        count: readyToReplyCount,
        description: 'Review and send auto-generated responses'
      },
      {
        id: 'faq_library',
        label: 'FAQ Library',
        mobileLabel: 'FAQs',
        icon: BookOpenIcon,
        count: answeredFAQs.filter(faq => faq.answer).length,
        description: 'Manage and update your FAQ knowledge base'
      },
      {
        id: 'not_relevant',
        label: 'Not Relevant',
        mobileLabel: 'Other',
        icon: XCircleIcon,
        count: emails.filter(e => e.isNotRelevant).length,
        description: 'View emails marked as not requiring FAQ matching'
      }
    ];

    return (
      <div className="mb-3 sm:mb-5">
        <nav className="flex flex-col bg-white rounded-lg shadow-sm" aria-label="Tabs">
          {/* First row: Icons and Labels */}
          <div className="flex flex-wrap sm:flex-nowrap justify-between w-full border-b border-gray-200">
            {tabData.map(({ id, label, mobileLabel, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as any)}
                className={`
                  relative flex-1 flex flex-col items-center py-3 px-2 min-w-[120px] sm:min-w-0
                  text-xs sm:text-sm font-medium hover:bg-gray-50 focus:z-10
                  ${activeTab === id ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}
                  transition-all duration-200 ease-in-out group
                `}
              >
                <div className="flex items-center justify-center w-full mb-1">
                  <Icon className={`
                    h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 transition-transform duration-200
                    ${activeTab === id ? 'scale-110' : 'group-hover:scale-105'}
                  `} />
                  <span className="hidden sm:inline ml-2">{label}</span>
                  <span className="sm:hidden ml-1">{mobileLabel}</span>
                  {count > 0 && (
                    <span className={`
                      ml-1 sm:ml-2 rounded-full px-1.5 py-0.5 text-xs font-medium
                      transition-colors duration-200
                      ${activeTab === id ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 group-hover:bg-gray-200'}
                    `}>
                      {count}
                    </span>
                  )}
                </div>
                {activeTab === id && (
                  <div className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-500"></div>
                )}
              </button>
            ))}
          </div>

          {/* Second row: Descriptions */}
          <div className="hidden sm:flex justify-between w-full py-1.5 bg-gray-50 rounded-b-lg">
            {tabData.map(({ id, description }) => (
              <div
                key={id}
                className={`
                  flex-1 px-2 text-center transition-colors duration-200
                  ${activeTab === id ? 'text-gray-700' : 'text-gray-500'}
                `}
              >
                <span className="text-[10px] font-medium leading-none">{description}</span>
              </div>
            ))}
          </div>
          {/* Mobile description tooltip */}
          <div className="block sm:hidden mt-1 pb-1.5 bg-gray-50 border-t border-gray-100">
            {tabData.map(({ id, description }) => (
              activeTab === id && (
                <div key={id} className="text-center px-4 py-1.5">
                  <span className="text-[10px] text-gray-600">{description}</span>
                </div>
              )
            ))}
          </div>
        </nav>
      </div>
    );
  };

  const shouldShowDate = (currentEmail: ExtendedEmail, index: number, emails: ExtendedEmail[]) => {
    if (index === 0) return true;

    const currentDate = new Date(currentEmail.receivedAt);
    const prevEmail = emails[index - 1];
    const prevDate = new Date(prevEmail.receivedAt);

    return currentDate.toDateString() !== prevDate.toDateString();
  };

  const renderEmailTimeline = (email: ExtendedEmail, index: number, allEmails: ExtendedEmail[]) => {
    const date = new Date(email.receivedAt);
    const formattedTime = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const formattedDate = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });

    const showDate = shouldShowDate(email, index, allEmails);

    return (
      <div className="absolute -left-[4.5rem] flex items-start h-6" style={{ top: '1.5rem' }}>
        <div className="flex flex-col items-end" style={{ marginTop: !showDate ? '12px' : '0px' }}>
          {showDate && (
            <div className="text-sm font-medium text-gray-600 mb-0.5">{formattedDate}</div>
          )}
          <div className="text-xs text-gray-500">{formattedTime}</div>
        </div>
      </div>
    );
  };

  const renderUnansweredEmails = () => {
    const filteredEmails = emails.filter(email =>
      !email.isReplied &&
      email.status !== 'not_relevant' &&
      (!email.matchedFAQ || !(email.id && ((emailQuestions.get(email.id)?.length ?? 0) > 0))) &&
      email.status !== 'processed'
    );

    if (filteredEmails.length === 0) {
      return (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
            <InboxIcon className="h-12 w-12" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No unanswered emails</h3>
          <p className="mt-2 text-sm text-gray-500">
            All emails have been processed or marked as not relevant
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-8 relative pl-[4.5rem]">
        {filteredEmails.map((email, index) => {
          const questions = emailQuestions.get(email.id) || [];
          const hasQuestions = questions.length > 0;
          const isAnalyzing = analyzingEmails.has(email.id);

          return (
            <div
              key={email.id}
              className="bg-white rounded-lg shadow-sm pt-4 pb-6 px-6 space-y-4 relative"
              style={{ marginBottom: '2rem' }}
            >
              {renderEmailTimeline(email, index, filteredEmails)}
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <h3 className="text-lg font-medium text-gray-900">
                    {email.subject}
                  </h3>
                  <div className="text-sm text-gray-500">
                    From: {email.sender}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleMarkNotRelevant(email)}
                    className="flex-shrink-0 inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    ❌ Not Relevant
                  </button>
                </div>
              </div>

              {/* Email Content with Thread Support */}
              {renderEmailContent(email)}

              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-gray-900">Questions:</h4>
                  {!isAnalyzing && (
                    <div className="flex items-center gap-2">
                      {hasQuestions ? (
                        <button
                          onClick={() => handleCreateFAQ(email)}
                          className="inline-flex items-center p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-colors"
                          title="Re-analyze email"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleCreateFAQ(email)}
                          disabled={isAnalyzing}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isAnalyzing ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <LightbulbIcon className="h-3 w-3 mr-1.5" />
                              Extract Questions
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Show loading state or questions */}
                {isAnalyzing ? (
                  <div className="flex items-center justify-center py-4">
                    <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                ) : hasQuestions ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {questions.map((question, index) => {
                      const matchedFAQ = answeredFAQs.find(faq =>
                        faq.answer &&
                        faq.answer.trim() !== '' &&
                        calculatePatternSimilarity(faq.question, question.question) > SIMILARITY_THRESHOLD
                      );
                      const isAnswered = !!matchedFAQ;
                      return (
                        <button
                          key={index}
                          onClick={() => handleAddToFAQLibrary(question)}
                          className={`
                            group relative inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                            transition-all duration-200 hover:shadow-md
                            ${isAnswered
                              ? 'bg-green-100 text-green-800 hover:bg-green-200 border border-green-200'
                              : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'}
                          `}
                        >
                          {isAnswered ? (
                            <CheckCircleIcon className="h-3 w-3 mr-1" />
                          ) : (
                            <PencilIcon className="h-3 w-3 mr-1" />
                          )}
                          {truncateQuestion(question.question)}
                          {isAnswered && (
                            <div className="absolute -top-1 -right-1 h-3 w-3 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
                              <CheckCircleIcon className="h-2 w-2 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 py-2">
                    No questions extracted yet
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Load More Button */}
        {hasMore && !loadingMore && (
          <div className="flex justify-center mt-8">
            <button
              onClick={() => loadEmails(false, page + 1)}
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              {loadingMore ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Loading...
                </>
              ) : (
                'Load 5 More'
              )}
            </button>
          </div>
        )}

        {/* Loading More Indicator */}
        {loadingMore && (
          <div className="flex justify-center mt-8">
            <div className="animate-pulse flex space-x-4">
              <div className="h-4 w-24 bg-gray-200 rounded"></div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSuggestedReplies = () => {
    const readyEmails = emails.filter(email =>
      email.status === 'processed' &&
      email.matchedFAQ &&
      !email.isReplied &&
      email.suggestedReply
    );

    if (readyEmails.length === 0) {
      return (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
            <CheckCircleIcon className="h-12 w-12" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No emails ready for reply</h3>
          <p className="mt-2 text-sm text-gray-500">
            Process some emails from the Unanswered tab to generate replies
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-8 relative pl-[4.5rem]">
        {readyEmails.map((email, index) => (
          <div
            key={email.id}
            className="bg-white rounded-lg shadow-sm pt-4 pb-6 px-6 space-y-4 relative"
          >
            {renderEmailTimeline(email, index, readyEmails)}
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <h3 className="text-lg font-medium text-gray-900">
                  {email.subject}
                </h3>
                <div className="text-sm text-gray-500">
                  From: {email.sender}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAutoReply(email)}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Send Auto-Reply
                </button>
                <button
                  onClick={() => handleEditReply(email)}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Edit Reply
                </button>
              </div>
            </div>

            {/* Email Content */}
            {renderEmailContent(email)}

            {/* Matched FAQ and Reply */}
            <div className="mt-4 space-y-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">Matched FAQ</h4>
                <div className="text-sm text-blue-800">
                  <p className="font-medium">Q: {email.matchedFAQ?.question}</p>
                  <p className="mt-1">A: {email.matchedFAQ?.answer}</p>
                  {email.matchedFAQ?.confidence && (
                    <p className="mt-2 text-xs text-blue-600">
                      Confidence: {Math.round(email.matchedFAQ.confidence * 100)}%
                    </p>
                  )}
                </div>
              </div>

              {/* Updated AI Generated Reply section */}
              <div className="bg-indigo-50 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <SparklesIcon className="h-4 w-4 text-indigo-600" />
                    <h4 className="text-sm font-medium text-indigo-600">AI Generated Reply</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditReply(email)}
                      className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => generateContextualReply(email)}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                        disabled={email.isGeneratingReply}
                        title="Regenerate AI response"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${email.isGeneratingReply ? 'animate-spin' : ''}`}
                        />
                      </button>
                      <div className="absolute invisible group-hover:visible bg-gray-900 text-white text-xs rounded py-1 px-2 -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                        Regenerate AI response
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-sm text-indigo-900 whitespace-pre-wrap">
                  {email.suggestedReply}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderFAQLibrary = () => {
    if (loadingFAQs) {
      return (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4 animate-spin">
            <SparklesIcon className="h-12 w-12" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">Loading FAQ Library...</h3>
        </div>
      );
    }

    if (answeredFAQs.length === 0) {
      return (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
            <BookOpenIcon className="h-12 w-12" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">FAQ Library is Empty</h3>
          <p className="mt-2 text-sm text-gray-500">
            Process emails to start building your FAQ library
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {answeredFAQs.map((faq, index) => (
          <div
            key={index}
            className="bg-white rounded-lg shadow-sm p-6 space-y-4"
          >
            <div className="flex justify-between items-start">
              <div className="space-y-1 flex-1">
                <h3 className="text-lg font-medium text-gray-900">
                  Q: {faq.question}
                </h3>
                <div className="text-sm text-gray-500">
                  Category: {faq.category || 'General'}
                  {faq.confidence && (
                    <span className="ml-2">
                      • Confidence: {Math.round(faq.confidence * 100)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEditLibraryFAQ(faq)}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  <PencilIcon className="h-4 w-4 mr-1" />
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteFAQ(faq)}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-red-700 bg-white hover:bg-red-50"
                >
                  <TrashIcon className="h-4 w-4 mr-1" />
                  Delete
                </button>
              </div>
            </div>

            <div className="prose prose-sm max-w-none">
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-900 mb-2">Answer</h4>
                <div className="text-sm text-gray-700 whitespace-pre-wrap">
                  {faq.answer}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderNotRelevantEmails = () => {
    const notRelevantEmails = emails.filter(email => email.status === 'not_relevant');

    if (notRelevantEmails.length === 0) {
      return (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
            <XCircleIcon className="h-12 w-12" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No Not-Relevant Emails</h3>
          <p className="mt-2 text-sm text-gray-500">
            Emails marked as not relevant will appear here
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-8 relative pl-[4.5rem]">
        {notRelevantEmails.map((email, index) => (
          <div
            key={email.id}
            className="bg-white rounded-lg shadow-sm pt-4 pb-6 px-6 space-y-4 relative"
          >
            {renderEmailTimeline(email, index, notRelevantEmails)}
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <h3 className="text-lg font-medium text-gray-900">
                  {email.subject}
                </h3>
                <div className="text-sm text-gray-500">
                  From: {email.sender}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleUndoNotRelevant(email)}
                  disabled={processingUndoNotRelevant.has(email.id)}
                  className={`inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 ${processingUndoNotRelevant.has(email.id)
                    ? 'bg-gray-100 cursor-not-allowed'
                    : 'bg-white hover:bg-gray-50'
                    }`}
                >
                  {processingUndoNotRelevant.has(email.id) ? (
                    <span className="inline-flex items-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    'Undo'
                  )}
                </button>
              </div>
            </div>

            {renderEmailContent(email)}

            {email.irrelevanceReason && (
              <div className="mt-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Reason for Not Relevant</h4>
                  <div className="text-sm text-gray-700">
                    {email.irrelevanceReason}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderAllEmails = () => {
    // Implement all emails rendering logic
    return <div>All Emails</div>;
  };

  const renderMainContent = () => {
    switch (activeTab) {
      case 'unanswered':
        return renderUnansweredEmails();
      case 'suggested':
        return renderSuggestedReplies();
      case 'faq_library':
        return renderFAQLibrary();
      case 'not_relevant':
        return renderNotRelevantEmails();
      case 'all':
        return renderAllEmails();
      default:
        return null;
    }
  };

  const renderAnswerModal = () => (
    <Transition.Root show={showAnswerModal} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={setShowAnswerModal}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl sm:p-6">
                <div className="absolute right-0 top-0 hidden pr-4 pt-4 sm:block">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    onClick={() => setShowAnswerModal(false)}
                  >
                    <span className="sr-only">Close</span>
                    <XCircleIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>
                <div className="mb-6">
                  <label className="flex items-center text-lg font-medium text-gray-900 mb-2">
                    ❓ Question
                  </label>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <p className="text-gray-800">{selectedFAQ?.question}</p>
                  </div>
                </div>

                <div>
                  <label htmlFor="answer" className="flex items-center text-lg font-medium text-gray-900 mb-3">
                    🙏 Answer
                  </label>
                  <textarea
                    id="answer"
                    rows={8}
                    className="w-full rounded-lg border-2 border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 px-4 py-3 text-gray-900"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Write a detailed answer that will help future similar questions..."
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    💡 Feel free to use bullet points or any format that makes the answer clear and helpful
                  </p>
                </div>

                <div className="bg-yellow-50 rounded-lg p-6 mt-6">
                  <h4 className="text-sm font-medium text-yellow-800 mb-2">AI Learning Note</h4>
                  <p className="text-sm text-yellow-700">
                    This FAQ pattern will help the AI identify and respond to similar questions in the future.
                    The more generic and well-defined the pattern, the better the AI can match it to new emails.
                  </p>
                </div>

                <div className="mt-8 flex justify-end gap-4">
                  <button
                    type="button"
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                    onClick={() => setShowAnswerModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-lg hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                    onClick={handleSaveFAQ}
                  >
                    Save FAQ Pattern
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );

  const renderEditReplyModal = () => {
    if (!editingReply) return null;

    return (
      <Transition.Root show={!!editingReply} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setEditingReply(null)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          </Transition.Child>

          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl">
                  <div className="absolute right-4 top-4">
                    <button
                      type="button"
                      className="text-gray-400 hover:text-gray-500"
                      onClick={() => setEditingReply(null)}
                    >
                      <span className="sr-only">Close</span>
                      <XIcon className="h-6 w-6" />
                    </button>
                  </div>

                  <div className="p-6">
                    {/* Remove blue background, make it cleaner */}
                    <Dialog.Title className="text-xl font-semibold text-gray-900 mb-6">
                      Edit AI-Generated Response
                    </Dialog.Title>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <label className="block text-sm font-medium text-gray-700">
                          To:
                        </label>
                        <input
                          type="email"
                          className="flex-1 text-sm text-gray-900 bg-gray-50 rounded-md px-3 py-1.5 border border-gray-200"
                          value={extractEmailAddress(emails.find(e => e.id === editingReply.emailId)?.sender || '')}
                          onChange={(e) => {
                            const email = emails.find(em => em.id === editingReply.emailId);
                            if (email) {
                              setEmails(prev => prev.map(em =>
                                em.id === email.id ? { ...em, sender: e.target.value } : em
                              ));
                            }
                          }}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Message
                        </label>
                        <Editor
                          apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
                          value={editingReply.reply}
                          onEditorChange={(content) =>
                            setEditingReply({ ...editingReply, reply: content })
                          }
                          init={{
                            height: 400,
                            menubar: false,
                            statusbar: false,
                            plugins: [
                              'link', 'lists', 'emoticons', 'image'
                            ],
                            toolbar: 'undo redo | bold italic underline | alignleft aligncenter alignright | bullist numlist outdent indent | link image | emoticons',
                            content_style: `
                              body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                                font-size: 14px;
                                line-height: 1.6;
                                color: #333;
                                margin: 1rem;
                                padding: 0;
                              }
                              p {
                                margin: 0 0 1rem 0;
                                padding: 0;
                              }
                              .emoji {
                                font-size: 1.2em;
                                vertical-align: middle;
                              }
                            `,
                            formats: {
                              p: { block: 'p', styles: { margin: '0 0 1rem 0' } }
                            },
                            forced_root_block: 'p',
                            convert_newlines_to_brs: false,
                            remove_trailing_brs: false,
                            paste_as_text: false,
                            paste_enable_default_filters: true,
                            paste_word_valid_elements: "p,b,strong,i,em,h1,h2,h3,h4,h5,h6,br",
                            paste_retain_style_properties: "none",
                            paste_merge_formats: true,
                            paste_convert_word_fake_lists: true,
                            entity_encoding: 'raw',
                            indent_use_margin: true,
                            visual_table_class: 'border-1',
                            verify_html: false,
                            // Add these to better handle whitespace and formatting
                            whitespace_elements: 'pre,textarea',
                            element_format: 'html',
                            keep_styles: true,
                            valid_elements: '*[*]'  // Allow all elements and attributes
                          }}
                        />
                      </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        type="button"
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        onClick={() => setEditingReply(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 inline-flex items-center gap-2"
                        onClick={() => handleSaveReply(editingReply.emailId)}
                      >
                        <span>Send Reply</span>
                        <Rocket className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>
    );
  };

  // Add function to load ready to reply emails from Firebase
  const loadReadyToReplyFromFirebase = async () => {
    try {
      const db = getFirebaseDB();
      if (!db) return null;

      const readyRef = doc(db, FIREBASE_COLLECTIONS.READY_TO_REPLY, 'latest');
      const readyDoc = await getDoc(readyRef);

      if (readyDoc.exists()) {
        const data = readyDoc.data();
        return data.emails || [];
      }
      return null;
    } catch (error) {
      console.error('Error loading ready to reply emails from Firebase:', error);
      return null;
    }
  };

  // Add function to save ready to reply emails to Firebase
  const saveReadyToReplyToFirebase = async (emails: ExtendedEmail[]) => {
    try {
      const db = getFirebaseDB();
      if (!db) return;

      const readyRef = doc(db, FIREBASE_COLLECTIONS.READY_TO_REPLY, 'latest');
      await setDoc(readyRef, {
        emails,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error saving ready to reply emails to Firebase:', error);
    }
  };

  // Add function to refresh a single email
  const refreshSingleEmail = async (email: ExtendedEmail) => {
    try {
      if (!user?.accessToken) {
        throw new Error('No access token available');
      }

      setLoadingContent(prev => new Set([...prev, email.id]));

      // Fetch directly from Gmail API with auth token
      const response = await fetch('/api/emails/refresh-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          threadId: email.threadId
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to refresh email');
      }

      const data = await response.json();
      console.log('Refresh response:', data);

      // Create a new email object to force re-render
      const updatedEmail = {
        ...email,
        content: data.content || '',
        sortTimestamp: new Date(data.receivedAt).getTime()
      };

      // Update email content in state with new object reference
      setEmails(prev => {
        const updated = prev.map(e => e.id === email.id ? updatedEmail : e);
        console.log('Updated email content:', {
          id: email.id,
          oldContent: email.content,
          newContent: updatedEmail.content,
          contentLength: (updatedEmail.content || '').length
        });
        return updated;
      });

      // Save to Firebase for persistence
      const firebaseDB = getFirebaseDB();
      if (firebaseDB) {
        const emailContentRef = doc(firebaseDB, 'email_content', email.id);
        await setDoc(emailContentRef, {
          content: data.content || '',
          timestamp: Date.now()
        });
      }

      // Force a re-render by updating the state again with the same content
      setTimeout(() => {
        setEmails(prev => [...prev]);
      }, 100);

    } catch (error) {
      console.error('Error refreshing email:', error);
    } finally {
      setLoadingContent(prev => {
        const next = new Set(prev);
        next.delete(email.id);
        return next;
      });
    }
  };

  // Add function to process email batch
  const processEmailBatch = async (emails: ExtendedEmail[]) => {
    try {
      let totalMatchedFAQs = 0;
      let totalNewQuestions = 0;
      let processedEmails = 0;

      // Process each email in the batch
      await Promise.all(emails.map(async (email) => {
        // Check if email is already processed
        const isProcessed = email.status === 'processed' || email.isNotRelevant;
        if (isProcessed) return;

        // Check if email is marked as not relevant
        const notRelevant = await isEmailMarkedNotRelevant(email.id);
        if (notRelevant) {
          setEmails(prev => prev.map(e =>
            e.id === email.id ? { ...e, isNotRelevant: true } : e
          ));
          return;
        }

        // Try to extract questions if none exist
        const existingQuestions = emailQuestions.get(email.id);
        if (!existingQuestions || existingQuestions.length === 0) {
          await handleCreateFAQ(email);
          // Get the updated questions after processing
          const updatedQuestions = emailQuestions.get(email.id) || [];
          const matched = updatedQuestions.filter(q => 'faqId' in q && q.faqId !== undefined).length;
          const newOnes = updatedQuestions.filter(q => !('faqId' in q) || q.faqId === undefined).length;
          totalMatchedFAQs += matched;
          totalNewQuestions += newOnes;
          processedEmails++;
        }
      }));

      // Show summary toast for batch operations if any emails were processed
      if (processedEmails > 0) {
        const summaryParts = [];
        if (totalMatchedFAQs > 0) {
          summaryParts.push(`${totalMatchedFAQs} matching FAQ${totalMatchedFAQs !== 1 ? 's' : ''}`);
        }
        if (totalNewQuestions > 0) {
          summaryParts.push(`${totalNewQuestions} new question${totalNewQuestions !== 1 ? 's' : ''}`);
        }
        if (summaryParts.length > 0) {
          toast.success(`Found ${summaryParts.join(' and ')} in ${processedEmails} email${processedEmails !== 1 ? 's' : ''}`);
        }
      }
    } catch (error) {
      console.error('Error processing email batch:', error);
      toast.error('Error processing some emails');
    }
  };

  // Add the handleRefresh function
  const handleRefresh = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);

      // Get the access token from the user object
      if (!user?.accessToken) {
        throw new Error('No access token available');
      }

      // Get all unique thread IDs from existing emails
      const threadIds = Array.from(new Set(emails
        .filter(email => email.threadId) // Only include emails with threadId
        .map(email => email.threadId as string)
      ));

      const response = await fetch('/api/emails/refresh-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          lastFetchTimestamp,
          nextPageToken,
          threadIds // Add the thread IDs to the request
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh emails: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const refreshedEmails = data.refreshedEmails || [];

      if (refreshedEmails.length > 0) {
        // Update state with new emails
        setEmails((prevEmails) => {
          const newEmails = [...prevEmails];
          refreshedEmails.forEach((email: ExtendedEmail) => {
            const index = newEmails.findIndex((e) => e.id === email.id);
            if (index === -1) {
              newEmails.push(email);
            } else {
              newEmails[index] = email;
            }
          });
          return newEmails;
        });

        // Process the new emails
        await processEmailBatch(refreshedEmails);
      }

      setNextPageToken(data.nextPageToken || null);
      setTotalEmails(data.totalEmails || 0);
      setLastFetchTimestamp(Date.now());
      setHasRefreshedOnce(true);

    } catch (error) {
      console.error('Error refreshing emails:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to refresh emails');

      if (error instanceof Error && error.message === 'No access token available') {
        toast.error('Please sign in again to refresh emails');
        return;
      }

      toast.error('Failed to refresh emails. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Add this function near the other handlers
  const handleUndoNotRelevant = async (email: ExtendedEmail) => {
    try {
      // Add email ID to processing set
      setProcessingUndoNotRelevant(prev => new Set(prev).add(email.id));

      // Optimistically update UI state
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: false,
            status: 'pending',
            irrelevanceReason: undefined,
            irrelevanceCategory: undefined,
            irrelevanceConfidence: undefined,
            irrelevanceDetails: undefined
          }
          : e
      ));

      // Update cache with the new state
      const cachedData = loadFromCache(CACHE_KEYS.ANSWERED_FAQS) || {};
      const updatedEmails = (cachedData.emails || []).map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: false,
            status: 'pending',
            irrelevanceReason: undefined,
            irrelevanceCategory: undefined,
            irrelevanceConfidence: undefined,
            irrelevanceDetails: undefined
          }
          : e
      );
      saveToCache(CACHE_KEYS.ANSWERED_FAQS, {
        ...cachedData,
        emails: updatedEmails,
        timestamp: Date.now()
      });

      // Update Firebase
      const db = getFirebaseDB();
      if (!db) throw new Error('Firebase DB not initialized');

      // Update the email in email_cache collection
      const emailRef = doc(db, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
      await setDoc(emailRef, {
        isNotRelevant: false,
        status: 'pending',
        irrelevanceReason: null,
        irrelevanceCategory: null,
        irrelevanceConfidence: null,
        irrelevanceDetails: null,
        markedNotRelevantAt: null
      }, { merge: true });

      toast.success('Email restored to processing queue');
    } catch (error) {
      console.error('Error undoing not relevant status:', error);

      // Revert optimistic updates on error
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: true,
            status: 'not_relevant'
          }
          : e
      ));

      // Revert cache on error
      const cachedData = loadFromCache(CACHE_KEYS.ANSWERED_FAQS) || {};
      const revertedEmails = (cachedData.emails || []).map(e =>
        e.id === email.id
          ? {
            ...e,
            isNotRelevant: true,
            status: 'not_relevant'
          }
          : e
      );
      saveToCache(CACHE_KEYS.ANSWERED_FAQS, {
        ...cachedData,
        emails: revertedEmails,
        timestamp: Date.now()
      });

      toast.error('Failed to restore email');
    } finally {
      // Remove email ID from processing set
      setProcessingUndoNotRelevant(prev => {
        const next = new Set(prev);
        next.delete(email.id);
        return next;
      });
    }
  };

  // Add function to check for new emails
  const checkForNewEmails = async () => {
    try {
      if (!user?.accessToken) return;

      // Get the most recent email's timestamp
      const mostRecentEmail = emails[0]; // Assuming emails are sorted by date
      const lastEmailTimestamp = mostRecentEmail ? new Date(mostRecentEmail.receivedAt).getTime() : 0;

      const response = await fetch('/api/emails/check-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          lastEmailTimestamp,
          existingThreadIds: emails.map(e => e.threadId).filter(Boolean)
        }),
      });

      if (!response.ok) return;

      const data = await response.json();
      setNewEmailsCount(data.newEmailsCount || 0);
      // Store the new thread IDs when we find them
      if (data.newThreadIds) {
        setNewThreadIds(data.newThreadIds);
      }
    } catch (error) {
      console.error('Error checking for new emails:', error);
    }
  };

  // Add effect to check for new emails periodically
  useEffect(() => {
    if (!user?.accessToken) return;

    // Check immediately on mount
    checkForNewEmails();

    // Then check every minute
    const interval = setInterval(checkForNewEmails, 60000);

    return () => clearInterval(interval);
  }, [user?.accessToken, emails]);

  // Update the header section to use the new function
  const renderHeader = () => (
    <div className="flex items-center justify-between mb-3 sm:mb-5">
      <div>
        <h1 className="text-sm sm:text-base font-semibold text-gray-900 mb-0.5">Customer Support Triage</h1>
        <p className="text-[11px] text-gray-500 hidden sm:block">Manage and respond to customer inquiries efficiently</p>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        {newEmailsCount > 0 && (
          <button
            onClick={handleNewEmailsRefresh}
            className="inline-flex items-center px-3 py-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium transition-colors"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading...
              </>
            ) : (
              <>
                <InboxIcon className="h-4 w-4 mr-1.5" />
                {newEmailsCount} new email{newEmailsCount !== 1 ? 's' : ''} available
              </>
            )}
          </button>
        )}
        {lastFetchTimestamp > 0 && (
          <div className="text-[11px] text-gray-400 hidden sm:block">
            Last updated: {new Date(lastFetchTimestamp).toLocaleTimeString()}
          </div>
        )}
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="inline-flex items-center px-2 py-1 border border-gray-300 shadow-sm text-[11px] font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-3 w-3 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="hidden sm:inline">Refresh</span>
              <span className="sm:hidden">↻</span>
            </>
          ) : (
            <>
              <ClockIcon className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">Refresh</span>
              <span className="sm:hidden">↻</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  // Add function to handle refreshing only new emails
  const handleNewEmailsRefresh = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);

      if (!user?.accessToken || !newThreadIds.length) {
        return;
      }

      const response = await fetch('/api/emails/refresh-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          threadIds: newThreadIds // Only send the new thread IDs
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh new emails: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const refreshedEmails = data.refreshedEmails || [];

      if (refreshedEmails.length > 0) {
        // Update state with new emails
        setEmails((prevEmails) => {
          const allEmails = [...prevEmails];

          refreshedEmails.forEach((email: ExtendedEmail) => {
            // Store the email content in Firebase
            const firebaseDB = getFirebaseDB();
            if (firebaseDB) {
              const emailContentRef = doc(firebaseDB, 'email_content', email.id);
              setDoc(emailContentRef, {
                content: email.content,
                timestamp: Date.now()
              });
            }

            const index = allEmails.findIndex((e) => e.id === email.id);
            const enrichedEmail = {
              ...email,
              content: email.content || '', // Ensure content is included
              sortTimestamp: new Date(email.receivedAt).getTime()
            };

            if (index === -1) {
              allEmails.push(enrichedEmail);
            } else {
              allEmails[index] = {
                ...allEmails[index],
                ...enrichedEmail
              };
            }
          });

          // Sort emails by timestamp, newest first
          return allEmails.sort((a, b) => {
            const aTime = a.sortTimestamp || new Date(a.receivedAt).getTime();
            const bTime = b.sortTimestamp || new Date(b.receivedAt).getTime();
            return bTime - aTime;
          });
        });

        // Process the new emails in the background
        processEmailBatch(refreshedEmails).catch(error => {
          console.error('Error processing new emails:', error);
          toast.error('Some emails may need to be processed again');
        });
      }

      // Clear the new emails count and thread IDs since we've loaded them
      setNewEmailsCount(0);
      setNewThreadIds([]);
      setLastFetchTimestamp(Date.now());

    } catch (error) {
      console.error('Error refreshing new emails:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to refresh new emails');
      toast.error('Failed to refresh new emails. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="space-y-8">
        <Layout>
          <div className="w-full max-w-[95%] sm:max-w-[85%] md:max-w-[75%] lg:max-w-[58%] mx-auto px-2 sm:px-4 py-4 sm:py-8">
            <LoadingSkeleton />
          </div>
        </Layout>
      </div>
    );
  }

  if (!user?.accessToken) {
    return (
      <div className="space-y-8">
        <Layout>
          <div className="w-full max-w-[95%] sm:max-w-[85%] md:max-w-[75%] lg:max-w-[58%] mx-auto px-2 sm:px-4 py-4 sm:py-8">
            <div className="text-center py-12">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Please sign in</h3>
              <p className="text-sm text-gray-500">
                Sign in with your account to view and manage emails
              </p>
            </div>
          </div>
        </Layout>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Layout>
        <div className="w-full max-w-[95%] sm:max-w-[85%] md:max-w-[75%] lg:max-w-[58%] mx-auto px-2 sm:px-4 py-4 sm:py-8">
          {renderHeader()}
          {renderTabs()}
          <div className="mt-3 sm:mt-5 mb-4 sm:mb-8">
            {renderMainContent()}
          </div>
        </div>
        {renderAnswerModal()}
        {renderEditReplyModal()}
      </Layout>
    </div>
  );
}

