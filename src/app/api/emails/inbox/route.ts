import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google, gmail_v1 } from 'googleapis';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import OpenAI from 'openai';

// Add OpenAI initialization after imports
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OpenAI API key is not configured');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || '',
});

// Add this helper function after imports
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Cache configuration
const DEFAULT_CACHE_DAYS = 30; // Default to 30 days if not configured
const CACHE_EXPIRY = (parseInt(process.env.EMAIL_ANALYSIS_CACHE_DAYS || '') || DEFAULT_CACHE_DAYS) * 24 * 60 * 60 * 1000;

// Add these constants at the top with other configurations
const BATCH_SIZE = 5; // Process 5 emails at a time
const RATE_LIMIT_DELAY = 1000; // 1 second between API calls
const TARGET_SUPPORT_EMAILS = 5; // Lowered from 20 to 5 until we fix analysis issues
const MAX_EMAILS_TO_PROCESS = 25; // Lowered from 100 to 25 until we fix analysis issues

// Add these rate limiting constants at the top
const GMAIL_RATE_LIMIT = {
  REQUESTS_PER_MINUTE: 250, // Gmail API quota is 250 requests per minute per user
  BATCH_SIZE: 10, // Process 10 threads at a time
  DELAY_BETWEEN_BATCHES: 1000, // 1 second between batches
};

// Update the rate limiting constants
const RATE_LIMITS = {
  MIN_TIME_BETWEEN_FETCHES: 30000, // 30 seconds
  RETRY_AFTER_DEFAULT: 60000, // 1 minute default retry after
  MAX_RETRIES: 3,
  BASE_DELAY: 2000,
  MAX_DELAY: 10000
};

// Add rate limiting state
let lastRequestTime = 0;
let consecutiveRequests = 0;
const MAX_CONSECUTIVE_REQUESTS = 5;
const CONSECUTIVE_REQUESTS_WINDOW = 60000; // 1 minute

interface EmailAnalysis {
  threadId: string;
  timestamp: string;
  analysis: {
    suggestedQuestions: string[];
    sentiment: string;
    keyPoints: string[];
    concepts: string[];
    requiresHumanResponse: boolean;
    reason: string;
    isSupport: boolean;
  };
  matchedFAQ: any;
  confidence: number;
  generatedReply: string | null;
  _cache?: {
    source: 'cache' | 'fresh';
    age?: number;
    expiresIn: number;
  };
}

interface CachedAnalysis {
  _cache: {
    source: 'cache';
    age: number;
    expiresIn: number;
  };
  questions: Array<{
    question: string;
    category: string;
    confidence: number;
  }>;
  timestamp: number;
  analysis?: {
    suggestedQuestions: string[];
    sentiment: string;
    keyPoints: string[];
    concepts: string[];
    requiresHumanResponse: boolean;
    reason: string;
    isSupport: boolean;
  };
}

type AnalysisResult = EmailAnalysis | CachedAnalysis;

// Add this helper function to process emails in batches
async function processBatch(emails: any[], faqs: any[]) {
  const results = [];
  for (const email of emails) {
    try {
      if (!OPENAI_API_KEY) {
        console.warn('OpenAI API key is not configured, skipping AI analysis');
        results.push(null);
        continue;
      }

      // Add a small delay between API calls
      await sleep(200);  // 200ms delay

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { 
            role: "system", 
            content: "You are an expert at matching customer support emails to FAQ patterns. Compare the email content to the given FAQ questions and determine the best match. Return a JSON object with bestMatch and confidence fields." 
          },
          { 
            role: "user", 
            content: JSON.stringify({
              email: {
                subject: email.subject,
                content: email.content
              },
              faqs: faqs.map(faq => ({
                id: faq.id,
                question: faq.question
              }))
            })
          }
        ],
        temperature: 0.1
      });

      if (response.choices[0].message.content) {
        try {
          const analysis = JSON.parse(response.choices[0].message.content);
          console.log('AI Analysis result:', analysis);
          results.push(analysis.bestMatch || null);
        } catch (parseError) {
          console.error('Error parsing OpenAI response:', parseError);
          console.log('Raw response:', response.choices[0].message.content);
          results.push(null);
        }
      } else {
        console.log('No content in OpenAI response');
        results.push(null);
      }
    } catch (error) {
      console.error('Error analyzing email with AI:', error);
      results.push(null);
    }
  }
  return results;
}

// Add getEmailAnalysis helper function
async function getEmailAnalysis(email: { threadId: string; subject: string; content: string }, db: Firestore, forceRefresh = false): Promise<AnalysisResult | null> {
  try {
    // Check cache first
    const analysisRef = db.collection('email_analyses').doc(email.threadId);
    const analysisDoc = await analysisRef.get();
    
    if (!forceRefresh && analysisDoc.exists) {
      const cachedAnalysis = analysisDoc.data() as CachedAnalysis | undefined;
      if (!cachedAnalysis) {
        console.debug(`Invalid cache data for thread ${email.threadId}`);
      } else {
        const cacheAge = Date.now() - new Date(cachedAnalysis.timestamp).getTime();
        
        // Return cached analysis if it's not expired
        if (cacheAge < CACHE_EXPIRY) {
          console.debug(`Using cached analysis for thread: ${email.threadId}`);
          return {
            ...cachedAnalysis,
            _cache: {
              source: 'cache' as const,
              age: Math.round(cacheAge / (1000 * 60 * 60 * 24)),
              expiresIn: Math.round((CACHE_EXPIRY - cacheAge) / (1000 * 60 * 60 * 24))
            }
          };
        }
      }
    }

    // If no cache or expired, analyze with OpenAI
    if (!OPENAI_API_KEY) {
      console.warn('OpenAI API key is not configured');
      return null;
    }

    // Get existing FAQs to check for matches
    const faqRef = db.collection('faqs');
    const faqSnapshot = await faqRef.get();
    const existingFaqs = faqSnapshot.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Analyze with OpenAI
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are an expert at analyzing customer support emails. Your task is to:
            1. Identify key questions and patterns
            2. Match with existing FAQs if possible
            3. Generate suggested questions for new FAQs if needed
            4. Analyze sentiment and key points
            
            Return a JSON object with:
            {
              "suggestedQuestions": string[],
              "sentiment": "positive"|"negative"|"neutral",
              "keyPoints": string[],
              "concepts": string[],
              "requiresHumanResponse": boolean,
              "reason": string,
              "isSupport": boolean
            }`
          },
          {
            role: "user",
            content: JSON.stringify({
              subject: email.subject,
              content: email.content,
              existingFaqs: existingFaqs
            })
          }
        ],
        temperature: 0.1
      });

      if (!response.choices[0].message?.content) {
        console.warn(`No content in OpenAI response for thread ${email.threadId}`);
        return null;
      }

      let analysis;
      try {
        analysis = JSON.parse(response.choices[0].message.content);
      } catch (parseError) {
        console.error(`Error parsing OpenAI response for thread ${email.threadId}:`, parseError);
        console.debug('Raw response:', response.choices[0].message.content);
        return null;
      }

      // Validate analysis structure
      if (!analysis || typeof analysis !== 'object') {
        console.error(`Invalid analysis structure for thread ${email.threadId}`);
        return null;
      }

      // Create the analysis object with default values for missing fields
      const emailAnalysis = {
        threadId: email.threadId,
        timestamp: new Date().toISOString(),
        analysis: {
          suggestedQuestions: analysis.suggestedQuestions || [],
          sentiment: analysis.sentiment || 'neutral',
          keyPoints: analysis.keyPoints || [],
          concepts: analysis.concepts || [],
          requiresHumanResponse: analysis.requiresHumanResponse || false,
          reason: analysis.reason || '',
          isSupport: analysis.isSupport || true
        },
        matchedFAQ: analysis.matchedFAQ || null,
        confidence: analysis.confidence || 0,
        generatedReply: analysis.generatedReply || null,
        _cache: {
          source: 'fresh' as const,
          expiresIn: Math.round(CACHE_EXPIRY / (1000 * 60 * 60 * 24))
        }
      };

      // Store in Firestore
      try {
        await analysisRef.set(emailAnalysis);
        console.debug(`Stored analysis for thread ${email.threadId}`);
      } catch (dbError) {
        console.error(`Error storing analysis in Firestore for thread ${email.threadId}:`, dbError);
        // Continue even if storage fails - we can still return the analysis
      }

      if (analysis?.questions) {
        // Store the questions in Firebase
        await analysisRef.set({
          questions: analysis.questions,
          timestamp: Date.now()
        }, { merge: true });
      }

      return emailAnalysis;
    } catch (openAiError) {
      console.error(`OpenAI API error for thread ${email.threadId}:`, openAiError);
      return null;
    }
  } catch (error) {
    console.error(`Error in getEmailAnalysis for thread ${email.threadId}:`, error);
    return null;
  }
}

// Modify processBatchWithRateLimit to handle errors better
async function processBatchWithRateLimit(emails: any[], db: FirebaseFirestore.Firestore) {
  const results = [];
  
  // Process in smaller batches
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(emails.length / BATCH_SIZE)}`);
    
    // Process each email in the batch
    const batchResults = await Promise.all(
      batch.map(async (email) => {
        try {
          await sleep(RATE_LIMIT_DELAY);
          const result = await getEmailAnalysis(email, db);
          if (!result) {
            console.debug(`No analysis result for email ${email.threadId}`);
          }
          return result;
        } catch (error) {
          console.error(`Error processing email ${email.threadId}:`, error);
          return null;
        }
      })
    );
    
    // Filter out null results
    const validResults = batchResults.filter(Boolean);
    results.push(...validResults);
    
    console.log(`Batch ${i / BATCH_SIZE + 1} complete: ${validResults.length}/${batch.length} successful`);
  }
  
  return results;
}

// Helper function to determine if an email is likely a customer support inquiry
function isCustomerSupportEmail(subject: string, content: string): boolean {
  // Simple heuristics to avoid unnecessary API calls
  const supportKeywords = [
    'help', 'support', 'issue', 'problem', 'error', 'question',
    'not working', 'broken', 'failed', 'stuck', 'can\'t', 'cannot',
    'how to', 'how do i', 'assistance', 'bug', 'feature request'
  ];

  const lowerSubject = subject.toLowerCase();
  const lowerContent = content.toLowerCase();

  // Quick check for obvious support keywords
  return supportKeywords.some(keyword => 
    lowerSubject.includes(keyword) || lowerContent.includes(keyword)
  );
}

// Add this helper function to get cached questions for an email
async function getCachedEmailQuestions(threadId: string, db: FirebaseFirestore.Firestore) {
  try {
    const emailAnalysisRef = db.collection('email_analyses').doc(threadId);
    const doc = await emailAnalysisRef.get();
    
    if (doc.exists) {
      const data = doc.data();
      return data?.questions || null;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching cached questions for thread ${threadId}:`, error);
    return null;
  }
}

// Add this helper function for rate-limited thread processing
async function processThreadsWithRateLimit(
  gmail: gmail_v1.Gmail,
  threads: gmail_v1.Schema$Thread[],
  userId: string = 'me'
) {
  const results = [];
  const batches = [];
  
  // Split threads into batches
  for (let i = 0; i < threads.length; i += GMAIL_RATE_LIMIT.BATCH_SIZE) {
    batches.push(threads.slice(i, i + GMAIL_RATE_LIMIT.BATCH_SIZE));
  }

  // Process each batch with delay
  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(async (thread) => {
        try {
          const threadDetails = await gmail.users.threads.get({
            userId,
            id: thread.id!,
          });
          return threadDetails;
        } catch (error) {
          console.error(`Error processing thread ${thread.id}:`, error);
          return null;
        }
      })
    );

    results.push(...batchResults.filter(Boolean));
    
    // Add delay between batches to respect rate limits
    if (batches.indexOf(batch) < batches.length - 1) {
      await sleep(GMAIL_RATE_LIMIT.DELAY_BETWEEN_BATCHES);
    }
  }
  
  return results;
}

// Add this helper function before the GET function
async function isEmailNotRelevant(threadId: string, db: Firestore): Promise<boolean> {
  try {
    const notRelevantRef = db.collection('not_relevant_reasons').where('emailId', '==', threadId);
    const snapshot = await notRelevantRef.get();
    return !snapshot.empty;
  } catch (error) {
    console.error(`Error checking not relevant status for thread ${threadId}:`, error);
    return false;
  }
}

// Add Gmail client initialization function
async function getGmailClient(accessToken: string): Promise<gmail_v1.Gmail | null> {
  try {
    const oauth2Client = await getOAuth2Client({
      access_token: accessToken,
      token_type: 'Bearer'
    });
    
    if (!oauth2Client) {
      console.error('Failed to initialize OAuth2 client');
      return null;
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const firebaseApp = getFirebaseAdmin();
    if (!firebaseApp) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    const db = firebaseApp.firestore();

    return gmail;
  } catch (error) {
    console.error('Error initializing Gmail client:', error);
    return null;
  }
}

// Update the GET function to handle pagination better
export async function GET(request: NextRequest) {
  try {
    // Enhanced rate limiting check
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMITS.MIN_TIME_BETWEEN_FETCHES) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: RATE_LIMITS.MIN_TIME_BETWEEN_FETCHES - timeSinceLastRequest },
        { status: 429 }
      );
    }

    lastRequestTime = now;

    // Get the access token from the Authorization header first
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
    }
    const accessToken = authHeader.split(' ')[1];

    // Initialize Firebase Admin and Firestore
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    const db = getFirestore(app);

    // Get Gmail client with access token
    const gmail = await getGmailClient(accessToken);
    if (!gmail) {
      return NextResponse.json(
        { error: 'Failed to initialize Gmail client' },
        { status: 500 }
      );
    }

    // Get pagination parameters from headers correctly
    const page = parseInt(request.headers.get('x-page') || '1');
    const forceRefresh = request.headers.get('x-force-refresh') === 'true';
    const pageSize = 10;

    // List threads with pagination and exponential backoff
    let retryCount = 0;
    const maxRetries = 3;
    const baseDelay = 2000; // Start with 2 second delay

    const fetchThreads = async () => {
      try {
        return await gmail.users.threads.list({
          userId: 'me',
          maxResults: pageSize,
          pageToken: page > 1 ? `${(page - 1) * pageSize}` : undefined,
        });
      } catch (error) {
        if (retryCount < maxRetries) {
          retryCount++;
          const delay = Math.min(baseDelay * Math.pow(2, retryCount), 10000); // Max 10 second delay
          console.log(`Retrying Gmail API call in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchThreads();
        }
        throw error;
      }
    };

    const threadsResponse = await fetchThreads();

    if (!threadsResponse.data.threads || threadsResponse.data.threads.length === 0) {
      return NextResponse.json({ emails: [], hasMore: false });
    }

    // Process threads with rate limiting
    const threadDetails = await processThreadsWithRateLimit(
      gmail,
      threadsResponse.data.threads
    );

    // Process the thread details into emails and filter out not relevant ones
    const emailPromises = threadDetails
      .filter(Boolean)
      .map(async (thread) => {
        if (!thread?.data.messages || thread.data.messages.length === 0) return null;

        const message = thread.data.messages[0];
        const headers = message.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        // Check if this email is marked as not relevant
        const isNotRelevant = await isEmailNotRelevant(thread.data.id || '', db);
        if (isNotRelevant) return null;

        return {
          id: thread.data.id || '',
          threadId: thread.data.id || '',
          subject: getHeader('subject'),
          sender: getHeader('from'),
          receivedAt: parseGmailDate(getHeader('date')),
          content: extractEmailBody(message),
        };
      });

    const emails = (await Promise.all(emailPromises)).filter(Boolean);

    // Check for more pages
    const hasMore = threadsResponse.data.nextPageToken !== undefined;

    return NextResponse.json({
      emails,
      hasMore,
    });
  } catch (error) {
    console.error('Error in GET /api/emails/inbox:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails' },
      { status: 500 }
    );
  }
}

// Simple confidence calculation function
function calculateConfidence(subject: string, content: string, faqQuestion: string): number {
  const normalizeText = (text: string) => 
    text.toLowerCase().replace(/[^\w\s]/g, '').trim();

  const subjectNormalized = normalizeText(subject);
  const contentNormalized = normalizeText(content);
  const questionNormalized = normalizeText(faqQuestion);

  // Split into words for comparison
  const subjectWords = new Set(subjectNormalized.split(/\s+/));
  const contentWords = new Set(contentNormalized.split(/\s+/));
  const questionWords = new Set(questionNormalized.split(/\s+/));

  // Calculate word overlap
  const subjectOverlap = [...subjectWords].filter(word => questionWords.has(word)).length;
  const contentOverlap = [...contentWords].filter(word => questionWords.has(word)).length;

  // Weight subject matches more heavily than content matches
  const subjectScore = subjectOverlap / Math.max(subjectWords.size, questionWords.size);
  const contentScore = contentOverlap / Math.max(contentWords.size, questionWords.size);

  // Combine scores with weights
  const confidence = (subjectScore * 0.6) + (contentScore * 0.4);

  return confidence;
}

// Add helper functions for email parsing
function extractEmailBody(message: gmail_v1.Schema$Message): string | null {
  try {
    if (!message.payload) return null;

    // Try to get body from parts first
    if (message.payload.parts) {
      const textPart = message.payload.parts.find(part => 
        part.mimeType === 'text/plain' || part.mimeType === 'text/html'
      );
      if (textPart?.body?.data) {
        return Buffer.from(textPart.body.data, 'base64').toString();
      }
    }

    // If no parts or no text part, try body directly
    if (message.payload.body?.data) {
      return Buffer.from(message.payload.body.data, 'base64').toString();
    }

    return null;
  } catch (error) {
    console.error('Error extracting email body:', error);
    return null;
  }
}

function parseGmailDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return new Date().toISOString(); // Fallback to current date if invalid
    }
    return date.toISOString();
  } catch (error) {
    console.error('Error parsing date:', error);
    return new Date().toISOString();
  }
} 