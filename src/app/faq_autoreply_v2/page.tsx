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
const formatTimeRemaining = (milliseconds: number): string => {
  const seconds = Math.ceil(milliseconds / 1000);
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
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
  const MIN_FETCH_INTERVAL = 30000; // 30 seconds

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
  const SIMILARITY_THRESHOLD = 0.8; // Lowered from 0.7 to group more aggressively

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

  // Update groupSimilarPatterns to be more aggressive
  const groupSimilarPatterns = useCallback((patterns: GenericFAQ[]): GenericFAQ[] => {
    const groups: GenericFAQ[] = [];
    
    patterns.forEach(pattern => {
      const similarGroup = groups.find(group => 
        calculatePatternSimilarity(group.question, pattern.question) > 0.8
      );
      
      if (similarGroup) {
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
    return answeredFAQs.find(faq => 
      calculatePatternSimilarity(faq.question, question) > 0.8
    ) || null;
  }, [answeredFAQs, calculatePatternSimilarity]);

  // Add this helper function to check if all email questions have been answered
  const checkEmailAnsweredStatus = useCallback((email: ExtendedEmail) => {
    const questions = emailQuestions.get(email.id) || [];
    if (questions.length === 0) return false;

    // Check if all questions have matching answered FAQs
    const allQuestionsAnswered = questions.every(q => 
      findMatchingAnsweredFAQ(q.question) !== null
    );

    if (allQuestionsAnswered) {
      // Find the best matching FAQ for the email
      const bestMatch = questions.reduce((best, current) => {
        const matchedFAQ = findMatchingAnsweredFAQ(current.question);
        if (!matchedFAQ) return best;
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
      // Try to load from Firebase cache first
      if (nextPage === 1) {
        const cachedEmails = await loadEmailsFromFirebase();
        if (cachedEmails) {
          console.log('Using cached emails from Firebase');
          setEmails(cachedEmails);
          setLoading(false); // Set loading to false since we have cached data to show
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
    checkEmailAnsweredStatus,
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
      if (!user?.accessToken) {
        setLoading(false);
        return;
      }

      try {
        if (!initialized) {
          setLoading(true);
          
          // First verify Gmail access before doing anything else
          const hasAccess = await checkGmailAccess();
          if (!hasAccess) {
            toast.error('Gmail access is required. Please sign in with Gmail permissions.');
            setLoading(false);
            return;
          }

          // Check if enough time has passed since last fetch
          const now = Date.now();
          const timeSinceLastFetch = now - lastFetchTimestamp;
          if (timeSinceLastFetch < MIN_FETCH_INTERVAL) {
            console.debug('Skipping fetch - too soon since last fetch');
            setLoading(false);
            return;
          }

          // Check cache only after verifying access
          const hasValidCache = Object.values(CACHE_KEYS).every(key => 
            key !== CACHE_KEYS.LAST_FETCH && isCacheValid(key)
          );

          if (hasValidCache) {
            const cachedEmails = loadFromCache(CACHE_KEYS.EMAILS);
            const cachedQuestions = loadFromCache(CACHE_KEYS.QUESTIONS);
            const cachedGenericFAQs = loadFromCache(CACHE_KEYS.GENERIC_FAQS);

            if (cachedEmails?.emails && cachedQuestions && cachedGenericFAQs?.genericFAQs) {
              const transformedEmails: ExtendedEmail[] = cachedEmails.emails.map((email: Email) => {
                const { matchedFAQ, ...rest } = email;
                const transformed: ExtendedEmail = {
                  ...rest,
                  questions: [],
                  suggestedReply: '',
                  showFullContent: false,
                  isGeneratingReply: false,
                  status: email.status || 'pending'
                };
                
                if (matchedFAQ) {
                  transformed.matchedFAQ = {
                    question: matchedFAQ.question,
                    answer: matchedFAQ.answer,
                    confidence: matchedFAQ.confidence || 1
                  };
                }
                
                return transformed;
              });
              
              setEmails(transformedEmails);
              const questionsMap = new Map<string, GenericFAQ[]>();
              Object.entries(cachedQuestions).forEach(([emailId, questions]) => {
                questionsMap.set(emailId, questions as GenericFAQ[]);
              });
              setEmailQuestions(questionsMap);
              setGenericFAQs(cachedGenericFAQs.genericFAQs);
              setInitialized(true);
              setLoading(false);
              return;
            }
          }

          // If we don't have valid cache, load fresh data
          await loadEmails(true);
          setLastFetchTimestamp(now);
          setInitialized(true);
        }
      } catch (error) {
        console.error('Error initializing:', error);
        toast.error('Failed to initialize. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    initialize();

    // Cleanup function to ensure we don't set state after unmount
    return () => {
      isSubscribed.current = false;
    };
  }, [user?.accessToken, checkGmailAccess, loadEmails, lastFetchTimestamp, initialized]);

  // Update the FAQ loading effect
  useEffect(() => {
    console.log('=== FAQ Loading Debug - Start ===');
    console.log('isSubscribed.current:', isSubscribed.current);
    console.log('Current answeredFAQs state:', answeredFAQs);
    isSubscribed.current = true;
    
    const loadFAQs = async () => {
      console.log('=== Loading FAQs ===');
      try {
        setLoadingFAQs(true);
        
        // Check cache first
        const cachedFAQs = loadFromCache(CACHE_KEYS.GENERIC_FAQS);
        console.log('Cached FAQs:', cachedFAQs);
        
        if (cachedFAQs?.genericFAQs) {
          console.log('Using cached FAQs');
          setGenericFAQs(cachedFAQs.genericFAQs);
          setLoadingFAQs(false);
          return;
        }

        // If no cache, fetch from API
        console.log('Fetching FAQs from API');
        const response = await fetch('/api/faq/list');
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`API Error: ${errorData.error || response.statusText}`);
        }
        const data = await response.json();
        console.log('API Response:', data);

        if (data.faqs) {
          console.log(`Loaded ${data.faqs.length} FAQs from API`);
          setGenericFAQs(data.faqs);
          saveToCache(CACHE_KEYS.GENERIC_FAQS, { genericFAQs: data.faqs });
        } else {
          console.warn('No FAQs found in API response');
        }
      } catch (error) {
        console.error('Error loading FAQs:', error);
        toast.error(`Failed to load FAQs: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setLoadingFAQs(false);
      }
    };

    // Initial load
    console.log('Starting initial FAQ load');
    loadFAQs();
    
    // Set up periodic refresh every 30 seconds
    const refreshInterval = setInterval(() => {
      console.log('Running periodic FAQ refresh');
      loadFAQs();
    }, 30000);
    
    // Cleanup function
    return () => {
      console.log('Cleaning up FAQ loading effect');
      isSubscribed.current = false;
      clearInterval(refreshInterval);
    };
  }, []); // Empty dependency array since we're using isSubscribed.current

  // Add a separate effect for updating email statuses
  useEffect(() => {
    if (answeredFAQs.length === 0) return;

    setEmails(prevEmails => prevEmails.map(email => {
      const matchedFAQ = checkEmailAnsweredStatus(email);
      if (matchedFAQ) {
        return {
          ...email,
          matchedFAQ,
          status: 'processed'
        };
      }
      return email;
    }));
  }, [answeredFAQs, checkEmailAnsweredStatus]);

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
    const existingQuestion = genericFAQs.find(q => q.question === question.question);
    
    if (existingQuestion && existingQuestion.emailIds) {
      const currentEmailIds = existingQuestion.emailIds || [];
      const updatedEmailIds = [...new Set([...currentEmailIds, ...(question.emailIds || [])])];
      existingQuestion.emailIds = updatedEmailIds;
    }

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

      // Update emailQuestions to maintain the relationship
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
                answer: answer.trim()
              };
            }
            return q;
          });
          updated.set(emailId, updatedQuestions);
        });
        return updated;
      });

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
    if (!email.content) return;
    
    setAnalyzing(true);
    try {
      const response = await fetch('/api/faq/generate-pattern', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: email.subject,
          content: email.content,
        })
      });

      if (!response.ok) {
        throw new Error('Failed to analyze email');
      }

      const data = await response.json();
      const questions: string[] = data.questions || [];

      // Map the questions to GenericFAQ objects
      const questionObjects: GenericFAQ[] = questions.map(question => ({
        question,
        category: data.category || 'support',
        emailIds: [email.id],
        confidence: 1,
        requiresCustomerSpecificInfo: false
      }));

      // Update emailQuestions state with proper typing
      setEmailQuestions(prev => {
        const updated = new Map(prev);
        updated.set(email.id, questionObjects);
        return updated;
      });

      // Add questions directly to answeredFAQs instead of genericFAQs
      setAnsweredFAQs(prevFAQs => {
        const newFAQs = questionObjects.map(q => ({
          question: q.question,
          answer: '', // Empty answer that needs to be filled
          category: q.category,
          confidence: q.confidence
        }));
        return [...prevFAQs, ...newFAQs];
      });

      toast.success(`Found ${questions.length} question${questions.length === 1 ? '' : 's'} in email`);
    } catch (error) {
      console.error('Error analyzing email:', error);
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
      reply: email.suggestedReply || `Dear ${email.sender.split('<')[0].trim()},

Thank you for your email regarding ${email.matchedFAQ?.question}.

${email.matchedFAQ?.answer}

Best regards,
Support Team`
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
              ${activeTab === id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}
              ${highlight ? 'bg-yellow-50' : ''}
            `}
          >
            <div className="flex items-center justify-center space-x-2">
              <Icon className="h-5 w-5" />
              <span>{label}</span>
              {count > 0 && (
                <span className="ml-2 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
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
    
    // Calculate time until next refresh
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimestamp;
    const timeUntilNextRefresh = Math.max(0, MIN_FETCH_INTERVAL - timeSinceLastFetch);
    const showRefreshTime = timeUntilNextRefresh > 0;

    return (
      <div className="space-y-4">
        {/* Status banner for rate limits */}
        {showRefreshTime && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-center">
              <ClockIcon className="h-5 w-5 text-blue-400 mr-2" />
              <div className="flex-1">
                <p className="text-sm text-blue-700">
                  Showing cached emails. Next refresh available in {formatTimeRemaining(timeUntilNextRefresh)}
                </p>
              </div>
            </div>
          </div>
        )}

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
                      <button
                        onClick={() => handleMarkNotRelevant(email)}
                        className="flex-shrink-0 inline-flex items-center px-3 py-1 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        ❌ Not Relevant
                      </button>
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
                  </div>

                  {/* Questions panel */}
                  {hasQuestions && (
                    <div className="w-full md:w-[350px] flex-shrink-0 border-t md:border-t-0 md:border-l border-gray-200 pt-4 md:pt-0 md:pl-6">
                      <div className="text-sm font-medium text-gray-900 mb-3 flex items-center justify-between">
                        <span>Questions to Answer ({questions.length})</span>
                        {progress === 100 && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            All Answered
                          </span>
                        )}
                      </div>
                      <div className="space-y-3">
                        {questions.map((question, index) => {
                          const matchedFAQ = findMatchingAnsweredFAQ(question.question);
                          return (
                            <div key={index} className="bg-gray-50 rounded-lg p-3">
                              <p className="text-sm text-gray-900 mb-2">{question.question}</p>
                              {matchedFAQ ? (
                                <div className="text-xs text-green-600">
                                  ✓ Answered in FAQ Library
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleAddToFAQLibrary(question)}
                                  className="text-xs text-blue-600 hover:text-blue-500"
                                >
                                  + Add to FAQ Library
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
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
  const handleRefresh = () => {
    clearCache();
    loadEmails(true);
  };

  // Update the Try Again button to force refresh
  const handleTryAgain = () => {
    loadEmails(true);
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
    const emailsWithMatches = emails.filter(e => e.matchedFAQ && !e.isReplied);
    
    if (emailsWithMatches.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          No emails ready for auto-reply yet
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {emailsWithMatches.map(email => (
          <div key={email.id} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-medium">{email.subject}</h3>
                <p className="text-sm text-gray-500">From: {email.sender}</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleAutoReply(email)}
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Send Auto-Reply
                </button>
              </div>
            </div>
            {email.matchedFAQ && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium mb-2">Matched FAQ:</h4>
                <p className="text-sm text-gray-700">{email.matchedFAQ.question}</p>
                <p className="text-sm text-gray-600 mt-2">{email.matchedFAQ.answer}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderFAQExpansion = () => {
    const unansweredFAQs = answeredFAQs.filter(faq => !faq.answer);
    
    if (unansweredFAQs.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          No questions to answer yet
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {unansweredFAQs.map(faq => (
          <div key={faq.question} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-medium">{faq.question}</h3>
                <p className="text-sm text-gray-500">
                  Category: {faq.category} · Confidence: {Math.round(faq.confidence * 100)}%
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleAddToFAQLibrary({
                    ...faq,
                    emailIds: [],
                    requiresCustomerSpecificInfo: false
                  })}
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  Add Answer
                </button>
                <button
                  onClick={() => handleIgnoreFAQ({
                    ...faq,
                    emailIds: [],
                    requiresCustomerSpecificInfo: false
                  })}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  Ignore
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Add this function to load FAQs from API
  const loadFAQsFromAPI = async () => {
    console.log('=== Loading FAQs from API ===');
    try {
      setLoadingFAQs(true);
      
      const response = await fetch('/api/faq/list');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      console.log('API Response:', data);

      if (data.faqs) {
        setAnsweredFAQs(data.faqs);
        saveToCache(CACHE_KEYS.ANSWERED_FAQS, { answeredFAQs: data.faqs });
      }
    } catch (error) {
      console.error('Error loading FAQs:', error);
      toast.error('Failed to load FAQ library');
    } finally {
      setLoadingFAQs(false);
    }
  };

  // Add effect to load FAQs when component mounts and when tab changes to FAQ library
  useEffect(() => {
    if (activeTab === 'faq_library') {
      loadFAQsFromAPI();
    }
  }, [activeTab]);

  // Add effect to load FAQs on initial mount
  useEffect(() => {
    loadFAQsFromAPI();
  }, []);

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

    if (!answeredFAQs.length) {
      return (
        <div className="text-center py-8">
          <p className="text-gray-500">No FAQs in the library yet.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {answeredFAQs.map(faq => (
          <div key={faq.question} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  {faq.question}
                </h3>
                <div className="flex items-center space-x-2 text-sm text-gray-500 mb-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800">
                    {faq.category}
                  </span>
                  <span>•</span>
                  <span>
                    Confidence: {Math.round(faq.confidence * 100)}%
                  </span>
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
  const handleEmailProcessing = (emailId: string) => {
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
  };

  const handleEmailClick = (emailId: string) => {
    if (!selectedFAQ) return;
    
    const emailIds = selectedFAQ.emailIds || [];
    emailIds.forEach((id: string) => {
        const relatedEmail = emails.find(e => e.id === id);
        if (relatedEmail) {
            // ... existing code ...
        }
    });

    const currentEmail = emails.find(e => e.id === emailId);
    if (currentEmail && emailIds.includes(currentEmail.id)) {
        // ... existing code ...
    }
  };

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

  return (
    <Layout>
      <div className="min-h-screen bg-gray-100 py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Customer Support Triage
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Create FAQs from unanswered emails to enable automatic replies
              </p>
            </div>
            {user?.accessToken && (
              <button
                onClick={handleRefresh}
                disabled={Date.now() - lastFetchTimestamp < MIN_FETCH_INTERVAL}
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white
                  ${Date.now() - lastFetchTimestamp < MIN_FETCH_INTERVAL 
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                <svg className={`mr-2 h-4 w-4 ${analyzing ? 'animate-spin' : ''}`} viewBox="0 0 24 24">
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                Refresh
              </button>
            )}
          </div>

          {user?.accessToken && renderTabs()}
          {renderMainContent()}
          {renderAnswerModal()}
        </div>
      </div>
    </Layout>
  );
} 