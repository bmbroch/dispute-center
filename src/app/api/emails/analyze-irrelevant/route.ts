import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { saveAIApiLog } from '@/lib/firebase/aiLogging';
import type { IrrelevanceAnalysis } from '@/types/faq';

const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OpenAI API key is not configured. Please set NEXT_PUBLIC_OPENAI_API_KEY or OPENAI_API_KEY environment variable.');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || '',
});

const MODEL = 'gpt-4o-mini' as const;

// Constants for token management - much more conservative limits
const MAX_TOTAL_TOKENS = 2000; // Very conservative limit to ensure we stay under 8k
const MAX_SUBJECT_CHARS = 100;
const MAX_CONTENT_CHARS = 4000; // Approximately 1000 tokens for content

// Helper function to truncate content to stay within token limits
function truncateContent(subject: string, content: string): { subject: string, content: string } {
  // Truncate subject
  const truncatedSubject = subject.length > MAX_SUBJECT_CHARS
    ? subject.slice(0, MAX_SUBJECT_CHARS) + '...'
    : subject;

  // Aggressively truncate content
  let truncatedContent = content;
  if (content.length > MAX_CONTENT_CHARS) {
    const startLength = Math.floor(MAX_CONTENT_CHARS * 0.6); // 60% from start
    const endLength = Math.floor(MAX_CONTENT_CHARS * 0.4);   // 40% from end
    const start = content.slice(0, startLength);
    const end = content.slice(-endLength);
    truncatedContent = `${start}\n\n[... ${content.length - MAX_CONTENT_CHARS} characters truncated ...]\n\n${end}`;
  }

  return {
    subject: truncatedSubject,
    content: truncatedContent
  };
}

// Helper function to check if email matches any existing FAQs
async function checkAgainstFAQLibrary(subject: string, content: string, db: FirebaseFirestore.Firestore): Promise<boolean> {
  try {
    // Get existing FAQs
    const faqSnapshot = await db.collection('faqs').get();
    const faqs = faqSnapshot.docs.map(doc => doc.data());

    if (faqs.length === 0) {
      console.log('No FAQs found in library');
      return false;
    }

    // Check for matches using OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an expert at matching customer inquiries to FAQs. Compare the email to the FAQ library and determine if it matches any existing FAQ. Return a JSON object with:
          {
            "matches": boolean,
            "matchedFAQ": string | null,
            "confidence": number (0-1),
            "explanation": string
          }`
        },
        {
          role: "user",
          content: JSON.stringify({
            email: {
              subject,
              content
            },
            faqs: faqs
          })
        }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    if (!response.choices[0].message?.content) {
      return false;
    }

    const analysis = JSON.parse(response.choices[0].message.content);
    return analysis.matches && analysis.confidence > 0.7; // Return true if we have a high confidence match
  } catch (error) {
    console.error('Error checking against FAQ library:', error);
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const { emailId, subject, content, sender, threadId, userEmail } = await req.json();
    if (!emailId || !subject || !content || !sender || !threadId || !userEmail) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }

    // Log the API call start
    try {
      await saveAIApiLog({
        username: userEmail,
        functionName: 'analyze-irrelevant',
        inputTokens: Math.ceil((subject.length + content.length) / 4),
        outputTokens: 0,
        status: 'success',
        model: 'gpt-4-turbo-preview',
      });
    } catch (logError) {
      console.error('Error logging API call:', logError);
    }

    // Get Firebase Admin instance
    const app = getFirebaseAdmin();
    if (!app) {
      return NextResponse.json(
        { error: 'Failed to connect to database' },
        { status: 500 }
      );
    }
    const db = getFirestore(app);

    // Get the not_relevant collection reference
    const notRelevantRef = db.collection('not_relevant');

    // Truncate content to stay within token limits
    const truncated = truncateContent(subject, content);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: `You are an AI assistant analyzing why an email is not relevant. Return a JSON object with the following structure:
            {
              "reason": "Brief explanation of why the email is not relevant",
              "category": "spam" | "personal" | "automated" | "internal" | "too_specific" | "other",
              "confidence": number between 0 and 1,
              "details": "Detailed explanation of the analysis"
            }`,
          },
          {
            role: 'user',
            content: `Please analyze this email and explain why it's not relevant:\n\nSubject: ${truncated.subject}\n\nContent: ${truncated.content}`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const analysis = JSON.parse(response.choices[0]?.message?.content || '{}') as IrrelevanceAnalysis;

      // Add to not_relevant collection
      await notRelevantRef.add({
        emailId,
        reason: analysis.reason,
        category: analysis.category,
        confidence: analysis.confidence,
        details: analysis.details,
        timestamp: new Date(),
      });

      // Log the successful API call
      await saveAIApiLog({
        username: userEmail,
        functionName: 'analyze-irrelevant',
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        status: 'success',
        model: 'gpt-4-turbo-preview',
      });

      return NextResponse.json({ success: true, analysis });
    } catch (error) {
      console.error('Error analyzing email:', error);

      // Log the failed API call
      try {
        await saveAIApiLog({
          username: userEmail,
          functionName: 'analyze-irrelevant',
          inputTokens: 0,
          outputTokens: 0,
          status: 'failed',
          model: 'gpt-4-turbo-preview',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } catch (logError) {
        console.error('Error logging API failure:', logError);
      }

      return NextResponse.json(
        { error: 'Failed to analyze email' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'Invalid request format' },
      { status: 400 }
    );
  }
}
