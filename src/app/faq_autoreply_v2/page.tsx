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
} from 'lucide-react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, doc, setDoc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { Email } from '@/types/email';
import { GenericFAQ, IrrelevanceAnalysis } from '@/types/faq';
import { calculatePatternSimilarity } from '@/lib/utils/similarity';

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
}

interface MatchedFAQ {
  question: string;
  answer: string;
  confidence: number;
}

interface ExtendedEmail extends Omit<Email, 'status' | 'matchedFAQ'> {
  questions?: GenericFAQ[];
  suggestedReply?: string;
  showFullContent?: boolean;
  isGeneratingReply?: boolean;
  matchedFAQ?: MatchedFAQ;
  status?: 'pending' | 'processed' | 'replied';
}

// Add cache helper functions at the top of the file
const CACHE_KEYS = {
  EMAILS: 'faq_emails_cache',
  QUESTIONS: 'faq_questions_cache',
  GENERIC_FAQS: 'faq_generic_faqs_cache',
  LAST_FETCH: 'faq_last_fetch_timestamp',
  AI_ANALYSIS: 'faq_ai_analysis_cache',
  ANSWERED_FAQS: 'faq_answered_faqs_cache'
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
const ANSWERED_FAQS_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes for answered FAQs
const MIN_FETCH_INTERVAL = 30000; // 30 seconds in milliseconds

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
        return emails;
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
  const questions = emailQuestions.get(email.id) || [];
  const debugText = `
=== Email Debug Info ===
Subject: ${email.subject}
From: ${email.sender}

Original Customer Question:
${email.content}

AI Generated Questions (${questions.length}):
${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}
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

// Add new function to save extracted questions to Firebase
const saveExtractedQuestionsToFirebase = async (emailId: string, questions: GenericFAQ[]) => {
  try {
    const db = getFirebaseDB();
    const docRef = doc(db, FIREBASE_COLLECTIONS.CACHED_QUESTIONS, emailId);
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

// Add new function to get cached questions from Firebase
const getCachedQuestionsFromFirebase = async (emailId: string) => {
  try {
    const db = getFirebaseDB();
    const docRef = doc(db, FIREBASE_COLLECTIONS.CACHED_QUESTIONS, emailId);
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

export default function FAQAutoReplyV2() {
  console.log('=== Component Render Start ===');
  const { user, checkGmailAccess, refreshAccessToken } = useAuth();
  const [emails, setEmails] = useState<ExtendedEmail[]>([]);
  const [potentialFAQs, setPotentialFAQs] = useState<PotentialFAQ[]>([]);
  const [genericFAQs, setGenericFAQs] = useState<GenericFAQ[]>([]);
  const [activeTab, setActiveTab] = useState<'unanswered' | 'suggested' | 'faq_expansion' | 'faq_library'>('unanswered');
  const [loading, setLoading] = useState(true);
  const [loadingFAQs, setLoadingFAQs] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
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
    const questions = emailQuestions.get(email.id) || [];
    if (questions.length === 0) return false;

    // Check if all questions have matching answered FAQs
    const allQuestionsAnswered = questions.every(q => {
      const matchedFAQ = findMatchingAnsweredFAQ(q.question);
      return matchedFAQ && matchedFAQ.answer && matchedFAQ.answer.trim() !== '';
    });

    if (allQuestionsAnswered) {
      // Find the best matching FAQ for the email (highest confidence)
      const bestMatch = questions.reduce((best, current) => {
        const matchedFAQ = findMatchingAnsweredFAQ(current.question);
        if (!matchedFAQ || !matchedFAQ.answer || matchedFAQ.answer.trim() === '') return best;
        if (!best || matchedFAQ.confidence > best.confidence) return matchedFAQ;
        return best;
      }, null as AnsweredFAQ | null);

      if (bestMatch) {
        return {
          question: bestMatch.question,
          answer: bestMatch.answer,
          confidence: bestMatch.confidence
        };
      }
    }

    return null;
  }, [emailQuestions, findMatchingAnsweredFAQ]);

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
      
      if (!forceRefresh && timeSinceLastFetch < MIN_FETCH_INTERVAL) {
        const waitTime = Math.ceil((MIN_FETCH_INTERVAL - timeSinceLastFetch) / 1000);
        const nextRefreshTime = new Date(now + (MIN_FETCH_INTERVAL - timeSinceLastFetch));
        toast.info(`Using cached data. Next refresh available at ${nextRefreshTime.toLocaleTimeString()}`);
        return;
      }

      let response = await fetch(`/api/emails/inbox`, {
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'X-Page': nextPage.toString(),
          'X-Force-Refresh': forceRefresh ? 'true' : 'false',
          'X-Last-Fetch': lastFetchTimestamp.toString()
        }
      });
      
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) {
          throw new Error('Session expired. Please sign in again.');
        }
        
        response = await fetch(`/api/emails/inbox`, {
          headers: {
            'Authorization': `Bearer ${newToken}`,
            'X-Page': nextPage.toString(),
            'X-Force-Refresh': forceRefresh ? 'true' : 'false',
            'X-Last-Fetch': lastFetchTimestamp.toString()
          }
        });
      }

      if (response.status === 429) {
        const data = await response.json();
        const retryAfter = data.retryAfter || MIN_FETCH_INTERVAL;
        const nextRefreshTime = new Date(now + retryAfter);
        toast.info(`Rate limit reached. Using cached data. Next refresh available at ${nextRefreshTime.toLocaleTimeString()}`);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch emails');
      }

      const data = await response.json();
      
      // Update last fetch timestamp on successful response
      setLastFetchTimestamp(now);

      // Process emails and merge with cached data
      const processedEmails = data.emails.map((email: ExtendedEmail) => {
        const cached = loadFromCache(`${CACHE_KEYS.AI_ANALYSIS}_${email.id}`) || {};
        return {
          ...email,
          suggestedReply: email.suggestedReply || (cached as CacheData).suggestedReply || '',
          questions: cached.questions || [],
          timestamp: cached.timestamp || Date.now()
        };
      });

      // Update emails state
      setEmails(prev => {
        const newEmails = isLoadingMore
          ? [...prev, ...processedEmails.filter(
              (email: ExtendedEmail) => !prev.some((e: ExtendedEmail) => e.id === email.id)
            )]
          : processedEmails;

        // Save to Firebase cache if this is a fresh load
        if (!isLoadingMore) {
          saveEmailsToFirebase(newEmails);
        }

        return newEmails;
      });

      // Update questions map after processing emails
      const questionsMap = new Map<string, GenericFAQ[]>();
      processedEmails.forEach((email: ExtendedEmail) => {
        if (email.questions) {
          questionsMap.set(email.id, email.questions);
        }
      });
      setEmailQuestions(questionsMap);

      // Process AI analysis results and update genericFAQs
      const newGenericFAQs: GenericFAQ[] = [];
      processedEmails.forEach((email: ExtendedEmail) => {
        const questions = questionsMap.get(email.id) || [];
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

      // Update pagination state
      setHasMore(data.hasMore || false);
      setPage(nextPage);

      // Save to cache
      if (!isLoadingMore) {
        saveToCache(CACHE_KEYS.EMAILS, processedEmails);
        saveToCache(CACHE_KEYS.QUESTIONS, Object.fromEntries(questionsMap));
        saveToCache(CACHE_KEYS.GENERIC_FAQS, groupedFAQs);
      }

      // If we got no new emails but hasMore is true, try loading the next page
      if (processedEmails.length === 0 && data.hasMore) {
        return loadEmails(forceRefresh, nextPage + 1);
      }
    } catch (error) {
      console.error('Error loading emails:', error);
      if (error instanceof Error && error.message.includes('Quota exceeded')) {
        toast.error('Gmail API quota reached. Please try again in a few minutes.');
      } else {
        toast.error(error instanceof Error ? error.message : 'Failed to load emails');
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
    MIN_FETCH_INTERVAL
  ]);

  useEffect(() => {
    // Check if analysis is enabled via environment variable
    setIsAnalysisEnabled(process.env.NEXT_PUBLIC_OPENAI_API_KEY !== undefined);
  }, []);

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      try {
        // Load emails first
        const cachedEmails = loadFromCache(CACHE_KEYS.EMAILS);
        let emailsData = cachedEmails?.emails || [];
        
        if (!cachedEmails || !isCacheValid(CACHE_KEYS.EMAILS)) {
          emailsData = await loadEmailsFromFirebase();
          saveToCache(CACHE_KEYS.EMAILS, { emails: emailsData, timestamp: Date.now() });
        }

        // Load all questions from Firebase for all emails
        const questionsMap = new Map<string, GenericFAQ[]>();
        const db = getFirebaseDB();
        if (db) {
          const questionsSnapshot = await getDocs(collection(db, FIREBASE_QUESTIONS_COLLECTION));
          questionsSnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.questions) {
              questionsMap.set(doc.id, data.questions);
              
              // Also add to answeredFAQs if they don't exist
              setAnsweredFAQs(prevFAQs => {
                const newFAQs = data.questions.map((q: GenericFAQ) => ({
                  question: q.question,
                  answer: '', // Empty answer that needs to be filled
                  category: q.category || 'support',
                  confidence: q.confidence || 1
                })).filter((newQ: AnsweredFAQ) => !prevFAQs.some(existingQ => 
                  calculatePatternSimilarity(existingQ.question, newQ.question) > SIMILARITY_THRESHOLD
                ));
                return [...prevFAQs, ...newFAQs];
              });
            }
          });
        }
        setEmailQuestions(questionsMap);

        // Update emails with their questions
        const updatedEmails = emailsData.map((email: ExtendedEmail) => {
          const questions = questionsMap.get(email.id);
          return questions ? { ...email, questions } : email;
        });

        setEmails(updatedEmails);
        setLastFetchTimestamp(Date.now());
      } catch (error) {
        console.error('Error initializing:', error);
        toast.error('Failed to load emails');
      } finally {
        setLoading(false);
      }
    };

    initialize();

    // Cleanup function to ensure we don't set state after unmount
    return () => {
      isSubscribed.current = false;
    };
  }, [calculatePatternSimilarity]); // Add calculatePatternSimilarity as dependency since we use it in the effect

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

  // Update the email status effect
  useEffect(() => {
    console.log('=== Email Status Update Debug ===');
    console.log('Answered FAQs:', answeredFAQs);
    console.log('Current Emails:', emails);
    
    if (answeredFAQs.length === 0) return;

    setEmails(prevEmails => {
      const updatedEmails = prevEmails.map(email => {
        const questions = emailQuestions.get(email.id) || [];
        console.log(`Checking email ${email.id}, questions:`, questions);
        
        if (questions.length === 0) return email;

        const matchedFAQ = checkEmailAnsweredStatus(email);
        console.log(`Email ${email.id} matchedFAQ:`, matchedFAQ);
        
        if (matchedFAQ) {
          // Only update if the status has actually changed
          if (!email.matchedFAQ || 
              email.matchedFAQ.question !== matchedFAQ.question || 
              email.matchedFAQ.answer !== matchedFAQ.answer) {
            console.log(`Updating email ${email.id} with new matchedFAQ`);
            return {
              ...email,
              matchedFAQ,
              status: 'processed' as const
            };
          }
        }
        return email;
      });

      // Only return new array if there were actual changes
      const hasChanges = updatedEmails.some((email, index) => 
        email !== prevEmails[index]
      );
      
      console.log('Email updates complete. Has changes:', hasChanges);
      return hasChanges ? updatedEmails : prevEmails;
    });
  }, [answeredFAQs, checkEmailAnsweredStatus, emailQuestions, emails]); // Added missing dependencies

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

      // Update emailQuestions to maintain the relationship and mark questions as answered
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
                isAnswered: true // Add this flag
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
      setEmails(prev => prev.map(email => {
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
              return {
                ...email,
                matchedFAQ: {
                  question: bestMatch.question,
                  answer: bestMatch.answer,
                  confidence: bestMatch.confidence
                },
                status: 'processed'
              };
            }
          }
        }
        return email;
      }));

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
    try {
      // Immediately remove the email from the list for better UX
      setEmails(prev => prev.filter(e => e.id !== email.id));
      
      // Remove from questions if present
      const updatedQuestions = new Map(emailQuestions);
      updatedQuestions.delete(email.id);
      setEmailQuestions(updatedQuestions);

      // Then send the analysis request in the background
      const response = await fetch('/api/emails/analyze-irrelevant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email: {
            id: email.id,
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
      
      // Show a simple success message with the reason
      toast.success(`Removed: ${analysis.reason}`);

    } catch (error) {
      console.error('Error marking email as not relevant:', error);
      // Even if the analysis fails, we keep the email removed
      toast.error('Error analyzing email, but it has been removed from the list');
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
      
      console.log('FAQ creation completed successfully');
      toast.success(`Found ${questionObjects.length} question${questionObjects.length === 1 ? '' : 's'} in email`);
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
          ? { ...e, isGeneratingReply: true }
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

    setEmails(prev => prev.map(e => 
      e.id === emailId 
        ? { ...e, suggestedReply: editingReply.reply }
        : e
    ));
    setEditingReply(null);
    toast.success('Reply updated');
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

  const toggleEmailContent = (emailId: string) => {
    setEmails(prev => prev.map(e => 
      e.id === emailId 
        ? { ...e, showFullContent: !e.showFullContent }
        : e
    ));
  };

  const renderTabs = () => (
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
            id: 'faq_expansion', 
            label: 'Questions to Answer', 
            icon: LightbulbIcon, 
            count: answeredFAQs.filter(faq => !faq.answer).length,
            description: 'Step 2: Answer extracted questions',
            highlight: answeredFAQs.filter(faq => !faq.answer).length > 0
          },
          { 
            id: 'suggested', 
            label: 'Ready to Reply', 
            icon: CheckCircleIcon, 
            count: emails.filter(e => e.matchedFAQ && !e.isReplied).length,
            description: 'Step 3: Send auto-replies'
          },
          {
            id: 'faq_library',
            label: 'FAQ Library',
            icon: BookOpenIcon,
            count: answeredFAQs.filter(faq => faq.answer).length,
            description: 'Browse all answered FAQs'
          }
        ].map(({ id, label, icon: Icon, count, description, highlight }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`
              group relative min-w-0 flex-1 overflow-hidden py-4 px-4 text-center text-sm font-medium hover:bg-gray-50 focus:z-10
              ${activeTab === id ? 'border-b-2 border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}
              ${highlight ? 'bg-yellow-50' : ''}
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

  const renderUnansweredEmails = () => {
    // Show skeleton during initial load, refresh, or when we have no emails yet
    if (loading && !emails.length) {  // Only show loading skeleton if we have no emails to display
      return (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-6 animate-pulse">
              <div className="flex justify-between items-start mb-4">
                <div className="w-3/4">
                  <div className="h-5 bg-gray-200 rounded w-2/3 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
                <div className="h-8 w-24 bg-gray-200 rounded"></div>
              </div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                <div className="h-4 bg-gray-200 rounded w-4/6"></div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    const unansweredEmails = emails.filter(email => !email.isReplied && !email.isNotRelevant && !email.matchedFAQ);
    
    return (
      <div className="space-y-4">
        {/* Status banner - Always show it */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <ClockIcon className="h-5 w-5 text-blue-400 mr-2" />
              <p className="text-sm text-blue-700">
                {timeUntilNextRefresh > 0 
                  ? `Showing cached emails. Next refresh available in ${formatTimeRemaining(timeUntilNextRefresh)}`
                  : 'Showing cached emails. Refresh available now'}
              </p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={timeUntilNextRefresh > 0}
              className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md
                ${timeUntilNextRefresh > 0 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
            >
              <svg className="h-4 w-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Now
            </button>
          </div>
        </div>

        {unansweredEmails.map(email => {
          const questions = emailQuestions.get(email.id) || [];
          const hasQuestions = questions.length > 0;
          const answeredQuestions = questions.filter(q => findMatchingAnsweredFAQ(q.question));
          const unansweredQuestions = questions.filter(q => !findMatchingAnsweredFAQ(q.question));
          const progress = hasQuestions ? (answeredQuestions.length / questions.length) * 100 : 0;
          
          return (
            <div key={email.id} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
              <div className="p-6">
                {/* Header with progress bar */}
                {hasQuestions && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-500">
                        Progress: {answeredQuestions.length}/{questions.length} questions answered
                      </span>
                      {progress > 0 && progress < 100 && (
                        <span className="text-sm font-medium text-blue-600">
                          {unansweredQuestions.length} more to auto-reply
                        </span>
                      )}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Main content */}
                <div className="flex flex-col md:flex-row md:items-start gap-6">
                  {/* Email content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-4">
                      <div className="min-w-0 flex-1 pr-4">
                        <h3 className="text-lg font-medium text-gray-900 mb-1 truncate">
                          {email.subject}
                        </h3>
                        <p className="text-sm text-gray-500">
                          From: {email.sender} · {new Date(email.receivedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => copyEmailDebugInfo(email)}
                          className="flex-shrink-0 inline-flex items-center px-3 py-1 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                          📋 Copy Debug Info
                        </button>
                        <button
                          onClick={() => handleMarkNotRelevant(email)}
                          className="flex-shrink-0 inline-flex items-center px-3 py-1 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                        >
                          ❌ Not Relevant
                        </button>
                      </div>
                    </div>
                    <div className="prose prose-sm max-w-none">
                      <p className="text-gray-700 line-clamp-3">
                        {email.content}
                      </p>
                      <button 
                        onClick={() => toggleEmailContent(email.id)}
                        className="text-blue-600 text-sm hover:text-blue-700 mt-1"
                      >
                        {email.showFullContent ? 'Show less' : 'Show more'}
                      </button>
                    </div>
                    <div className="mt-4">
                      {(!email.aiAnalysis && !email.analysis) || (!hasQuestions && !email.isGeneratingReply) ? (
                        <button
                          onClick={() => handleCreateFAQ(email)}
                          disabled={analyzing}
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                        >
                          {analyzing ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <LightbulbIcon className="h-4 w-4 mr-2" />
                              Extract Questions
                            </>
                          )}
                        </button>
                      ) : (
                        <div className="text-sm text-gray-500">
                          {hasQuestions ? `${questions.length} questions found` : 'No questions found in this email'}
                        </div>
                      )}
                    </div>

                    {/* Questions bubbles */}
                    {hasQuestions && (
                      <div className="mt-6">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">Questions Identified:</h4>
                        <div className="flex flex-wrap gap-3">
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
                                  group relative inline-flex items-center px-4 py-2 rounded-full text-sm font-medium
                                  transition-all duration-200 hover:shadow-md
                                  ${isAnswered 
                                    ? 'bg-green-100 text-green-800 hover:bg-green-200 border border-green-200' 
                                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'}
                                `}
                              >
                                {isAnswered ? (
                                  <CheckCircleIcon className="h-4 w-4 mr-2 text-green-600" />
                                ) : (
                                  <PencilIcon className="h-4 w-4 mr-2 text-blue-600" />
                                )}
                                {truncateQuestion(question.question)}
                                {isAnswered && (
                                  <div className="absolute -top-2 -right-2 h-4 w-4 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
                                    <CheckCircleIcon className="h-3 w-3 text-white" />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Questions panel - Keep this as a reference but hide it */}
                  {false && hasQuestions && (
                    <div className="w-full md:w-[350px] flex-shrink-0 border-t md:border-t-0 md:border-l border-gray-200 pt-4 md:pt-0 md:pl-6">
                      {/* ... existing questions panel code ... */}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Loading more indicator */}
        {loadingMore && (
          <div className="bg-white rounded-xl shadow-sm p-6 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        )}
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

  // Update the handleRefresh function to clear cache
  const handleRefresh = async () => {
    if (Date.now() - lastFetchTimestamp < MIN_FETCH_INTERVAL) {
      toast.error('Please wait before refreshing again');
      return;
    }

    console.log('=== Starting Refresh ===');
    setLoading(true);
    try {
      console.log('Clearing cache...');
      clearCache();
      
      console.log('Loading fresh emails...');
      await loadEmails(true, 1);
      
      console.log('Resetting states...');
      setEmailQuestions(new Map());
      setGenericFAQs([]);
      
      console.log('Reloading FAQ library...');
      const response = await fetch('/api/faq/list');
      if (response.ok) {
        const data = await response.json();
        console.log('FAQ library loaded:', data.faqs?.length || 0, 'FAQs found');
        if (data.faqs) {
          const validFAQs = data.faqs.filter((faq: AnsweredFAQ) => 
            faq.question && 
            faq.answer && 
            faq.answer.trim() !== '' && 
            faq.question.trim() !== ''
          );
          console.log('Valid FAQs:', validFAQs.length);
          setAnsweredFAQs(validFAQs);
        }
      }

      setLastFetchTimestamp(Date.now());
      console.log('=== Refresh Complete ===');
      toast.success('Refreshed successfully');
    } catch (error) {
      console.error('Error refreshing:', error);
      toast.error('Failed to refresh');
    } finally {
      setLoading(false);
    }
  };

  // Main render function debug
  const renderMainContent = () => {
    console.log('=== Rendering Main Content ===');
    console.log('Current activeTab:', activeTab);
    console.log('Current answeredFAQs:', answeredFAQs);
    
    if (loading) {
      console.log('Showing loading state');
      return <div>Loading...</div>;
    }

    switch (activeTab) {
      case 'unanswered':
        console.log('Rendering unanswered tab');
        return renderUnansweredEmails();
      case 'suggested':
        console.log('Rendering suggested tab');
        return renderSuggestedReplies();
      case 'faq_expansion':
        console.log('Rendering FAQ expansion tab');
        return renderFAQExpansion();
      case 'faq_library':
        console.log('Rendering FAQ library tab');
        return renderFAQLibrary();
      default:
        console.log('Unknown tab:', activeTab);
        return null;
    }
  };

  // Add the missing render functions
  const renderSuggestedReplies = () => {
    // Only show emails where all questions have been answered
    const emailsWithMatches = emails.filter(e => {
      const questions = emailQuestions.get(e.id) || [];
      return e.matchedFAQ && 
             !e.isReplied && 
             questions.length > 0 && 
             questions.every(q => {
               const matchedFAQ = findMatchingAnsweredFAQ(q.question);
               return matchedFAQ && matchedFAQ.answer && matchedFAQ.answer.trim() !== '';
             });
    });
      
    if (emailsWithMatches.length === 0) {
      return (
        <div className="text-center py-8 text-gray-600">
          <p>No emails ready for auto-reply yet</p>
          <p className="text-sm mt-2">Answer all questions in the "Questions to Answer" tab first</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {emailsWithMatches.map(email => (
          <div key={email.id} className="bg-white rounded-lg shadow-sm overflow-hidden">
            {/* Email Header */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{email.subject}</h3>
                  <p className="text-sm text-gray-600">From: {email.sender}</p>
                </div>
                <div className="flex items-center space-x-3">
                  {!editingReply || editingReply.emailId !== email.id ? (
                    <>
                      <button
                        onClick={() => generateContextualReply(email)}
                        className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        <LightbulbIcon className="h-4 w-4 mr-2" />
                        Regenerate Reply
                      </button>
                      <button
                        onClick={() => handleEditReply(email)}
                        className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        <PencilIcon className="h-4 w-4 mr-2" />
                        Edit Reply
                      </button>
                      <button
                        onClick={() => handleAutoReply(email)}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                      >
                        Send Auto-Reply
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setEditingReply(null)}
                        className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveReply(email.id)}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                      >
                        Save Changes
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Original Email Preview */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <h4 className="text-sm font-medium text-gray-900 mb-2">Original Email:</h4>
                <p className="text-sm text-gray-700 whitespace-pre-line">
                  {email.content?.length > 200 
                    ? `${email.content.slice(0, 200)}...` 
                    : email.content}
                </p>
                {email.content?.length > 200 && (
                  <button
                    onClick={() => toggleEmailContent(email.id)}
                    className="text-sm text-blue-600 hover:text-blue-800 mt-2"
                  >
                    {email.showFullContent ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>

              {/* Matched FAQ */}
              {email.matchedFAQ && (
                <div className="bg-blue-50 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-medium text-blue-900 mb-2">Matched FAQ:</h4>
                  <p className="text-sm text-blue-800 font-medium">
                    {email.matchedFAQ.question.replace('{email}', email.sender)}
                  </p>
                  <p className="text-sm text-blue-700 mt-2">{email.matchedFAQ.answer}</p>
                </div>
              )}
            </div>

            {/* Draft Reply Section */}
            <div className="p-6 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-900">Draft Reply:</h4>
                {email.isGeneratingReply && (
                  <span className="text-sm text-blue-600 flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating reply...
                  </span>
                )}
              </div>
              {editingReply && editingReply.emailId === email.id ? (
                <div className="space-y-4">
                  <textarea
                    value={editingReply.reply}
                    onChange={(e) => setEditingReply({ ...editingReply, reply: e.target.value })}
                    className="w-full h-64 rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="Edit your reply here..."
                  />
                  <div className="bg-yellow-50 rounded-lg p-4">
                    <h5 className="text-sm font-medium text-yellow-800 mb-2">Tips for a great reply:</h5>
                    <ul className="text-sm text-yellow-700 list-disc list-inside space-y-1">
                      <li>Be clear and concise</li>
                      <li>Address all points in the original email</li>
                      <li>Use a professional but friendly tone</li>
                      <li>Include any relevant links or resources</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-gray-700 whitespace-pre-line">
                    {email.suggestedReply || generateDefaultReply(email)}
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderFAQExpansion = () => {
    // Debug logs to help identify the issue
    console.log('=== FAQ Expansion Debug ===');
    console.log('Loading state:', loading);
    console.log('Emails:', emails.length);
    console.log('Email questions:', emailQuestions);
    console.log('Answered FAQs:', answeredFAQs);
    
    // Get all questions from all emails
    const allQuestions = new Set<GenericFAQ>();
    
    // Collect questions from all emails
    Array.from(emailQuestions.entries()).forEach(([emailId, questions]) => {
      questions.forEach(q => {
        // Only add if not already answered
        const isAnswered = answeredFAQs.some(faq => 
          faq.answer && faq.answer.trim() && calculatePatternSimilarity(faq.question, q.question) > SIMILARITY_THRESHOLD
        );
        if (!isAnswered) {
          allQuestions.add(q);
        }
      });
    });

    // Show loading state if we're still loading initial data
    if (loading && !emails.length) {
      return (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      );
    }

    // Only show "no questions" message if we have no questions and we're not loading
    if (!loading && allQuestions.size === 0) {
      return (
        <div className="text-center py-8 text-gray-600">
          <p>No questions to answer yet</p>
          <p className="text-sm mt-2">Extract questions from emails in the Unanswered Emails tab</p>
        </div>
      );
    }

    // Convert to array and sort by emailIds length (most common questions first)
    const sortedQuestions = Array.from(allQuestions).sort((a, b) => 
      (b.emailIds?.length || 0) - (a.emailIds?.length || 0)
    );

    return (
      <div className="space-y-4">
        {sortedQuestions.map((faq, index) => {
          // Find all emails that contain this question
          const sourceEmails = emails.filter(email => {
            const emailQs = emailQuestions.get(email.id) || [];
            return emailQs.some(q => calculatePatternSimilarity(q.question, faq.question) > SIMILARITY_THRESHOLD);
          });

          return (
            <div key={index} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200">
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <PencilIcon className="h-5 w-5 text-blue-600" />
                      <h3 className="text-lg font-medium text-gray-900">
                        {faq.question}
                      </h3>
                    </div>
                    
                    {/* Source emails section */}
                    <div className="mt-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">
                        Found in {sourceEmails.length} email{sourceEmails.length !== 1 ? 's' : ''}:
                      </h4>
                      <div className="space-y-2">
                        {sourceEmails.map((email, emailIndex) => (
                          <div key={emailIndex} className="flex items-start gap-2 text-sm text-gray-600">
                            <div className="w-4 h-4 mt-0.5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-600 text-xs">{emailIndex + 1}</span>
                            </div>
                            <div>
                              <div className="font-medium">{email.subject}</div>
                              <div className="text-gray-500">From: {email.sender}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleAddToFAQLibrary({
                      ...faq,
                      emailIds: sourceEmails.map(e => e.id)
                    })}
                    className="flex-shrink-0 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Answer Question
                  </button>
                </div>
              </div>
            </div>
          );
        })}
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
    const questions = emailQuestions.get(email.id) || [];
    const debugText = `
=== Email Debug Info ===
Subject: ${email.subject}
From: ${email.sender}

Original Customer Question:
${email.content}

AI Generated Questions (${questions.length}):
${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}
`;

    navigator.clipboard.writeText(debugText).then(() => {
      toast.success('Debug info copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy debug info');
    });
  }, [emailQuestions]);

  return (
    <Layout>
      <div className="max-w-[80%] mx-auto py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900 mb-2">Customer Support Triage</h1>
            <p className="text-gray-500">Manage and respond to customer inquiries efficiently</p>
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <ClockIcon className="h-4 w-4 mr-2" />
            Refresh
          </button>
        </div>
        {renderTabs()}
        <div className="mt-6">
          {renderMainContent()}
        </div>
        {renderAnswerModal()}
      </div>
    </Layout>
  );
} 