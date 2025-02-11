import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2Client } from '@/lib/google/auth';
import { google, gmail_v1 } from 'googleapis';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import OpenAI from 'openai';
import type { Firestore } from 'firebase-admin/firestore';

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

// Add this helper function to safely extract email body
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

// Add this helper function to safely parse dates
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

// Update the GET function to handle pagination better
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'No authorization header provided' }, { status: 401 });
    }

    const accessToken = authHeader.replace('Bearer ', '');
    const page = parseInt(request.headers.get('X-Page') || '1');
    const forceRefresh = request.headers.get('X-Force-Refresh') === 'true';
    const pageSize = 10; // Increased from 5 to 10 emails per page

    // Initialize OAuth2 client and Gmail client
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ 
      access_token: accessToken,
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send'
      ].join(' ')
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const db = getFirestore(getFirebaseAdmin() as any);

    // Get threads with proper pagination - request more than needed to account for filtering
    const threadsResponse = await gmail.users.threads.list({
      userId: 'me',
      q: 'in:inbox -category:{promotions social updates forums} -label:sent',
      maxResults: pageSize * 2, // Request more threads to account for filtering
      pageToken: page > 1 ? String((page - 1) * pageSize) : undefined
    });

    if (!threadsResponse.data.threads) {
      return NextResponse.json({ 
        emails: [],
        page,
        hasMore: false
      });
    }

    // Process each thread
    const processedEmails = await Promise.all(
      threadsResponse.data.threads.map(async (thread) => {
        if (!thread.id) return null;

        try {
          // Check if thread is marked as not relevant in Firebase
          const notRelevantDoc = await db.collection('not_relevant_reasons')
            .where('emailId', '==', thread.id)
            .limit(1)
            .get();

          if (!notRelevantDoc.empty) {
            // Skip this thread as it's marked not relevant
            return null;
          }

          const threadDetails = await gmail.users.threads.get({
            userId: 'me',
            id: thread.id
          });

          if (!threadDetails.data.messages?.[0]) return null;

          const latestMessage = threadDetails.data.messages[threadDetails.data.messages.length - 1];
          if (!latestMessage.payload) return null;

          const headers = latestMessage.payload.headers || [];
          const getHeader = (name: string) => 
            headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

          const subject = getHeader('subject');
          const from = getHeader('from');
          const date = getHeader('date');
          const body = extractEmailBody(latestMessage);

          if (!body) return null;

          // Quick check if this is likely a support email before doing full analysis
          if (!isCustomerSupportEmail(subject, body)) {
            return null;
          }

          // First try to get cached questions
          const cachedQuestions = await getCachedEmailQuestions(thread.id, db);
          let analysis = null;

          if (cachedQuestions) {
            // Use cached questions
            analysis = {
              questions: cachedQuestions,
              timestamp: Date.now(),
              _cache: {
                source: 'cache' as const,
                age: 0,
                expiresIn: CACHE_EXPIRY
              }
            };
          } else if (forceRefresh) {
            // Only perform analysis if we don't have cached questions and forceRefresh is true
            analysis = await getEmailAnalysis({
              threadId: thread.id,
              subject: subject || 'No Subject',
              content: body
            }, db, forceRefresh);

            // Store the questions in Firebase if we got them
            if (analysis !== null && typeof analysis === 'object' && 'analysis' in analysis) {
                const analysisData = analysis.analysis;
                if (analysisData && typeof analysisData === 'object' && 'suggestedQuestions' in analysisData) {
                    const emailAnalysisRef = db.collection('email_analyses').doc(thread.id);
                    await emailAnalysisRef.set({
                        questions: analysisData.suggestedQuestions,
                        timestamp: Date.now()
                    });
                }
            }
          }

          let suggestedQuestions: string[] = [];
          
          // Store the questions in Firebase if we got them
          if (analysis !== null && typeof analysis === 'object' && 'analysis' in analysis) {
              const analysisData = analysis.analysis;
              if (analysisData && typeof analysisData === 'object' && 'suggestedQuestions' in analysisData) {
                  suggestedQuestions = analysisData.suggestedQuestions;
                  const emailAnalysisRef = db.collection('email_analyses').doc(thread.id);
                  await emailAnalysisRef.set({
                      questions: analysisData.suggestedQuestions,
                      timestamp: Date.now()
                  });
              }
          }

          // Update the confidence handling with null check
          const confidence = (analysis !== null && 'confidence' in analysis && typeof analysis.confidence === 'number') ? analysis.confidence : 0;

          return {
            id: thread.id,
            threadId: thread.id,
            subject: subject || 'No Subject',
            sender: from || 'Unknown Sender',
            content: body,
            receivedAt: parseGmailDate(date),
            hasReply: threadDetails.data.messages.length > 1,
            isReplied: false,
            isNotRelevant: false,
            analysis: analysis || null,
            confidence: confidence,
            suggestedQuestions: suggestedQuestions,
            timestamp: analysis?.timestamp || Date.now()
          };
        } catch (error) {
          console.error(`Error processing thread ${thread.id}:`, error);
          return null;
        }
      })
    );

    // Filter out null values and non-support emails
    const validEmails = processedEmails.filter(Boolean);

    // Get the next page token only if we have more valid emails
    const hasMore = validEmails.length >= pageSize && threadsResponse.data.nextPageToken;

    // Return only the requested number of emails
    return NextResponse.json({
      emails: validEmails.slice(0, pageSize),
      page,
      hasMore: hasMore
    });

  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
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