import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { FAQ } from '@/types/faq';
import { calculatePatternSimilarity } from '@/lib/utils/similarity';

// Validate environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error('OpenAI API key is not configured');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

interface ExistingFaq {
  id: string;
  question?: string;
}

export async function POST(req: Request) {
  try {
    // Validate OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key is not configured');
      return NextResponse.json(
        { error: 'OpenAI API key is not configured' },
        { status: 500 }
      );
    }

    const { emails } = await req.json();

    // Validate emails input
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      console.error('No emails provided for analysis');
      return NextResponse.json(
        { error: 'No emails provided for analysis' },
        { status: 400 }
      );
    }

    // Initialize Firebase Admin
    const app = getFirebaseAdmin();
    if (!app) {
      console.error('Failed to initialize Firebase Admin');
      return NextResponse.json(
        { error: 'Failed to initialize Firebase Admin' },
        { status: 500 }
      );
    }
    const db = getFirestore(app);

    // Get existing FAQs to avoid duplicates
    const faqRef = db.collection('faqs');
    const faqSnapshot = await faqRef.get();
    const existingFaqs = faqSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log('Starting email analysis with OpenAI...', {
      emailCount: emails.length,
      existingFaqCount: existingFaqs.length
    });

    // Analyze emails to generate generic FAQs
    const systemPrompt = `You are an expert at analyzing customer support emails and generating generic, reusable FAQ questions.
    Given a set of customer emails, identify common underlying themes and generate generic questions that could help multiple users.

    For example:
    If multiple users ask about "how do I set up X" or "can't configure Y", generate a generic question like "How do I set up and configure my account?"

    Rules:
    1. Questions should be generic enough to help multiple users
    2. Avoid customer-specific details
    3. Group similar questions together
    4. Identify which emails would be helped by each FAQ
    5. Categorize questions (e.g., Setup, Usage, Billing, etc.)

    Return a JSON object in this format:
    {
      "genericFaqs": [{
        "question": string,
        "category": string,
        "emailIds": string[],  // IDs of emails this FAQ would help answer
        "confidence": number,  // 0-1 how confident this is a common issue
        "requiresCustomerSpecificInfo": boolean
      }]
    }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify(emails.map(e => ({
            id: e.id,
            subject: e.subject,
            content: e.content
          })))
        }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    if (!response.choices[0].message.content) {
      console.error('No content in OpenAI response');
      throw new Error('No response from OpenAI');
    }

    console.log('Successfully received OpenAI analysis');

    const analysis = JSON.parse(response.choices[0].message.content);

    // Filter out any FAQs that are too similar to existing ones
    const newFaqs = analysis.genericFaqs.filter((newFaq: { question: string }) => {
      // Check against all existing FAQs using similarity
      return !existingFaqs.some((existingFaq: ExistingFaq) => {
        const existingQuestion = existingFaq.question || '';
        return calculatePatternSimilarity(existingQuestion, newFaq.question) > 0.7;
      });
    });

    console.log('Analysis complete', {
      totalFaqsGenerated: analysis.genericFaqs.length,
      newUniqueFaqs: newFaqs.length
    });

    return NextResponse.json({
      faqs: newFaqs,
      totalEmails: emails.length,
      faqsGenerated: newFaqs.length
    });

  } catch (error) {
    console.error('Error analyzing emails:', error);
    // Return a more detailed error response
    return NextResponse.json(
      {
        error: 'Failed to analyze emails',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// Simple text similarity function
function calculateSimilarity(text1: string, text2: string): number {
  const normalize = (text: string) => text.toLowerCase().replace(/[^\w\s]/g, '');
  const words1 = new Set(normalize(text1).split(/\s+/));
  const words2 = new Set(normalize(text2).split(/\s+/));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}
