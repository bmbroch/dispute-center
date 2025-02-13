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
} from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, doc, setDoc, getDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { Email } from '@/types/email';
import { GenericFAQ, IrrelevanceAnalysis } from '@/types/faq';
import { calculatePatternSimilarity } from '@/lib/utils/similarity';
import { Firestore } from 'firebase/firestore';

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

interface BaseEmail {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string;
  receivedAt: number | string;  // Allow both number and string
}

interface ExtendedEmail extends BaseEmail {
  questions?: GenericFAQ[];
  suggestedReply?: string;
  showFullContent?: boolean;
  isGeneratingReply?: boolean;
  matchedFAQ?: MatchedFAQ;
  status?: 'pending' | 'processed' | 'replied' | 'removed_from_ready';
  isReplied?: boolean;
  isNotRelevant?: boolean;
  isMovingToReady?: boolean;
  emailIds?: string[];
  irrelevanceReason?: string;
  category?: 'support' | 'sales' | 'other';
  aiAnalysis?: boolean;
  analysis?: any; // TODO: Define proper type for analysis
  gmailError?: string;
  threadMessages?: {
    id: string;
    subject: string;
    sender: string;
    content: string;
    receivedAt: number | string;
  }[];
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

// Add loading state tracking
const loadingState = {
  isLoading: false,
  lastFetchTime: 0,
  retryTimeout: null as NodeJS.Timeout | null,
};

const FIREBASE_CACHE_COLLECTION = 'email_cache';
const FIREBASE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Add isEmailReadyForReply helper function
const isEmailReadyForReply = (email: ExtendedEmail, emailQuestions: Map<string, GenericFAQ[]>, answeredFAQs: AnsweredFAQ[]) => {
  const questions = emailQuestions.get(email.id) || [];
  return email.matchedFAQ && 
         !email.isReplied && 
         email.suggestedReply && 
         questions.length > 0 && 
         questions.every(q => {
           const matchedFAQ = answeredFAQs.find(faq => 
             faq.answer && 
             faq.answer.trim() !== '' && 
             calculatePatternSimilarity(faq.question, q.question) > SIMILARITY_THRESHOLD
           );
           return matchedFAQ && matchedFAQ.answer && matchedFAQ.answer.trim() !== '';
         });
};

const loadEmailsFromFirebase = async () => {
  try {
    const db = getFirebaseDB();
    if (!db) return null;

    const cacheRef = doc(db, FIREBASE_CACHE_COLLECTION, 'latest');
    const cacheDoc = await getDoc(cacheRef);
    
    if (cacheDoc.exists()) {
      const { emails, timestamp } = cacheDoc.data();
      
      // Check if cache is still valid
      if (Date.now() - timestamp < FIREBASE_CACHE_DURATION) {
        // Get all not relevant email IDs
        const notRelevantRef = collection(db, 'not_relevant_emails');
        const notRelevantDocs = await getDocs(notRelevantRef);
        const notRelevantIds = new Set(notRelevantDocs.docs.map(doc => doc.id));

        // Sort emails by the most recent message in their thread
        const sortedEmails = emails.map((email: ExtendedEmail) => {
          // Mark email as not relevant if it's in the not_relevant_emails collection
          const isNotRelevant = notRelevantIds.has(email.id);
          
          if (email.threadMessages && email.threadMessages.length > 0) {
            // Sort thread messages by receivedAt in descending order
            email.threadMessages.sort((a, b) => {
              const aTime = typeof a.receivedAt === 'string' ? new Date(a.receivedAt).getTime() : Number(a.receivedAt);
              const bTime = typeof b.receivedAt === 'string' ? new Date(b.receivedAt).getTime() : Number(b.receivedAt);
              return bTime - aTime;
            });
            
            // Update the email's content and receivedAt with the most recent message
            const mostRecent = email.threadMessages[0];
            return {
              ...email,
              content: mostRecent.content,
              subject: mostRecent.subject,
              sender: mostRecent.sender,
              receivedAt: mostRecent.receivedAt,
              isNotRelevant
            };
          }
          return { ...email, isNotRelevant };
        });

        // Sort emails by their most recent message
        sortedEmails.sort((a: ExtendedEmail, b: ExtendedEmail) => {
          const aTime = typeof a.receivedAt === 'string' ? new Date(a.receivedAt).getTime() : Number(a.receivedAt);
          const bTime = typeof b.receivedAt === 'string' ? new Date(b.receivedAt).getTime() : Number(b.receivedAt);
          return bTime - aTime;
        });

        return sortedEmails;
      }
    }
    return null;
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
  CACHED_QUESTIONS: 'cached_questions'
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

// Add this helper function near the top with other helper functions
const handleShowFullContent = (emailId: string) => {
  setEmails(prev => prev.map(e => 
    e.id === emailId 
      ? { ...e, showFullContent: true }
      : e
  ));
};

export default function FAQAutoReplyV2() {
  console.log('=== Component Render Start ===');
  const { user, checkGmailAccess, refreshAccessToken } = useAuth();
  const [emails, setEmails] = useState<ExtendedEmail[]>([]); // Explicitly initialize as empty array
  const [potentialFAQs, setPotentialFAQs] = useState<PotentialFAQ[]>([]);
  const [genericFAQs, setGenericFAQs] = useState<GenericFAQ[]>([]);
  const [activeTab, setActiveTab] = useState<'unanswered' | 'suggested' | 'faq_library' | 'not_relevant'>('unanswered');
  const [loading, setLoading] = useState(true);
  const [loadingFAQs, setLoadingFAQs] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [isAnalysisEnabled, setIsAnalysisEnabled] = useState(false);
  const [showAnswerModal, setShowAnswerModal] = useState(false);
  const [selectedFAQ, setSelectedFAQ] = useState<GenericFAQ | null>(null);
  const [answer, setAnswer] = useState('');
  const [emailQuestions, setEmailQuestions] = useState<EmailQuestionsMap>(new Map());
  const [loadingCache, setLoadingCache] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [answeredFAQs, setAnsweredFAQs] = useState<AnsweredFAQ[]>([]);
  const [editingReply, setEditingReply] = useState<EditingReply | null>(null);
  const [lastFetchTimestamp, setLastFetchTimestamp] = useState<number>(0);
  const [timeUntilNextRefresh, setTimeUntilNextRefresh] = useState<number>(0);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  // Add this state near other state declarations
  const [hasRefreshedOnce, setHasRefreshedOnce] = useState(false);

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

  // Update the loadEmails function to use Firebase cache
  const loadEmails = useCallback(async (forceRefresh = false, nextPage = 1) => {
    if (!user?.accessToken) {
      toast.error('Please sign in to access emails');
      return;
    }

    // Prevent multiple simultaneous loads
    if (loading || loadingMore) {
      return;
    }

    const isLoadingMore = nextPage > 1;
    if (!isLoadingMore) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      // Only use Firebase cache if not forcing refresh
      if (!forceRefresh && nextPage === 1) {
        const cachedEmails = await loadEmailsFromFirebase();
        if (cachedEmails) {
          console.log('Using cached emails from Firebase');
          setEmails(cachedEmails);
          setLoading(false);
        }
      }

      // Check if enough time has passed since last fetch
      const now = Date.now();
      const timeSinceLastFetch = now - lastFetchTimestamp;
      const isFirstFetch = lastFetchTimestamp === 0;
      
      if (!forceRefresh && !isFirstFetch && timeSinceLastFetch < MIN_FETCH_INTERVAL) {
        const waitTime = Math.ceil((MIN_FETCH_INTERVAL - timeSinceLastFetch) / 1000);
        const nextRefreshTime = new Date(now + (MIN_FETCH_INTERVAL - timeSinceLastFetch));
        toast.info(`Using cached data. Next refresh available at ${nextRefreshTime.toLocaleTimeString()}`);
        return;
      }

      let response;
      try {
        response = await fetch(`/api/emails/inbox`, {
          headers: {
            'Authorization': `Bearer ${user.accessToken}`,
            'X-Page': nextPage.toString(),
            'X-Force-Refresh': forceRefresh ? 'true' : 'false',
            'X-Last-Fetch': lastFetchTimestamp.toString()
          }
        });
      } catch (fetchError) {
        console.error('Network error fetching emails:', fetchError);
        throw new Error('Failed to connect to email server. Please check your internet connection.');
      }

      // Handle various HTTP status codes
      if (response.status === 401) {
        console.log('Access token expired, attempting to refresh...');
        const newToken = await refreshAccessToken();
        if (!newToken) {
          throw new Error('Your session has expired. Please sign in again.');
        }
        
        try {
          response = await fetch(`/api/emails/inbox`, {
            headers: {
              'Authorization': `Bearer ${newToken}`,
              'X-Page': nextPage.toString(),
              'X-Force-Refresh': forceRefresh ? 'true' : 'false',
              'X-Last-Fetch': lastFetchTimestamp.toString()
            }
          });
        } catch (retryError) {
          console.error('Network error on retry:', retryError);
          throw new Error('Failed to connect after token refresh. Please try again.');
        }
      }

      if (response.status === 429) {
        const data = await response.json();
        const retryAfter = data.retryAfter || MIN_FETCH_INTERVAL;
        const nextRefreshTime = new Date(now + retryAfter);
        toast.warning(`Rate limit reached. Next refresh available at ${nextRefreshTime.toLocaleTimeString()}`, {
          duration: 5000,
          icon: '⚠️'
        });
        return;
      }

      if (response.status === 403) {
        throw new Error('Access to Gmail API is forbidden. Please check your permissions.');
      }

      if (response.status === 404) {
        throw new Error('Email inbox not found. Please verify your Gmail settings.');
      }

      if (response.status === 500) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Gmail server error. Please try again later.');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch emails (Status: ${response.status})`);
      }

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        console.error('Error parsing response:', parseError);
        throw new Error('Invalid response from email server');
      }

      // Validate response data structure
      if (!data || !Array.isArray(data.emails)) {
        console.error('Invalid response format:', data);
        throw new Error('Invalid email data received from server');
      }

      // Update last fetch timestamp on successful response
      setLastFetchTimestamp(now);

      // Process emails and merge with cached data
      const processedEmails = await Promise.all(data.emails.map(async (email: ExtendedEmail) => {
        try {
          // Check if email is marked as not relevant
          const isNotRelevant = await isEmailMarkedNotRelevant(email.id);
          if (isNotRelevant) {
            return null; // Skip this email
          }

          const cached = loadFromCache(`${CACHE_KEYS.AI_ANALYSIS}_${email.id}`) || {};
          return {
            ...email,
            suggestedReply: email.suggestedReply || (cached as CacheData).suggestedReply || '',
            questions: cached.questions || [],
            timestamp: cached.timestamp || Date.now()
          };
        } catch (processingError) {
          console.error('Error processing email:', email.id, processingError);
          return email;
        }
      }));

      // Filter out null values (not relevant emails)
      const filteredEmails = processedEmails.filter(email => email !== null);

      // Update emails state
      setEmails(prev => {
        const newEmails = isLoadingMore
          ? [...prev, ...filteredEmails.filter(
              (email: ExtendedEmail) => !prev.some((e: ExtendedEmail) => e.id === email.id)
            )]
          : filteredEmails;

        // Save to Firebase cache if this is a fresh load
        if (!isLoadingMore) {
          saveEmailsToFirebase(newEmails).catch(error => {
            console.error('Error saving to Firebase:', error);
          });
        }

        return newEmails;
      });

      // Update questions map after processing emails
      try {
        const questionsMap = new Map<string, GenericFAQ[]>();
        filteredEmails.forEach((email: ExtendedEmail) => {
          if (email.questions) {
            questionsMap.set(email.id, email.questions);
          }
        });
        setEmailQuestions(questionsMap);
      } catch (questionsError) {
        console.error('Error updating questions map:', questionsError);
        toast.error('Failed to process email questions');
      }

      // Process AI analysis results and update genericFAQs
      try {
        const newGenericFAQs: GenericFAQ[] = [];
        filteredEmails.forEach((email: ExtendedEmail) => {
          const questions = emailQuestions.get(email.id) || [];
          if (questions.length > 0) {
            questions.forEach((question: GenericFAQ) => {
              const existingQuestion = newGenericFAQs.find(faq => 
                calculatePatternSimilarity(faq.question, typeof question === 'string' ? question : question.question) > 0.8
              );
              
              if (!existingQuestion) {
                newGenericFAQs.push({
                  question: typeof question === 'string' ? question : question.question,
                  category: 'support',
                  emailIds: [email.id],
                  confidence: 1,
                  requiresCustomerSpecificInfo: false
                });
              } else {
                if (!existingQuestion.emailIds) {
                  existingQuestion.emailIds = [];
                }
                existingQuestion.emailIds.push(email.id);
              }
            });
          }
        });

        // Group similar questions before updating state
        const groupedFAQs = groupSimilarPatterns(newGenericFAQs);

        // Update genericFAQs state
        setGenericFAQs(prev => {
          if (isLoadingMore) {
            const combined = [...prev, ...groupedFAQs];
            return groupSimilarPatterns(combined);
          }
          return groupedFAQs;
        });

        // Save to cache
        try {
          if (!isLoadingMore) {
            saveToCache(CACHE_KEYS.EMAILS, filteredEmails);
            saveToCache(CACHE_KEYS.QUESTIONS, Object.fromEntries(emailQuestions));
            saveToCache(CACHE_KEYS.GENERIC_FAQS, groupedFAQs);
          }
        } catch (cacheError) {
          console.error('Error saving to cache:', cacheError);
          // Continue even if cache save fails
        }

        // If we got no new emails but hasMore is true, try loading the next page
        if (filteredEmails.length === 0 && data.hasMore) {
          return loadEmails(forceRefresh, nextPage + 1);
        }
      } catch (faqError) {
        console.error('Error processing FAQs:', faqError);
        toast.error('Failed to process FAQ patterns');
      }

      // Update pagination state
      setHasMore(data.hasMore || false);
      setPage(nextPage);

      // If we got no new emails but hasMore is true, try loading the next page
      if (filteredEmails.length === 0 && data.hasMore) {
        return loadEmails(forceRefresh, nextPage + 1);
      }
    } catch (error) {
      console.error('Error loading emails:', error);
      
      // Handle specific error types
      if (error instanceof Error) {
        if (error.message.includes('Quota exceeded')) {
          toast.error('Gmail API quota reached. Please try again in a few minutes.', {
            duration: 5000,
            icon: '⚠️'
          });
        } else if (error.message.includes('internet connection')) {
          toast.error('Network error. Please check your internet connection.', {
            duration: 5000,
            icon: '🌐'
          });
        } else if (error.message.includes('session has expired')) {
          toast.error('Session expired. Please sign in again.', {
            duration: 5000,
            icon: '🔑'
          });
        } else {
          toast.error(error.message, {
            duration: 5000,
            icon: '❌'
          });
        }
      } else {
        toast.error('An unexpected error occurred while loading emails', {
          duration: 5000,
          icon: '❌'
        });
      }
    } finally {
      // Only set loading to false if we have emails or if there was an error
      if (!isLoadingMore) {
        setLoading(false);
      }
      setLoadingMore(false);
    }
  }, [
    user?.accessToken,
    calculatePatternSimilarity,
    groupSimilarPatterns,
    loading,
    loadingMore,
    refreshAccessToken,
    lastFetchTimestamp,
    emailQuestions
  ]);

  useEffect(() => {
    // Check if analysis is enabled via environment variable
    setIsAnalysisEnabled(process.env.NEXT_PUBLIC_OPENAI_API_KEY !== undefined);
  }, []);

  useEffect(() => {
    const initialize = async () => {
      if (!isSubscribed.current) return;
      
      try {
        // Always try Firebase cache first for ready-to-reply emails
        const firebaseReadyToReply = await loadReadyToReplyFromFirebase();
        
        if (firebaseReadyToReply && firebaseReadyToReply.length > 0) {
          // Update local cache
          saveToCache(CACHE_KEYS.READY_TO_REPLY, { 
            emails: firebaseReadyToReply, 
            timestamp: Date.now() 
          });
          
          // Update emails state to include ready-to-reply
          setEmails(prev => {
            const existingEmailIds = new Set(prev.map(e => e.id));
            const newEmails = [...prev];
            
            firebaseReadyToReply.forEach((readyEmail: ExtendedEmail) => {
              if (!existingEmailIds.has(readyEmail.id)) {
                newEmails.push(readyEmail);
              } else {
                // Update existing email with ready-to-reply status
                const index = newEmails.findIndex(e => e.id === readyEmail.id);
                if (index !== -1) {
                  newEmails[index] = {
                    ...newEmails[index],
                    ...readyEmail,
                    status: 'processed'
                  };
                }
              }
            });
            
            return newEmails;
          });
        }
        
        // Then load regular emails
        const firebaseEmails = await loadEmailsFromFirebase();
        if (firebaseEmails && firebaseEmails.length > 0) {
          setEmails(prev => {
            const existingEmailIds = new Set(prev.map(e => e.id));
            return [
              ...prev,
              ...firebaseEmails.filter((e: ExtendedEmail) => !existingEmailIds.has(e.id))
            ];
          });
          saveToCache(CACHE_KEYS.EMAILS, { emails: firebaseEmails, timestamp: Date.now() });
        }
        
        setLastFetchTimestamp(Date.now());
        
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
  }, [emails, isSubscribed, loadEmails]); // Added emails to dependency array

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
    if (!loadingMore && hasMore) {
      loadEmails(false, page + 1);
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

  const handleCreateFAQ = async (email: ExtendedEmail) => {
    console.log('=== Starting FAQ Creation ===');
    console.log('Email:', {
      id: email.id,
      subject: email.subject,
      contentLength: email.content?.length,
      contentPreview: email.content?.substring(0, 100) + '...'
    });

    if (!email.content) {
      console.log('Error: No email content to analyze');
      toast.error('No email content to analyze');
      return;
    }
    
    setAnalyzing(true);
    try {
      console.log('Making API request to extract questions...');
      const response = await fetch('/api/knowledge/extract-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailContent: email.content
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
      
      // Map the questions to GenericFAQ objects with proper type handling
      const questionObjects = data.questions.map((q: any) => {
        console.log('Processing question:', q);
        
        // If q is already a properly formatted object, use it directly
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
        
        // If q is a string, create a new object
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

      // Save questions to Firebase
      console.log('Saving questions to Firebase...');
      await saveQuestionsToFirebase(email.id, questionObjects);

      // Update the email object with the questions
      console.log('Updating emails state...');
      setEmails(prev => prev.map(e => 
        e.id === email.id 
          ? { ...e, questions: questionObjects }
          : e
      ));

      // Save to cache
      console.log('Saving to cache...');
      saveToCache(CACHE_KEYS.QUESTIONS, Object.fromEntries(emailQuestions));
      
      // Show success toast with question count
      toast.success(`Found ${questionObjects.length} question${questionObjects.length === 1 ? '' : 's'} in email`);

      // Check if all questions have matching FAQs
      const allQuestionsAnswered = questionObjects.every((q: GenericFAQ) => 
        answeredFAQs.some(faq => 
          faq.answer && 
          faq.answer.trim() !== '' && 
          calculatePatternSimilarity(faq.question, q.question) > SIMILARITY_THRESHOLD
        )
      );

      // If all questions are answered, show the "moving to Ready to Reply" notification
      if (allQuestionsAnswered) {
        toast.success(
          <div className="flex flex-col gap-1">
            <div className="font-medium">All questions have been answered! 🎉</div>
            <div className="text-sm text-gray-600">
              Moving to "Ready to Reply" once we finish generating a response...
            </div>
          </div>,
          {
            duration: 5000,
            icon: '✨'
          }
        );

        // Add a slight delay before starting the animation
        setTimeout(() => {
          setEmails(prev => prev.map(e => 
            e.id === email.id 
              ? { ...e, isMovingToReady: true }
              : e
          ));
        }, 1000);

        // Remove the email from the list after animation completes
        setTimeout(() => {
          setEmails(prev => prev.filter(e => e.id !== email.id));
        }, 1500);
      }

      console.log('FAQ creation completed successfully');
    } catch (error) {
      console.error('Error in handleCreateFAQ:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to analyze email. Please try again.');
    } finally {
      setAnalyzing(false);
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

    try {
      // Update emails state
      setEmails(prev => prev.map(e => 
        e.id === emailId 
          ? { ...e, suggestedReply: editingReply.reply }
          : e
      ));

      // Get the updated ready-to-reply emails
      const readyToReplyEmails = emails.map(e => 
        e.id === emailId 
          ? { ...e, suggestedReply: editingReply.reply }
          : e
      ).filter(e => 
        e.status === 'processed' && 
        e.matchedFAQ && 
        !e.isReplied
      );

      // Save to Firebase
      await saveReadyToReplyToFirebase(readyToReplyEmails);

      // Save to local cache
      saveToCache(CACHE_KEYS.READY_TO_REPLY, {
        emails: readyToReplyEmails,
        timestamp: Date.now()
      });

      setEditingReply(null);
      toast.success('Reply updated successfully');
    } catch (error) {
      console.error('Error saving reply:', error);
      toast.error('Failed to save reply');
    }
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

  const renderEmailContent = (email: ExtendedEmail) => {
    const isThreadExpanded = expandedThreads.has(email.threadId);
    const hasThread = email.threadMessages && email.threadMessages.length > 1;
    
    // Get the most recent message content
    const mostRecentContent = hasThread 
      ? getCleanContent(email.threadMessages[0].content)
      : getCleanContent(email.content);

    const rawContent = hasThread ? email.threadMessages[0].content : email.content;
    const isHTML = isHTMLContent(rawContent);

    return (
      <div className="space-y-4">
        {/* Show More/Less Button at the top */}
        <button
          onClick={() => handleShowFullContent(email.id)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-blue-700 bg-blue-50 hover:bg-blue-100 transition-all duration-200"
        >
          <ChevronRightIcon 
            className={`h-3 w-3 transform transition-transform duration-200 ${
              email.showFullContent ? 'rotate-90' : '-rotate-90'
            }`}
          />
          {email.showFullContent ? 'Show Less' : 'Show More'}
        </button>

        {/* Email Content */}
        <div className="prose max-w-none">
          <div className="text-gray-700">
            <div 
              className={`relative overflow-hidden transition-all duration-300 ease-in-out ${
                email.showFullContent ? '' : 'max-h-[120px]'
              }`}
            >
              {/* Gradient overlay for collapsed state */}
              {!email.showFullContent && (
                <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white to-transparent pointer-events-none" />
              )}
              
              {/* Content */}
              {isHTML ? (
                <div 
                  className="email-html-content"
                  dangerouslySetInnerHTML={{ __html: mostRecentContent }}
                />
              ) : (
                <div className="whitespace-pre-wrap">{mostRecentContent}</div>
              )}
            </div>
          </div>
        </div>

        {/* Thread View Toggle */}
        {hasThread && (
          <div className="mt-4">
            <button
              onClick={() => toggleThreadExpansion(email.threadId)}
              className="flex items-center text-sm text-gray-600 hover:text-gray-800"
            >
              <ChevronRightIcon
                className={`w-4 h-4 mr-1 transform transition-transform duration-200 ${
                  isThreadExpanded ? 'rotate-90' : ''
                }`}
              />
              {isThreadExpanded ? 'Hide Thread' : `View Thread (${email.threadMessages.length} messages)`}
            </button>
          </div>
        )}

        {/* Thread Messages */}
        {isThreadExpanded && hasThread && (
          <div className="mt-4 space-y-4 pl-4 border-l-2 border-gray-200">
            {email.threadMessages.map((message, index) => (
              <div key={message.id} className="space-y-2">
                <div className="flex items-center text-sm text-gray-600">
                  <span className="font-medium">{message.sender}</span>
                  <span className="mx-2">•</span>
                  <span>{new Date(message.receivedAt).toLocaleString()}</span>
                </div>
                <div 
                  className="prose max-w-none text-gray-700"
                  dangerouslySetInnerHTML={{ 
                    __html: isHTMLContent(message.content) ? message.content : message.content
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderTabs = () => {
    const readyToReplyCount = emails.filter(e => 
      e.status === 'processed' && 
      e.matchedFAQ && 
      !e.isReplied &&
      e.suggestedReply // Make sure we have a suggested reply
    ).length;

    return (
      <div className="border-b border-gray-200 mb-8">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {[
            { 
              id: 'unanswered', 
              label: 'Unanswered Emails', 
              icon: MessageCircleIcon, 
              count: emails.filter(e => !e.isReplied && !e.isNotRelevant && !e.matchedFAQ).length,
              description: 'Step 1: Extract questions from emails'
            },
            { 
              id: 'suggested', 
              label: 'Ready to Reply', 
              icon: CheckCircleIcon, 
              count: readyToReplyCount,
              description: 'Step 2: Send auto-replies'
            },
            {
              id: 'faq_library',
              label: 'FAQ Library',
              icon: BookOpenIcon,
              count: answeredFAQs.filter(faq => faq.answer).length,
              description: 'Browse all answered FAQs'
            },
            {
              id: 'not_relevant',
              label: 'Not Relevant',
              icon: XCircleIcon,
              count: emails.filter(e => e.isNotRelevant).length,
              description: 'Emails marked as not relevant'
            }
          ].map(({ id, label, icon: Icon, count, description }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as any)}
              className={`
                group relative min-w-0 flex-1 overflow-hidden py-4 px-4 text-center text-sm font-medium hover:bg-gray-50 focus:z-10
                ${activeTab === id ? 'border-b-2 border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}
              `}
            >
              <div className="flex items-center justify-center space-x-2">
                <Icon className="h-5 w-5" />
                <span>{label}</span>
                {count > 0 && (
                  <span className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium 
                    ${activeTab === id ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                    {count}
                  </span>
                )}
              </div>
              <span className="mt-1 block text-xs text-gray-500">{description}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  };

  const renderUnansweredEmails = () => {
    return (
      <div className="space-y-8">
        {emails
          .filter(email => !email.isReplied && !email.isNotRelevant)
          .map(email => {
            const questions = emailQuestions.get(email.id) || [];
            const hasQuestions = questions.length > 0;

            return (
              <div
                key={email.id}
                className={`bg-white rounded-lg shadow-sm p-6 space-y-4 ${
                  email.isMovingToReady ? 'opacity-50' : ''
                }`}
              >
                {/* Email Header */}
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      {email.subject}
                    </h3>
                    <div className="text-sm text-gray-500">
                      From: {email.sender} • {new Date(email.receivedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => copyEmailDebugInfo(email)}
                      className="flex-shrink-0 inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    >
                      📋 Copy Debug
                    </button>
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
                  {(!email.aiAnalysis && !email.analysis) || (!hasQuestions && !email.isGeneratingReply) ? (
                    <button
                      onClick={() => handleCreateFAQ(email)}
                      disabled={analyzing}
                      className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                    >
                      {analyzing ? (
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
                  ) : (
                    <div className="text-xs text-gray-500">
                      {hasQuestions ? `${questions.length} questions found` : 'No questions found in this email'}
                    </div>
                  )}
                </div>

                {/* Questions bubbles */}
                {hasQuestions && (
                  <div className="mt-4">
                    <h4 className="text-xs font-medium text-gray-900 mb-2">Questions Identified:</h4>
                    <div className="flex flex-wrap gap-2">
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
                  </div>
                )}
              </div>
            );
          })}
      </div>
    );
  };

  const renderAnswerModal = () => (
    <Transition.Root show={showAnswerModal} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={setShowAnswerModal}>
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

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-8 text-left align-middle shadow-xl transition-all">
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
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimestamp;
    const isFirstFetch = lastFetchTimestamp === 0;

    // Allow refresh if it's the first time after page load or if enough time has passed
    if (!hasRefreshedOnce || isFirstFetch || timeSinceLastFetch >= MIN_FETCH_INTERVAL) {
      console.log('=== Starting Refresh ===');
      setLoading(true);
      try {
        console.log('Clearing cache...');
        clearCache();
        
        // Reset ready-to-reply emails in Firebase
        const db = getFirebaseDB();
        if (db) {
          console.log('Resetting ready-to-reply emails in Firebase...');
          const readyRef = doc(db, 'ready_to_reply', 'latest');
          await setDoc(readyRef, { 
            emails: [], 
            timestamp: now 
          });

          // Also clear the removed emails tracking
          const removedRef = doc(db, 'removed_from_ready', 'latest');
          await setDoc(removedRef, {
            emailIds: [],
            timestamp: now
          });
        }
        
        // Reset states
        setEmails(prev => prev.filter(e => e.status !== 'processed' && e.status !== 'removed_from_ready'));
        setEmailQuestions(new Map());
        setGenericFAQs([]);
        
        // Load fresh data
        await loadEmails(true, 1);
        
        setLastFetchTimestamp(Date.now());
        setHasRefreshedOnce(true);
        console.log('=== Refresh Complete ===');
        toast.success('Refreshed successfully');
      } catch (error) {
        console.error('Error refreshing:', error);
        toast.error('Failed to refresh');
      } finally {
        setLoading(false);
      }
    } else {
      const waitTime = Math.ceil((MIN_FETCH_INTERVAL - timeSinceLastFetch) / 1000);
      toast.error(`Please wait ${waitTime} seconds before refreshing again`);
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
    console.log('=== Rendering Main Content ===');
    console.log('Current activeTab:', activeTab);
    console.log('Current answeredFAQs:', answeredFAQs);
    
    if (loading) {
      console.log('Showing loading state');
      return <SkeletonLoader />;
    }

    switch (activeTab) {
      case 'unanswered':
        console.log('Rendering unanswered tab');
        return renderUnansweredEmails();
      case 'suggested':
        console.log('Rendering suggested tab');
        return renderSuggestedReplies();
      case 'faq_library':
        console.log('Rendering FAQ library tab');
        return renderFAQLibrary();
      case 'not_relevant':
        console.log('Rendering not relevant tab');
        return renderNotRelevantEmails();
      default:
        console.log('Unknown tab:', activeTab);
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
      <div className="space-y-6">
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
            {readyToReplyEmails.map(email => (
              <div key={email.id} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                {/* Email Header */}
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

                {/* Content Sections */}
                <div className="px-6">
                  {/* Original Email */}
                  <div className="mb-6">
                    <div className="flex items-center text-sm text-gray-500 mb-2">
                      <MessageCircleIcon className="h-4 w-4 mr-1.5" />
                      Original Email
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {email.content}
                      </p>
                    </div>
                  </div>

                  {/* FAQ Match Indicator */}
                  <div className="mb-6">
                    <div className="group relative">
                      <div className="flex items-center text-sm text-gray-500 mb-2">
                        <BookOpenIcon className="h-4 w-4 mr-1.5" />
                        <span>Matched with {email.matchedFAQ ? '2' : '0'} FAQs</span>
                        <button className="ml-1.5 text-gray-400 hover:text-gray-600">
                          <Info className="h-4 w-4" />
                        </button>
                      </div>
                      {/* Tooltip content */}
                      <div className="hidden group-hover:block absolute left-0 bottom-full mb-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
                        <div className="font-medium mb-1">Matched FAQs:</div>
                        <ul className="space-y-1">
                          <li>• {email.matchedFAQ?.question}</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* AI Generated Reply */}
                  <div className="mb-6">
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
                    
                    {email.gmailError ? (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-start">
                          <XCircleIcon className="h-5 w-5 text-red-400 mt-0.5 mr-2" />
                          <div>
                            <h3 className="text-sm font-medium text-red-800">Gmail API Error</h3>
                            <p className="mt-1 text-sm text-red-700">{email.gmailError}</p>
                          </div>
                        </div>
                      </div>
                    ) : editingReply?.emailId === email.id ? (
                      <div className="space-y-3">
                        <div className="relative">
                          {/* Rich Text Editor Controls */}
                          <div className="absolute top-0 left-0 right-0 flex items-center gap-1 px-2 py-1.5 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                            <button className="p-1 hover:bg-gray-200 rounded" title="Bold">
                              <Bold className="h-4 w-4 text-gray-600" />
                            </button>
                            <button className="p-1 hover:bg-gray-200 rounded" title="Italic">
                              <Italic className="h-4 w-4 text-gray-600" />
                            </button>
                            <button className="p-1 hover:bg-gray-200 rounded" title="Bullet List">
                              <List className="h-4 w-4 text-gray-600" />
                            </button>
                            <div className="h-4 w-px bg-gray-300 mx-1"></div>
                            <button className="p-1 hover:bg-gray-200 rounded" title="Add Link">
                              <Link className="h-4 w-4 text-gray-600" />
                            </button>
                          </div>
                          
                          <textarea
                            value={editingReply.reply}
                            onChange={(e) => setEditingReply({ ...editingReply, reply: e.target.value })}
                            className="w-full rounded-lg border border-gray-200 shadow-sm focus:border-purple-500 focus:ring-purple-500 mt-12 px-6 py-4"
                            rows={15}
                            style={{ minHeight: '400px' }}
                            placeholder="Edit your reply here..."
                          />
                        </div>
                        
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingReply(null)}
                            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveReply(email.id)}
                            className="px-3 py-1.5 text-sm bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="absolute -left-2 top-3 w-1 h-[calc(100%-24px)] bg-purple-100 rounded-full"></div>
                        <div className="bg-purple-50 rounded-lg p-4 pl-6">
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">
                            {email.suggestedReply || generateDefaultReply(email)}
                          </p>
                        </div>
                      </div>
                    )}
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
  }, [genericFAQs, answeredFAQs, emailQuestions, activeTab, loading, loadingFAQs, loadingCache, loadingMore]);

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
  const handleShowFullContent = useCallback((emailId: string) => {
    setEmails(prev => prev.map(e => 
      e.id === emailId 
        ? { ...e, showFullContent: !e.showFullContent }
        : e
    ));
  }, []);

  // Add this function to handle moving emails back to relevant
  const handleMoveBackToRelevant = async (email: ExtendedEmail) => {
    try {
      // Remove from not_relevant_emails collection in Firebase
      const db = getFirebaseDB();
      if (!db) throw new Error('Firebase DB not initialized');

      const notRelevantRef = doc(db, 'not_relevant_emails', email.id);
      await deleteDoc(notRelevantRef);

      // Update local state
      setEmails(prev => prev.map(e => 
        e.id === email.id ? { ...e, isNotRelevant: false } : e
      ));

      toast.success('Email moved back to unanswered emails');
    } catch (error) {
      console.error('Error moving email back to relevant:', error);
      toast.error('Failed to move email back');
    }
  };

  function renderNotRelevantEmails() {
    return (
      <div className="space-y-8">
        {emails
          .filter(email => email.isNotRelevant)
          .map(email => (
            <div
              key={email.id}
              className="bg-white rounded-lg shadow-sm p-6 space-y-4"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <h3 className="text-lg font-medium text-gray-900">
                    {email.subject}
                  </h3>
                  <div className="text-sm text-gray-500">
                    From: {email.sender} • {new Date(email.receivedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => copyEmailDebugInfo(email)}
                    className="flex-shrink-0 inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                  >
                    📋 Copy Debug
                  </button>
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
        {emails.filter(e => e.isNotRelevant).length === 0 && (
          <div className="text-center text-gray-500">No emails marked as not relevant.</div>
        )}
      </div>
    );
  }

  return (
    <Layout>
      <div className="max-w-[58%] mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold text-gray-900 mb-0.5">Customer Support Triage</h1>
            <p className="text-[11px] text-gray-500">Manage and respond to customer inquiries efficiently</p>
          </div>
          <div className="flex items-center gap-3">
            {lastFetchTimestamp > 0 && (
              <div className="text-[11px] text-gray-400">
                Last updated: {new Date(lastFetchTimestamp).toLocaleTimeString()}
              </div>
            )}
            <button
              onClick={handleRefresh}
              className="inline-flex items-center px-2 py-1 border border-gray-300 shadow-sm text-[11px] font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <ClockIcon className="h-3 w-3 mr-1" />
              Refresh
            </button>
          </div>
        </div>
        {/* Tabs section */}
        <div className="border-b border-gray-200 mb-5">
          <nav className="-mb-px flex space-x-4" aria-label="Tabs">
            {[
              { 
                id: 'unanswered', 
                label: 'Unanswered Emails', 
                icon: MessageCircleIcon, 
                count: emails.filter(e => !e.isReplied && !e.isNotRelevant && !e.matchedFAQ).length,
                description: 'Step 1: Extract questions from emails'
              },
              { 
                id: 'suggested', 
                label: 'Ready to Reply', 
                icon: CheckCircleIcon, 
                count: readyToReplyCount,
                description: 'Step 2: Send auto-replies'
              },
              {
                id: 'faq_library',
                label: 'FAQ Library',
                icon: BookOpenIcon,
                count: answeredFAQs.filter(faq => faq.answer).length,
                description: 'Browse all answered FAQs'
              },
              {
                id: 'not_relevant',
                label: 'Not Relevant',
                icon: XCircleIcon,
                count: emails.filter(e => e.isNotRelevant).length,
                description: 'Emails marked as not relevant'
              }
            ].map(({ id, label, icon: Icon, count, description }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as any)}
                className={`
                  group relative min-w-0 flex-1 overflow-hidden py-1.5 px-2 text-[11px] font-medium hover:bg-gray-50 focus:z-10
                  ${activeTab === id ? 'border-b-2 border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}
                `}
              >
                <div className="flex items-center justify-center space-x-1">
                  <Icon className="h-3 w-3" />
                  <span>{label}</span>
                  {count > 0 && (
                    <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium 
                      ${activeTab === id ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                      {count}
                    </span>
                  )}
                </div>
                <span className="mt-0.5 block text-[9px] text-gray-500">{description}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="mt-5 mb-8">
          {renderMainContent()}
        </div>
      </div>
    </Layout>
  );
} 