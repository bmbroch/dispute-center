import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OpenAI API key is not configured. Please set NEXT_PUBLIC_OPENAI_API_KEY or OPENAI_API_KEY environment variable.');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || '',
});

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

  // Debug logging
  console.log('Content lengths:', {
    originalSubject: subject.length,
    truncatedSubject: truncatedSubject.length,
    originalContent: content.length,
    truncatedContent: truncatedContent.length,
    totalChars: truncatedSubject.length + truncatedContent.length
  });

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
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key is not configured' },
        { status: 400 }
      );
    }

    const { email } = await req.json();
    if (!email?.subject || !email?.content) {
      return NextResponse.json(
        { error: 'Email subject and content are required' },
        { status: 400 }
      );
    }

    // Initialize Firebase Admin
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    const db = getFirestore(app);

    // Truncate content to stay within token limits
    const { subject, content } = truncateContent(email.subject, email.content);

    // First check if the email matches any existing FAQs
    const matchesExistingFAQ = await checkAgainstFAQLibrary(subject, content, db);
    if (matchesExistingFAQ) {
      return NextResponse.json({
        error: 'Email matches existing FAQ',
        shouldNotMarkIrrelevant: true
      }, { status: 400 });
    }

    // Debug log the final input size
    console.log('Final input size:', {
      subject: subject.length,
      content: content.length,
      total: subject.length + content.length
    });

    try {
      // Analyze the email with OpenAI
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are an expert at analyzing customer support emails. Your task is to explain why a given email is not relevant for FAQ generation.
            Consider factors like:
            1. Is it a personal/individual-specific inquiry?
            2. Is it spam or marketing content?
            3. Is it an automated notification?
            4. Is it internal communication?
            5. Is it too specific to be useful as a general FAQ?
            
            Return a JSON object with:
            {
              "reason": "A concise one-line explanation",
              "category": "spam|personal|automated|internal|too_specific|other",
              "confidence": 0-1 score of how confident you are this is not relevant,
              "details": "2-3 sentences explaining the analysis"
            }`
          },
          {
            role: "user",
            content: JSON.stringify({
              subject: subject,
              content: content
            })
          }
        ],
        temperature: 0.1,
        max_tokens: MAX_TOTAL_TOKENS
      });

      if (!response.choices[0].message?.content) {
        return NextResponse.json(
          { error: 'No response from AI analysis' },
          { status: 500 }
        );
      }

      try {
        const analysis = JSON.parse(response.choices[0].message.content);
        
        // Validate the response structure
        if (!analysis.reason || !analysis.category) {
          console.error('Invalid analysis structure:', analysis);
          return NextResponse.json(
            { 
              error: 'Invalid analysis format',
              reason: 'Email marked as not relevant',
              category: 'other',
              confidence: 1,
              details: 'Unable to analyze specific reason'
            }
          );
        }

        // Store in Firestore
        const notRelevantRef = db.collection('not_relevant_reasons');
        
        await notRelevantRef.add({
          emailId: email.threadId,
          reason: analysis.reason,
          category: analysis.category,
          confidence: analysis.confidence,
          details: analysis.details,
          createdAt: new Date().toISOString()
        });

        return NextResponse.json(analysis);
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        // Return a fallback response if parsing fails
        return NextResponse.json({
          reason: 'Email marked as not relevant',
          category: 'other',
          confidence: 1,
          details: 'Unable to analyze specific reason'
        });
      }
    } catch (openAiError) {
      console.error('OpenAI API error:', openAiError);
      // Return a user-friendly response even when OpenAI fails
      return NextResponse.json({
        reason: 'Email marked as not relevant',
        category: 'other',
        confidence: 1,
        details: 'Analysis service temporarily unavailable'
      });
    }
  } catch (error) {
    console.error('Error analyzing irrelevant email:', error);
    // Return a generic fallback response
    return NextResponse.json({
      reason: 'Email marked as not relevant',
      category: 'other',
      confidence: 1,
      details: 'Unable to process analysis'
    });
  }
} 