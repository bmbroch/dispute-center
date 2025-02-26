import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { saveAIApiLog } from '@/lib/firebase/aiLogging';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, getDocs } from 'firebase/firestore';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
}

interface MatchedFAQ {
  questionId: string;
  question: string;
  confidence: number;
  matchReasoning?: string;
}

interface NewQuestion {
  question: string;
  category: string;
  confidence: number;
  requiresCustomerSpecificInfo: boolean;
  reasoning?: string;
}

interface ParsedResponse {
  matchedFAQs: MatchedFAQ[];
  newQuestions: NewQuestion[];
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = 'gpt-4o-mini' as const;

// Function to get existing FAQs from the library
async function getExistingFAQs(): Promise<FAQ[]> {
  try {
    const db = getFirebaseDB();
    if (!db) return [];

    const faqRef = collection(db, 'faq_library');
    const snapshot = await getDocs(faqRef);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as FAQ));
  } catch (error) {
    console.error('Error fetching existing FAQs:', error);
    return [];
  }
}

export async function POST(req: Request) {
  try {
    if (!openai.apiKey) {
      console.error('OpenAI API key not configured');
      return NextResponse.json(
        { error: 'OpenAI API key is not configured' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { emailId, emailContent, maxQuestions } = body;

    if (!emailContent) {
      console.error('No email content provided');
      return NextResponse.json(
        { error: 'No email content provided' },
        { status: 400 }
      );
    }

    console.log('Processing request:', {
      emailId,
      contentLength: emailContent?.length,
      contentPreview: emailContent?.substring(0, 200) + '...',
      maxQuestions
    });

    // First, get existing FAQs
    const existingFAQs = await getExistingFAQs();
    console.log(`Found ${existingFAQs.length} existing FAQs`);

    if (!existingFAQs || existingFAQs.length === 0) {
      console.log('No existing FAQs found, will only generate new questions');
    }

    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `You are an expert at analyzing customer inquiries and matching them with existing FAQ questions. You excel at understanding the core intent of questions and matching them to more general existing FAQs.

For example:
- "How do I get my money back for this broken app?" → matches "How can I request a refund"
- "The app keeps crashing, can I have my payment returned?" → matches "How can I request a refund"
- "Why isn't my subscription working on my new phone?" → matches "How do I manage my subscription"

Always try to match to existing FAQs first by understanding the underlying intent. Only suggest new questions if the core intent is truly unique. Always respond with valid JSON.`
          },
          {
            role: 'user',
            content: `Analyze this email content and match it with existing FAQs. Focus on understanding the core intent of the inquiry and match it to more general existing FAQs when possible.

Here are the existing FAQ questions - try to match the email's intent to these general questions:
${existingFAQs.map(faq => `- ${faq.question} (id: ${faq.id})`).join('\n')}

Guidelines for matching:
1. Look for the underlying intent, not just exact wording matches
2. If a specific question can be answered by a more general existing FAQ, use the existing FAQ
3. Consider that different wording might express the same basic need
4. Only suggest new questions if the core intent is truly unique and not covered by any existing FAQ
5. When suggesting new questions, make them as generic as possible to cover similar future cases

Email Content:
${emailContent}

Respond with a JSON object in this exact format:
{
  "matchedFAQs": [
    {
      "questionId": "existing-faq-id",
      "question": "existing question text",
      "confidence": 0.8,
      "matchReasoning": "Brief explanation of why this FAQ matches the intent"
    }
  ],
  "newQuestions": [
    {
      "question": "generic new question",
      "category": "support",
      "confidence": 0.9,
      "requiresCustomerSpecificInfo": false,
      "reasoning": "Explanation of why this needs a new FAQ and can't be covered by existing ones"
    }
  ]
}`
          }
        ],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: { type: "json_object" }
      });

      console.log('Received OpenAI response');

      const result = response.choices[0]?.message?.content;

      if (!result) {
        console.error('No content in OpenAI response');
        return NextResponse.json(
          { error: 'Failed to extract questions - no content in response' },
          { status: 500 }
        );
      }

      let parsedResult: ParsedResponse;
      try {
        parsedResult = JSON.parse(result) as ParsedResponse;
        console.log('Successfully parsed OpenAI response');
      } catch (parseError) {
        console.error('Failed to parse OpenAI response:', parseError);
        return NextResponse.json(
          { error: 'Failed to parse OpenAI response' },
          { status: 500 }
        );
      }

      // Map the matched FAQs to include their full content
      const matchedFAQs = (parsedResult.matchedFAQs || []).map(match => {
        const existingFAQ = existingFAQs.find(faq => faq.id === match.questionId);
        return {
          ...match,
          answer: existingFAQ?.answer,
          category: existingFAQ?.category || 'support'
        };
      });

      // Log the successful API call
      await saveAIApiLog({
        username: emailId || 'unknown',
        functionName: 'extract-questions',
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        status: 'success',
        model: MODEL,
      });

      return NextResponse.json({
        matchedFAQs,
        newQuestions: parsedResult.newQuestions || [],
        usage: response.usage
      });

    } catch (openAIError) {
      console.error('OpenAI API error:', openAIError);
      const errorMessage = openAIError instanceof Error ? openAIError.message : 'Unknown OpenAI error';
      return NextResponse.json(
        { error: `OpenAI API error: ${errorMessage}` },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error processing request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Server error: ${errorMessage}` },
      { status: 500 }
    );
  }
}
