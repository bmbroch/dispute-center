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

  // If similarityThreshold is stored as a percentage (>= 1), convert to decimal
  if (settings.similarityThreshold >= 1) {
    return settings.similarityThreshold / 100;
  }

  // If it's already a decimal (<1), use it directly
  return settings.similarityThreshold || DEFAULT_SIMILARITY_THRESHOLD;
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

    // If we're loading emails, ensure they're sorted by timestamp
    if (key === CACHE_KEYS.EMAILS && data) {
      const emailsData = Array.isArray(data) ? data : data.emails;

      if (emailsData && emailsData.length > 0) {
        // Sort emails by timestamp (most recent first)
        const sortedEmails = [...emailsData].sort((a, b) =>
          (b.sortTimestamp || new Date(b.receivedAt).getTime()) -
          (a.sortTimestamp || new Date(a.receivedAt).getTime())
        );

        return Array.isArray(data) ? sortedEmails : { ...data, emails: sortedEmails };
      }
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

  // Sort messages by receivedAt timestamp to ensure we get the most recent one
  // Make a copy of the array first to avoid modifying the original
  const sortedMessages = [...email.threadMessages].sort((a, b) => {
    // Sort by receivedAt (descending) - most recent first
    if (a.receivedAt && b.receivedAt) {
      return b.receivedAt - a.receivedAt;
    }
    // If receivedAt is not available, keep original order
    return 0;
  });

  // Get the most recent message in the thread (first after sorting descending)
  const lastMessage = sortedMessages[0];

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
  READY_TO_REPLY: 'ready_to_reply',
  EMAIL_CONTENT: 'email_content'  // Adding EMAIL_CONTENT collection
};

const loadEmailsFromFirebase = async (user: { email: string | null } | null) => {
  try {
    const db = getFirebaseDB();
    if (!db || !user?.email) return null;

    // Get emails from user's subcollections
    const userEmailsRef = collection(db, `users/${user.email}/emails`);
    const userThreadCacheRef = collection(db, `users/${user.email}/thread_cache`);
    const userEmailContentRef = collection(db, `users/${user.email}/email_content`);

    const [emailsSnapshot, threadCacheSnapshot, emailContentSnapshot] = await Promise.all([
      getDocs(userEmailsRef),
      getDocs(userThreadCacheRef),
      getDocs(userEmailContentRef)
    ]);

    // Create maps to merge data
    const emailMap = new Map<string, ExtendedEmail>();
    const contentMap = new Map<string, any>();
    const threadMap = new Map<string, { lastMessageTimestamp: number }>();

    // Process thread cache documents first to get latest timestamps
    threadCacheSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const lastMessageTimestamp = typeof data.lastMessageTimestamp === 'number' ?
        data.lastMessageTimestamp :
        (typeof data.lastMessageTimestamp === 'string' ? parseInt(data.lastMessageTimestamp) : Date.now());

      threadMap.set(doc.id, {
        lastMessageTimestamp
      });
    });

    // Process email content documents
    emailContentSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      contentMap.set(doc.id, data.content);
    });

    // Process emails and ensure consistent timestamps
    emailsSnapshot.docs.forEach((doc) => {
      const data = doc.data();

      // Ensure receivedAt is a number
      const receivedAt = typeof data.receivedAt === 'number' ?
        data.receivedAt :
        (typeof data.receivedAt === 'string' ? parseInt(data.receivedAt) : Date.now());

      // Get thread timestamp
      const threadInfo = threadMap.get(data.threadId);

      // Determine sortTimestamp with proper fallbacks
      const sortTimestamp = data.sortTimestamp && typeof data.sortTimestamp === 'number' ?
        data.sortTimestamp :
        threadInfo?.lastMessageTimestamp ||
        receivedAt;

      const email: ExtendedEmail = {
        ...data,
        id: doc.id,
        threadId: data.threadId,
        subject: data.subject,
        sender: data.sender,
        content: contentMap.get(doc.id) || data.content,
        receivedAt,
        sortTimestamp,
        status: data.status || 'pending'
      };

      emailMap.set(doc.id, email);
    });

    // Convert map to array and sort by sortTimestamp
    const sortedEmails = Array.from(emailMap.values())
      .sort((a, b) => {
        const aTimestamp = a.sortTimestamp || 0;
        const bTimestamp = b.sortTimestamp || 0;
        return bTimestamp - aTimestamp;
      });

    return sortedEmails;
  } catch (error) {
    console.error('Error loading emails from Firebase:', error);
    return null;
  }
};

const saveEmailsToFirebase = async (emails: (Email | ExtendedEmail)[], user: { email: string | null } | null) => {
  try {
    const db = getFirebaseDB();
    if (!db) return;
    if (!user?.email) {
      console.error('Cannot save emails: No user email provided');
      return;
    }

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

      // Convert receivedAt to a Unix timestamp number
      let receivedAtTimestamp: number;
      if (typeof email.receivedAt === 'number') {
        receivedAtTimestamp = email.receivedAt;
      } else if (typeof email.receivedAt === 'string') {
        const parsed = new Date(email.receivedAt).getTime();
        receivedAtTimestamp = isNaN(parsed) ? Date.now() : parsed;
      } else {
        receivedAtTimestamp = Date.now();
      }

      // Set sortTimestamp based on receivedAt
      const sortTimestamp = ('sortTimestamp' in email && email.sortTimestamp) || receivedAtTimestamp;

      // Create normalized email object
      const normalizedEmail = {
        ...email,
        // Always store receivedAt as a Unix timestamp number
        receivedAt: receivedAtTimestamp,
        // Always store sortTimestamp as a Unix timestamp number
        sortTimestamp: sortTimestamp,
        // Add lastUpdated timestamp
        lastUpdated: Date.now()
      };

      // Then sanitize the entire object
      const sanitizedEmail = sanitizeObject(normalizedEmail);

      try {
        // First check if the email already exists to preserve status
        const emailRef = doc(db, `users/${user.email}/emails`, email.id);
        const existingEmailDoc = await getDoc(emailRef);
        let mergedEmail = { ...sanitizedEmail };

        if (existingEmailDoc.exists()) {
          const existingEmail = existingEmailDoc.data();
          // Preserve status from existing email
          if (existingEmail.status) {
            console.log(`Preserving status '${existingEmail.status}' for email ${email.id}`);
            mergedEmail.status = existingEmail.status;
          }

          // Preserve other important fields
          if (existingEmail.isReplied !== undefined) {
            mergedEmail.isReplied = existingEmail.isReplied;
          }

          if (existingEmail.isNotRelevant !== undefined) {
            mergedEmail.isNotRelevant = existingEmail.isNotRelevant;
          }

          if (existingEmail.matchedFAQ !== undefined) {
            mergedEmail.matchedFAQ = existingEmail.matchedFAQ;
          }
        }

        // Save to individual email document
        await setDoc(emailRef, mergedEmail, { merge: true });

        // If thread ID exists, update thread cache too
        if (email.threadId) {
          const threadRef = doc(db, `users/${user.email}/thread_cache`, email.threadId);
          await setDoc(threadRef, {
            emailId: email.id,
            threadId: email.threadId,
            subject: email.subject,
            sender: email.sender,
            receivedAt: receivedAtTimestamp,
            lastMessageTimestamp: sortTimestamp,
            lastUpdated: Date.now()
          }, { merge: true });
        }

        // If email has content and it's not already in the content collection, save it
        if (email.content) {
          const emailContentRef = doc(db, `users/${user.email}/email_content`, email.id);
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

    console.log(`Saved ${savedCount} emails to Firebase under user ${user.email}`);
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
const loadQuestionsFromFirebase = async (user: { email: string | null } | null) => {
  try {
    const db = getFirebaseDB();
    if (!db) return null;
    if (!user?.email) {
      console.error('Cannot load questions: No user email provided');
      return null;
    }

    const questionsRef = collection(db, `users/${user.email}/email_questions`);
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
const saveQuestionsToFirebase = async (emailId: string, questions: GenericFAQ[], user: { email: string | null } | null) => {
  try {
    const db = getFirebaseDB();
    if (!db) return;
    if (!user?.email) {
      console.error('Cannot save questions: No user email provided');
      return;
    }

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

    const questionRef = doc(db, `users/${user.email}/email_questions`, emailId);
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
const saveExtractedQuestionsToFirebase = async (emailId: string, questions: GenericFAQ[], user: { email: string | null } | null) => {
  try {
    const db = getFirebaseDB();
    if (!db) return false;
    if (!user?.email) {
      console.error('Cannot save extracted questions: No user email provided');
      return false;
    }

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

    const docRef = doc(db, `users/${user.email}/cached_questions`, emailId);
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
const getCachedQuestionsFromFirebase = async (emailId: string, user: { email: string | null } | null) => {
  try {
    const db = getFirebaseDB();
    if (!db) return null;
    if (!user?.email) {
      console.error('Cannot get cached questions: No user email provided');
      return null;
    }

    const docRef = doc(db, `users/${user.email}/cached_questions`, emailId);
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
  similarityThreshold: 70, // Changed from 0.7 to 70 (percentage)
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

// Add this helper function before export default function
const sortEmails = <T extends { sortTimestamp?: number; receivedAt?: string | number; id?: string; threadId?: string }>(
  emails: T[]
): T[] => {
  console.log(`DEBUG: sortEmails - Sorting ${emails.length} emails`);
  return [...emails].sort((a, b) => {
    return ((b.sortTimestamp || 0) - (a.sortTimestamp || 0));
  });
};

// Add this at the top of the file, before any other functions or components
const safeISOString = (date: any): string => {
  try {
    if (!date) return 'N/A';
    if (typeof date === 'number') {
      // Check if timestamp is valid
      if (isNaN(date) || date <= 0 || !isFinite(date)) return 'Invalid Timestamp';
      return new Date(date).toISOString();
    }
    if (date instanceof Date) {
      if (isNaN(date.getTime())) return 'Invalid Date';
      return date.toISOString();
    }
    if (typeof date === 'string') {
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) return 'Invalid Date String';
      return parsed.toISOString();
    }
    return 'Unknown Format';
  } catch (err) {
    console.error('Date conversion error:', err);
    return 'Date Error';
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

  // Add storage for previous email status before marking not relevant
  const prevEmailStatus = useRef<Record<string, string>>({});

  // Add a ref to track emails length to avoid unnecessary effect triggers
  const emailsLengthRef = useRef(0);

  // Load saved settings from localStorage
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('faq_autoreply_settings');
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);

        // Ensure the similarityThreshold is properly formatted as a percentage
        if (parsedSettings.similarityThreshold !== undefined) {
          // If the value is below 1, it's likely stored as a decimal (e.g., 0.8)
          // Convert it to a percentage value (e.g., 80)
          if (parsedSettings.similarityThreshold < 1) {
            parsedSettings.similarityThreshold = parsedSettings.similarityThreshold * 100;
          }
        }

        console.log('Loaded settings from localStorage:', parsedSettings);
        setSettings(parsedSettings);
      }
    } catch (error) {
      console.error('Error loading settings from localStorage:', error);
    }
  }, []);

  // Update the emailsLengthRef whenever emails change
  useEffect(() => {
    emailsLengthRef.current = emails.length;
    // Add debug logging to track email state changes
    console.log('DEBUG: Emails state updated, new count:', emails.length);
    // Log breakdown of email status types
    const statusBreakdown = emails.reduce((acc, email) => {
      const status = email.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('DEBUG: Email status breakdown:', statusBreakdown);
  }, [emails.length, emails]);

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

    console.log('DEBUG: autoCheckNewEmails triggered');

    try {
      // Check if emails array is valid and ready to use
      if (!Array.isArray(emails)) {
        console.warn('Emails not yet initialized for autoCheckNewEmails');
        return; // Exit early - we'll try again later when emails are loaded
      }

      console.log('DEBUG: Current emails count before auto-check:', emails.length);

      // SPECIAL DEBUG: Look for Feb 28th emails
      const feb28 = new Date('2025-02-28').getTime();
      const feb28Emails = emails.filter(e => {
        // Check receivedAt
        let receivedTime = 0;
        if (typeof e.receivedAt === 'number') receivedTime = e.receivedAt;
        else if (typeof e.receivedAt === 'string') receivedTime = new Date(e.receivedAt).getTime();

        // Check sortTimestamp
        const sortTime = typeof e.sortTimestamp === 'number' ? e.sortTimestamp : 0;

        // Check if either timestamp is Feb 28 (within the day)
        const isReceivedFeb28 = receivedTime > 0 &&
          new Date(receivedTime).toDateString() === new Date(feb28).toDateString();
        const isSortFeb28 = sortTime > 0 &&
          new Date(sortTime).toDateString() === new Date(feb28).toDateString();

        return isReceivedFeb28 || isSortFeb28;
      });

      console.log(`DEBUG: Found ${feb28Emails.length} emails from Feb 28:`);
      feb28Emails.forEach((e, i) => {
        console.log(`DEBUG: Feb 28 Email #${i + 1}:`);
        console.log(`  - ID: ${e.id}`);
        console.log(`  - ThreadID: ${e.threadId}`);
        console.log(`  - Subject: ${e.subject || 'Unknown'}`);
        console.log(`  - receivedAt: ${e.receivedAt} (${typeof e.receivedAt === 'number' || !e.receivedAt ? '' : safeISOString(e.receivedAt)})`);
        console.log(`  - sortTimestamp: ${e.sortTimestamp} (${e.sortTimestamp ? safeISOString(e.sortTimestamp) : 'N/A'})`);
        console.log(`  - In emails array: ${emails.some(email => email.id === e.id)}`);
        console.log(`  - Thread ID in existingThreadIds: ${emails.filter(email => email.threadId).map(email => email.threadId).includes(e.threadId)}`);
      });

      // Get the timestamp of the most recent email we have
      let latestEmailTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000; // Default: 30 days ago
      let latestEmailId = null;
      let latestEmailDate = null;

      if (emails.length > 0) {
        try {
          // Safely calculate the maximum timestamp - CRITICAL BUG FIX: Check both sortTimestamp AND receivedAt
          const emailsWithTimestamps = emails
            .filter(e => e && (e.receivedAt || e.sortTimestamp)) // Filter out any invalid emails
            .map(e => {
              // First check sortTimestamp which is usually more reliable
              if (typeof e.sortTimestamp === 'number' && e.sortTimestamp > 0) {
                return {
                  id: e.id,
                  threadId: e.threadId,
                  subject: e.subject || 'Unknown',
                  timestamp: e.sortTimestamp,
                  source: 'sortTimestamp',
                  rawValue: e.sortTimestamp,
                  receivedAt: e.receivedAt
                };
              }

              // Fall back to receivedAt if no valid sortTimestamp
              const timestamp = typeof e.receivedAt === 'number'
                ? e.receivedAt
                : new Date(e.receivedAt).getTime();

              return {
                id: e.id,
                threadId: e.threadId,
                subject: e.subject || 'Unknown',
                timestamp: isNaN(timestamp) ? 0 : timestamp,
                source: 'receivedAt',
                rawValue: e.receivedAt,
                sortTimestamp: e.sortTimestamp
              };
            })
            .filter(item => item.timestamp > 0); // Filter out any invalid timestamps

          // Sort by timestamp (newest first)
          emailsWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);

          // Log the 5 most recent emails for debugging
          console.log('DEBUG: 5 most recent emails by timestamp:');
          emailsWithTimestamps.slice(0, 5).forEach((e, i) => {
            // Safe date conversion function
            const safeFormatDate = (timestamp: number | undefined) => {
              if (!timestamp || typeof timestamp !== 'number' || timestamp <= 0 || isNaN(timestamp)) {
                return 'Invalid Date';
              }
              try {
                return new Date(timestamp).toISOString();
              } catch (err) {
                console.error(`Invalid timestamp value: ${timestamp}`, err);
                return 'Invalid Date Range';
              }
            };

            console.log(`DEBUG:   [${i + 1}] ID: ${e.id}, ThreadID: ${e.threadId}, Subject: ${e.subject}, Timestamp: ${e.timestamp} (${safeFormatDate(e.timestamp)}), Source: ${e.source}`);

            if (e.source === 'sortTimestamp' && (e as any).receivedAt) {
              let receivedDateStr = 'Invalid Date';
              try {
                const receivedAt = (e as any).receivedAt;
                const receivedDate = typeof receivedAt === 'number' ?
                  receivedAt :
                  (typeof receivedAt === 'string' ? new Date(receivedAt).getTime() : 0);

                if (receivedDate > 0 && !isNaN(receivedDate)) {
                  receivedDateStr = safeFormatDate(receivedDate);
                }
              } catch (err) {
                console.error(`Error processing receivedAt: ${(e as any).receivedAt}`, err);
              }
              console.log(`DEBUG:     Also has receivedAt: ${(e as any).receivedAt} (${receivedDateStr})`);
            } else if (e.source === 'receivedAt' && (e as any).sortTimestamp) {
              console.log(`DEBUG:     Also has sortTimestamp: ${(e as any).sortTimestamp} (${safeFormatDate((e as any).sortTimestamp)})`);
            }
          });

          if (emailsWithTimestamps.length > 0) {
            latestEmailTimestamp = emailsWithTimestamps[0].timestamp;
            latestEmailId = emailsWithTimestamps[0].id;
            latestEmailDate = new Date(latestEmailTimestamp);

            // Safe date string conversion
            let dateString = safeISOString(latestEmailTimestamp);

            console.log(`DEBUG: Most recent email: ID=${latestEmailId}, Timestamp=${latestEmailTimestamp} (${dateString})`);

            // CRITICAL: Check future dates
            if (latestEmailTimestamp > Date.now()) {
              console.log(`!!! WARNING: Latest email timestamp (${latestEmailTimestamp}) is in the future! Current time: ${Date.now()} (${safeISOString(new Date())})`);
            }
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
        .filter(Boolean);

      // Safe date formatting helper
      const formatTimestamp = (timestamp: number) => {
        return safeISOString(timestamp);
      };

      console.log(`DEBUG: Checking for emails newer than ${latestEmailDate ? formatTimestamp(latestEmailTimestamp) : 'Unknown'} (Unix: ${latestEmailTimestamp})`);
      console.log(`DEBUG: Have ${existingThreadIds.length} existing thread IDs`);

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
      console.log(`DEBUG: check-new API response: ${JSON.stringify(data, null, 2)}`);

      if (data.newEmailsCount > 0) {
        console.log(`DEBUG: Found ${data.newEmailsCount} new emails out of ${data.totalFound} total emails`);
        console.log(`DEBUG: New thread IDs: ${JSON.stringify(data.newThreadIds || [])}`);
        setNewEmailsCount(data.newEmailsCount);
        setNewThreadIds(data.newThreadIds || []);
        setShowNewEmailsButton(true);
      } else {
        console.log('DEBUG: No new emails found');
      }
    } catch (error) {
      console.error('Error checking for new emails:', error);
    }
  };

  // Function to load new emails when the button is clicked
  const handleLoadNewEmails = async () => {
    if (newEmailsCount > 0) {
      try {
        console.log('DEBUG: handleLoadNewEmails triggered, loading', newEmailsCount, 'new emails');
        setLoadingNewEmails(true);
        // Wait a short time to show the loading state
        await new Promise(resolve => setTimeout(resolve, 300));

        console.log("DEBUG: Current emails count:", emails.length);
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
          const newEmails = data.refreshedEmails.map((email: Email) => {
            // Ensure we always use the actual received timestamp from Gmail
            const receivedTimestamp = typeof email.receivedAt === 'number'
              ? email.receivedAt
              : new Date(email.receivedAt).getTime();

            return {
              ...email,
              sortTimestamp: receivedTimestamp,
              receivedAt: receivedTimestamp
            };
          });

          // Filter out any emails we already have
          const existingIds = new Set(emails.map(e => e.id));
          const uniqueNewEmails = newEmails.filter((e: any) => !existingIds.has(e.id));

          // Double-check timestamps to ensure we're only adding newer emails
          const latestExistingTimestamp = emails.length > 0
            ? Math.max(...emails
              .filter(e => e && e.receivedAt)
              .map(e => typeof e.receivedAt === 'number'
                ? e.receivedAt
                : new Date(e.receivedAt).getTime())
              .filter(t => !isNaN(t) && t > 0))
            : 0;

          console.log('Latest existing timestamp:', new Date(latestExistingTimestamp).toISOString());

          // Only include emails that are newer than our latest email
          const trulyNewEmails = uniqueNewEmails.filter((e: any) => {
            const timestamp = typeof e.receivedAt === 'number'
              ? e.receivedAt
              : new Date(e.receivedAt).getTime();
            const isNewer = timestamp > latestExistingTimestamp;
            if (!isNewer) {
              console.log(`Skipping email ${e.id} with older timestamp ${new Date(timestamp).toISOString()}`);
            }
            return isNewer;
          });

          console.log(`Found ${trulyNewEmails.length} truly new emails out of ${uniqueNewEmails.length} unique emails`);

          if (trulyNewEmails.length > 0) {
            // Merge with existing emails and sort
            const mergedEmails = sortEmails([...emails, ...trulyNewEmails]);

            // Update the emails state with the merged list
            setEmails(mergedEmails);

            // Filter out any potentially undefined or invalid emails
            const validUniqueEmails = mergedEmails.filter((email: any) => email && email.id);

            if (validUniqueEmails.length > 0) {
              // Save the new emails to Firebase
              await saveEmailsToFirebase(validUniqueEmails, user);
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

            toast.success(`Loaded ${trulyNewEmails.length} new email${trulyNewEmails.length === 1 ? '' : 's'}`);
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

    // Check if all questions have matching answered FAQs with valid answers
    const questionsWithAnswers = questions.map(q => {
      // First find all potential FAQ matches that exceed the similarity threshold
      const potentialMatches = answeredFAQs.filter(faq =>
        calculatePatternSimilarity(faq.question, q.question) > similarityThreshold
      );

      // Then check if any of these matches has a proper answer
      const matchedFAQWithAnswer = potentialMatches.find(faq =>
        !!faq.answer && faq.answer.trim() !== ''
      );

      return {
        question: q,
        matchedFAQ: matchedFAQWithAnswer
      };
    });

    // Debug logging to show which questions have valid answers
    console.log('Questions with answers check:', questionsWithAnswers.map(q => ({
      question: q.question.question.substring(0, 30) + '...',
      hasValidAnswer: !!q.matchedFAQ,
      answerPreview: q.matchedFAQ ? (q.matchedFAQ.answer.substring(0, 20) + '...') : 'NO ANSWER'
    })));

    const allQuestionsAnswered = questionsWithAnswers.every(q => q.matchedFAQ);
    console.log(`All questions answered: ${allQuestionsAnswered}`);

    if (allQuestionsAnswered) {
      // Find the best match (highest confidence)
      const bestMatch = questionsWithAnswers.reduce((best, current) => {
        if (!current.matchedFAQ) return best;
        if (!best || (current.matchedFAQ.confidence || 0) > (best.confidence || 0)) {
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
    console.log('=== LOAD EMAILS FUNCTION CALLED ===');
    console.log('Parameters:', { skipCache, pageNumber });
    console.log('State:', {
      loading,
      loadingMore,
      hasMore,
      page,
      'lastLoadTime.current': lastLoadTime.current,
      'MIN_FETCH_INTERVAL': MIN_FETCH_INTERVAL,
      'timeSinceLastLoad': now - lastLoadTime.current
    });

    if (now - lastLoadTime.current < MIN_FETCH_INTERVAL && !skipCache) {
      console.error('⚠️ Skipping loadEmails due to rate limit');
      return;
    }

    // Clear any pending timeouts
    if (loadTimeout.current) {
      clearTimeout(loadTimeout.current);
    }

    // If pageNumber is provided and greater than 1, we're loading more emails
    const isLoadingMore = pageNumber && pageNumber > 1;
    console.log("📊 loadEmails PAGINATION:", {
      pageNumber,
      isLoadingMore,
      'current loadingMore state': loadingMore
    });

    if (isLoadingMore) {
      console.log("🔄 Setting loadingMore = true for pagination");
      setLoadingMore(true);
    } else {
      console.log("🔄 Setting loading = true for initial load");
      setLoading(true);
    }

    try {
      // Only use cache for initial load, not for pagination
      if (!isLoadingMore) {
        console.log("💾 Checking cache for initial load");
        const cached = !skipCache ? loadFromCache(CACHE_KEYS.EMAILS) : null;
        if (cached && !skipCache) {
          // Handle both formats: direct array or nested in emails property
          const emailsData = Array.isArray(cached) ? cached : cached.emails;
          if (emailsData && emailsData.length > 0) {
            // Cast the cached data to the correct type before setting
            console.log('DEBUG: Using cached emails:', emailsData.length);

            // Ensure cached emails are sorted
            const sortedCachedEmails = sortEmails(emailsData as ExtendedEmail[]) as ExtendedEmail[];
            setEmails(sortedCachedEmails);
            setLastFetchTimestamp(Date.now());
            setLoading(false);
            return;
          }
        }
      }

      // For pagination (Load 5 More), fetch directly from Gmail API
      if (isLoadingMore) {
        console.log("📥 PAGINATION: Fetching directly from Gmail API");
        console.log(`Current emails state: page=${page}, emails.length=${emails.length}`);
        console.log(`Loading page ${pageNumber} of emails from Gmail API... isLoadingMore=${isLoadingMore}`);

        if (!user?.accessToken) {
          console.error("No access token available");
          toast.error("Authentication error. Please sign in again.");
          setLoadingMore(false);
          return;
        }

        // Find the oldest email timestamp to ensure we get older emails
        let oldestTimestamp: number | undefined = undefined;
        if (emails.length > 0) {
          console.log('Finding oldest email timestamp from', emails.length, 'emails');

          // Get all timestamps from emails
          const timestamps = emails.map(email => {
            return email.sortTimestamp ||
              (email.receivedAt ?
                (typeof email.receivedAt === 'number' ?
                  email.receivedAt :
                  new Date(email.receivedAt).getTime())
                : 0);
          }).filter(timestamp => timestamp > 0);

          // Sort timestamps in ascending order (oldest first)
          timestamps.sort((a, b) => a - b);

          // Get the oldest timestamp
          if (timestamps.length > 0) {
            oldestTimestamp = timestamps[0];

            // Subtract 1 second to ensure we get emails older than this one
            // This helps prevent edge cases where emails have the exact same timestamp
            oldestTimestamp = oldestTimestamp - 1000;

            console.log('Oldest email timestamp:', {
              timestamp: oldestTimestamp,
              date: new Date(oldestTimestamp).toISOString()
            });
          }
        }

        // Build the API URL with pagination and oldest timestamp
        let apiUrl = `/api/emails/inbox?page=${pageNumber}&limit=5`;
        if (oldestTimestamp) {
          apiUrl += `&oldestTimestamp=${oldestTimestamp}`;
          console.log(`🔍 Requesting emails older than ${new Date(oldestTimestamp).toISOString()}`);
        } else {
          console.warn('⚠️ No oldest timestamp found, may fetch duplicate emails');
        }

        console.log('🔄 About to make API request to:', apiUrl);
        console.log('Request headers:', {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken ? 'VALID_TOKEN_EXISTS' : 'NO_TOKEN'}`
        });

        // Declare data variable outside the try/catch block
        let data;

        try {
          // Fetch older emails from Gmail API with pagination
          console.log('⚡ Executing fetch request...');
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${user.accessToken}`
            }
          });

          console.log('✅ Got response:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch older emails: ${response.statusText}`);
          }

          data = await response.json();
          console.log(`Fetched ${data.emails?.length || 0} older emails from Gmail API (page ${pageNumber})`);
        } catch (error) {
          console.error('🚨 Error making API request:', error);
          throw error; // Re-throw to be handled by the outer catch block
        }

        // Check if data exists and has emails before proceeding
        if (data && data.emails && data.emails.length > 0) {
          // Transform the emails to match ExtendedEmail type
          const transformedEmails = data.emails.map((email: any) => {
            // Log the original timestamp data
            console.log(`Email ${email.id} timestamps: internalDate=${email.internalDate}, receivedAt=${email.receivedAt}`);

            // Ensure proper timestamp handling
            let receivedAt = email.receivedAt || null;
            let sortTimestamp = null;

            // If email has internalDate from Gmail, use it
            if (email.internalDate) {
              const internalDateTimestamp = parseInt(email.internalDate);
              if (!isNaN(internalDateTimestamp)) {
                sortTimestamp = internalDateTimestamp;
                if (!receivedAt) {
                  receivedAt = new Date(internalDateTimestamp).toISOString();
                }
              }
            }

            // Ensure all required properties exist for ExtendedEmail type
            return {
              id: email.id || '',
              threadId: email.threadId || '',
              subject: email.subject || '',
              sender: email.sender || '',
              content: email.content || '',
              receivedAt: receivedAt || new Date().toISOString(),
              sortTimestamp: sortTimestamp || (receivedAt ? new Date(receivedAt).getTime() : Date.now()),
              // Copy other properties from the original email
              ...email,
            } as ExtendedEmail;
          });

          // Add the new emails to the existing list
          setEmails(prevEmails => {
            // Filter out any duplicates
            const existingIds = new Set(prevEmails.map((e: ExtendedEmail) => e.id));
            const uniqueNewEmails = transformedEmails.filter((e: ExtendedEmail) => !existingIds.has(e.id));

            console.log(`Found ${uniqueNewEmails.length} new unique emails out of ${transformedEmails.length} fetched`);

            if (uniqueNewEmails.length === 0) {
              console.warn('⚠️ No new unique emails found, may need to adjust oldestTimestamp logic');
            }

            // Combine and sort
            const combinedEmails = [...prevEmails, ...uniqueNewEmails];
            return sortEmails(combinedEmails) as ExtendedEmail[];
          });

          // Update pagination state
          setPage(pageNumber);
          setHasMore(data.hasMore);

          // Save the combined emails to Firebase for persistence
          saveEmailsToFirebase(transformedEmails, user);

          // Load any existing questions for the new emails
          for (const email of transformedEmails) {
            getQuestionsForEmail(email.id).then(questions => {
              if (questions && questions.length > 0) {
                setEmailQuestions(prev => {
                  const newMap = new Map(prev);
                  newMap.set(email.id, questions);
                  return newMap;
                });
                console.log(`Loaded ${questions.length} existing questions for email ${email.id}`);
              }
            }).catch(error => {
              console.error(`Error loading questions for email ${email.id}:`, error);
            });
          }
        } else {
          // If no more emails were found, update hasMore
          setHasMore(false);
        }

        setLastFetchTimestamp(Date.now());
        setLoadingMore(false);
        return;
      }

      // For initial load, try Firebase first
      console.log("Loading fresh emails...");

      // Actual fetch logic here - loading from Firebase
      const firebaseEmails = await loadEmailsFromFirebase(user);
      console.log('DEBUG: Loaded from Firebase:', firebaseEmails?.length || 0);

      const readyToReplyEmails = await loadReadyToReplyFromFirebase(user);
      console.log('DEBUG: Ready to reply emails from Firebase:', readyToReplyEmails?.length || 0);

      if (firebaseEmails && firebaseEmails.length > 0) {
        console.log(`Loaded ${firebaseEmails.length} emails from Firebase`);

        // Use our sortEmails helper function for consistent sorting
        console.log('DEBUG: Sorting emails using sortEmails helper');
        const sortedEmails = sortEmails(firebaseEmails) as ExtendedEmail[];

        console.log('DEBUG: Setting sorted emails:', sortedEmails.length);
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
      setLoading(false);
      setLoadingMore(false);
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

      console.log('DEBUG: Initialize function started');

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
            console.log('DEBUG: Emails loaded from local storage cache:', emailsData.length);

            // Sort emails by timestamp with most recent first before setting the state
            const sortedCachedEmails = sortEmails(emailsData) as ExtendedEmail[];

            console.log('DEBUG: Setting sorted cached emails:', sortedCachedEmails.length);
            setEmails(sortedCachedEmails);
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
          const firebaseEmails = await loadEmailsFromFirebase(user);
          console.log('DEBUG: Emails loaded from Firebase:', firebaseEmails?.length || 0);

          const readyToReplyEmails = await loadReadyToReplyFromFirebase(user);
          console.log('DEBUG: Ready to reply emails from Firebase:', readyToReplyEmails?.length || 0);

          if (firebaseEmails && firebaseEmails.length > 0) {
            setEmails(prevEmails => {
              const existingIds = new Set(prevEmails.map(e => e.id));
              const newEmails = firebaseEmails.filter(e => !existingIds.has(e.id));
              console.log('DEBUG: New unique emails from Firebase:', newEmails.length);

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

              // Sort the merged array by timestamp with most recent first
              const combinedEmails = [...prevEmails, ...newEmails];
              // Use our sortEmails helper for consistent sorting
              return sortEmails(combinedEmails) as ExtendedEmail[];
            });
          }

          // Load cached questions from Firebase
          console.log('Loading cached questions from Firebase...');
          const cachedQuestions = await loadQuestionsFromFirebase(user);
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
            const questions = await getCachedQuestionsFromFirebase(email.id, user);
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
    console.log('Current user state:', {
      email: user?.email,
      hasAccessToken: !!user?.accessToken,
      accessToken: user?.accessToken ? `${user.accessToken.substring(0, 10)}...` : null
    });

    const loadFAQs = async () => {
      if (!user?.accessToken) {
        console.log('No access token available, skipping FAQ load');
        return;
      }

      try {
        setLoadingFAQs(true);

        // Only fetch from API - remove cache logic to ensure fresh data
        console.log('Fetching FAQs from API with token:', user.accessToken.substring(0, 10) + '...');
        const response = await fetch('/api/faq/list', {
          headers: {
            Authorization: `Bearer ${user.accessToken}`
          }
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('FAQ API error:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData
          });
          throw new Error(errorData.error || 'Failed to fetch FAQs');
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
        toast.error(error instanceof Error ? error.message : 'Failed to load FAQ library');
        setAnsweredFAQs([]);
      } finally {
        setLoadingFAQs(false);
      }
    };

    loadFAQs();

    // Add this helper function to debug the FAQ library
    debugFAQLibrary();

    return () => {
      console.log('Cleaning up FAQ loading effect');
    };
  }, [user?.accessToken]); // Add user.accessToken as a dependency

  // Add this helper function to debug the FAQ library
  const debugFAQLibrary = () => {
    console.log('=== DEBUG FAQ LIBRARY ===');
    console.log(`Total FAQs in library: ${answeredFAQs.length}`);

    const faqsWithAnswers = answeredFAQs.filter(faq => !!faq.answer && faq.answer.trim() !== '');
    console.log(`FAQs with valid answers: ${faqsWithAnswers.length}`);

    console.log('All FAQs with answers:');
    faqsWithAnswers.forEach((faq, index) => {
      console.log(`${index + 1}. Q: ${faq.question}`);
      console.log(`   A: ${faq.answer?.substring(0, 50)}${faq.answer && faq.answer.length > 50 ? '...' : ''}`);
    });

    console.log('=== END DEBUG FAQ LIBRARY ===');
  };

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
            matchedFAQ: {
              question: matchedFAQ.question,
              answer: matchedFAQ.answer || '',
              confidence: matchedFAQ.confidence || 1  // Provide default value
            },
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
                saveReadyToReplyToFirebase(updatedReadyToReply, user);

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

  const handleLoadMore = useCallback(() => {
    console.log('Load more clicked!');
    console.log('Current state before load more:', {
      loading,
      isLoading,
      loadingMore,
      hasMore,
      page,
      user: user ? 'User exists' : 'No user',
      userAccessToken: user?.accessToken ? 'Token exists' : 'No token',
      emailsCount: emails.length
    });

    // Log the timestamps of current emails to help diagnose issues
    if (emails.length > 0) {
      console.log('CURRENT EMAILS TIMESTAMPS:');
      const sortedEmails = [...emails].sort((a, b) => {
        const aTime = a.sortTimestamp || (a.receivedAt ? new Date(a.receivedAt).getTime() : 0);
        const bTime = b.sortTimestamp || (b.receivedAt ? new Date(b.receivedAt).getTime() : 0);
        return aTime - bTime; // Ascending order (oldest first)
      });

      // Log oldest 3 and newest 3 emails
      const oldestEmails = sortedEmails.slice(0, 3);
      const newestEmails = sortedEmails.slice(-3);

      oldestEmails.forEach((email, i) => {
        const timestamp = email.sortTimestamp || (email.receivedAt ? new Date(email.receivedAt).getTime() : 0);
        console.log(`Oldest #${i + 1}: ID=${email.id}, Subject="${email.subject}", Timestamp=${timestamp}, Date=${new Date(timestamp).toISOString()}`);
      });

      newestEmails.forEach((email, i) => {
        const timestamp = email.sortTimestamp || (email.receivedAt ? new Date(email.receivedAt).getTime() : 0);
        console.log(`Newest #${i + 1}: ID=${email.id}, Subject="${email.subject}", Timestamp=${timestamp}, Date=${new Date(timestamp).toISOString()}`);
      });
    }

    if (!loading && !loadingMore && hasMore) {
      const nextPage = page + 1;
      console.log(`Loading more emails (page ${nextPage})...`);

      // Make sure we're setting the page state before calling loadEmails
      setPage(nextPage);

      // Set loading state for 'Load More'
      setLoadingMore(true);
      console.log('SETTING loadingMore = true');

      // Now call loadEmails with the next page number - pass skipCache=true to bypass rate limit check
      console.log(`Calling loadEmails with skipCache=true, pageNumber=${nextPage}`);
      loadEmails(true, nextPage);
    } else {
      console.log('⚠️ Not loading more because:', {
        loading: loading ? 'Already loading' : 'Not loading',
        loadingMore: loadingMore ? 'Already loading more' : 'Not loading more',
        hasMore: hasMore ? 'Has more' : 'No more emails'
      });
    }
  }, [loading, loadingMore, hasMore, page, loadEmails, user, emails]);

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
        saveReadyToReplyToFirebase(updatedReadyToReply, user);

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
          Authorization: `Bearer ${user?.accessToken}`
        },
        body: JSON.stringify({
          id: faq.id
        })
      });

      if (!response.ok) {
        throw new Error('Failed to delete FAQ');
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
    // Validation checks
    if (!user?.accessToken) {
      console.error('No access token available');
      toast.error('Authentication required. Please try logging in again.');
      return;
    }

    if (!selectedFAQ) {
      console.error('No FAQ selected');
      toast.error('No FAQ selected to save');
      return;
    }

    if (!answer || !answer.trim()) {
      console.error('No answer provided');
      toast.error('Please provide an answer');
      return;
    }

    try {
      console.log('Saving FAQ with token:', user.accessToken.substring(0, 10) + '...');
      // Then save to FAQ library
      const response = await fetch('/api/faq/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.accessToken}`
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
        const errorData = await response.json();
        console.error('FAQ save error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        throw new Error(errorData.error || errorData.details || 'Failed to save FAQ');
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
      setShowAnswerModal(false);
    } catch (error) {
      console.error('Error saving FAQ:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save FAQ');
    }
  };

  const handleIgnoreFAQ = (faq: GenericFAQ) => {
    setGenericFAQs(prev => prev.filter(f => f.question !== faq.question));
    toast.success('FAQ ignored');
  };

  const handleMarkNotRelevant = async (emailId: string) => {
    try {
      // Store the email's current status before updating
      const emailToMark = emails.find(e => e.id === emailId);
      if (emailToMark) {
        prevEmailStatus.current[emailId] = emailToMark.status || 'pending';
      }

      // Optimistic UI update
      setEmails(prev =>
        sortEmails(prev.map(email =>
          email.id === emailId
            ? { ...email, isNotRelevant: true, status: 'not_relevant' }
            : email
        ))
      );

      // Show immediate feedback to user
      toast.success('Email marked as not relevant');

      try {
        const firebaseDB = getFirebaseDB();
        if (firebaseDB && emailId) {
          // Save to not_relevant_emails collection
          const notRelevantRef = doc(firebaseDB, FIREBASE_COLLECTIONS.NOT_RELEVANT, emailId);
          await setDoc(notRelevantRef, {
            emailId: emailId,
            threadId: emails.find(e => e.id === emailId)?.threadId || '',
            markedAt: new Date().toISOString(),
            markedBy: user?.email || 'unknown'
          });

          // Update (or create) the email document in emails collection
          // Using setDoc with merge:true instead of updateDoc to handle cases where the document doesn't exist
          const emailRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAILS, emailId);
          await setDoc(emailRef, {
            id: emailId,
            threadId: emails.find(e => e.id === emailId)?.threadId || '',
            status: 'not_relevant',
            subject: emails.find(e => e.id === emailId)?.subject || '',
            sender: emails.find(e => e.id === emailId)?.sender || '',
            receivedAt: emails.find(e => e.id === emailId)?.receivedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }, { merge: true });

          // Also update the email_cache entry to ensure consistency across refreshes
          const emailCacheRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAIL_CACHE, emailId);
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
          sortEmails(prev.map(email =>
            email.id === emailId
              ? { ...email, isNotRelevant: false, status: (prevEmailStatus.current[emailId] || 'pending') as ExtendedEmail['status'] }
              : email
          ))
        );
      }
    } catch (error) {
      // Revert optimistic update
      setEmails(prev =>
        sortEmails(prev.map(email =>
          email.id === emailId
            ? { ...email, isNotRelevant: false, status: (prevEmailStatus.current[emailId] || 'pending') as ExtendedEmail['status'] }
            : email
        ))
      );

      // ... existing code ...
    }
  };

  const handleUndoNotRelevant = async (emailId: string) => {
    try {
      // Optimistic UI update
      setEmails(prev =>
        sortEmails(prev.map(email =>
          email.id === emailId
            ? { ...email, isNotRelevant: false, status: 'pending' }
            : email
        ))
      );

      // Show immediate feedback to user
      toast.success('Email marked as relevant again');

      // Tracking for UI loading indicator
      setProcessingUndoNotRelevant(prev => new Set(prev).add(emailId));

      try {
        const firebaseDB = getFirebaseDB();
        if (firebaseDB && emailId) {
          // Remove from not_relevant_emails collection
          const notRelevantRef = doc(firebaseDB, FIREBASE_COLLECTIONS.NOT_RELEVANT, emailId);
          await deleteDoc(notRelevantRef);

          // Update the email document in emails collection
          const emailRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAILS, emailId);
          await setDoc(emailRef, {
            status: 'pending',
            updatedAt: new Date().toISOString()
          }, { merge: true });

          // Also update the email_cache entry to ensure consistency across refreshes
          const emailCacheRef = doc(firebaseDB, FIREBASE_COLLECTIONS.EMAIL_CACHE, emailId);
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
          sortEmails(prev.map(email =>
            email.id === emailId
              ? { ...email, isNotRelevant: true, status: 'not_relevant' }
              : email
          ))
        );
      } finally {
        setProcessingUndoNotRelevant(prev => {
          const updated = new Set(prev);
          updated.delete(emailId);
          return updated;
        });
      }
    } catch (error) {
      // Revert optimistic update
      setEmails(prev =>
        sortEmails(prev.map(email =>
          email.id === emailId
            ? { ...email, isNotRelevant: true, status: 'not_relevant' }
            : email
        ))
      );

      // ... existing code ...
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
        saveQuestionsToFirebase(email.id, allQuestions, user),
        saveExtractedQuestionsToFirebase(email.id, allQuestions, user)
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
        matchedFAQ: matchedFAQ ? {
          question: matchedFAQ.question,
          answer: matchedFAQ.answer,
          confidence: matchedFAQ.confidence || 1  // Provide default value if undefined
        } : undefined
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
        saveEmailsToFirebase([updatedEmail], user);
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
              className="text-gray-400 hover:text-gray-600 transition-colors p-1.5 hover:bg-gray-50 rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh email content"
              disabled={email.isRefreshing}
            >
              <RefreshCw
                className={`h-4 w-4 ${email.isRefreshing ? 'animate-spin text-blue-600' : ''}`}
              />
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
    console.log('DEBUG: Total emails before filtering:', emails.length);

    // Add debug logging to see what emails are being filtered out
    const repliedEmails = emails.filter(email => email.isReplied);
    const notRelevantEmails = emails.filter(email => email.status === 'not_relevant');
    const matchedFAQEmails = emails.filter(email => email.matchedFAQ && email.id && ((emailQuestions.get(email.id)?.length ?? 0) > 0));
    const processedEmails = emails.filter(email => email.status === 'processed');
    const userLastSenderEmails = emails.filter(email => isUserLastSender(email, user));
    const readyToReplyEmails = emails.filter(email => isEmailReadyForReply(email, emailQuestions, user));

    console.log('DEBUG: Filtering breakdown:');
    console.log('- Replied emails:', repliedEmails.length);
    console.log('- Not relevant emails:', notRelevantEmails.length);
    console.log('- Matched FAQ emails:', matchedFAQEmails.length);
    console.log('- Processed emails:', processedEmails.length);
    console.log('- User last sender emails:', userLastSenderEmails.length);
    console.log('- Ready to reply emails:', readyToReplyEmails.length);

    // Simplified filtering logic: show in Unanswered if not ready for reply, not replied, not not-relevant, and user not last sender
    const filteredEmails = emails.filter(email =>
      !email.isReplied &&
      email.status !== 'not_relevant' &&
      !isUserLastSender(email, user) &&
      !isEmailReadyForReply(email, emailQuestions, user)
    );

    console.log('DEBUG: Emails after filtering:', filteredEmails.length);

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
                    onClick={() => handleMarkNotRelevant(email.id)}
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
                      // SIMPLIFIED APPROACH:
                      // 1. Find all potential matches that exceed similarity threshold
                      const potentialMatches = answeredFAQs.filter(faq =>
                        calculatePatternSimilarity(faq.question, question.question) > similarityThreshold
                      );

                      // 2. Check if any match has a valid answer
                      const matchWithAnswer = potentialMatches.find(match =>
                        !!match.answer && match.answer.trim() !== ''
                      );

                      // 3. Only consider it answered if we found a match with an answer
                      const isAnswered = !!matchWithAnswer;

                      // Special debugging for the problematic question about features not appearing
                      const isFeatureQuestion = question.question?.toLowerCase().includes('feature is not appearing');
                      if (isFeatureQuestion) {
                        console.log('🔎 FEATURE QUESTION CHECK:', {
                          questionText: question.question,
                          similarityThreshold: similarityThreshold,
                          potentialMatches: potentialMatches.map(m => ({
                            matchQuestion: m.question,
                            similarity: calculatePatternSimilarity(m.question, question.question),
                            hasAnswer: !!m.answer && m.answer.trim() !== '',
                            answerPreview: m.answer ? m.answer.substring(0, 30) : 'NO ANSWER'
                          })),
                          hasValidMatch: isAnswered,
                          matchWithAnswer: matchWithAnswer ? {
                            question: matchWithAnswer.question,
                            answerPreview: matchWithAnswer.answer.substring(0, 30)
                          } : 'NONE'
                        });
                      }

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
              onClick={handleLoadMore}
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
    // Add debug logging to understand why emails aren't showing in Ready to Reply
    console.log('DEBUG: Checking Ready to Reply criteria for emails');

    // Count emails that meet each criterion
    const hasMatchedFAQ = emails.filter(e => e.matchedFAQ).length;
    const notReplied = emails.filter(e => !e.isReplied).length;
    const hasProcessedStatus = emails.filter(e => e.status === 'processed').length;
    const hasSuggestedReply = emails.filter(e => e.suggestedReply).length;
    const notUserLastSender = emails.filter(e => !isUserLastSender(e, user)).length;

    console.log('DEBUG: Ready criteria breakdown:');
    console.log('- Total emails:', emails.length);
    console.log('- Has matchedFAQ:', hasMatchedFAQ);
    console.log('- Not replied:', notReplied);
    console.log('- Processed status:', hasProcessedStatus);
    console.log('- Has suggested reply:', hasSuggestedReply);
    console.log('- User not last sender:', notUserLastSender);

    // Detailed analysis of why emails aren't ready
    const emailsWithQuestions = emails.filter(e => {
      const questions = emailQuestions.get(e.id);
      return questions && questions.length > 0;
    }).length;
    const emailsWithAllAnsweredQuestions = emails.filter(e => areAllQuestionsAnswered(e)).length;

    console.log('- Has questions:', emailsWithQuestions);
    console.log('- All questions have answers:', emailsWithAllAnsweredQuestions);

    // Use our standard isEmailReadyForReply helper instead of duplicating logic
    const readyEmails = emails.filter(email => isEmailReadyForReply(email, emailQuestions, user));

    console.log('DEBUG: Ready for reply emails count:', readyEmails.length);

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
                  onClick={() => handleUndoNotRelevant(email.id)}
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
  const loadReadyToReplyFromFirebase = async (user: { email: string | null } | null) => {
    try {
      const db = getFirebaseDB();
      if (!db) return null;
      if (!user?.email) {
        console.error('Cannot load ready to reply emails: No user email provided');
        return null;
      }

      const readyRef = doc(db, `users/${user.email}/ready_to_reply`, 'latest');
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
  const saveReadyToReplyToFirebase = async (emails: ExtendedEmail[], user: { email: string | null } | null) => {
    try {
      const db = getFirebaseDB();
      if (!db) return;
      if (!user?.email) {
        console.error('Cannot save ready to reply emails: No user email provided');
        return;
      }

      const sanitizedEmails = emails.map(email => ({
        id: email.id,
        threadId: email.threadId,
        subject: email.subject,
        sender: email.sender,
        receivedAt: email.receivedAt,
        status: email.status,
        matchedFAQ: email.matchedFAQ ? {
          question: email.matchedFAQ.question || '',
          answer: email.matchedFAQ.answer || '',
          confidence: email.matchedFAQ.confidence || 0
        } : null,
        content: typeof email.content === 'string'
          ? email.content
          : (email.content?.text || email.content?.html || ''),
        suggestedReply: email.suggestedReply || '',
        isReplied: !!email.isReplied,
        isNotRelevant: !!email.isNotRelevant,
        sortTimestamp: email.sortTimestamp || Date.now()
      }));

      const readyRef = doc(db, `users/${user.email}/ready_to_reply`, 'latest');
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
        throw new Error('User access token not available');
      }

      let currentAccessToken = user.accessToken;

      // Set loading state for this specific email
      setEmails((prevEmails) => {
        return prevEmails.map((e) => {
          if (e.threadId === email.threadId) {
            return { ...e, isRefreshing: true };
          }
          return e;
        });
      });

      const makeRequest = async (token: string) => {
        const response = await fetch('/api/emails/refresh-single', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            threadId: email.threadId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          if (errorData.error === 'Invalid Credentials' && refreshAccessToken) {
            // Try to refresh the token
            const newToken = await refreshAccessToken();
            if (newToken) {
              return makeRequest(newToken);
            }
          }
          throw new Error(errorData.error || 'Failed to refresh email');
        }

        return response;
      };

      const response = await makeRequest(currentAccessToken);
      const data = await response.json();

      // Update the email content and preserve the original timestamp for sorting
      setEmails((prevEmails) => {
        const updatedEmails = prevEmails.map((e) => {
          if (e.threadId === email.threadId) {
            // Use the receivedAt timestamp from the API response for sorting
            // This preserves the original email received time
            const receivedAt = data.receivedAt || e.receivedAt;
            const sortTimestamp = typeof receivedAt === 'number'
              ? receivedAt
              : typeof receivedAt === 'string'
                ? new Date(receivedAt).getTime()
                : e.sortTimestamp;

            return {
              ...e,
              ...data,
              isRefreshing: false,
              receivedAt: receivedAt,
              sortTimestamp: sortTimestamp,
              lastRefreshed: Date.now() // Track when it was refreshed separately
            };
          }
          return e;
        });

        return sortEmails(updatedEmails) as ExtendedEmail[];
      });

      // Save to Firebase
      const firebaseDB = getFirebaseDB();
      if (firebaseDB && user?.email) {
        // Use email for the path instead of uid
        const emailsRef = collection(firebaseDB, `users/${user.email}/emails`);
        const emailDoc = doc(emailsRef, email.threadId);

        // Preserve the original receivedAt timestamp
        const receivedAt = data.receivedAt || email.receivedAt;
        const sortTimestamp = typeof receivedAt === 'number'
          ? receivedAt
          : typeof receivedAt === 'string'
            ? new Date(receivedAt).getTime()
            : email.sortTimestamp;

        await setDoc(emailDoc, {
          ...email,
          ...data,
          receivedAt: receivedAt,
          sortTimestamp: sortTimestamp,
          lastRefreshed: Date.now()
        }, { merge: true });
      }
    } catch (error) {
      console.error('Error refreshing email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to refresh email');
    } finally {
      // Reset loading states
      setEmails((prevEmails) => {
        return prevEmails.map((e) => {
          if (e.threadId === email.threadId) {
            return { ...e, isRefreshing: false };
          }
          return e;
        });
      });
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
      await saveEmailsToFirebase(resetEmails, user);

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
        if (!db || !user?.email) {
          console.error('Cannot clear ready to reply collection: Database or user email not available');
          return;
        }
        const readyRef = doc(db, `users/${user.email}/ready_to_reply`, 'latest');
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

  // Add a helper function to check if all questions for an email are answered
  const areAllQuestionsAnswered = (email: ExtendedEmail): boolean => {
    const questions = emailQuestions.get(email.id) || [];
    if (questions.length === 0) return false;

    // Check each question to see if it has a matching FAQ with a valid answer
    const questionsWithAnswerStatus = questions.map(question => {
      // First get all potential FAQ matches that exceed the similarity threshold
      const potentialMatches = answeredFAQs.filter(faq =>
        calculatePatternSimilarity(faq.question, question.question) > similarityThreshold
      );

      // Then check if any of these matches has a proper answer
      const matchedFAQWithAnswer = potentialMatches.find(faq =>
        !!faq.answer && faq.answer.trim() !== ''
      );

      // Special debugging for the problematic question about features not appearing
      const isFeatureQuestion = question.question?.toLowerCase().includes('feature is not appearing');
      if (isFeatureQuestion) {
        console.log('🔎 FEATURE QUESTION IN areAllQuestionsAnswered:', {
          emailId: email.id,
          questionText: question.question,
          similarityThreshold,
          potentialMatches: potentialMatches.map(m => ({
            matchQuestion: m.question,
            similarity: calculatePatternSimilarity(m.question, question.question),
            hasAnswer: !!m.answer && m.answer.trim() !== ''
          })),
          isAnswered: !!matchedFAQWithAnswer
        });
      }

      // Only consider it answered if we found a match with a non-empty answer
      return {
        question: question.question,
        isAnswered: !!matchedFAQWithAnswer
      };
    });

    // Log detailed information for this email
    if (questionsWithAnswerStatus.some(q => q.question.toLowerCase().includes('feature is not appearing'))) {
      console.log('🔎 Email questions answer status:', email.id, questionsWithAnswerStatus);
    }

    return questionsWithAnswerStatus.every(q => q.isAnswered);
  };

  // Use this helper consistently across the app
  const isEmailReadyForReply = (email: ExtendedEmail, emailQuestions: Map<string, GenericFAQ[]>, user: any) => {
    // First check basic conditions
    if (!email || !email.id || isUserLastSender(email, user) ||
      email.isReplied || email.status === 'not_relevant') {
      return false;
    }

    // Check for matched FAQ and questions
    const hasMatchedFAQ = email.matchedFAQ !== undefined;

    // Use the helper function to check if all questions have answers
    const allQuestionsAnswered = areAllQuestionsAnswered(email);

    // Additional check for suggested reply
    const hasSuggestedReply = email.suggestedReply !== undefined;

    // Status check
    const isProcessed = email.status === 'processed';

    console.log('DEBUG: Email ready check:', email.id, {
      hasMatchedFAQ,
      allQuestionsAnswered,
      hasSuggestedReply,
      isProcessed
    });

    // Email is ready for reply if all conditions are met
    return hasMatchedFAQ &&
      allQuestionsAnswered &&
      hasSuggestedReply &&
      isProcessed;
  };

  // Add this useEffect after other useEffects
  // Add a useEffect to ensure emails are always sorted
  useEffect(() => {
    // Only run this if emails have been loaded (is an array) and has items
    if (Array.isArray(emails) && emails.length > 0) {
      // Check if the emails are already sorted by timestamp
      const sortedEmails = sortEmails(emails as ExtendedEmail[]);
      const currentTimestamps = emails.map(e => e.sortTimestamp || 0);
      const sortedTimestamps = sortedEmails.map(e => e.sortTimestamp || 0);

      // Compare arrays to check if they're already sorted
      const isAlreadySorted = currentTimestamps.every((val, idx) => val === sortedTimestamps[idx]);

      if (!isAlreadySorted) {
        console.log('DEBUG: Emails detected out of order - resorting');
        // Use setTimeout to avoid state update during render
        setTimeout(() => {
          setEmails(sortedEmails as ExtendedEmail[]);
        }, 0);
      }
    }
  }, [emails]); // Run whenever emails change

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

          {/* Debug button only in development */}
          {process.env.NODE_ENV === 'development' && (
            <button
              onClick={debugCheckTimestamp}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Debug Timestamp
            </button>
          )}

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

  // Add the refreshAllEmailsFromGmail function
  const refreshAllEmailsFromGmail = async () => {
    if (!user?.accessToken) {
      toast.error('Please sign in to refresh emails');
      return;
    }

    try {
      setManualRefreshTriggered(true);
      setIsLoading(true);
      toast.info('Refreshing emails from Gmail...');

      const response = await fetch('/api/emails/refresh-all', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to refresh emails');
      }

      const data = await response.json();
      console.log('Refreshed emails:', data.emails.length);

      // Merge with existing emails, preserving not_relevant status
      setEmails(prevEmails => {
        const emailMap = new Map();

        // First add all existing emails to the map
        prevEmails.forEach(email => {
          emailMap.set(email.threadId, email);
        });

        // Then update with new emails, but preserve not_relevant status
        data.emails.forEach((newEmail: any) => {
          const existingEmail = emailMap.get(newEmail.threadId);

          if (existingEmail) {
            // Preserve not_relevant status if it was set
            const mergedEmail = {
              ...newEmail,
              isNotRelevant: existingEmail.isNotRelevant || false,
              status: existingEmail.isNotRelevant ? 'not_relevant' : (newEmail.status || 'pending')
            };
            emailMap.set(newEmail.threadId, mergedEmail);
          } else {
            emailMap.set(newEmail.threadId, newEmail);
          }
        });

        const mergedEmails = Array.from(emailMap.values());

        // Use the sortEmails helper function
        return sortEmails(mergedEmails);
      });

      toast.success(`Refreshed ${data.emails.length} emails`);
    } catch (error) {
      console.error('Error refreshing emails:', error);
      toast.error('Failed to refresh emails');
    } finally {
      setIsLoading(false);
      setManualRefreshTriggered(false);
    }
  };

  // Add the handleSaveSettings function
  const handleSaveSettings = (newSettings: AutoReplySettings) => {
    // Make a copy of the settings to avoid directly modifying the parameter
    const settingsToSave = { ...newSettings };

    // Ensure similarity threshold is consistently stored as a percentage (1-100)
    // This ensures we don't accidentally convert 80% to 0.8% on reload
    if (settingsToSave.similarityThreshold < 1) {
      settingsToSave.similarityThreshold = settingsToSave.similarityThreshold * 100;
    }

    setSettings(settingsToSave);

    // Save settings to localStorage
    localStorage.setItem('faq_autoreply_settings', JSON.stringify(settingsToSave));
    toast.success('Settings saved successfully');
    setShowSettingsModal(false);
  };

  // New function to completely reset emails and fetch fresh ones from Gmail
  const resetAllEmailsAndRefresh = async () => {
    try {
      const db = getFirebaseDB();
      if (!db || !user?.accessToken) {
        toast.error('Failed to connect to the database or user not authenticated');
        return;
      }

      // Show loading toast
      toast.loading('Performing complete email reset...', { id: 'reset-emails' });

      // Clear emails from state first (immediate feedback)
      setEmails([]);

      // Step 1: Delete all emails from Firebase collections
      // User's email collection
      const userEmailsRef = collection(db, `users/${user.email}/emails`);
      const emailsSnapshot = await getDocs(userEmailsRef);

      if (emailsSnapshot.size > 0) {
        const emailBatch = writeBatch(db);
        emailsSnapshot.forEach((doc) => {
          emailBatch.delete(doc.ref);
        });
        await emailBatch.commit();
        console.log(`Deleted ${emailsSnapshot.size} emails from user's emails collection`);
      }

      // User's not relevant collection
      const userNotRelevantRef = collection(db, `users/${user.email}/not_relevant`);
      const notRelevantSnapshot = await getDocs(userNotRelevantRef);
      if (notRelevantSnapshot.size > 0) {
        const notRelevantBatch = writeBatch(db);
        notRelevantSnapshot.forEach((doc) => {
          notRelevantBatch.delete(doc.ref);
        });
        await notRelevantBatch.commit();
        console.log(`Deleted ${notRelevantSnapshot.size} entries from user's not_relevant collection`);
      }

      // User's ready to reply collection
      try {
        const readyRef = doc(db, `users/${user.email}/ready_to_reply`, 'latest');
        await setDoc(readyRef, { emails: [], timestamp: Date.now() });
        console.log('Cleared user ready_to_reply collection');
      } catch (error) {
        console.error('Error clearing ready_to_reply collection:', error);
      }

      // User's thread cache collection
      const userThreadCacheRef = collection(db, `users/${user.email}/thread_cache`);
      const threadsSnapshot = await getDocs(userThreadCacheRef);
      if (threadsSnapshot.size > 0) {
        const threadBatch = writeBatch(db);
        threadsSnapshot.forEach((doc) => {
          threadBatch.delete(doc.ref);
        });
        await threadBatch.commit();
        console.log(`Deleted ${threadsSnapshot.size} threads from user's thread_cache collection`);
      }

      // User's email content collection
      const userEmailContentRef = collection(db, `users/${user.email}/email_content`);
      const contentSnapshot = await getDocs(userEmailContentRef);
      if (contentSnapshot.size > 0) {
        // Due to potentially large number of documents, delete in batches
        let count = 0;
        const BATCH_SIZE = 500; // Firebase batch limit

        for (let i = 0; i < contentSnapshot.size; i += BATCH_SIZE) {
          const batch = writeBatch(db);
          const batchDocs = contentSnapshot.docs.slice(i, i + BATCH_SIZE);

          batchDocs.forEach(doc => {
            batch.delete(doc.ref);
            count++;
          });

          await batch.commit();
          console.log(`Deleted batch of ${batchDocs.length} email contents`);
        }

        console.log(`Deleted ${count} email contents from user's email_content collection`);
      }

      // Also clear local cache
      clearCache();
      setEmailQuestions(new Map());

      // Step 2: Update the toast to indicate progress
      toast.loading('All emails deleted. Fetching 20 most recent emails from Gmail...', { id: 'reset-emails' });

      // Step 3: Fetch fresh emails from Gmail API (most recent 20 threads)
      try {
        const response = await fetch('/api/emails/inbox?limit=20', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${user.accessToken}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch emails from Gmail');
        }

        const data = await response.json();
        console.log('Fetched fresh emails from Gmail:', data.emails.length);

        // Transform the emails to match ExtendedEmail type
        const transformedEmails = data.emails.map((email: any) => {
          // Log the original timestamp data
          console.log(`Email ${email.id} timestamps: internalDate=${email.internalDate}, receivedAt=${email.receivedAt}`);

          // Ensure proper timestamp handling
          let receivedAt = email.receivedAt || null;
          let sortTimestamp = null;

          // If email has internalDate from Gmail, use it
          if (email.internalDate) {
            const internalDateTimestamp = parseInt(email.internalDate);
            if (!isNaN(internalDateTimestamp)) {
              sortTimestamp = internalDateTimestamp;
              if (!receivedAt) {
                receivedAt = new Date(internalDateTimestamp).toISOString();
              }
            }
          }

          // Ensure all required properties exist for ExtendedEmail type
          return {
            id: email.id || '',
            threadId: email.threadId || '',
            subject: email.subject || '',
            sender: email.sender || '',
            content: email.content || '',
            receivedAt: receivedAt || new Date().toISOString(),
            sortTimestamp: sortTimestamp || (receivedAt ? new Date(receivedAt).getTime() : Date.now()),
            // Copy other properties from the original email
            ...email,
          } as ExtendedEmail;
        });

        // Log debug info about timestamps
        console.log(`DEBUG: Created ${transformedEmails.length} emails with timestamps`);
        console.log(`DEBUG: First 3 email timestamps for verification:`);
        for (let i = 0; i < Math.min(3, transformedEmails.length); i++) {
          const email = transformedEmails[i];
          console.log(`Email ${i + 1}: ${email.subject}`);
          console.log(`  - receivedAt: ${email.receivedAt}`);
          console.log(`  - sortTimestamp: ${email.sortTimestamp} (${email.sortTimestamp ? safeISOString(email.sortTimestamp) : 'N/A'})`);
        }

        // Log timestamp info without accessing properties directly
        console.log(`DEBUG: Created ${transformedEmails.length} emails with timestamps`);

        // Set the new emails in state
        const sortedEmails = sortEmails(transformedEmails) as ExtendedEmail[];
        setEmails(sortedEmails);

        // Save the emails to Firebase
        console.log('Saving fresh emails to Firebase...');
        await saveEmailsToFirebase(sortedEmails, user);

        // Debug: Verify timestamps after saving
        debugCheckTimestamp();

        console.log(`Saved ${sortedEmails.length} emails to Firebase`);

        // Success toast - restore this line
        toast.success(`Complete reset finished. Loaded ${data.emails.length} fresh emails from Gmail and saved to Firebase`, { id: 'reset-emails' });
      } catch (error) {
        console.error('Error fetching fresh emails:', error);
        toast.error('Failed to fetch fresh emails from Gmail. Please try manually refreshing.', { id: 'reset-emails' });
      }

    } catch (error) {
      console.error('Error during complete email reset:', error);
      toast.error('Failed to complete email reset', { id: 'reset-emails' });
    }
  };

  // Add a debug function to check what's happening with timestamps
  const debugCheckTimestamp = () => {
    if (!user) {
      console.log('No user logged in');
      return;
    }

    console.log('DEBUG: Manually checking timestamps');

    try {
      // 1. Find all Feb 28 emails if any
      const feb28 = new Date('2025-02-28').getTime();
      console.log(`DEBUG: Looking for Feb 28 emails (${safeISOString(feb28)})`);

      const feb28Emails = emails.filter(e => {
        // Check receivedAt
        let receivedTime = 0;
        if (typeof e.receivedAt === 'number') receivedTime = e.receivedAt;
        else if (typeof e.receivedAt === 'string') receivedTime = new Date(e.receivedAt).getTime();

        // Check sortTimestamp
        const sortTime = typeof e.sortTimestamp === 'number' ? e.sortTimestamp : 0;

        // Check if either timestamp is Feb 28 (within the day)
        const isReceivedFeb28 = receivedTime > 0 &&
          new Date(receivedTime).toDateString() === new Date(feb28).toDateString();
        const isSortFeb28 = sortTime > 0 &&
          new Date(sortTime).toDateString() === new Date(feb28).toDateString();

        return isReceivedFeb28 || isSortFeb28;
      });

      if (feb28Emails.length > 0) {
        console.log(`DEBUG: Found ${feb28Emails.length} emails from Feb 28:`);
        feb28Emails.forEach((e, i) => {
          console.log(`DEBUG: Feb 28 Email #${i + 1}:`);
          console.log(`  - ID: ${e.id}`);
          console.log(`  - ThreadID: ${e.threadId}`);
          console.log(`  - Subject: ${e.subject || 'Unknown'}`);
          console.log(`  - receivedAt: ${e.receivedAt} (${typeof e.receivedAt === 'number' || !e.receivedAt ? '' : safeISOString(e.receivedAt)})`);
          console.log(`  - sortTimestamp: ${e.sortTimestamp} (${e.sortTimestamp ? safeISOString(e.sortTimestamp) : 'N/A'})`);
        });
      } else {
        console.log('DEBUG: No Feb 28 emails found');
      }

      // 2. Find the latest timestamp across all emails
      let latestTimestamp = 0;
      let latestEmail: ExtendedEmail | null = null;

      // First check sortTimestamp
      emails.forEach(email => {
        if (typeof email.sortTimestamp === 'number' && email.sortTimestamp > 0 && email.sortTimestamp > latestTimestamp) {
          latestTimestamp = email.sortTimestamp;
          latestEmail = email;
        }
      });

      // Then check receivedAt
      emails.forEach(email => {
        let receivedTime = 0;
        if (typeof email.receivedAt === 'number') receivedTime = email.receivedAt;
        else if (typeof email.receivedAt === 'string') receivedTime = new Date(email.receivedAt).getTime();

        if (!isNaN(receivedTime) && receivedTime > 0 && receivedTime > latestTimestamp) {
          latestTimestamp = receivedTime;
          latestEmail = email;
        }
      });

      if (latestEmail) {
        console.log('DEBUG: Latest email found:');
        // Type assertion for latestEmail
        const typedLatestEmail = latestEmail as ExtendedEmail;

        console.log(`  - ID: ${typedLatestEmail.id}`);
        console.log(`  - ThreadID: ${typedLatestEmail.threadId}`);
        console.log(`  - Subject: ${typedLatestEmail.subject || 'Unknown'}`);

        // Fixed date conversion logic
        let receivedAtDate = '';
        if (typeof typedLatestEmail.receivedAt === 'number') {
          receivedAtDate = safeISOString(typedLatestEmail.receivedAt);
        } else if (typedLatestEmail.receivedAt && typeof typedLatestEmail.receivedAt === 'string') {
          receivedAtDate = safeISOString(typedLatestEmail.receivedAt);
        } else {
          receivedAtDate = 'Invalid Date';
        }

        console.log(`  - receivedAt: ${typedLatestEmail.receivedAt} (${receivedAtDate})`);

        // Fixed sortTimestamp display
        let sortTimestampDate = 'N/A';
        if (typedLatestEmail.sortTimestamp) {
          sortTimestampDate = safeISOString(typedLatestEmail.sortTimestamp);
        }

        console.log(`  - sortTimestamp: ${typedLatestEmail.sortTimestamp} (${sortTimestampDate})`);
        console.log(`  - Latest timestamp used: ${latestTimestamp} (${safeISOString(latestTimestamp)})`);

        // The timestamp that would be sent to the API
        console.log(`DEBUG: Timestamp that would be sent to check-new API: ${latestTimestamp} (${new Date(latestTimestamp).toISOString()})`);
      } else {
        console.log('DEBUG: No emails with valid timestamps found');
      }

      toast.success('Timestamp debug info logged to console');
    } catch (error) {
      console.error('Error in debugCheckTimestamp:', error);
      toast.error('Error checking timestamps');
    }
  };

  // Add this helper function after the saveQuestionsToFirebase function
  const getQuestionsForEmail = async (emailId: string): Promise<GenericFAQ[] | null> => {
    try {
      const db = getFirebaseDB();
      if (!db) return null;

      const questionRef = doc(db, FIREBASE_QUESTIONS_COLLECTION, emailId);
      const questionDoc = await getDoc(questionRef);

      if (questionDoc.exists()) {
        const data = questionDoc.data();
        return data.questions || [];
      }

      return null;
    } catch (error) {
      console.error('Error getting questions from Firebase:', error);
      return null;
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
          onResetAllEmails={resetAllEmailsAndRefresh}
        />
      </Layout>
    </div>
  );
}
