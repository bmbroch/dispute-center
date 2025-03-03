import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import OpenAI from 'openai';
import { EmailAnalysis } from '@/types/faq';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OpenAI API key is not configured');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || '',
});

// Cache configuration
const DEFAULT_CACHE_DAYS = 30; // Default to 30 days if not configured
const CACHE_EXPIRY = (parseInt(process.env.EMAIL_ANALYSIS_CACHE_DAYS || '') || DEFAULT_CACHE_DAYS) * 24 * 60 * 60 * 1000;

// Add cache status to response
interface CacheInfo {
  source: 'cache' | 'fresh';
  age?: number;
  expiresIn?: number;
}

export async function POST(req: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key is not configured' },
        { status: 400 }
      );
    }

    const { email, forceRefresh = false } = await req.json();
    if (!email?.threadId || !email?.subject || !email?.content) {
      return NextResponse.json(
        { error: 'Email threadId, subject and content are required' },
        { status: 400 }
      );
    }

    // Initialize Firebase Admin
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    const db = getFirestore(app);

    // Extract user email from the request headers or use a default
    const authHeader = req.headers.get('Authorization');
    let userEmail = 'default@example.com'; // Default fallback

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const accessToken = authHeader.split(' ')[1];
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });

        if (userInfoResponse.ok) {
          const userInfo = await userInfoResponse.json();
          userEmail = userInfo.email || userEmail;
        }
      } catch (error) {
        console.error('Error fetching user info:', error);
      }
    }

    const user = { email: userEmail };

    // Check cache first if not forcing refresh
    if (!forceRefresh) {
      const analysisRef = db.collection('email_analyses').doc(email.threadId);
      const analysisDoc = await analysisRef.get();

      if (analysisDoc.exists) {
        const cachedAnalysis = analysisDoc.data() as EmailAnalysis;
        const cacheAge = Date.now() - new Date(cachedAnalysis.timestamp).getTime();

        // Return cached analysis if it's not expired
        if (cacheAge < CACHE_EXPIRY) {
          console.log('Returning cached analysis for thread:', email.threadId);

          // Add cache info to response
          const cacheInfo: CacheInfo = {
            source: 'cache',
            age: Math.round(cacheAge / (1000 * 60 * 60 * 24)), // Age in days
            expiresIn: Math.round((CACHE_EXPIRY - cacheAge) / (1000 * 60 * 60 * 24)) // Days until expiry
          };

          return NextResponse.json({
            ...cachedAnalysis,
            _cache: cacheInfo
          });
        }
      }
    }

    // Get existing FAQs from user's subcollection
    const userFaqsRef = db.collection('users').doc(user.email).collection('faqs');
    const faqSnapshot = await userFaqsRef.get();
    const existingFaqs = faqSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Analyze the email with OpenAI
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
            "suggestedQuestions": Array of potential FAQ patterns,
            "sentiment": "positive|negative|neutral",
            "keyPoints": Array of key points from the email,
            "concepts": Array of main concepts discussed,
            "requiresHumanResponse": boolean,
            "reason": String explaining why human response needed (if applicable)
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
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    if (!response.choices[0].message.content) {
      throw new Error('No response from OpenAI');
    }

    const analysis = JSON.parse(response.choices[0].message.content);

    // Create the analysis object
    const emailAnalysis: EmailAnalysis = {
      threadId: email.threadId,
      timestamp: new Date().toISOString(),
      analysis: analysis,
      matchedFAQ: analysis.matchedFAQ,
      confidence: analysis.confidence,
      generatedReply: analysis.generatedReply
    };

    // Store in Firestore
    const analysisRef = db.collection('email_analyses').doc(email.threadId);
    await analysisRef.set(emailAnalysis);

    // Add cache info to response
    const cacheInfo: CacheInfo = {
      source: 'fresh',
      expiresIn: Math.round(CACHE_EXPIRY / (1000 * 60 * 60 * 24)) // Days until expiry
    };

    return NextResponse.json({
      ...emailAnalysis,
      _cache: cacheInfo
    });

  } catch (error) {
    console.error('Error analyzing email:', error);
    return NextResponse.json(
      {
        error: 'Failed to analyze email',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const threadId = req.nextUrl.searchParams.get('threadId');
    if (!threadId) {
      return NextResponse.json(
        { error: 'Thread ID is required' },
        { status: 400 }
      );
    }

    // Initialize Firebase Admin
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    const db = getFirestore(app);

    // Get cached analysis
    const analysisRef = db.collection('email_analyses').doc(threadId);
    const analysisDoc = await analysisRef.get();

    if (!analysisDoc.exists) {
      return NextResponse.json(
        { error: 'No analysis found for this thread' },
        { status: 404 }
      );
    }

    const analysis = analysisDoc.data() as EmailAnalysis;
    const cacheAge = Date.now() - new Date(analysis.timestamp).getTime();

    // Add cache info to response
    const cacheInfo: CacheInfo = {
      source: 'cache',
      age: Math.round(cacheAge / (1000 * 60 * 60 * 24)), // Age in days
      expiresIn: Math.round((CACHE_EXPIRY - cacheAge) / (1000 * 60 * 60 * 24)) // Days until expiry
    };

    return NextResponse.json({
      ...analysis,
      _cache: cacheInfo
    });

  } catch (error) {
    console.error('Error fetching email analysis:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch email analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
