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
  MailCheckIcon,
  MailIcon,
} from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, doc, setDoc, getDoc, getDocs, query, where, deleteDoc, writeBatch } from 'firebase/firestore';
import type { Email, ExtendedEmail, EmailContent, BaseEmail } from '@/types/email';
import { GenericFAQ, IrrelevanceAnalysis } from '@/types/faq';
import { calculatePatternSimilarity } from '@/lib/utils/similarity';
import { Firestore } from 'firebase/firestore';
import DOMPurify from 'dompurify';
import EmailRenderNew from '../components/EmailRenderNew';
import dynamic from 'next/dynamic';
import { TINYMCE_CONFIG } from '@/lib/config/tinymce';
import { Editor } from '@tinymce/tinymce-react';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import SettingsModal from './components/SettingsModal';

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
const DEFAULT_SIMILARITY_THRESHOLD = 0.6; // Default threshold for question similarity matching

// Helper function to get current similarity threshold
const getSimilarityThreshold = (settings: AutoReplySettings | null) => {
  if (!settings) return DEFAULT_SIMILARITY_THRESHOLD;
  return settings.confidenceThreshold / 100 || DEFAULT_SIMILARITY_THRESHOLD;
};

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
    // If we're caching emails, create a lightweight version to save space
    if (key === CACHE_KEYS.EMAILS && Array.isArray(data)) {
      // Limit to maximum 50 emails to prevent quota issues
      const emailsToCache = data.slice(0, 50).map(email => {
        // Create a lightweight version of each email
        const { id, threadId, subject, sender, timestamp, isReplied, status, matchedFAQ } = email;
        return {
          id, threadId, subject, sender, timestamp, isReplied, status, matchedFAQ,
          // Only include the first 200 chars of content as a preview if it exists
          content: email.content ?
            (typeof email.content === 'string' ?
              email.content.substring(0, 200) :
              { html: email.content.html?.substring(0, 200) || null, text: email.content.text?.substring(0, 200) || null })
            : email.content
        };
      });

      data = emailsToCache;
    }

    const cacheData = {
      data,
      timestamp: Date.now()
    };

    // Check approximate size before trying to save
    const serialized = JSON.stringify(cacheData);
    // If data is larger than 2MB, don't save to cache
    if (serialized.length > 2 * 1024 * 1024) {
      console.warn(`Data for ${key} is too large (${Math.round(serialized.length / 1024 / 1024)}MB) to cache safely. Skipping cache.`);
      return;
    }

    localStorage.setItem(key, serialized);
  } catch (error) {
    console.error('Error saving to cache:', error);

    // Handle quota exceeded error specifically
    if (
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    ) {
      console.warn('Storage quota exceeded. Clearing cache to allow app to continue functioning.');

      // If this was for emails cache, clear that first
      if (key === CACHE_KEYS.EMAILS) {
        localStorage.removeItem(CACHE_KEYS.EMAILS);
      } else {
        // Otherwise try clearing all caches
        clearCache();
      }
    }
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

// Check if the authenticated user was the last to send a message in this thread
const isUserLastSender = (email: ExtendedEmail, user: any): boolean => {
  if (!email?.threadMessages || !email.threadMessages.length || !user?.email) return false;

  // Get the most recent message in the thread
  const lastMessage = email.threadMessages[email.threadMessages.length - 1];

  // Add more defensive checks for undefined values
  if (!lastMessage?.sender) return false;

  // Check if the sender of the last message includes the authenticated user's email
  return lastMessage.sender.toLowerCase().includes(user.email.toLowerCase());
};

// Determine if email is ready for reply (updated to check if user was NOT the last sender)
const isEmailReadyForReply = (email: ExtendedEmail, emailQuestions: Map<string, GenericFAQ[]>, user: any) => {
  const questions = email.id ? emailQuestions.get(email.id) : undefined;

  // Don't consider emails where the authenticated user was the last to reply
  const userWasLastSender = isUserLastSender(email, user);

  // If there are no questions extracted yet, the email is not ready for reply
  if (!questions || questions.length === 0) {
    return false;
  }

  // Check if all questions have answers in the FAQ library
  const allQuestionsHaveAnswers = questions.every(question =>
    question.answer && question.answer.trim() !== ''
  );

  return (
    !email.isNotRelevant &&
    !email.isReplied &&
    !userWasLastSender &&
    allQuestionsHaveAnswers
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

const saveEmailsToFirebase = async (emails: (Email | ExtendedEmail)[]) => {
  try {
    const db = getFirebaseDB();
    if (!db) return;

    // Helper function to sanitize an object by removing undefined values
    const sanitizeObject = (obj: any): any => {
      if (obj === null || obj === undefined) return null;
      if (typeof obj !== 'object') return obj;

      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
      }

      // Handle objects
      const sanitized: any = {};
      Object.entries(obj).forEach(([key, value]) => {
        // Skip undefined values
        if (value === undefined) return;
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeObject(value);
      });
      return sanitized;
    };

    let savedCount = 0;

    // Save each email individually to the email_cache collection
    for (const email of emails) {
      if (!email || !email.id) {
        console.warn('Skipping invalid email without ID');
        continue;
      }

      // First convert receivedAt if it's a number
      const normalizedEmail = {
        ...email,
        receivedAt: typeof email.receivedAt === 'number'
          ? email.receivedAt.toString()
          : email.receivedAt,
        // Add lastUpdated timestamp
        lastUpdated: Date.now()
      };

      // Then sanitize the entire object
      const sanitizedEmail = sanitizeObject(normalizedEmail);

      try {
        // Save to individual email document
        const emailRef = doc(db, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
        await setDoc(emailRef, sanitizedEmail);

        // If thread ID exists, update thread cache too
        if (email.threadId) {
          const threadRef = doc(db, FIREBASE_COLLECTIONS.THREAD_CACHE, email.threadId);
          await setDoc(threadRef, {
            emailId: email.id,
            threadId: email.threadId,
            subject: email.subject,
            sender: email.sender,
            receivedAt: email.receivedAt,
            lastUpdated: Date.now()
          }, { merge: true });
        }

        // If email has content and it's not already in the content collection, save it
        if (email.content) {
          const emailContentRef = doc(db, 'email_content', email.id);
          await setDoc(emailContentRef, {
            content: email.content,
            timestamp: Date.now()
          });
        }

        savedCount++;
      } catch (error) {
        console.error(`Error saving email ${email.id} to Firebase:`, error);
      }
    }

    console.log(`Saved ${savedCount} emails to Firebase`);
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

    // Sanitize questions to ensure no undefined values
    const sanitizedQuestions = questions.map(q => ({
      question: q.question || '',
      answer: q.answer || '',
      category: q.category || 'support',
      confidence: q.confidence || 0,
      emailIds: q.emailIds || [emailId],
      requiresCustomerSpecificInfo: !!q.requiresCustomerSpecificInfo,
      similarPatterns: q.similarPatterns || [],
      updatedAt: q.updatedAt || new Date().toISOString(),
      id: q.id || `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    }));

    const questionRef = doc(db, FIREBASE_QUESTIONS_COLLECTION, emailId);
    await setDoc(questionRef, {
      questions: sanitizedQuestions,
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

    // Sanitize questions to ensure no undefined values
    const sanitizedQuestions = questions.map(q => ({
      question: q.question || '',
      answer: q.answer || '',
      category: q.category || 'support',
      confidence: q.confidence || 0,
      emailIds: q.emailIds || [emailId],
      requiresCustomerSpecificInfo: !!q.requiresCustomerSpecificInfo,
      similarPatterns: q.similarPatterns || [],
      updatedAt: q.updatedAt || new Date().toISOString(),
      id: q.id || `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    }));

    await setDoc(docRef, {
      questions: sanitizedQuestions,
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

// Replace the existing AutoReplySettings interface with this unified one
interface AutoReplySettings {
  similarityThreshold: number;
  confidenceThreshold: number;
  emailFormatting: {
    greeting: string;
    listStyle: 'bullet' | 'numbered';
    spacing: 'compact' | 'normal' | 'spacious';
    signatureStyle: string;
    customPrompt: string;
    useHtml: boolean;
    includeSignature: boolean;
    signatureText: string;
  };
}

const DEFAULT_SETTINGS: AutoReplySettings = {
  similarityThreshold: 0.7,
  confidenceThreshold: 0.8,
  emailFormatting: {
    greeting: "Hi [Name]",
    listStyle: 'bullet',
    spacing: 'normal',
    signatureStyle: "Best,\nInterview Sidekick team",
    customPrompt: "Please keep responses friendly but professional.",
    useHtml: true,
    includeSignature: true,
    signatureText: 'Best regards,\nSupport Team'
  }
};

export default function FAQAutoReplyV2() {
  console.log('=== Component Render Start ===');
  const { user, checkGmailAccess, refreshAccessToken, loading: authLoading } = useAuth();
  const [emails, setEmails] = useState<ExtendedEmail[]>([]);
  const [potentialFAQs, setPotentialFAQs] = useState<PotentialFAQ[]>([]);
  const [genericFAQs, setGenericFAQs] = useState<GenericFAQ[]>([]);
  const [activeTab, setActiveTab] = useState<'unanswered' | 'suggested' | 'faq_library' | 'not_relevant' | 'all' | 'answered'>('unanswered');
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
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settings, setSettings] = useState<AutoReplySettings>(DEFAULT_SETTINGS);
  // Add state to track if initial data has loaded
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  // Add state to track if we should show the new emails button
  const [showNewEmailsButton, setShowNewEmailsButton] = useState(false);
  // Add state to track when new emails are being loaded
  const [loadingNewEmails, setLoadingNewEmails] = useState(false);
  // Add state for tracking manual refresh
  const [manualRefreshTriggered, setManualRefreshTriggered] = useState(false);

  // Add a ref to track emails length to avoid unnecessary effect triggers
  const emailsLengthRef = useRef(0);

  // Update the emailsLengthRef whenever emails change
  useEffect(() => {
    emailsLengthRef.current = emails.length;
  }, [emails.length]);

  // Automatically check for new emails after page load
  useEffect(() => {
    if (user && initialDataLoaded) {
      const timer = setTimeout(() => {
        // Make sure emails are loaded before checking for new ones
        if (Array.isArray(emails) && emails.length > 0) {
          autoCheckNewEmails();
        } else {
          console.log('Skipping automatic email check because emails not yet loaded');
          // Try again after another delay if needed
          const retryTimer = setTimeout(() => {
            autoCheckNewEmails();
          }, 5000);

          return () => clearTimeout(retryTimer);
        }
      }, 10000); // Increased from 5 seconds to 10 seconds after page load

      return () => clearTimeout(timer);
    }
  }, [user, initialDataLoaded, emails.length]);

  // Function to automatically check for new emails without showing toast notifications
  const autoCheckNewEmails = async () => {
    if (!user) return;

    try {
      // Check if emails array is valid and ready to use
      if (!Array.isArray(emails)) {
        console.warn('Emails not yet initialized for autoCheckNewEmails');
        return; // Exit early - we'll try again later when emails are loaded
      }

      // Get the timestamp of the most recent email we have
      let latestEmailTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000; // Default: 30 days ago

      if (emails.length > 0) {
        try {
          // Safely calculate the maximum timestamp
          const timestamps = emails
            .filter(e => e && e.receivedAt) // Filter out any invalid emails
            .map(e => {
              // Handle both string and number formats
              if (typeof e.receivedAt === 'number') return e.receivedAt;
              if (typeof e.receivedAt === 'string') {
                const parsed = new Date(e.receivedAt).getTime();
                return isNaN(parsed) ? 0 : parsed;
              }
              return 0;
            })
            .filter(timestamp => timestamp > 0); // Filter out any invalid timestamps

          if (timestamps.length > 0) {
            latestEmailTimestamp = Math.max(...timestamps);
          }
        } catch (err) {
          console.error('Error calculating latest email timestamp:', err);
          // Continue with the default timestamp
        }
      }

      // Safely extract thread IDs
      const existingThreadIds = emails
        .filter(e => e && e.threadId) // Filter out invalid entries
        .map(e => e.threadId)
        .filter(Boolean); // Filter out nulls/undefined/empty strings

      const response = await fetch('/api/emails/check-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          lastEmailTimestamp: latestEmailTimestamp,
          existingThreadIds
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to check for new emails:', errorData.error);
        return;
      }

      const data = await response.json();

      if (data.newEmailsCount > 0) {
        setNewEmailsCount(data.newEmailsCount);
        setNewThreadIds(data.newThreadIds || []);
        setShowNewEmailsButton(true);
      }
    } catch (error) {
      console.error('Error checking for new emails:', error);
    }
  };

  // Function to load new emails when the button is clicked
  const handleLoadNewEmails = async () => {
    if (newEmailsCount > 0) {
      try {
        setLoadingNewEmails(true);
        // Wait a short time to show the loading state
        await new Promise(resolve => setTimeout(resolve, 300));

        console.log("Loading new emails with thread IDs:", newThreadIds);

        if (!user?.accessToken) {
          console.error("No access token available");
          toast.error("Authentication error. Please sign in again.");
          setLoadingNewEmails(false);
          return;
        }

        // Use the refresh-batch endpoint which accepts thread IDs
        const response = await fetch('/api/emails/refresh-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.accessToken}`
          },
          body: JSON.stringify({
            threadIds: newThreadIds
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch new emails: ${response.statusText}`);
        }

        const data = await response.json();
        console.log("Fetched emails from Gmail API:", data);

        if (data.refreshedEmails && data.refreshedEmails.length > 0) {
          // Format the emails in the same structure as our existing emails
          const newEmails = data.refreshedEmails.map((email: any) => ({
            ...email,
            sortTimestamp: new Date(email.receivedAt).getTime()
          }));

          // Filter out any emails we already have
          const existingIds = new Set(emails.map(e => e.id));
          const uniqueNewEmails = newEmails.filter((e: any) => !existingIds.has(e.id));

          console.log("New unique emails found:", uniqueNewEmails.length);

          if (uniqueNewEmails.length > 0) {
            // Merge with existing emails and sort
            const mergedEmails = [...emails, ...uniqueNewEmails].sort((a, b) =>
              (b.sortTimestamp || 0) - (a.sortTimestamp || 0)
            );

            // Update the emails state with the merged list
            setEmails(mergedEmails);

            // Filter out any potentially undefined or invalid emails
            const validUniqueEmails = uniqueNewEmails.filter((email: any) => email && email.id);

            if (validUniqueEmails.length > 0) {
              // Save the new emails to Firebase
              await saveEmailsToFirebase(validUniqueEmails);
              console.log(`Saved ${validUniqueEmails.length} valid new emails to Firebase`);
            } else {
              console.warn('No valid emails to save to Firebase');
            }

            // Update the cache
            saveToCache(CACHE_KEYS.EMAILS, {
              emails: mergedEmails,
              timestamp: Date.now()
            });

            // Reset the new emails button state
            setShowNewEmailsButton(false);
            setNewEmailsCount(0);
            setNewThreadIds([]);

            toast.success(`Loaded ${uniqueNewEmails.length} new email${uniqueNewEmails.length === 1 ? '' : 's'}`);
          } else {
            toast.info("No new emails found");
          }
        } else {
          toast.info("No new emails found");
        }
      } catch (error) {
        console.error("Error loading new emails:", error);
        toast.error(error instanceof Error ? error.message : "Failed to load new emails");
      } finally {
        setLoadingNewEmails(false);
      }
    }
  };

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

  // Get the similarity threshold from settings
  const similarityThreshold = useMemo(() => getSimilarityThreshold(settings), [settings]);

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
        if (calculatePatternSimilarity(q.question, faq.question) > similarityThreshold) {
          allQuestions.add(q.question);
        }
      });
    });

    return Array.from(allQuestions);
  }, [emails, emailQuestions, calculatePatternSimilarity, similarityThreshold]);

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

        return hasCommonKeyWord && similarity > similarityThreshold;
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
  }, [calculatePatternSimilarity, similarityThreshold]);

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
      return similarity > similarityThreshold;
    });

    if (similarMatch) {
      console.log('Found similar match:', similarMatch);
      return similarMatch;
    }

    console.log('No match found for question:', question);
    return null;
  }, [answeredFAQs, calculatePatternSimilarity, similarityThreshold]);

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
        calculatePatternSimilarity(faq.question, q.question) > similarityThreshold
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
  }, [emailQuestions, answeredFAQs, calculatePatternSimilarity, similarityThreshold]);

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
      if (cached && !skipCache) {
        // Handle both formats: direct array or nested in emails property
        const emailsData = Array.isArray(cached) ? cached : cached.emails;
        if (emailsData && emailsData.length > 0) {
          // Cast the cached data to the correct type before setting
          setEmails(emailsData as ExtendedEmail[]);
          setLastFetchTimestamp(Date.now());
          return;
        }
      }

      console.log("Loading fresh emails...");

      // Actual fetch logic here - loading from Firebase
      const firebaseEmails = await loadEmailsFromFirebase();
      const readyToReplyEmails = await loadReadyToReplyFromFirebase();

      if (firebaseEmails && firebaseEmails.length > 0) {
        console.log(`Loaded ${firebaseEmails.length} emails from Firebase`);

        // Sort emails by timestamp (most recent first)
        const sortedEmails = [...firebaseEmails].sort((a, b) =>
          (b.sortTimestamp || 0) - (a.sortTimestamp || 0)
        );

        setEmails(sortedEmails);

        // Save to cache - directly save the emails array without extra nesting
        saveToCache(CACHE_KEYS.EMAILS, sortedEmails);

        setLastFetchTimestamp(Date.now());
      } else {
        console.log("No emails found in Firebase, keeping current emails");
      }

      // Update last load time
      lastLoadTime.current = Date.now();

    } catch (error) {
      console.error("Error loading emails:", error);
      toast.error("Failed to load emails");
    } finally {
      setIsLoading(false);
      setManualRefreshTriggered(false);
    }
  }, [user?.accessToken, page, MIN_FETCH_INTERVAL, setManualRefreshTriggered]);

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
        // Ensure the manual refresh indicator is false during initialization
        setManualRefreshTriggered(false);

        // First try to load from local cache
        const cachedData = loadFromCache(CACHE_KEYS.EMAILS);
        if (cachedData) {
          // Handle both formats: direct array or nested in emails property
          const emailsData = Array.isArray(cachedData) ? cachedData : cachedData.emails;
          if (emailsData && emailsData.length > 0) {
            setEmails(emailsData as ExtendedEmail[]);
          }
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

        // Mark initial data as loaded
        setInitialDataLoaded(true);

      } catch (error) {
        console.error('Error initializing data:', error);
      } finally {
        setLoading(false);
        // Mark initial data as loaded even if there was an error
        setInitialDataLoaded(true);
      }
    };

    initialize();

    return () => {
      controller.abort();
    };
  }, [user?.accessToken]);

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

        // If no questions have been extracted yet, don't process this email
        if (questions.length === 0) {
          return email;
        }

        // Check if all questions have answers in the FAQ library
        const allQuestionsHaveAnswers = questions.every(question =>
          question.answer && question.answer.trim() !== ''
        );

        // Skip emails that have already been processed, marked not relevant,
        // or don't have all questions answered
        if (!isEmailReadyForReply(email, emailQuestions, user) || !allQuestionsHaveAnswers) {
          return email;
        }

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
                      calculatePatternSimilarity(q.question, faq.question) > similarityThreshold
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

  }, [answeredFAQs, checkEmailAnsweredStatus, emailQuestions, calculatePatternSimilarity, similarityThreshold, user]);

  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      loadEmails(false);
    }
  };

  const handleAutoReply = async (email: ExtendedEmail) => {
    // Skip generating replies for emails where the user was last to reply
    if (isUserLastSender(email, user)) {
      console.log('Skipping AI reply generation - user was last to reply:', email.id);
      return;
    }

    const questions = emailQuestions.get(email.id) || [];

    // Skip if there are no questions extracted yet
    if (questions.length === 0) {
      console.log('Skipping AI reply generation - no questions extracted:', email.id);
      toast.warning('No questions extracted from this email yet');
      return;
    }

    // Check if all questions have answers in the FAQ library
    const allQuestionsHaveAnswers = questions.every(question =>
      question.answer && question.answer.trim() !== ''
    );

    if (!allQuestionsHaveAnswers) {
      console.log('Skipping AI reply generation - not all questions have answers:', email.id);
      toast.warning('Cannot generate reply: not all questions have answers in the FAQ library');
      return;
    }

    setAnalyzingEmails(prev => new Set(prev).add(email.id));

    try {
      const response = await fetch('/api/knowledge/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId: email.id,
          subject: email.subject,
          content: email.content,
          matchedFAQ: email.matchedFAQ,
          questions: questions,
          answeredFAQs: answeredFAQs.filter(faq =>
            questions.some((q: GenericFAQ) =>
              calculatePatternSimilarity(q.question, faq.question) > similarityThreshold
            )
          )
        })
      });

      if (response.ok) {
        const data = await response.json();
        const emailWithReply = {
          ...email,
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

        toast.success('Auto-reply sent successfully');
        loadEmails();
      } else {
        throw new Error('Failed to send auto-reply');
      }
    } catch (error) {
      toast.error('Failed to send auto-reply');
    } finally {
      // Remove this email from loading state
      setAnalyzingEmails(prev => {
        const updated = new Set(prev);
        updated.delete(email.id);
        return updated;
      });
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
    // Immediately update UI for a responsive feel (optimistic update)
    setEmails(prev =>
      prev.map(e => e.id === email.id ? { ...e, isNotRelevant: true, status: 'not_relevant' } : e)
    );

    // Show immediate feedback to user
    toast.success('Email marked as not relevant');

    try {
      const firebaseDB = getFirebaseDB();
      if (firebaseDB && email.id) {
        // Save to not_relevant_emails collection
        const notRelevantRef = doc(firebaseDB, FIREBASE_COLLECTIONS.NOT_RELEVANT, email.id);
        await setDoc(notRelevantRef, {
          emailId: email.id,
          threadId: email.threadId,
          markedAt: new Date().toISOString(),
          markedBy: user?.email || 'unknown'
        });

        // Update (or create) the email document in emails collection
        // Using setDoc with merge:true instead of updateDoc to handle cases where the document doesn't exist
        const emailRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAILS, email.id);
        await setDoc(emailRef, {
          id: email.id,
          threadId: email.threadId,
          status: 'not_relevant',
          subject: email.subject || '',
          sender: email.sender || '',
          receivedAt: email.receivedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }, { merge: true });

        // Also update the email_cache entry to ensure consistency across refreshes
        const emailCacheRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
        await setDoc(emailCacheRef, {
          status: 'not_relevant',
          isNotRelevant: true,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (error) {
      console.error('Error marking email as not relevant:', error);
      // Only show error toast if the operation fails
      toast.error('Failed to mark email as not relevant');

      // Revert the optimistic update if the operation failed
      setEmails(prev =>
        prev.map(e => e.id === email.id ? { ...e, isNotRelevant: false, status: email.status === 'not_relevant' ? 'pending' : email.status } : e)
      );
    }
  };

  const handleUndoNotRelevant = async (email: ExtendedEmail) => {
    // Immediately update UI for a responsive feel (optimistic update)
    setEmails(prev =>
      prev.map(e => e.id === email.id ? { ...e, isNotRelevant: false, status: 'pending' } : e)
    );

    // Show immediate feedback to user
    toast.success('Email marked as relevant again');

    // Tracking for UI loading indicator
    setProcessingUndoNotRelevant(prev => new Set(prev).add(email.id));

    try {
      const firebaseDB = getFirebaseDB();
      if (firebaseDB && email.id) {
        // Remove from not_relevant_emails collection
        const notRelevantRef = doc(firebaseDB, FIREBASE_COLLECTIONS.NOT_RELEVANT, email.id);
        await deleteDoc(notRelevantRef);

        // Update the email document in emails collection
        const emailRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAILS, email.id);
        await setDoc(emailRef, {
          status: 'pending',
          updatedAt: new Date().toISOString()
        }, { merge: true });

        // Also update the email_cache entry to ensure consistency across refreshes
        const emailCacheRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
        await setDoc(emailCacheRef, {
          status: 'pending',
          isNotRelevant: false,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (error) {
      console.error('Error marking email as relevant:', error);
      toast.error('Failed to mark email as relevant');

      // Revert the optimistic update if the operation failed
      setEmails(prev =>
        prev.map(e => e.id === email.id ? { ...e, isNotRelevant: true, status: 'not_relevant' } : e)
      );
    } finally {
      setProcessingUndoNotRelevant(prev => {
        const updated = new Set(prev);
        updated.delete(email.id);
        return updated;
      });
    }
  };

  // Add this function to check if an email is marked as not relevant
  const isEmailMarkedNotRelevant = async (emailId: string): Promise<boolean> => {
    try {
      const db = getFirebaseDB();
      if (!db) return false;

      // Check multiple sources to be resilient
      // 1. First check the not_relevant_emails collection
      const notRelevantRef = doc(db, FIREBASE_COLLECTIONS.NOT_RELEVANT, emailId);
      const docSnap = await getDoc(notRelevantRef);

      if (docSnap.exists()) {
        return true;
      }

      // 2. If not found there, check the email status in the emails collection
      const emailRef = doc(db, FIREBASE_COLLECTIONS.EMAILS, emailId);
      const emailSnap = await getDoc(emailRef);

      if (emailSnap.exists() && emailSnap.data()?.status === 'not_relevant') {
        return true;
      }

      // 3. Finally check the email_cache collection
      const emailCacheRef = doc(db, FIREBASE_COLLECTIONS.EMAIL_CACHE, emailId);
      const cacheSnap = await getDoc(emailCacheRef);

      if (cacheSnap.exists() &&
        (cacheSnap.data()?.status === 'not_relevant' ||
          cacheSnap.data()?.isNotRelevant === true)) {
        return true;
      }

      return false;
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

      // Combine matched FAQs and new questions into a single array of GenericFAQ objects
      const allQuestions: GenericFAQ[] = [
        ...matchedFAQs.map((faq: MatchedFAQ) => ({
          question: faq.question || '',
          answer: faq.answer || '',
          category: faq.category || 'support',
          confidence: faq.confidence || 0,
          emailIds: [email.id],
          id: faq.questionId || undefined,
          requiresCustomerSpecificInfo: false,
          updatedAt: new Date().toISOString()
        })),
        ...newQuestions.map((q: NewQuestion) => ({
          question: q.question || '',
          category: q.category || 'support',
          emailIds: [email.id],
          confidence: q.confidence || 0,
          requiresCustomerSpecificInfo: !!q.requiresCustomerSpecificInfo,
          updatedAt: new Date().toISOString()
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

      // Check if all questions have answers - this is needed for "Ready to Reply"
      const allQuestionsHaveAnswers = allQuestions.length > 0 &&
        allQuestions.every(question => question.answer && question.answer.trim() !== '');

      // Find the best match for this email if all questions have answers
      let matchedFAQ = null;
      if (allQuestionsHaveAnswers) {
        // Find the best matched FAQ to use as the primary match
        const bestMatch = allQuestions.reduce((best, current) => {
          if (!current.answer || !current.confidence) return best;
          if (!best || (best.confidence || 0) < current.confidence) return current;
          return best;
        }, null as GenericFAQ | null);

        if (bestMatch && bestMatch.answer) {
          matchedFAQ = {
            question: bestMatch.question,
            answer: bestMatch.answer,
            confidence: bestMatch.confidence
          };
        }
      }

      // Update the email object with the questions and status
      const updatedEmail: ExtendedEmail = {
        ...email,
        questions: allQuestions,
        status: allQuestionsHaveAnswers && matchedFAQ ? 'processed' : 'pending',
        matchedFAQ: matchedFAQ || undefined
      };

      // Update emails state
      setEmails(prev => prev.map(e =>
        e.id === email.id ? updatedEmail : e
      ));

      // Save to cache in the background
      const updatedQuestions = new Map(emailQuestions);
      updatedQuestions.set(email.id, allQuestions);
      saveToCache(CACHE_KEYS.QUESTIONS, Object.fromEntries(updatedQuestions));

      // If all questions have answers and there's a matched FAQ, generate a reply
      if (allQuestionsHaveAnswers && matchedFAQ) {
        console.log('All questions have answers, generating reply...');
        // Save updated email status to Firebase
        saveEmailsToFirebase([updatedEmail]);
        // Generate a reply so the email appears in Ready to Reply
        generateContextualReply(updatedEmail);
      }

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
  const generateContextualReply = async (email: ExtendedEmail, forceRegenerate = false) => {
    try {
      // Check if we already have a reply in Firebase (skip this check if forceRegenerate is true)
      const db = getFirebaseDB();
      if (db && !forceRegenerate) {
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

      // Use settings from the settings modal or fallback to defaults
      const currentSettings = {
        confidenceThreshold: settings.confidenceThreshold / 100 || 0.6, // Convert percentage to decimal
        emailFormatting: {
          greeting: settings.emailFormatting.greeting || "Hi there",
          signatureStyle: settings.emailFormatting.signatureStyle || "Sincerely, Our Team",
          customPrompt: settings.emailFormatting.customPrompt || "Please keep responses friendly and human sounding."
        }
      };

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
              calculatePatternSimilarity(q.question, faq.question) > currentSettings.confidenceThreshold
            );
          }),
          settings: currentSettings,
          userEmail: user?.email
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

    // Use settings from the settings modal or fallback to defaults
    const greeting = settings.emailFormatting?.greeting?.replace('[Name]', senderName) || `Hi ${senderName}`;
    const signature = settings.emailFormatting?.signatureStyle?.replace('[Name]', 'Support Team') || 'Best regards,\nSupport Team';

    const question = email.matchedFAQ?.question?.replace('{email}', email.sender) || '';
    const answer = email.matchedFAQ?.answer || '';

    return `${greeting},

Thank you for your email regarding ${question}.

${answer}

${signature}`;
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
          calculatePatternSimilarity(faq.question, q.question) > similarityThreshold
        )
      );

      const progress = questions.length > 0 ? (answeredQuestions.length / questions.length) * 100 : 0;
      const isComplete = progress === 100;

      if (isComplete && !email.matchedFAQ && !email.isReplied && !email.isNotRelevant) {
        const bestMatch = answeredQuestions.reduce((best, current) => {
          const matchedFAQ = answeredFAQs.find(faq =>
            calculatePatternSimilarity(faq.question, current.question) > similarityThreshold
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
  }, [emails, emailQuestions, answeredFAQs, calculatePatternSimilarity, similarityThreshold]);

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

    // Add validation for the date
    const isValidDate = (dateValue: any) => {
      if (!dateValue) return false;
      const date = new Date(dateValue);
      return !isNaN(date.getTime());
    };

    // Use fallback date if receivedAt is invalid
    const receivedAt = isValidDate(email.receivedAt) ? email.receivedAt : new Date().toISOString();

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 hover:shadow-sm transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {new Date(receivedAt).toLocaleString()}
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
    const readyToReplyCount = emails.filter(e => {
      // Get the questions for this email
      const questions = emailQuestions.get(e.id) || [];

      // Check if all questions have been answered
      const allQuestionsHaveAnswers = questions.length > 0 && questions.every(question =>
        question.answer && question.answer.trim() !== ''
      );

      return e.status === 'processed' &&
        e.matchedFAQ &&
        !e.isReplied &&
        e.suggestedReply &&
        !isUserLastSender(e, user) && // Don't include emails where the user was last to reply
        allQuestionsHaveAnswers; // Only include if all questions have answers
    }).length;

    const answeredCount = emails.filter(e =>
      isUserLastSender(e, user) // Emails where the user was the last to reply
    ).length;

    // Calculate unanswered count using the same filter criteria as renderUnansweredEmails
    const unansweredCount = emails.filter(email =>
      !email.isReplied &&
      email.status !== 'not_relevant' &&
      (!email.matchedFAQ || !(email.id && ((emailQuestions.get(email.id)?.length ?? 0) > 0))) &&
      email.status !== 'processed' &&
      !isUserLastSender(email, user) // Exclude emails where the user is the last sender
    ).length;

    const tabData = [
      {
        id: 'unanswered',
        label: 'Unanswered',
        mobileLabel: 'New',
        icon: MessageCircleIcon,
        count: unansweredCount,
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
      },
      {
        id: 'answered',
        label: 'Answered',
        mobileLabel: 'Ans',
        icon: MailCheckIcon,
        count: answeredCount,
        description: 'Emails where you were the last to reply'
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

    // Helper function to check if a date is valid
    const isValidDate = (dateValue: any) => {
      if (!dateValue) return false;
      const date = new Date(dateValue);
      return !isNaN(date.getTime());
    };

    // Use fallback dates if receivedAt is invalid
    const currentReceivedAt = isValidDate(currentEmail.receivedAt) ? currentEmail.receivedAt : new Date().toISOString();
    const currentDate = new Date(currentReceivedAt);

    const prevEmail = emails[index - 1];
    const prevReceivedAt = isValidDate(prevEmail.receivedAt) ? prevEmail.receivedAt : new Date().toISOString();
    const prevDate = new Date(prevReceivedAt);

    return currentDate.toDateString() !== prevDate.toDateString();
  };

  const renderEmailTimeline = (email: ExtendedEmail, index: number, allEmails: ExtendedEmail[]) => {
    // Add validation for receivedAt to handle invalid dates
    const isValidDate = (dateValue: any) => {
      if (!dateValue) return false;
      const date = new Date(dateValue);
      return !isNaN(date.getTime());
    };

    // Use fallback date if receivedAt is invalid
    const receivedAt = isValidDate(email.receivedAt) ? email.receivedAt : new Date().toISOString();
    const date = new Date(receivedAt);

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
      email.status !== 'processed' &&
      !isUserLastSender(email, user) // Exclude emails where the user is the last sender
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
        {showNewEmailsButton && newEmailsCount > 0 && !loadingNewEmails && (
          <button
            onClick={handleLoadNewEmails}
            className="w-full h-[60px] bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium rounded-lg flex items-center justify-center transition-colors duration-200 mb-4 shadow-sm"
          >
            <MailIcon className="h-5 w-5 mr-2" />
            Load {newEmailsCount} new email{newEmailsCount === 1 ? '' : 's'}
          </button>
        )}
        {loadingNewEmails && (
          <div className="w-full h-[60px] bg-gray-50 rounded-lg mb-4 animate-pulse flex items-center justify-center">
            <div className="flex items-center space-x-2">
              <div className="h-5 w-5 bg-gray-200 rounded-full animate-pulse"></div>
              <div className="h-4 w-48 bg-gray-200 rounded"></div>
            </div>
          </div>
        )}
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
                        calculatePatternSimilarity(faq.question, question.question) > similarityThreshold
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
    const readyEmails = emails.filter(email => {
      // Get the questions for this email
      const questions = emailQuestions.get(email.id) || [];

      // Check if all questions have been answered
      const allQuestionsHaveAnswers = questions.length > 0 && questions.every(question =>
        question.answer && question.answer.trim() !== ''
      );

      return email.status === 'processed' &&
        email.matchedFAQ &&
        !email.isReplied &&
        email.suggestedReply &&
        !isUserLastSender(email, user) && // Don't include emails where the user was last to reply
        allQuestionsHaveAnswers; // Only include if all questions have answers
    });

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
                    <h4 className="text-sm font-medium text-indigo-600">
                      {email.isGeneratingReply ? 'Generating AI Reply...' : 'AI Generated Reply'}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditReply(email)}
                      className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                      disabled={email.isGeneratingReply}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => generateContextualReply(email, true)}
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
                  {email.isGeneratingReply ? (
                    <div className="flex items-center justify-center py-4">
                      <svg className="animate-spin h-5 w-5 text-indigo-600 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Generating a fresh AI reply...</span>
                    </div>
                  ) : (
                    email.suggestedReply
                  )}
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
    const notRelevantEmails = emails.filter(email => email.isNotRelevant);

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

  const renderAnsweredEmails = () => {
    const answeredEmails = emails.filter(email => isUserLastSender(email, user));

    if (answeredEmails.length === 0) {
      return (
        <div className="text-center py-12">
          <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
            <MailCheckIcon className="h-12 w-12" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No answered emails</h3>
          <p className="mt-2 text-sm text-gray-500">
            Emails where you were the last to reply will appear here
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-8 relative pl-[4.5rem]">
        {answeredEmails.map((email, index) => (
          <div
            key={email.id}
            className="bg-white rounded-lg shadow-sm pt-4 pb-6 px-6 space-y-4 relative"
            style={{ marginBottom: '2rem' }}
          >
            {renderEmailTimeline(email, index, answeredEmails)}
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <h3 className="text-lg font-medium text-gray-900">
                  {email.subject}
                </h3>
                <div className="text-sm text-gray-500">
                  From: {email.sender}
                </div>
              </div>
            </div>

            {/* Email Content with Thread Support */}
            {renderEmailContent(email)}
          </div>
        ))}
      </div>
    );
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
      case 'answered':
        return renderAnsweredEmails();
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

      // Create a sanitized version of the emails with only the necessary properties
      const sanitizedEmails = emails.map(email => ({
        id: email.id,
        threadId: email.threadId,
        subject: email.subject,
        sender: email.sender,
        receivedAt: email.receivedAt,
        status: email.status,
        // Only include matchedFAQ if it exists and has required properties
        matchedFAQ: email.matchedFAQ ? {
          question: email.matchedFAQ.question || '',
          answer: email.matchedFAQ.answer || '',
          confidence: email.matchedFAQ.confidence || 0
        } : null,
        // Convert content to a string if it's an object to avoid circular references
        content: typeof email.content === 'string'
          ? email.content
          : (email.content?.text || email.content?.html || ''),
        suggestedReply: email.suggestedReply || '',
        isReplied: !!email.isReplied,
        isNotRelevant: !!email.isNotRelevant,
        sortTimestamp: email.sortTimestamp || Date.now()
      }));

      const readyRef = doc(db, FIREBASE_COLLECTIONS.READY_TO_REPLY, 'latest');
      await setDoc(readyRef, {
        emails: sanitizedEmails,
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
    const emailsToProcess = emails.filter(email =>
      !email.isReplied &&
      !email.isNotRelevant &&
      !analyzingEmails.has(email.id)
    );

    if (emailsToProcess.length === 0) {
      console.log('No emails to process.');
      return;
    }

    setAnalyzing(true);
    console.log(`Processing batch of ${emailsToProcess.length} emails`);

    // Initialize counters for email processing stats
    let totalMatchedFAQs = 0;
    let totalNewQuestions = 0;
    let processedEmails = 0;

    try {
      const resultEmails = await Promise.all(
        emailsToProcess.map(async (email) => {
          // First, check if user was the last to reply - if so, mark as "answered" but don't process
          if (isUserLastSender(email, user)) {
            return {
              ...email,
              isReplied: false, // Not technically replied to by customer
              isAnswered: true  // But answered by us
            };
          }

          setAnalyzingEmails(prev => new Set(prev).add(email.id));

          // Check if email is marked as not relevant
          const notRelevant = await isEmailMarkedNotRelevant(email.id);
          if (notRelevant) {
            setEmails(prev => prev.map(e =>
              e.id === email.id ? { ...e, isNotRelevant: true } : e
            ));
            return { ...email, isNotRelevant: true };
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

            // After extracting questions, check if they all have answers
            // If not all questions have answers, don't proceed with generating a reply yet
            const questions = emailQuestions.get(email.id) || [];
            const allQuestionsHaveAnswers = questions.length > 0 && questions.every(question =>
              question.answer && question.answer.trim() !== ''
            );

            if (!allQuestionsHaveAnswers) {
              console.log(`Email ${email.id} has questions without answers. Skipping reply generation.`);
              return email;
            }
          }

          // Check if email is ready for reply using our updated function that checks for answered questions
          const readyToReply = isEmailReadyForReply(email, emailQuestions, user);

          if (readyToReply) {
            try {
              const response = await fetch('/api/knowledge/generate-reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  emailId: email.id,
                  subject: email.subject,
                  content: email.content,
                  matchedFAQ: email.matchedFAQ,
                  questions: existingQuestions || [],
                  answeredFAQs: answeredFAQs.filter(faq =>
                    existingQuestions?.some(q =>
                      calculatePatternSimilarity(q.question, faq.question) > similarityThreshold
                    ) ||
                    answeredFAQs.some(faq =>
                      calculatePatternSimilarity(faq.question, email.matchedFAQ?.question || '') > similarityThreshold
                    )
                  )
                })
              });

              if (response.ok) {
                const data = await response.json();
                const emailWithReply = {
                  ...email,
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

          // Remove this email from loading state
          setAnalyzingEmails(prev => {
            const updated = new Set(prev);
            updated.delete(email.id);
            return updated;
          });

          return email;
        })
      );

      // Update the emails state with the processed results
      if (resultEmails.length > 0) {
        setEmails(prev => {
          const updated = [...prev];
          resultEmails.forEach(result => {
            const index = updated.findIndex(e => e.id === result.id);
            if (index !== -1) {
              updated[index] = result;
            }
          });
          return updated;
        });
      }
    } catch (error) {
      console.error('Error processing email batch:', error);
      toast.error('Error processing some emails');
    } finally {
      setAnalyzing(false);
    }
  };

  // Add the renderHeader function
  const renderHeader = () => {
    return (
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">FAQ Auto Reply</h1>
          <p className="text-gray-500 mt-1">
            Automatically match and reply to customer support emails
          </p>
        </div>
        <div className="mt-4 md:mt-0 flex items-center space-x-3">
          <button
            onClick={() => {
              refreshAllEmailsFromGmail();
            }}
            disabled={isLoading}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading && manualRefreshTriggered ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Cog6ToothIcon className="h-4 w-4 mr-2" />
            Settings
          </button>
        </div>
      </div>
    );
  };

  // Add the handleSaveSettings function before the return statement
  const handleSaveSettings = (newSettings: AutoReplySettings) => {
    setSettings(newSettings);
    // Save settings to localStorage
    localStorage.setItem('faq_autoreply_settings', JSON.stringify(newSettings));
    toast.success('Settings saved successfully');
    setShowSettingsModal(false);
  };

  // Add checkNewEmails function after the loadEmails function
  const checkNewEmails = async () => {
    if (!user) {
      toast.error('You need to be logged in to check for new emails');
      return;
    }

    try {
      setIsLoading(true);
      toast.info('Checking for new emails...');

      // Check if emails array is valid and ready to use
      if (!Array.isArray(emails)) {
        throw new Error('Emails not properly initialized. Please try again in a few moments.');
      }

      // Get the timestamp of the most recent email we have
      let latestEmailTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000; // Default: 30 days ago

      if (emails.length > 0) {
        try {
          // Safely calculate the maximum timestamp
          const timestamps = emails
            .filter(e => e && e.receivedAt) // Filter out any invalid emails
            .map(e => {
              // Handle both string and number formats
              if (typeof e.receivedAt === 'number') return e.receivedAt;
              if (typeof e.receivedAt === 'string') {
                const parsed = new Date(e.receivedAt).getTime();
                return isNaN(parsed) ? 0 : parsed;
              }
              return 0;
            })
            .filter(timestamp => timestamp > 0); // Filter out any invalid timestamps

          if (timestamps.length > 0) {
            latestEmailTimestamp = Math.max(...timestamps);
          }
        } catch (err) {
          console.error('Error calculating latest email timestamp:', err);
          // Continue with the default timestamp
        }
      }

      // Safely extract thread IDs
      const existingThreadIds = emails
        .filter(e => e && e.threadId) // Filter out invalid entries
        .map(e => e.threadId)
        .filter(Boolean); // Filter out nulls/undefined/empty strings

      const response = await fetch('/api/emails/check-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          lastEmailTimestamp: latestEmailTimestamp,
          existingThreadIds
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to check for new emails');
      }

      const data = await response.json();

      if (data.newEmailsCount > 0) {
        toast.success(`${data.newEmailsCount} new email${data.newEmailsCount === 1 ? '' : 's'} found! Click 'Refresh Emails' to load them.`);
        setNewEmailsCount(data.newEmailsCount);
        setNewThreadIds(data.newThreadIds || []);
        setShowNewEmailsButton(true);
      } else {
        toast.info('No new emails found.');
      }
    } catch (error) {
      console.error('Error checking for new emails:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to check for new emails');
    } finally {
      setIsLoading(false);
    }
  };

  // Add a function to refresh all emails directly from Gmail API
  const refreshAllEmailsFromGmail = async () => {
    if (!user?.accessToken) {
      toast.error('Please sign in to refresh emails');
      return;
    }

    try {
      setManualRefreshTriggered(true);
      setIsLoading(true);
      toast.info('Refreshing emails from Gmail...');

      // Get all the thread IDs we have
      const allThreadIds = emails.map(e => e.threadId).filter(Boolean);

      if (allThreadIds.length === 0) {
        // If we don't have any thread IDs, fall back to loading from Firebase
        await loadEmails(true);
        toast.success('No existing emails to refresh. Loaded emails from database.');
        return;
      }

      console.log(`Refreshing ${allThreadIds.length} threads from Gmail API...`);

      // Call the refresh-batch endpoint with all thread IDs
      const response = await fetch('/api/emails/refresh-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        },
        body: JSON.stringify({
          threadIds: allThreadIds
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to refresh emails from Gmail');
      }

      const data = await response.json();
      console.log("Refreshed emails from Gmail API:", data);

      if (data.refreshedEmails && data.refreshedEmails.length > 0) {
        // Before updating emails, get a list of emails marked as not relevant
        // to ensure we preserve that status after refresh
        const firebaseDB = getFirebaseDB();
        const notRelevantEmails = new Set<string>();

        if (firebaseDB) {
          try {
            // Get all not relevant emails from the collection
            const notRelevantSnapshot = await getDocs(collection(firebaseDB, FIREBASE_COLLECTIONS.NOT_RELEVANT));
            notRelevantSnapshot.docs.forEach(doc => {
              notRelevantEmails.add(doc.id);
            });

            // Also check emails collection for status='not_relevant'
            const emailsSnapshot = await getDocs(query(
              collection(firebaseDB, FIREBASE_COLLECTIONS.EMAILS),
              where('status', '==', 'not_relevant')
            ));
            emailsSnapshot.docs.forEach(doc => {
              notRelevantEmails.add(doc.id);
            });

            console.log(`Found ${notRelevantEmails.size} emails marked as not relevant`);
          } catch (error) {
            console.error('Error fetching not relevant emails:', error);
          }
        }

        // Format the refreshed emails with proper timestamp formatting
        const refreshedEmails = data.refreshedEmails.map((email: any) => ({
          ...email,
          // Ensure receivedAt is handled properly
          receivedAt: email.receivedAt ?
            (typeof email.receivedAt === 'number' ? email.receivedAt : parseInt(email.receivedAt)) :
            Date.now(),
          // Set sortTimestamp based on receivedAt
          sortTimestamp: email.receivedAt ?
            (typeof email.receivedAt === 'number' ? email.receivedAt : parseInt(email.receivedAt)) :
            Date.now()
        }));

        // Create a map of current emails for easy lookup and updating
        const currentEmailsMap = new Map(emails.map(e => [e.id, e]));

        // Merge refreshed emails with current emails
        const mergedEmails = [...emails];

        // Keep track of emails that have actually changed
        const changedEmails: ExtendedEmail[] = [];

        // Update existing emails and add new ones
        refreshedEmails.forEach((refreshedEmail: any) => {
          const index = mergedEmails.findIndex(e => e.id === refreshedEmail.id);
          if (index >= 0) {
            const existingEmail = mergedEmails[index];
            // Check if there are actual content changes
            const contentChanged =
              refreshedEmail.content !== existingEmail.content ||
              refreshedEmail.subject !== existingEmail.subject ||
              (refreshedEmail.threadMessages?.length !== existingEmail.threadMessages?.length);

            // Check if this email is marked as not relevant
            const isNotRelevant = notRelevantEmails.has(refreshedEmail.id) ||
              existingEmail.isNotRelevant ||
              existingEmail.status === 'not_relevant';

            // Update existing email with fresh data while preserving state
            mergedEmails[index] = {
              ...mergedEmails[index],
              ...refreshedEmail,
              // Preserve these important state properties
              matchedFAQ: mergedEmails[index].matchedFAQ,
              isReplied: mergedEmails[index].isReplied,
              // Ensure not-relevant status is preserved
              isNotRelevant: isNotRelevant,
              status: isNotRelevant ? 'not_relevant' : mergedEmails[index].status,
              suggestedReply: mergedEmails[index].suggestedReply,
              // Ensure threadMessages is preserved if it exists in original but not in refreshed
              threadMessages: refreshedEmail.threadMessages || mergedEmails[index].threadMessages
            };

            // If content changed, add to changedEmails
            if (contentChanged) {
              changedEmails.push(mergedEmails[index]);
            }
          } else {
            // Check if this new email is marked as not relevant
            const isNotRelevant = notRelevantEmails.has(refreshedEmail.id);

            // Add new email
            const newEmail = {
              ...refreshedEmail,
              isNotRelevant: isNotRelevant,
              status: isNotRelevant ? 'not_relevant' : 'pending'
            };

            mergedEmails.push(newEmail);
            // New emails are definitely changed
            changedEmails.push(newEmail);
          }
        });

        // Sort by timestamp
        const sortedEmails = mergedEmails.sort((a, b) =>
          (b.sortTimestamp || 0) - (a.sortTimestamp || 0)
        );

        // Update state
        setEmails(sortedEmails);

        // Only save emails that have actually changed to Firebase
        if (changedEmails.length > 0) {
          // Filter out any potential undefined values before saving
          const validChangedEmails = changedEmails.filter(email => email && email.id);

          if (validChangedEmails.length > 0) {
            console.log('Saving valid changed emails to Firebase:', validChangedEmails.length);

            // For each changed email, ensure not-relevant status is saved correctly in all collections
            await Promise.all(validChangedEmails.map(async (email) => {
              // Mark not-relevant emails in all necessary collections
              if (email.isNotRelevant || email.status === 'not_relevant') {
                if (firebaseDB && email.id) {
                  // Ensure the email is in the not_relevant_emails collection
                  const notRelevantRef = doc(firebaseDB, FIREBASE_COLLECTIONS.NOT_RELEVANT, email.id);
                  await setDoc(notRelevantRef, {
                    emailId: email.id,
                    threadId: email.threadId,
                    markedAt: new Date().toISOString(),
                    markedBy: user?.email || 'unknown'
                  }, { merge: true });

                  // Also ensure the status is set in the email_cache collection
                  const emailCacheRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
                  await setDoc(emailCacheRef, {
                    status: 'not_relevant',
                    isNotRelevant: true,
                    updatedAt: new Date().toISOString()
                  }, { merge: true });
                }
              }
            }));

            await saveEmailsToFirebase(validChangedEmails);
            toast.success(`Updated ${validChangedEmails.length} email${validChangedEmails.length === 1 ? '' : 's'} with changes`);
          } else {
            toast.info('No valid email changes to save');
          }
        } else {
          toast.info('No changes detected in your emails');
        }

        // Update cache with all emails
        saveToCache(CACHE_KEYS.EMAILS, sortedEmails);

        toast.success(`Refreshed ${data.successCount} emails from Gmail`);

        if (data.errorCount > 0) {
          toast.warning(`Failed to refresh ${data.errorCount} emails`);
        }
      } else {
        toast.info('No changes found in your emails');
      }
    } catch (error) {
      console.error('Error refreshing emails from Gmail:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to refresh emails');

      // Fall back to Firebase if Gmail refresh fails
      toast.info('Falling back to database...');
      await loadEmails(true);
    } finally {
      setIsLoading(false);
      setManualRefreshTriggered(false);
    }
  };

  // Add the reset email categorizations function after saveEmailsToFirebase
  const resetEmailCategorizations = async () => {
    try {
      const db = getFirebaseDB();
      if (!db) {
        toast.error('Failed to connect to the database');
        return;
      }

      // Show loading toast
      toast.loading('Resetting email categorizations...', { id: 'reset-emails' });

      // Get all emails from the EMAIL_CACHE collection
      const emailCacheRef = collection(db, FIREBASE_COLLECTIONS.EMAIL_CACHE);
      const emailsSnapshot = await getDocs(emailCacheRef);

      const resetEmails: ExtendedEmail[] = [];
      const emailIds: string[] = [];

      // Track stats for user feedback
      let processedCount = 0;
      let repliedCount = 0;
      let readyToReplyCount = 0;
      let notRelevantCount = 0;

      // Process each email
      emailsSnapshot.forEach((doc) => {
        const email = doc.data() as ExtendedEmail;

        // Skip emails with no ID
        if (!email || !email.id) {
          console.warn('Skipping invalid email without ID');
          return;
        }

        emailIds.push(email.id);

        // Track stats
        if (email.status === 'processed') processedCount++;
        if (email.isReplied) repliedCount++;
        if (email.status === 'processed' && !email.isReplied) readyToReplyCount++;
        if (email.isNotRelevant || email.status === 'not_relevant') notRelevantCount++;

        // Reset the properties that affect categorization
        const resetEmail = {
          ...email,
          status: 'pending' as const,   // Reset to pending status
          matchedFAQ: undefined,        // Clear the matched FAQ
          suggestedReply: undefined,    // Clear the suggested reply
          isReplied: false,             // Reset replied status
          isNotRelevant: false          // Reset not relevant status
        };

        resetEmails.push(resetEmail as ExtendedEmail);
      });

      // Save the reset emails back to Firebase
      await saveEmailsToFirebase(resetEmails);

      // Remove entries from NOT_RELEVANT collection
      const notRelevantBatch = writeBatch(db);
      const notRelevantSnapshot = await getDocs(collection(db, FIREBASE_COLLECTIONS.NOT_RELEVANT));

      notRelevantSnapshot.forEach((doc) => {
        if (emailIds.includes(doc.id)) {
          notRelevantBatch.delete(doc.ref);
        }
      });

      // Commit the batch delete operation
      if (notRelevantSnapshot.size > 0) {
        await notRelevantBatch.commit();
        console.log(`Removed ${notRelevantSnapshot.size} entries from not_relevant_emails collection`);
      }

      // Also clear the READY_TO_REPLY collection
      try {
        const readyRef = doc(db, FIREBASE_COLLECTIONS.READY_TO_REPLY, 'latest');
        await setDoc(readyRef, { emails: [], timestamp: Date.now() });
        console.log('Cleared ready_to_reply collection');
      } catch (error) {
        console.error('Error clearing ready_to_reply collection:', error);
      }

      // Update emails state to reflect changes
      setEmails(current =>
        current.map(email => {
          const matchingResetEmail = resetEmails.find(e => e.id === email.id);
          return matchingResetEmail || email;
        })
      );

      // Reset any cached questions
      setEmailQuestions(new Map());

      // Create detailed success message
      const resetDetails = [
        `Total emails reset: ${resetEmails.length}`,
        `Previously processed: ${processedCount}`,
        `Previously replied: ${repliedCount}`,
        `Previously ready to reply: ${readyToReplyCount}`,
        `Previously not relevant: ${notRelevantCount}`
      ].join('\n');

      // Success toast with detailed message
      toast.success(`All emails have been reset to the "Unanswered" state`, { id: 'reset-emails' });

      // Log detailed stats
      console.log('Email reset complete:', resetDetails);
    } catch (error) {
      console.error('Error resetting email categorizations:', error);
      toast.error('Failed to reset emails', { id: 'reset-emails' });
    }
  };

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
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          settings={settings}
          onSave={handleSaveSettings}
          onResetEmails={resetEmailCategorizations}
        />
      </Layout>
    </div>
  );
}
