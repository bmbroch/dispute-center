'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { EmailList } from '../components/faq/EmailList';
import { FAQExpansionList } from '../components/faq/FAQExpansionList';
import { useAuth } from '@/lib/hooks/useAuth';
import { toast } from 'sonner';
import {
  MessageCircleIcon,
  LightbulbIcon,
  ClockIcon,
} from 'lucide-react';
import { Email, GenericFAQ } from '@/types/faq';
import { calculatePatternSimilarity } from '@/lib/utils/similarity';

// Cache configuration
const CACHE_KEYS = {
  EMAILS: 'faq_emails_cache',
  QUESTIONS: 'faq_questions_cache',
  GENERIC_FAQS: 'faq_generic_faqs_cache',
  LAST_FETCH: 'faq_last_fetch_timestamp'
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Add the groupSimilarPatterns function
function groupSimilarPatterns(questions: any[]): any[] {
  const groups: any[] = [];
  
  questions.forEach(question => {
    const similarGroup = groups.find(group => 
      calculatePatternSimilarity(group.question, question.question) > 0.8
    );
    
    if (similarGroup) {
      if (!similarGroup.similarPatterns) {
        similarGroup.similarPatterns = [];
      }
      similarGroup.similarPatterns.push(question.question);
      similarGroup.emailIds = [...new Set([...similarGroup.emailIds, ...question.emailIds])];
    } else {
      groups.push({
        ...question,
        similarPatterns: []
      });
    }
  });
  
  return groups;
}

// Add EmailSkeleton component
const EmailSkeleton = () => (
  <div className="space-y-6">
    {[1, 2, 3].map((i) => (
      <div key={i} className="bg-white shadow rounded-lg overflow-hidden animate-pulse">
        <div className="p-6">
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-3 bg-gray-100 rounded w-1/2"></div>
            <div className="h-16 bg-gray-50 rounded w-full mt-4"></div>
            <div className="flex justify-end space-x-3">
              <div className="h-8 bg-gray-200 rounded w-24"></div>
              <div className="h-8 bg-gray-100 rounded w-24"></div>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

export default function FAQAutoReplyV3Page() {
  const { user, checkGmailAccess, refreshAccessToken } = useAuth();
  const [emails, setEmails] = useState<Email[]>([]);
  const [genericFAQs, setGenericFAQs] = useState<GenericFAQ[]>([]);
  const [activeTab, setActiveTab] = useState<'unanswered' | 'suggested' | 'faq_expansion'>('unanswered');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [emailQuestions, setEmailQuestions] = useState<Map<string, GenericFAQ[]>>(new Map());
  const [page, setPage] = useState(1);

  // Load cached emails on mount
  useEffect(() => {
    const cachedEmails = localStorage.getItem(CACHE_KEYS.EMAILS);
    const lastFetch = localStorage.getItem(CACHE_KEYS.LAST_FETCH);
    
    if (cachedEmails && lastFetch) {
      const timeSinceLastFetch = Date.now() - parseInt(lastFetch);
      if (timeSinceLastFetch < CACHE_DURATION) {
        setEmails(JSON.parse(cachedEmails));
        setLoading(false);
      }
    }
  }, []);

  const loadEmails = useCallback(async (forceRefresh = false, nextPage = 1) => {
    if (!user?.accessToken) {
      toast.error('Please sign in to access emails');
      return;
    }

    if (!forceRefresh) {
      setLoading(true);
    }

    try {
      let currentToken = user.accessToken;
      let response = await fetch('/api/emails/inbox', {
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'X-Page': nextPage.toString(),
          'X-Force-Refresh': forceRefresh ? 'true' : 'false'
        }
      });
      
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) {
          toast.error('Session expired. Please sign in again.');
          setLoading(false);
          return;
        }
        currentToken = newToken;
        response = await fetch('/api/emails/inbox', {
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'X-Page': nextPage.toString(),
            'X-Force-Refresh': forceRefresh ? 'true' : 'false'
          }
        });
      }

      if (!response.ok) {
        throw new Error('Failed to fetch emails');
      }

      const data = await response.json();
      console.log('Loaded emails:', data);
      
      // Update cache
      localStorage.setItem(CACHE_KEYS.EMAILS, JSON.stringify(data.emails));
      localStorage.setItem(CACHE_KEYS.LAST_FETCH, Date.now().toString());
      
      setEmails(data.emails || []);
      setPage(nextPage);
    } catch (error) {
      console.error('Error loading emails:', error);
      toast.error('Failed to load emails');
    } finally {
      setLoading(false);
    }
  }, [user?.accessToken, refreshAccessToken]);

  const loadMoreEmails = async () => {
    if (!user?.accessToken || loadingMore) return;

    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      let currentToken = user.accessToken;
      
      let response = await fetch('/api/emails/inbox', {
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'X-Page': nextPage.toString()
        }
      });

      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) {
          toast.error('Session expired. Please sign in again.');
          setLoadingMore(false);
          return;
        }
        currentToken = newToken;
        response = await fetch('/api/emails/inbox', {
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'X-Page': nextPage.toString()
          }
        });
      }

      if (!response.ok) {
        throw new Error('Failed to load more emails');
      }

      const data = await response.json();
      if (data.emails && data.emails.length > 0) {
        setEmails(prev => [...prev, ...data.emails]);
        setPage(nextPage);
        
        // Update cache with new emails
        const allEmails = [...emails, ...data.emails];
        localStorage.setItem(CACHE_KEYS.EMAILS, JSON.stringify(allEmails));

        // Analyze new emails for questions
        setAnalyzing(true);
        try {
          const emailQuestionsMap = new Map(emailQuestions);
          
          await Promise.all(
            data.emails.map(async (email: Email) => {
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
                  console.error('Error analyzing email:', email.id);
                  return;
                }

                const analysisData = await response.json();
                const questions = [{
                  question: analysisData.genericPattern,
                  category: analysisData.suggestedCategory,
                  emailIds: [email.id],
                  confidence: 1,
                  requiresCustomerSpecificInfo: analysisData.requiresCustomerInfo,
                  similarPatterns: analysisData.similarPatterns || [],
                }];

                emailQuestionsMap.set(email.id, questions);
              } catch (error) {
                console.error('Error analyzing email:', error);
              }
            })
          );

          setEmailQuestions(emailQuestionsMap);
          // Cache the questions (convert Map to object for storage)
          saveToCache(CACHE_KEYS.QUESTIONS, Object.fromEntries(emailQuestionsMap));
          
          // Group similar questions for FAQ Expansion tab
          const allQuestions = Array.from(emailQuestionsMap.values()).flat();
          const groupedQuestions = groupSimilarPatterns(allQuestions);
          setGenericFAQs(groupedQuestions);
          // Cache the generic FAQs
          saveToCache(CACHE_KEYS.GENERIC_FAQS, groupedQuestions);

        } catch (error) {
          console.error('Error analyzing new emails:', error);
        } finally {
          setAnalyzing(false);
        }

      } else {
        toast.info('No more emails to load');
      }
    } catch (error) {
      console.error('Error loading more emails:', error);
      toast.error('Failed to load more emails');
    } finally {
      setLoadingMore(false);
    }
  };

  // Add this helper function to cache data
  const saveToCache = (key: string, data: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem(CACHE_KEYS.LAST_FETCH, Date.now().toString());
    } catch (error) {
      console.error('Error saving to cache:', error);
    }
  };

  // Initial load - only run once when component mounts and user is available
  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      if (!user?.accessToken || !mounted) {
        setLoading(false);
        return;
      }

      try {
        const hasAccess = await checkGmailAccess();
        if (!hasAccess) {
          toast.error('Gmail access is required. Please sign in with Gmail permissions.');
          setLoading(false);
          return;
        }

        await loadEmails(false); // Pass false to not force refresh on initial load
      } catch (error) {
        console.error('Error initializing:', error);
        if (mounted) {
          toast.error('Failed to initialize. Please try again.');
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, [user?.accessToken, checkGmailAccess, loadEmails]);

  const handleAutoReply = async (email: Email) => {
    try {
      const response = await fetch('/api/emails/auto-reply', {
        method: 'POST',
        body: JSON.stringify({ emailId: email.id }),
      });
      
      if (response.ok) {
        toast.success('Auto-reply sent successfully');
        loadEmails(true);
      } else {
        throw new Error('Failed to send auto-reply');
      }
    } catch (error) {
      toast.error('Failed to send auto-reply');
    }
  };

  const handleMarkNotRelevant = async (email: Email) => {
    try {
      // First, immediately remove the email from the list for better UX
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
        body: JSON.stringify({ email })
      });

      const data = await response.json();
      
      // Show a simple success message
      toast.success('Email removed from analysis');

      // Log the analysis result for learning purposes
      if (response.ok && data.reason) {
        console.debug('Email marked not relevant:', {
          id: email.id,
          reason: data.reason,
          category: data.category
        });
      }

    } catch (error) {
      console.error('Error marking email as not relevant:', error);
      // Even if the analysis fails, we keep the email removed
      toast.error('Error analyzing email, but it has been removed from the list');
    }
  };

  const handleAddToFAQLibrary = (faq: GenericFAQ) => {
    // ... Implementation from v2 ...
  };

  const handleIgnoreFAQ = (faq: GenericFAQ) => {
    setGenericFAQs(prev => prev.filter(f => f.question !== faq.question));
    toast.success('FAQ ignored');
  };

  const renderTabs = () => (
    <div className="border-b border-gray-200 mb-8">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        {[
          { id: 'unanswered', label: 'Unanswered', icon: MessageCircleIcon, count: emails.filter(e => !e.isReplied && !e.isNotRelevant).length },
          { id: 'suggested', label: 'Suggested Replies', icon: LightbulbIcon, count: emails.filter(e => e.matchedFAQ && !e.isReplied).length },
          { id: 'faq_expansion', label: 'FAQ Expansion', icon: ClockIcon, count: genericFAQs.length }
        ].map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`
              group inline-flex items-center px-1 py-4 border-b-2 font-medium text-sm
              ${activeTab === id 
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
            `}
          >
            <Icon className="h-5 w-5 mr-2" />
            {label}
            <span className={`ml-2 py-0.5 px-2.5 rounded-full text-xs font-medium ${
              activeTab === id ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-900'
            }`}>
              {count}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Customer Support Triage
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Create FAQs from unanswered emails to enable automatic replies
              </p>
            </div>
            <button
              onClick={() => loadEmails(true)}
              disabled={loading}
              className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 ${
                loading ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading...
                </>
              ) : (
                'Refresh'
              )}
            </button>
          </div>

          {renderTabs()}

          {loading ? (
            <EmailSkeleton />
          ) : !user?.accessToken ? (
            <div className="text-center py-12">
              <div className="text-gray-500 mb-4">Please sign in to view emails</div>
            </div>
          ) : emails.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-500 mb-4">No emails found</div>
              <button
                onClick={() => loadEmails(true)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Try Again
              </button>
            </div>
          ) : (
            <div>
              {activeTab === 'unanswered' && (
                <>
                  <EmailList
                    emails={emails.filter(e => !e.isReplied && !e.isNotRelevant)}
                    emailQuestions={emailQuestions}
                    onAutoReply={handleAutoReply}
                    onMarkNotRelevant={handleMarkNotRelevant}
                  />
                  <div className="mt-6 text-center">
                    <button
                      onClick={loadMoreEmails}
                      disabled={loadingMore}
                      className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 ${
                        loadingMore ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {loadingMore ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Loading More...
                        </>
                      ) : (
                        'Load More Emails'
                      )}
                    </button>
                  </div>
                </>
              )}
              {activeTab === 'suggested' && (
                <EmailList
                  emails={emails.filter(e => e.matchedFAQ && !e.isReplied)}
                  emailQuestions={emailQuestions}
                  onAutoReply={handleAutoReply}
                  onMarkNotRelevant={handleMarkNotRelevant}
                  showNotRelevantButton={false}
                />
              )}
              {activeTab === 'faq_expansion' && (
                <FAQExpansionList
                  faqs={genericFAQs}
                  onAddToLibrary={handleAddToFAQLibrary}
                  onIgnore={handleIgnoreFAQ}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
} 