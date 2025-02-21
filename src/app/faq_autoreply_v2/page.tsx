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
  question: string;
  answer: string;
  category: string;
  confidence: number;
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
  question: string;
  answer: string;
  confidence: number;
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

const loadEmailsFromFirebase = async () => {
  try {
    const db = getFirebaseDB();
    if (!db) return null;

    // First get all not relevant emails
    const notRelevantRef = collection(db, FIREBASE_COLLECTIONS.NOT_RELEVANT);
    const notRelevantSnapshot = await getDocs(notRelevantRef);
    const notRelevantEmails = notRelevantSnapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      isNotRelevant: true
    })) as ExtendedEmail[];

    // Get emails from both email_cache and thread_cache
    const emailCacheRef = collection(db, FIREBASE_COLLECTIONS.EMAIL_CACHE);
    const threadCacheRef = collection(db, FIREBASE_COLLECTIONS.THREAD_CACHE);

    const [emailCacheSnapshot, threadCacheSnapshot] = await Promise.all([
      getDocs(emailCacheRef),
      getDocs(threadCacheRef)
    ]);

    // Create a map to merge thread and email data
    const emailMap = new Map<string, ExtendedEmail>();

    // Process email cache documents
    emailCacheSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      emailMap.set(doc.id, {
        ...data,
        id: doc.id,
        content: data.content || { html: null, text: data.content }
      } as ExtendedEmail);
    });

    // Process thread cache documents and merge with email data
    threadCacheSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.emailId && emailMap.has(data.emailId)) {
        const existingEmail = emailMap.get(data.emailId)!;
        emailMap.set(data.emailId, {
          ...existingEmail,
          ...data,
          id: data.emailId,
          threadId: doc.id,
          content: data.content || existingEmail.content
        });
      }
    });

    // Convert map to array and sort by receivedAt
    const cachedEmails = Array.from(emailMap.values()).sort((a, b) => {
      const aTime = typeof a.receivedAt === 'string' ? new Date(a.receivedAt).getTime() : Number(a.receivedAt);
      const bTime = typeof b.receivedAt === 'string' ? new Date(b.receivedAt).getTime() : Number(b.receivedAt);
      return bTime - aTime;
    });

    // Get all not relevant email IDs
    const notRelevantIds = new Set(notRelevantSnapshot.docs.map(doc => doc.id));

    // Mark emails as not relevant if they're in the not_relevant_emails collection
    const processedEmails = cachedEmails.map(email => ({
      ...email,
      isNotRelevant: notRelevantIds.has(email.id)
    }));

    // Combine with not relevant emails, ensuring no duplicates
    const existingIds = new Set(processedEmails.map(e => e.id));
    const combinedEmails = [
      ...processedEmails,
      ...notRelevantEmails.filter(e => !existingIds.has(e.id))
    ];

    return combinedEmails;
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

// Add new Firebase collection reference
const FIREBASE_COLLECTIONS = {
  EMAILS: 'emails',
  QUESTIONS: 'questions',
  FAQS: 'faqs',
  CACHED_QUESTIONS: 'cached_questions',
  EMAIL_CACHE: 'email_cache',
  THREAD_CACHE: 'thread_cache',
  EMAIL_ANALYSIS: 'email_analysis',
  NOT_RELEVANT: 'not_relevant_emails'
};

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

// Modify the existing extractQuestionsFromEmail function
const extractQuestionsFromEmail = async (email: ExtendedEmail) => {
  // First check Firebase cache
  const cachedQuestions = await getCachedQuestionsFromFirebase(email.id);
  if (cachedQuestions) {
    // Group similar questions before returning cached results
    return groupSimilarPatterns(cachedQuestions);
  }

  // If no cache, extract questions
  try {
    const response = await fetch('/api/knowledge/extract-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailContent: email.content })
    });

    if (!response.ok) throw new Error('Failed to extract questions');

    const questions = await response.json();

    // Group similar questions before saving to cache
    const groupedQuestions = groupSimilarPatterns(questions);

    // Save grouped questions to Firebase cache
    await saveExtractedQuestionsToFirebase(email.id, groupedQuestions);

    return groupedQuestions;
  } catch (error) {
    console.error('Error extracting questions:', error);
    return [];
  }
};

// Add this before the component definition
const groupSimilarPatterns = (patterns: GenericFAQ[]): GenericFAQ[] => {
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
};

// Add this type definition at the top with other interfaces
type EmailQuestionsMap = Map<string, GenericFAQ[]>;

// Add this type definition at the top with other interfaces
interface RemovedEmailsCache {
  emails: string[];
  timestamp: number;
}

// Add this helper function near the top with other helper functions
const isHTMLContent = (content: string): boolean => {
  // Check for common HTML indicators
  const htmlIndicators = [
    '<!DOCTYPE',
    '<html',
    '<body',
    '<div',
    '<p>',
    '<table',
    '<head',
    '<style',
    '<script'
  ];

  const lowerContent = content.toLowerCase();
  return htmlIndicators.some(indicator => lowerContent.includes(indicator.toLowerCase()));
};

const sanitizeHTML = (html: string): string => {
  // Basic sanitization to extract text from HTML
  // Remove style/script tags and their contents
  let sanitized = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ') // Replace any remaining tags with space
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim();

  // Decode HTML entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = sanitized;
  return textarea.value;
};

// Add this helper function near the top with other helper functions
const truncateText = (text: string, maxLength: number): string => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

const getCleanContent = (content: string) => {
  // Split into lines
  const lines = content.split('\n');
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

const sanitizeAndFormatHTML = (content: string): string => {
  // First clean the content
  const cleanContent = getCleanContent(content);

  // Basic sanitization to prevent XSS
  let sanitized = cleanContent
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
    .replace(/on\w+="[^"]*"/g, '') // Remove event handlers
    .replace(/javascript:/gi, ''); // Remove javascript: URLs

  // Process inline images (cid: references)
  sanitized = sanitized.replace(/src="cid:([^"]+)"/g, (match, cid) => {
    // For now, we'll just preserve the cid reference but add a class
    return `src="cid:${cid}" class="inline-image"`;
  });

  // Improve formatting of HTML content
  sanitized = sanitized
    // Style blockquotes
    .replace(/<blockquote/g, '<blockquote style="margin: 0.5em 0 0.5em 1em; padding-left: 1em; border-left: 2px solid #e5e7eb; color: #4b5563;"')
    // Ensure images are responsive
    .replace(/<img([^>]*)>/g, (match, attributes) => {
      // Don't modify inline images (they have the class we added above)
      if (attributes.includes('class="inline-image"')) {
        return `<img${attributes}>`;
      }
      return `<img${attributes} style="max-width: 100%; height: auto;" loading="lazy">`;
    })
    // Add spacing between paragraphs
    .replace(/<p>/g, '<p style="margin: 0.5em 0; color: #1f2937;">')
    // Style links
    .replace(/<a([^>]*)>/g, '<a$1 style="color: #2563eb; text-decoration: underline;">')
    // Add default text color to divs
    .replace(/<div(?![^>]*color)/g, '<div style="color: #1f2937;"')
    // Clean up extra spacing
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/\n{3,}/g, '\n\n');

  return sanitized;
};

// Add these helper functions before the EmailContent component
const decodeHtmlEntities = (html: string): string => {
  if (!html) return '';

  // First pass: Use DOMParser to decode HTML entities
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let decoded = doc.documentElement.textContent || html;

  // Second pass: Use textarea for additional entity decoding
  const textarea = document.createElement('textarea');
  textarea.innerHTML = decoded;
  decoded = textarea.value;

  // Third pass: Handle any remaining HTML entities
  return decoded.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const extractStyles = (html: string): string => {
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const styles = [];
  let match;

  while ((match = styleRegex.exec(html)) !== null) {
    styles.push(match[1]);
  }

  return styles.join('\n');
}

// Update the EmailContent component
const EmailContent = ({ content }: { content: string | { html: string | null; text: string | null } }) => {
  // Add debug function
  const copyDebugInfo = () => {
    let debugInfo = '';
    if (typeof content === 'object') {
      debugInfo = JSON.stringify({
        html: content.html,
        text: content.text,
        contentType: 'object'
      }, null, 2);
    } else {
      debugInfo = JSON.stringify({
        content,
        contentType: 'string'
      }, null, 2);
    }

    navigator.clipboard.writeText(debugInfo).then(() => {
      toast.success('Email content debug info copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy debug info');
    });
  };

  // If content is an object with html/text properties
  if (typeof content === 'object') {
    // First check for valid HTML content
    if (content.html && content.html.trim()) {
      let decodedHtml = decodeHtmlEntities(content.html);

      return (
        <div className="relative">
          <button
            onClick={copyDebugInfo}
            className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 bg-white/80 hover:bg-white rounded-md shadow-sm border border-gray-200"
            title="Copy debug info"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </button>
          <div
            className="prose prose-sm max-w-none email-content overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: decodedHtml }}
          />
        </div>
      );
    }

    // Only fallback to text content if HTML is not available
    if (content.text) {
      const decodedText = decodeHtmlEntities(content.text);
      return (
        <div className="relative">
          <button
            onClick={copyDebugInfo}
            className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 bg-white/80 hover:bg-white rounded-md shadow-sm border border-gray-200"
            title="Copy debug info"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </button>
          <pre className="whitespace-pre-wrap text-sm text-gray-700">{decodedText}</pre>
        </div>
      );
    }
  }

  // Handle string content (legacy format)
  if (typeof content === 'string' && content.trim()) {
    const decodedContent = decodeHtmlEntities(content);
    // Check if the content is HTML
    if (decodedContent.trim().startsWith('<')) {
      return (
        <div className="relative">
          <button
            onClick={copyDebugInfo}
            className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 bg-white/80 hover:bg-white rounded-md shadow-sm border border-gray-200"
            title="Copy debug info"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </button>
          <div
            className="prose prose-sm max-w-none email-content overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: decodedContent }}
          />
        </div>
      );
    }
    return (
      <div className="relative">
        <button
          onClick={copyDebugInfo}
          className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 bg-white/80 hover:bg-white rounded-md shadow-sm border border-gray-200"
          title="Copy debug info"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </button>
        <div className="whitespace-pre-wrap text-sm text-gray-700">{decodedContent}</div>
      </div>
    );
  }

  // If no valid content is found
  return (
    <div className="relative">
      <button
        onClick={copyDebugInfo}
        className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-gray-600 bg-white/80 hover:bg-white rounded-md shadow-sm border border-gray-200"
        title="Copy debug info"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      </button>
      <div className="text-gray-500 italic">No content available</div>
    </div>
  );
};

// Update the EmailItem component to properly handle the content object
const EmailItem = ({ email, onRefresh }: { email: ExtendedEmail; onRefresh: () => void }) => {
  return (
    <div className="border rounded-lg p-4 mb-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="font-medium">{email.subject}</h3>
          <p className="text-sm text-gray-600">{email.sender}</p>
        </div>
        <button
          onClick={onRefresh}
          className="p-1 hover:bg-gray-100 rounded-full"
          title="Refresh email"
        >
          <ClockIcon className="h-4 w-4 text-gray-500" />
        </button>
      </div>
      <EmailContent content={email.content} />
    </div>
  );
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
      // Find the best matching FAQ (highest confidence)
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

  // Update the loadEmails function to handle the new pagination
  const loadEmails = useCallback(async (skipCache: boolean = false, pageNumber?: number) => {
    if (!user?.accessToken) {
      toast.error('Please sign in to access emails');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`/api/emails/inbox${nextPageToken ? `?pageToken=${nextPageToken}` : ''}`, {
        headers: {
          'Authorization': `Bearer ${user.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch emails');
      }

      const data = await response.json();

      if (data.emails) {
        setEmails(prevEmails => {
          if (skipCache) {
            return data.emails as ExtendedEmail[];
          }
          const newEmails = data.emails.filter((email: ExtendedEmail) =>
            !prevEmails.some(prevEmail => prevEmail.id === email.id)
          );
          return [...prevEmails, ...newEmails] as ExtendedEmail[];
        });
        setNextPageToken(data.nextPageToken);
        setHasMore(!!data.nextPageToken);
      }
    } catch (error) {
      console.error('Error loading emails:', error);
      toast.error('Failed to load emails');
    } finally {
      setIsLoading(false);
    }
  }, [user?.accessToken, nextPageToken]);

  useEffect(() => {
    // Check if analysis is enabled via environment variable
    setIsAnalysisEnabled(process.env.NEXT_PUBLIC_OPENAI_API_KEY !== undefined);
  }, []);

  useEffect(() => {
    const initialize = async () => {
      if (!isSubscribed.current) return;

      try {
        setLoading(true);

        // First try to load from local cache
        const cachedData = loadFromCache(CACHE_KEYS.EMAILS);
        if (cachedData?.emails) {
          setEmails(cachedData.emails as ExtendedEmail[]);
        }

        // Then try Firebase cache
        const firebaseEmails = await loadEmailsFromFirebase();
        if (firebaseEmails && firebaseEmails.length > 0) {
          setEmails(prevEmails => {
            const existingIds = new Set(prevEmails.map(e => e.id));
            const newEmails = firebaseEmails.filter(e => !existingIds.has(e.id));
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
        const db = getFirebaseDB();
        if (db) {
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
      isSubscribed.current = false;
    };
  }, [loadEmails]);

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
          faqMatches[email.id] = matchedFAQ;
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
      const response = await fetch('/api/emails/auto-reply', {
        method: 'POST',
        body: JSON.stringify({ emailId: email.id }),
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
      requiresCustomerSpecificInfo: false
    });
    setAnswer(faq.answer);
    setShowAnswerModal(true);
  };

  const handleDeleteLibraryFAQ = async (faq: AnsweredFAQ) => {
    const shouldDelete = window.confirm('Are you sure you want to delete this FAQ?');
    if (!shouldDelete) return;

    try {
      const response = await fetch('/api/faq/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: faq.question
        })
      });

      if (!response.ok) {
        throw new Error('Failed to delete FAQ');
      }

      // Remove from answered FAQs
      setAnsweredFAQs(prev => prev.filter(f => f.question !== faq.question));
      toast.success('FAQ deleted successfully');
    } catch (error) {
      console.error('Error deleting FAQ:', error);
      toast.error('Failed to delete FAQ');
    }
  };

  const handleSaveFAQ = async () => {
    if (!selectedFAQ || !answer.trim()) return;

    try {
      // First, save to FAQ library
      const response = await fetch('/api/faq/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: selectedFAQ.question,
          answer: answer.trim(),
          category: selectedFAQ.category,
          emailIds: selectedFAQ.emailIds || [],
          similarPatterns: selectedFAQ.similarPatterns || []
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save FAQ');
      }

      const savedFAQ = await response.json();

      // Track which emails become ready for reply
      const emailsMovedToReady: ExtendedEmail[] = [];

      // Update answeredFAQs state with both the main question and similar patterns
      setAnsweredFAQs(prev => {
        const newAnsweredFAQs = [...prev];
        const mainQuestionIndex = newAnsweredFAQs.findIndex(f => f.question === selectedFAQ.question);
        const newFAQ = {
          question: selectedFAQ.question,
          answer: answer.trim(),
          category: selectedFAQ.category,
          confidence: selectedFAQ.confidence
        };

        if (mainQuestionIndex >= 0) {
          newAnsweredFAQs[mainQuestionIndex] = newFAQ;
        } else {
          newAnsweredFAQs.push(newFAQ);
        }

        // Add similar patterns as separate FAQs
        if (selectedFAQ.similarPatterns) {
          selectedFAQ.similarPatterns.forEach(pattern => {
            const patternIndex = newAnsweredFAQs.findIndex(f => f.question === pattern);
            if (patternIndex >= 0) {
              newAnsweredFAQs[patternIndex] = {
                ...newFAQ,
                question: pattern
              };
            } else {
              newAnsweredFAQs.push({
                ...newFAQ,
                question: pattern
              });
            }
          });
        }

        return newAnsweredFAQs;
      });

      // Update emailQuestions and check for ready emails
      setEmailQuestions(prev => {
        const updated = new Map(prev);
        const emailIds = selectedFAQ?.emailIds || [];
        emailIds.forEach(emailId => {
          const emailQuestions = updated.get(emailId) || [];
          const updatedQuestions = emailQuestions.map(q => {
            if (q.question === selectedFAQ?.question ||
              (selectedFAQ?.similarPatterns && selectedFAQ.similarPatterns.includes(q.question))) {
              return {
                ...q,
                answer: answer.trim(),
                isAnswered: true
              };
            }
            return q;
          });
          updated.set(emailId, updatedQuestions);
        });
        return updated;
      });

      // Update genericFAQs to remove answered questions
      setGenericFAQs(prev =>
        prev.filter(faq =>
          faq.question !== selectedFAQ.question &&
          !selectedFAQ.similarPatterns?.includes(faq.question)
        )
      );

      // Update emails that might now have all questions answered
      setEmails(prev => {
        const updatedEmails = prev.map(email => {
          const emailIds = selectedFAQ?.emailIds || [];
          if (emailIds.includes(email.id)) {
            const questions = emailQuestions.get(email.id) || [];
            const allAnswered = questions.every(q =>
              answeredFAQs.some(faq =>
                calculatePatternSimilarity(faq.question, q.question) > SIMILARITY_THRESHOLD ||
                (selectedFAQ?.similarPatterns && selectedFAQ.similarPatterns.includes(q.question))
              )
            );

            if (allAnswered) {
              const bestMatch = questions.reduce((best, current) => {
                const matchedFAQ = findMatchingAnsweredFAQ(current.question) ||
                  (current.question === selectedFAQ?.question ? {
                    question: selectedFAQ?.question,
                    answer: answer.trim(),
                    category: selectedFAQ?.category,
                    confidence: selectedFAQ?.confidence
                  } : null);

                if (!matchedFAQ) return best;
                if (!best || matchedFAQ.confidence > best.confidence) return matchedFAQ;
                return best;
              }, null as AnsweredFAQ | null);

              if (bestMatch) {
                const updatedEmail = {
                  ...email,
                  matchedFAQ: {
                    question: bestMatch.question,
                    answer: bestMatch.answer,
                    confidence: bestMatch.confidence
                  },
                  status: 'processed' as const
                };
                emailsMovedToReady.push(updatedEmail);
                return updatedEmail;
              }
            }
          }
          return email;
        });

        // Save ready to reply emails to Firebase
        const readyToReplyEmails = updatedEmails.filter(email =>
          email.status === 'processed' &&
          email.matchedFAQ &&
          !email.isReplied
        );

        if (readyToReplyEmails.length > 0) {
          console.log('Saving ready to reply emails to Firebase:', readyToReplyEmails.length);
          saveReadyToReplyToFirebase(readyToReplyEmails);

          // Also save to local cache
          saveToCache(CACHE_KEYS.READY_TO_REPLY, {
            emails: readyToReplyEmails,
            timestamp: Date.now()
          });
        }

        return updatedEmails;
      });

      // Save updated state to cache
      saveToCache(CACHE_KEYS.QUESTIONS, Object.fromEntries(emailQuestions));
      saveToCache(CACHE_KEYS.ANSWERED_FAQS, { answeredFAQs: answeredFAQs });

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

  const handleMarkNotRelevant = async (email: ExtendedEmail) => {
    // Immediately mark locally as isNotRelevant
    setEmails(prev => prev.map(e =>
      e.id === email.id ? { ...e, isNotRelevant: true } : e
    ));

    // Remove from questions if you wish
    const updatedQuestions = new Map(emailQuestions);
    updatedQuestions.delete(email.id);
    setEmailQuestions(updatedQuestions);

    try {
      // Save to Firebase first
      const db = getFirebaseDB();
      if (!db) throw new Error('Firebase DB not initialized');

      const notRelevantRef = doc(db, 'not_relevant_emails', email.id);
      await setDoc(notRelevantRef, {
        emailId: email.id,
        threadId: email.threadId,
        subject: email.subject,
        sender: email.sender,
        content: email.content,
        receivedAt: email.receivedAt,
        markedNotRelevantAt: Date.now()
      });

      // Now call analyze-irrelevant with threadId
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
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to analyze email');
      }

      const analysis: IrrelevanceAnalysis = await response.json();

      // Update the Firebase document with the analysis reason
      await setDoc(notRelevantRef, {
        reason: analysis.reason
      }, { merge: true });

      toast.success(`Removed: ${analysis.reason}`);
    } catch (error) {
      console.error('Error marking email as not relevant:', error);
      toast.error('Error analyzing email, but it has been removed from the list');
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
    const contentToAnalyze = typeof email.content === 'object'
      ? (email.content.html || email.content.text)
      : email.content;

    console.log('Email:', {
      id: email.id,
      subject: email.subject,
      contentLength: contentToAnalyze?.length,
      contentPreview: contentToAnalyze?.substring(0, 100) + '...'
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
          emailContent: contentToAnalyze
        })
      });

      console.log('API response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error:', {
          status: response.status,
          statusText: response.statusText,
          errorText
        });

        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          console.error('Failed to parse error response:', e);
          errorData = { error: 'Failed to parse error response' };
        }

        throw new Error(errorData.error || `API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('API response data:', data);

      if (!data.questions) {
        console.error('Invalid response format:', data);
        throw new Error(data.error || 'Invalid response from question extraction');
      }

      console.log('Processing extracted questions:', data.questions);

      const questionObjects = data.questions.map((q: any) => {
        console.log('Processing question:', q);

        if (typeof q === 'object' && q !== null) {
          console.log('Question is an object:', q);
          return {
            question: q.question,
            category: q.category || 'support',
            emailIds: [email.id],
            confidence: q.confidence || 1,
            requiresCustomerSpecificInfo: q.requiresCustomerSpecificInfo || false
          };
        }

        console.log('Question is a string:', q);
        return {
          question: q,
          category: 'support',
          emailIds: [email.id],
          confidence: 1,
          requiresCustomerSpecificInfo: false
        };
      });

      console.log('Final processed questions:', questionObjects);

      if (questionObjects.length === 0) {
        console.log('No questions were found');
        toast.info('No questions were found in this email');
        return;
      }

      // Update emailQuestions state with proper typing
      console.log('Updating emailQuestions state...');
      setEmailQuestions(prev => {
        const updated = new Map(prev);
        updated.set(email.id, questionObjects);
        return updated;
      });

      // Save questions to both Firebase collections
      console.log('Saving questions to Firebase...');
      await Promise.all([
        saveQuestionsToFirebase(email.id, questionObjects),
        saveExtractedQuestionsToFirebase(email.id, questionObjects)
      ]);

      // Update the email object with the questions
      console.log('Updating emails state...');
      setEmails(prev => prev.map(e =>
        e.id === email.id
          ? { ...e, questions: questionObjects }
          : e
      ));

      // Save to cache
      console.log('Saving to cache...');
      const updatedQuestions = new Map(emailQuestions);
      updatedQuestions.set(email.id, questionObjects);
      saveToCache(CACHE_KEYS.QUESTIONS, Object.fromEntries(updatedQuestions));

      toast.success('Questions extracted successfully');
    } catch (error) {
      console.error('Error creating FAQ:', error);
      toast.error('Failed to extract questions');
    } finally {
      // Remove this email from loading state
      setAnalyzingEmails(prev => {
        const updated = new Set(prev);
        updated.delete(email.id);
        return updated;
      });
    }
  };

  const generateContextualReply = async (email: ExtendedEmail) => {
    try {
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
      const db = getFirebaseDB();
      if (db) {
        const replyRef = doc(db, 'email_replies', email.id);
        await setDoc(replyRef, {
          reply: data.reply,
          timestamp: Date.now()
        });
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
    setEditingReply({
      emailId: email.id,
      reply: email.suggestedReply || generateDefaultReply(email)
    });
  };

  const handleSaveReply = async (emailId: string) => {
    if (!editingReply) return;

    setEmails(prev => prev.map(e => {
      if (e.id === emailId) {
        return { ...e, suggestedReply: editingReply.reply };
      }
      return e;
    }));

    setEditingReply(null);
  };

  const generateDefaultReply = (email: ExtendedEmail) => {
    const senderName = email.sender.split('<')[0].trim();
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

  const renderEmailContent = (email: ExtendedEmail) => {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 hover:shadow-sm transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-500">
            {new Date(email.receivedAt).toLocaleString()}
          </div>
        </div>
        <EmailRenderNew
          content={email.content}
          maxHeight={200}
          showDebugInfo={false}
          className="email-content"
          onRefresh={() => refreshSingleEmail(email)}
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
      !email.isNotRelevant &&
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

  // Update the handleRefresh function
  const handleRefresh = async () => {
    try {
      if (!user?.accessToken) {
        toast.error('Please sign in to refresh emails');
        return;
      }

      const emailsToRefresh = emails.filter(email => email.threadId); // Only refresh emails with threadId
      if (emailsToRefresh.length === 0) {
        toast.error('No emails to refresh');
        return;
      }

      toast.loading(`Refreshing ${emailsToRefresh.length} emails...`);

      let currentToken = user.accessToken;
      const batchSize = 5; // Process 5 emails at a time
      const emailBatches = [];

      // Split emails into batches
      for (let i = 0; i < emailsToRefresh.length; i += batchSize) {
        emailBatches.push(emailsToRefresh.slice(i, i + batchSize));
      }

      let updatedEmails: ExtendedEmail[] = [];
      let failedEmails = 0;

      // Process each batch
      for (let i = 0; i < emailBatches.length; i++) {
        const batch = emailBatches[i];
        const batchPromises = batch.map(async (email) => {
          if (!email.threadId) return null;

          try {
            let response = await fetch(`/api/gmail/fetch-emails?threadId=${email.threadId}`, {
              headers: {
                'Authorization': `Bearer ${currentToken}`
              }
            });

            // Handle 401 by refreshing token
            if (response.status === 401) {
              const newToken = await refreshAccessToken();
              if (!newToken) {
                throw new Error('Session expired');
              }
              currentToken = newToken;
              // Retry with new token
              response = await fetch(`/api/gmail/fetch-emails?threadId=${email.threadId}`, {
                headers: {
                  'Authorization': `Bearer ${currentToken}`
                }
              });
            }

            if (!response.ok) {
              throw new Error('Failed to fetch email data');
            }

            const emailData = await response.json();

            // Process the email data
            const processedEmailData = {
              ...emailData,
              lastUpdated: Date.now(),
              content: {
                html: typeof emailData.content === 'object' ? emailData.content.html : null,
                text: typeof emailData.content === 'object' ? emailData.content.text : emailData.content
              }
            };

            // Update Firebase
            const db = getFirebaseDB();
            if (db) {
              const emailDocRef = doc(db, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
              const threadDocRef = doc(db, FIREBASE_COLLECTIONS.THREAD_CACHE, email.threadId);

              await Promise.all([
                setDoc(emailDocRef, processedEmailData, { merge: true }),
                setDoc(threadDocRef, {
                  ...processedEmailData,
                  threadId: email.threadId,
                  emailId: email.id,
                  lastUpdated: Date.now()
                }, { merge: true })
              ]);
            }

            return processedEmailData;
          } catch (error) {
            console.error(`Error refreshing email ${email.id}:`, error);
            failedEmails++;
            return null;
          }
        });

        // Wait for batch to complete and add successful updates to list
        const batchResults = await Promise.all(batchPromises);
        updatedEmails = [...updatedEmails, ...batchResults.filter((email): email is ExtendedEmail => email !== null)];

        // Update progress
        toast.loading(`Refreshed ${updatedEmails.length} of ${emailsToRefresh.length} emails...`);

        // Add a small delay between batches to avoid rate limiting
        if (i < emailBatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Update local state
      setEmails(prevEmails => {
        const updatedEmailMap = new Map(updatedEmails.map(email => [email.id, email]));
        return prevEmails.map(email => updatedEmailMap.get(email.id) || email);
      });

      toast.dismiss();

      // Show success/failure message
      if (failedEmails > 0) {
        toast.warning(
          <div className="flex flex-col gap-1">
            <div className="font-medium">Refresh completed with some errors</div>
            <div className="text-sm text-gray-600">
              Successfully updated {updatedEmails.length} emails, {failedEmails} failed
            </div>
          </div>,
          { duration: 5000 }
        );
      } else {
        toast.success(
          <div className="flex flex-col gap-1">
            <div className="font-medium">All emails refreshed successfully</div>
            <div className="text-sm text-gray-600">
              Updated {updatedEmails.length} emails
            </div>
          </div>,
          { duration: 3000 }
        );
      }
    } catch (error) {
      toast.dismiss();
      console.error('Error refreshing emails:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to refresh emails');
    }
  };

  const SkeletonLoader = () => {
    return (
      <div className="space-y-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg shadow-sm p-6 space-y-4 animate-pulse">
            {/* Header */}
            <div className="flex justify-between items-start">
              <div className="space-y-2 flex-1">
                <div className="h-5 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
              <div className="flex gap-1.5">
                <div className="h-8 w-20 bg-gray-200 rounded"></div>
                <div className="h-8 w-20 bg-gray-200 rounded"></div>
              </div>
            </div>

            {/* Content */}
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-full"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              <div className="h-4 bg-gray-200 rounded w-4/6"></div>
            </div>

            {/* Actions */}
            <div className="pt-2">
              <div className="h-8 w-32 bg-gray-200 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderMainContent = () => {
    if (authLoading) {
      return (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading authentication state...</p>
          </div>
        </div>
      );
    }

    if (loading) {
      return <SkeletonLoader />;
    }

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

  // Add the missing render functions
  const renderSuggestedReplies = () => {
    // Get list of removed email IDs
    const removedEmailsCache = loadFromCache('removed_from_ready_emails') as RemovedEmailsCache | null;
    const removedEmailIds = new Set(removedEmailsCache?.emails || []);

    // Only show emails that are processed, have a matched FAQ, haven't been replied to, and haven't been removed
    const readyToReplyEmails = emails.filter(e =>
      e.status === 'processed' &&
      e.matchedFAQ &&
      !e.isReplied &&
      e.suggestedReply &&
      !removedEmailIds.has(e.id)
    );

    return (
      <div className="space-y-8">
        {readyToReplyEmails.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <InboxIcon className="h-12 w-12" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">No emails ready for reply</h3>
            <p className="mt-2 text-sm text-gray-500">
              Answer questions in the "Questions to Answer" tab to prepare replies
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {readyToReplyEmails.map((email, index) => (
              <div key={email.id} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                <div className="p-6 pb-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-medium text-gray-900 truncate pr-4">
                        {email.subject}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        From: {email.sender}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center px-2.5 py-1.5 bg-gray-50 text-xs text-gray-600 rounded-full">
                        <span className="flex items-center">
                          <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-green-400 mr-1.5"></span>
                          Ready to reply
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Original Email */}
                <div className="px-6 mb-6">
                  <div className="flex items-center text-sm text-gray-500 mb-2">
                    <MessageCircleIcon className="h-4 w-4 mr-1.5" />
                    Original Email
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">
                      {typeof email.content === 'string'
                        ? email.content
                        : (email.content.html || email.content.text || '')}
                    </p>
                  </div>
                </div>

                {/* FAQ Match Indicator */}
                <div className="px-6 mb-6">
                  <div className="group relative">
                    <div className="flex items-center text-sm text-gray-500 mb-2">
                      <BookOpenIcon className="h-4 w-4 mr-1.5" />
                      <span>Matched with {email.matchedFAQ ? '2' : '0'} FAQs</span>
                      <button className="ml-1.5 text-gray-400 hover:text-gray-600">
                        <Info className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* AI Generated Reply */}
                <div className="px-6 mb-6">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <div className="flex items-center text-gray-500">
                      <Sparkles className="h-4 w-4 mr-1.5 text-purple-400" />
                      AI Generated Reply
                    </div>
                    {!email.gmailError && editingReply?.emailId !== email.id && (
                      <button
                        onClick={() => handleEditReply(email)}
                        className="flex items-center text-gray-400 hover:text-gray-600"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <div className="absolute -left-2 top-3 w-1 h-[calc(100%-24px)] bg-purple-100 rounded-full"></div>
                    <div className="bg-purple-50 rounded-lg p-4 pl-6">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {email.suggestedReply || generateDefaultReply(email)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="px-6 py-4 bg-gray-50 flex justify-between items-center">
                  <div className="flex items-center text-xs text-gray-500">
                    <ClockIcon className="h-4 w-4 mr-1" />
                    Generated {new Date(email.receivedAt).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRemoveFromReadyToReply(email)}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      title="Remove from Ready to Reply"
                    >
                      <TrashIcon className="h-4 w-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => handleAutoReply(email)}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                    >
                      <Rocket className="h-4 w-4 mr-1.5" />
                      Send Reply
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderFAQLibrary = () => {
    console.log('=== Rendering FAQ Library ===');
    console.log('Current FAQs:', answeredFAQs);

    if (loadingFAQs) {
      return (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      );
    }

    // Filter to only show FAQs with actual answers
    const validFAQs = answeredFAQs.filter(faq =>
      faq.answer &&
      faq.answer.trim() !== '' &&
      faq.question &&
      faq.question.trim() !== ''
    );

    if (!validFAQs.length) {
      return (
        <div className="text-center py-8">
          <p className="text-gray-500">No FAQs in the library yet.</p>
          <p className="text-sm text-gray-400 mt-2">Answer questions from the "Questions to Answer" tab to build your FAQ library.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {validFAQs.map(faq => (
          <div key={faq.question} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  {faq.question}
                </h3>
                <div className="flex items-center space-x-2 text-sm text-gray-500 mb-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800">
                    {faq.category || 'General'}
                  </span>
                  {faq.confidence && (
                    <>
                      <span>•</span>
                      <span>
                        Confidence: {Math.round(faq.confidence * 100)}%
                      </span>
                    </>
                  )}
                </div>
                <div className="prose prose-sm max-w-none">
                  <p className="text-gray-700 whitespace-pre-line">{faq.answer}</p>
                </div>
              </div>
              <div className="flex items-start space-x-2 ml-4">
                <button
                  onClick={() => handleEditLibraryFAQ(faq)}
                  className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
                  title="Edit FAQ"
                >
                  <PencilIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => handleDeleteLibraryFAQ(faq)}
                  className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full transition-colors"
                  title="Delete FAQ"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Update the email handling in handleEmailProcessing
  const handleEmailProcessing = useCallback((emailId: string) => {
    const currentEmail = emails.find(e => e.id === emailId);
    if (!currentEmail) return;

    if (selectedFAQ && Array.isArray(selectedFAQ.emailIds)) {
      selectedFAQ.emailIds.forEach((emailId: string) => {
        const relatedEmail = emails.find(e => e.id === emailId);
        if (relatedEmail) {
          // Process the email
        }
      });

      const currentEmail = emails.find(e => e.id === emailId);
      if (currentEmail && selectedFAQ.emailIds.includes(currentEmail.id)) {
        // Handle matched email
      }
    }
  }, [emails, selectedFAQ]);

  // Add debug logging for state changes
  useEffect(() => {
    console.log('=== FAQ State Debug ===');
    console.log('Generic FAQs:', genericFAQs);
    console.log('Answered FAQs:', answeredFAQs);
    console.log('Email Questions:', Array.from(emailQuestions.entries()));
    console.log('Active Tab:', activeTab);
    console.log('Loading States:', {
      loading,
      loadingFAQs,
      loadingCache,
      loadingMore
    });
  }, [genericFAQs, answeredFAQs, emailQuestions, activeTab, loading, loadingFAQs, loadingCache, loadingMore, emails]);

  // Add this useEffect for the countdown timer
  useEffect(() => {
    const updateTimer = () => {
      const now = Date.now();
      const timeSinceLastFetch = now - lastFetchTimestamp;
      const remainingTime = Math.max(0, MIN_FETCH_INTERVAL - timeSinceLastFetch);
      setTimeUntilNextRefresh(remainingTime);
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [lastFetchTimestamp]);

  // Add this helper function after the state declarations
  const copyEmailDebugInfo = useCallback((email: ExtendedEmail) => {
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
  }, []);

  // Add these styles to your global CSS or in a style tag in your layout
  const globalStyles = `
    @keyframes slideAndFadeOut {
      0% {
        transform: translateX(0);
        opacity: 1;
        max-height: 1000px;
        margin-bottom: 1rem;
      }
      60% {
        transform: translateX(30%);
        opacity: 0.5;
      }
      100% {
        transform: translateX(100%);
        opacity: 0;
        max-height: 0;
        margin-bottom: 0;
        padding: 0;
      }
    }

    .animate-slide-fade-out {
      animation: slideAndFadeOut 1s ease-in-out forwards;
    }

    /* HTML Email Content Styles */
    .email-html-content {
      max-width: 100%;
      overflow-x: auto;
    }

    .email-html-content img {
      max-width: 100%;
      height: auto;
    }

    .email-html-content table {
      max-width: 100%;
      margin: 1rem 0;
      border-collapse: collapse;
    }

    .email-html-content td,
    .email-html-content th {
      padding: 0.5rem;
      border: 1px solid #e5e7eb;
    }

    .email-html-content a {
      color: #3b82f6;
      text-decoration: underline;
    }

    .email-html-content pre,
    .email-html-content code {
      white-space: pre-wrap;
      background-color: #f3f4f6;
      padding: 0.2rem 0.4rem;
      border-radius: 0.25rem;
    }

    .email-html-content blockquote {
      border-left: 4px solid #e5e7eb;
      margin: 1rem 0;
      padding-left: 1rem;
      color: #6b7280;
    }
  `;
  // ... existing code ...

  // Capture globalStyles in a ref to avoid dependency issues
  const globalStylesRef = useRef(globalStyles);

  useEffect(() => {
    const styleSheet = document.createElement("style");
    styleSheet.textContent = globalStylesRef.current;
    document.head.appendChild(styleSheet);

    return () => {
      document.head.removeChild(styleSheet);
    };
  }, []); // Remove globalStyles from dependencies since it's captured in closure

  // Add this function near other Firebase-related functions
  const saveReadyToReplyToFirebase = async (emails: (Email | ExtendedEmail)[]) => {
    try {
      const db = getFirebaseDB();
      if (!db) return;

      // Convert and sanitize emails
      const sanitizedEmails = emails.map(email => {
        const baseEmail: BaseEmail = {
          id: email.id,
          threadId: email.threadId,
          subject: email.subject,
          sender: email.sender,
          content: email.content,
          receivedAt: typeof email.receivedAt === 'string' ? Date.parse(email.receivedAt) : email.receivedAt
        };

        return {
          ...baseEmail,
          isReplied: 'isReplied' in email ? email.isReplied : false,
          matchedFAQ: 'matchedFAQ' in email && email.matchedFAQ ? {
            question: email.matchedFAQ.question,
            answer: email.matchedFAQ.answer,
            confidence: typeof email.matchedFAQ.confidence === 'number' ? email.matchedFAQ.confidence : 1
          } : undefined,
          suggestedReply: 'suggestedReply' in email ? email.suggestedReply : '',
          status: 'status' in email ? email.status : 'processed'
        } as ExtendedEmail;
      });

      const readyRef = doc(db, 'ready_to_reply', 'latest');
      await setDoc(readyRef, {
        emails: sanitizedEmails,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error saving ready to reply emails to Firebase:', error);
    }
  };

  const loadReadyToReplyFromFirebase = async () => {
    try {
      const db = getFirebaseDB();
      if (!db) return null;

      const readyRef = doc(db, 'ready_to_reply', 'latest');
      const readyDoc = await getDoc(readyRef);

      if (readyDoc.exists()) {
        const { emails, timestamp } = readyDoc.data();
        if (Date.now() - timestamp < FIREBASE_CACHE_DURATION) {
          return emails;
        }
      }
      return null;
    } catch (error) {
      console.error('Error loading ready to reply emails from Firebase:', error);
      return null;
    }
  };

  const handleRemoveFromReadyToReply = async (email: ExtendedEmail) => {
    try {
      // Update emails state to remove this email from ready to reply
      setEmails(prev => prev.map(e => {
        if (e.id === email.id) {
          const updatedEmail: ExtendedEmail = {
            ...e,
            status: 'removed_from_ready',
            matchedFAQ: undefined
          };
          return updatedEmail;
        }
        return e;
      }));

      // Get current ready to reply emails excluding the removed one
      const readyToReplyEmails = emails.filter(e =>
        e.id !== email.id &&
        e.status === 'processed' &&
        e.matchedFAQ &&
        !e.isReplied &&
        e.suggestedReply
      );

      // Update Firebase cache
      await saveReadyToReplyToFirebase(readyToReplyEmails);

      // Update local cache
      saveToCache(CACHE_KEYS.READY_TO_REPLY, {
        emails: readyToReplyEmails,
        timestamp: Date.now()
      });

      // Also save the removed status to a separate cache to persist it
      const removedEmails = loadFromCache('removed_from_ready_emails')?.emails || [];
      saveToCache('removed_from_ready_emails', {
        emails: [...removedEmails, email.id],
        timestamp: Date.now()
      });

      toast.success(
        <div className="flex flex-col gap-1">
          <div className="font-medium">Removed from Ready to Reply</div>
          <div className="text-sm text-gray-600">
            This email won&apos;t be auto-replied to unless you refresh the page
          </div>
        </div>,
        {
          duration: 5000,
          icon: '🚫'
        }
      );

    } catch (error) {
      console.error('Error removing email from ready to reply:', error);
      toast.error('Failed to remove email');
    }
  };

  // Add this helper function inside the component
  const handleShowFullContent = useCallback((emailId: string): void => {
    setEmails((prev: ExtendedEmail[]) => prev.map((e: ExtendedEmail) =>
      e.id === emailId
        ? { ...e, showFullContent: true }
        : e
    ));
  }, []);

  // Add this function to handle moving emails back to relevant
  const handleMoveBackToRelevant = async (email: ExtendedEmail) => {
    try {
      const updatedEmail = {
        ...email,
        isNotRelevant: false,
        irrelevanceReason: undefined
      };

      setEmails((prevEmails: ExtendedEmail[]) =>
        prevEmails.map((e) => (e.id === email.id ? updatedEmail : e))
      );
    } catch (error) {
      console.error('Error moving email back to relevant:', error);
      toast.error('Failed to move email back to relevant');
    }
  };

  function renderNotRelevantEmails() {
    const notRelevantEmails = emails.filter(email => email.isNotRelevant);

    return (
      <div className="space-y-8 relative pl-[4.5rem]">
        {notRelevantEmails.map((email, index) => (
          <div
            key={email.id}
            className="bg-white rounded-lg shadow-sm p-6 space-y-4 relative"
            style={{ marginBottom: '2rem' }}
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
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleMoveBackToRelevant(email)}
                  title="Add back to relevant"
                  className="flex-shrink-0 inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  ↩️ Move Back
                </button>
              </div>
            </div>

            {/* Email Content with Thread Support */}
            {renderEmailContent(email)}
          </div>
        ))}
        {notRelevantEmails.length === 0 && (
          <div className="text-center text-gray-500">No emails marked as not relevant.</div>
        )}
      </div>
    );
  }

  // Add this new function to render all emails
  function renderAllEmails() {
    return (
      <div className="space-y-8 relative pl-[4.5rem]">
        {emails.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto h-12 w-12 text-gray-400 mb-4">
              <InboxIcon className="h-12 w-12" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">No emails found</h3>
            <p className="mt-2 text-sm text-gray-500">
              Your inbox is empty
            </p>
          </div>
        ) : (
          <>
            {emails.map((email, index) => (
              <div
                key={email.id}
                className="bg-white rounded-lg shadow-sm pt-4 pb-6 px-6 space-y-4 relative"
                style={{ marginBottom: '2rem' }}
              >
                {renderEmailTimeline(email, index, emails)}
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      {email.subject}
                    </h3>
                    <div className="text-sm text-gray-500">
                      From: {email.sender}
                    </div>
                    {/* Add status indicators */}
                    <div className="flex gap-2 mt-2">
                      {email.isReplied && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircleIcon className="h-3 w-3 mr-1" />
                          Replied
                        </span>
                      )}
                      {email.isNotRelevant && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          <XCircleIcon className="h-3 w-3 mr-1" />
                          Not Relevant
                        </span>
                      )}
                      {email.matchedFAQ && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          <BookOpenIcon className="h-3 w-3 mr-1" />
                          FAQ Matched
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => refreshSingleEmail(email)}
                    className="p-1 text-gray-500 hover:text-gray-700"
                    title="Refresh email data"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>

                {/* Email Content with Thread Support */}
                {renderEmailContent(email)}

                {/* Show matched FAQ if exists */}
                {email.matchedFAQ && (
                  <div className="mt-4 bg-blue-50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-blue-900 mb-2">Matched FAQ:</h4>
                    <p className="text-sm text-blue-800">{email.matchedFAQ.question}</p>
                    {email.matchedFAQ.answer && (
                      <p className="text-sm text-blue-700 mt-2">{email.matchedFAQ.answer}</p>
                    )}
                  </div>
                )}
              </div>
            ))}

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
          </>
        )}
      </div>
    );
  }

  // Update the "Load More" button text to reflect the larger batch size
  const renderLoadMoreButton = () => (
    <div className="flex justify-center mt-4 mb-8">
      <button
        className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded"
        onClick={() => loadEmails(false)}
        disabled={isLoading}
      >
        {isLoading ? 'Loading...' : 'Load More'}
      </button>
    </div>
  );

  // Fix the remaining type issues in the component
  // Update the email questions check
  const hasValidQuestions = (email: ExtendedEmail, emailQuestions: Map<string, GenericFAQ[]>) => {
    const questions = emailQuestions.get(email.id);
    return questions !== undefined && questions.length > 0;
  };

  // Update the email filtering with proper type checks
  const filterEmails = (emails: ExtendedEmail[], filter: string): ExtendedEmail[] => {
    return emails.filter((email) => {
      if (!email) return false;
      switch (filter) {
        case 'unanswered':
          return !email.isNotRelevant && !email.isReplied;
        case 'not_relevant':
          return !!email.isNotRelevant;
        case 'ready':
          return !!email.matchedFAQ && !email.isReplied;
        default:
          return true;
      }
    });
  };

  // Fix the email state updates
  const updateEmails = (newEmails: ExtendedEmail[]) => {
    setEmails(prevEmails => {
      const uniqueEmails = newEmails.filter(email => {
        return !prevEmails.some(prevEmail => prevEmail.id === email.id);
      });
      return [...prevEmails, ...uniqueEmails] as ExtendedEmail[];
    });
  };

  // Update the email state management
  const handleEmailUpdate = (email: ExtendedEmail | null) => {
    if (!email) return;

    setEmails(prevEmails =>
      prevEmails.map(e =>
        e.id === email.id
          ? { ...e, ...email, status: (email.status || e.status || 'pending') as ExtendedEmail['status'] }
          : e
      )
    );
  };

  const filterReadyEmails = (emails: ExtendedEmail[]) => {
    return emails.filter(email =>
      email.id &&
      (!email.matchedFAQ || !(email.id && ((emailQuestions.get(email.id)?.length ?? 0) > 0))) &&
      !email.isNotRelevant &&
      !email.isReplied
    );
  };

  // Add this function near other email-related functions
  const refreshSingleEmail = async (email: ExtendedEmail) => {
    try {
      if (!user?.accessToken) {
        toast.error('Please sign in to refresh emails');
        return;
      }

      toast.loading('Refreshing email data...');

      let currentToken = user.accessToken;

      // First attempt with current token
      let response = await fetch('/api/emails/refresh-single', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ threadId: email.threadId })
      });

      // Handle 401 by refreshing token
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) {
          toast.dismiss();
          toast.error('Session expired. Please sign in again.');
          return;
        }
        currentToken = newToken;
        // Retry with new token
        response = await fetch('/api/emails/refresh-single', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ threadId: email.threadId })
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch email data');
      }

      const updatedEmail = await response.json();

      // Update Firebase with the new email data
      const db = getFirebaseDB();
      if (!db) throw new Error('Firebase not initialized');

      // Prepare the metadata (everything except content)
      const emailMetadata = {
        id: email.id,
        threadId: email.threadId,
        subject: updatedEmail.subject,
        sender: updatedEmail.sender,
        receivedAt: updatedEmail.receivedAt,
        lastUpdated: Date.now(),
        // Add a flag to indicate content is stored separately
        hasLargeContent: true
      };

      // Prepare the content object
      const emailContent = {
        html: typeof updatedEmail.content === 'object' ? updatedEmail.content.html : null,
        text: typeof updatedEmail.content === 'object' ? updatedEmail.content.text : null
      };

      // Function to truncate content if needed
      const truncateContent = (content: string, maxLength: number = 500000) => {
        if (!content) return content;
        if (content.length <= maxLength) return content;

        // For HTML, try to preserve structure
        if (content.includes('</')) {
          // Find the last complete tag before maxLength
          const truncated = content.substring(0, maxLength);
          const lastCloseTag = truncated.lastIndexOf('</');
          if (lastCloseTag > 0) {
            return truncated.substring(0, lastCloseTag) + '\n<!-- Content truncated due to size limits -->';
          }
        }

        return content.substring(0, maxLength) + '\n... (Content truncated due to size limits)';
      };

      // Truncate content if necessary
      if (emailContent.html) {
        emailContent.html = truncateContent(emailContent.html);
      }
      if (emailContent.text) {
        emailContent.text = truncateContent(emailContent.text);
      }

      try {
        // First update Firebase with the full content object
        const firebaseData = {
          ...emailMetadata,
          content: {
            html: emailContent.html || null,
            text: emailContent.text || null
          }
        };

        // Save metadata to email_cache
        const emailDocRef = doc(db, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
        await setDoc(emailDocRef, firebaseData, { merge: true });

        // Save metadata to thread_cache
        const threadDocRef = doc(db, FIREBASE_COLLECTIONS.THREAD_CACHE, email.threadId);
        await setDoc(threadDocRef, {
          ...firebaseData,
          emailId: email.id
        }, { merge: true });

        // Save content to a separate collection with compression
        const contentDocRef = doc(db, 'email_content', email.id);
        await setDoc(contentDocRef, {
          content: emailContent,
          updatedAt: Date.now()
        });

        // Extract and save new questions
        const contentToAnalyze = emailContent.html || emailContent.text;
        if (contentToAnalyze) {
          const questionsResponse = await fetch('/api/knowledge/extract-questions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              emailContent: contentToAnalyze
            })
          });

          if (questionsResponse.ok) {
            const questionsData = await questionsResponse.json();
            if (questionsData.questions) {
              // Save to both question collections
              await Promise.all([
                saveQuestionsToFirebase(email.id, questionsData.questions),
                saveExtractedQuestionsToFirebase(email.id, questionsData.questions)
              ]);

              // Update emailQuestions state
              setEmailQuestions(prev => {
                const updated = new Map(prev);
                updated.set(email.id, questionsData.questions);
                return updated;
              });
            }
          }
        }

        // Update React state with string content
        const stateData: Partial<ExtendedEmail> = {
          ...emailMetadata,
          content: emailContent.html || emailContent.text || '',
          status: email.status,
          isReplied: email.isReplied,
          isNotRelevant: email.isNotRelevant,
          matchedFAQ: email.matchedFAQ,
          suggestedReply: email.suggestedReply
        };

        setEmails((prevEmails: ExtendedEmail[]) =>
          prevEmails.map((e: ExtendedEmail) =>
            e.id === email.id ? {
              ...e,
              ...stateData
            } : e
          )
        );

        toast.dismiss();
        toast.success(
          <div className="flex flex-col gap-1">
            <div className="font-medium">Email refreshed successfully</div>
            <div className="text-sm text-gray-600">
              Content, metadata, and questions updated
            </div>
          </div>,
          { duration: 3000 }
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('maximum allowed size')) {
          console.error('Content too large, saving metadata only:', error);
          // Save only metadata if content is too large
          const emailDocRef = doc(db, FIREBASE_COLLECTIONS.EMAIL_CACHE, email.id);
          await setDoc(emailDocRef, {
            ...emailMetadata,
            contentError: 'Content too large to store'
          }, { merge: true });

          toast.dismiss();
          toast.warning('Email metadata updated (content too large to store)');
        } else {
          throw error;
        }
      }
    } catch (error) {
      toast.dismiss();
      console.error('Error refreshing email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to refresh email');
    }
  };

  return (
    <Layout>
      <div className="w-full max-w-[95%] sm:max-w-[85%] md:max-w-[75%] lg:max-w-[58%] mx-auto px-2 sm:px-4 py-4 sm:py-8">
        <div className="flex items-center justify-between mb-3 sm:mb-5">
          <div>
            <h1 className="text-sm sm:text-base font-semibold text-gray-900 mb-0.5">Customer Support Triage</h1>
            <p className="text-[11px] text-gray-500 hidden sm:block">Manage and respond to customer inquiries efficiently</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {lastFetchTimestamp > 0 && (
              <div className="text-[11px] text-gray-400 hidden sm:block">
                Last updated: {new Date(lastFetchTimestamp).toLocaleTimeString()}
              </div>
            )}
            <button
              onClick={handleRefresh}
              className="inline-flex items-center px-2 py-1 border border-gray-300 shadow-sm text-[11px] font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <ClockIcon className="h-3 w-3 mr-1" />
              <span className="hidden sm:inline">Refresh</span>
              <span className="sm:hidden">↻</span>
            </button>
          </div>
        </div>
        {renderTabs()}
        <div className="mt-3 sm:mt-5 mb-4 sm:mb-8">
          {renderMainContent()}
        </div>
      </div>
      {renderAnswerModal()}
    </Layout>
  );
}
