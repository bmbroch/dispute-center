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

// Update these constants at the top
const BATCH_SIZE = 20; // Reduced from 100 to 20 for smaller batches
const RATE_LIMIT_DELAY = 1000; // 1 second between API calls
const MAX_EMAILS_TO_PROCESS = 100; // Reduced maximum emails to process

// Update the Gmail rate limiting constants
const GMAIL_RATE_LIMIT = {
  REQUESTS_PER_MINUTE: 250,
  BATCH_SIZE: 20, // Reduced batch size for thread processing
  DELAY_BETWEEN_BATCHES: 1000,
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

interface ThreadMessage {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string;
  receivedAt: number;
}

interface EmailResponse {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string;
  receivedAt: number;
  threadMessages: ThreadMessage[];
  extractionError: {
    message: string;
    details?: any;
  } | undefined;
}

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

// Update the GET function to fetch more threads
export async function GET(request: NextRequest) {
  try {
    // Get pagination parameters from URL
    const searchParams = new URL(request.url).searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20'); // Default limit reduced to 20
    const pageToken = searchParams.get('pageToken') || undefined;

    // Get access token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }
    const accessToken = authHeader.split(' ')[1];

    // Initialize Gmail client
    const gmail = await getGmailClient(accessToken);
    if (!gmail) {
      return NextResponse.json({ error: 'Failed to initialize Gmail client' }, { status: 500 });
    }

    // Initialize Firestore
    const firebaseApp = getFirebaseAdmin();
    if (!firebaseApp) {
      return NextResponse.json({ error: 'Failed to initialize Firebase Admin' }, { status: 500 });
    }
    const db = firebaseApp.firestore();

    // Fetch threads with pagination, removing the time window restriction
    const response = await gmail.users.threads.list({
      userId: 'me',
      maxResults: limit,
      pageToken: pageToken,
      q: 'in:inbox -label:automated-reply', // Removed time window restriction
    });

    const threads = response.data.threads || [];
    const nextPageToken = response.data.nextPageToken;

    // Process threads with rate limiting
    const processedThreads = await Promise.all(
      threads.map(async (thread) => {
        try {
          const threadDetails = await gmail.users.threads.get({
            userId: 'me',
            id: thread.id!,
            format: 'full', // Get full message details
          });

          // Get the most recent message from the thread
          const messages = threadDetails.data.messages || [];
          const mostRecentMessage = messages[messages.length - 1];

          if (!mostRecentMessage || !mostRecentMessage.payload) {
            return null;
          }

          // Extract email content
          const { content, error: extractionError } = extractEmailBody(mostRecentMessage);

          // Get thread messages for context
          const threadMessages = messages.map(message => {
            const { content: messageContent } = extractEmailBody(message);
            return {
              id: message.id!,
              threadId: thread.id!,
              subject: message.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
              sender: message.payload?.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
              content: messageContent || '',
              receivedAt: parseInt(message.internalDate || '0'),
            };
          }).reverse(); // Reverse to get oldest first

          return {
            id: mostRecentMessage.id!,
            threadId: thread.id!,
            subject: mostRecentMessage.payload.headers?.find(h => h.name === 'Subject')?.value || 'No Subject',
            sender: mostRecentMessage.payload.headers?.find(h => h.name === 'From')?.value || 'Unknown Sender',
            content: content || '',
            receivedAt: parseInt(mostRecentMessage.internalDate || '0'),
            threadMessages,
            extractionError
          };
        } catch (error) {
          console.error(`Error processing thread ${thread.id}:`, error);
          return null;
        }
      })
    );

    // Filter out failed threads first
    const validThreads = processedThreads.filter((thread): thread is EmailResponse => {
      if (!thread) return false;
      return (
        typeof thread.id === 'string' &&
        typeof thread.threadId === 'string' &&
        typeof thread.subject === 'string' &&
        typeof thread.sender === 'string' &&
        typeof thread.content === 'string' &&
        typeof thread.receivedAt === 'number' &&
        Array.isArray(thread.threadMessages)
      );
    });

    // Check not relevant status for all threads in parallel
    const notRelevantChecks = await Promise.all(
      validThreads.map(async thread => ({
        thread,
        isNotRelevant: await isEmailNotRelevant(thread.id, db)
      }))
    );

    // Filter out not relevant threads
    const finalThreads = notRelevantChecks
      .filter(({ isNotRelevant }) => !isNotRelevant)
      .map(({ thread }) => thread)
      .sort((a, b) => {
        if (!a || !b) return 0;
        return b.receivedAt - a.receivedAt;
      });

    // Return response with pagination info
    return NextResponse.json({
      emails: finalThreads,
      hasMore: Boolean(nextPageToken),
      nextPage: nextPageToken ? page + 1 : null,
      nextPageToken: nextPageToken,
      total: response.data.resultSizeEstimate || 0,
      currentPage: page,
      pageSize: limit
    });

  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: error instanceof Error && error.message.includes('quota') ? 429 : 500 }
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
function extractEmailBody(message: gmail_v1.Schema$Message): { content: string | null; error?: { message: string; details?: any } } {
  try {
    if (!message.payload) {
      return {
        content: null,
        error: {
          message: 'No message payload found',
          details: { messageId: message.id }
        }
      };
    }

    // Helper function to recursively search for text content in parts
    const findTextContent = (part: gmail_v1.Schema$MessagePart): string | null => {
      // Log the part structure for debugging
      console.log('Processing part:', {
        mimeType: part.mimeType,
        hasBody: !!part.body,
        hasData: !!part.body?.data,
        hasParts: !!part.parts,
        partId: part.partId
      });

      // Check if this part is text content
      if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
        if (part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString();
        }
      }

      // If this is a multipart message, search through all parts
      if (part.parts) {
        for (const subPart of part.parts) {
          const content = findTextContent(subPart);
          if (content) return content;
        }
      }

      return null;
    };

    // Try to find text content in the message
    const content = findTextContent(message.payload);
    
    if (content) {
      return { content };
    }

    // If no content found, return detailed error
    return {
      content: null,
      error: {
        message: 'No email body content found',
        details: {
          messageId: message.id,
          hasPayload: !!message.payload,
          hasParts: !!message.payload.parts,
          hasDirectBody: !!message.payload.body,
          mimeType: message.payload.mimeType,
          partStructure: message.payload.parts?.map(part => ({
            mimeType: part.mimeType,
            hasBody: !!part.body,
            hasData: !!part.body?.data,
            hasParts: !!part.parts
          }))
        }
      }
    };
  } catch (error) {
    console.error('Error extracting email body:', error);
    return {
      content: null,
      error: {
        message: 'Error extracting email body',
        details: {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
          mimeType: message.payload?.mimeType,
          hasPayload: !!message.payload,
          hasParts: !!message.payload?.parts,
          hasDirectBody: !!message.payload?.body,
          partStructure: message.payload?.parts?.map(part => ({
            mimeType: part.mimeType,
            hasBody: !!part.body,
            hasData: !!part.body?.data,
            hasParts: !!part.parts
          }))
        }
      }
    };
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