import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { EmailSimulationResult } from '@/types/faq';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Key concepts that should be distinguished
const DISTINCT_CONCEPTS = {
  username: ['username', 'user name', 'login name', 'account name'],
  password: ['password', 'pwd', 'pass', 'reset password'],
  email: ['email', 'e-mail', 'mail'],
  account: ['account', 'profile'],
  payment: ['payment', 'billing', 'charge', 'subscription'],
  // Add more concepts as needed
};

function findMatchingConcepts(text: string): string[] {
  const lowercaseText = text.toLowerCase();
  return Object.entries(DISTINCT_CONCEPTS).reduce((matches: string[], [concept, terms]) => {
    if (terms.some(term => lowercaseText.includes(term))) {
      matches.push(concept);
    }
    return matches;
  }, []);
}

function calculateConfidence(
  userQuestion: string,
  faqQuestion: string,
  userConcepts: string[],
  faqConcepts: string[]
): number {
  // If the concepts don't match, significantly reduce confidence
  const conceptsMatch = userConcepts.some(concept => faqConcepts.includes(concept));
  if (!conceptsMatch) {
    return 30; // Very low confidence if core concepts don't match
  }

  // Calculate basic similarity (you might want to use a more sophisticated algorithm)
  const userWords = new Set(userQuestion.toLowerCase().split(/\s+/));
  const faqWords = new Set(faqQuestion.toLowerCase().split(/\s+/));
  const commonWords = new Set([...userWords].filter(x => faqWords.has(x)));
  
  const similarity = (commonWords.size * 2) / (userWords.size + faqWords.size);
  
  // Weight the confidence score
  const baseConfidence = similarity * 100;
  
  // Adjust confidence based on concept matching
  const conceptMatchScore = conceptsMatch ? 100 : 30;
  
  // Final confidence is weighted average
  return Math.round((baseConfidence * 0.7 + conceptMatchScore * 0.3));
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const { emailContent, email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email address is required' },
        { status: 400 }
      );
    }

    // Analyze the question with GPT to understand intent and generate response
    const systemPrompt = `You are a helpful customer support agent for Interview Sidekick, a platform that helps with interview preparation.
    Analyze the incoming customer email to:
    1. Identify the main topic and intent
    2. Determine customer sentiment
    3. Extract key points
    4. Generate a professional, helpful response
    
    Respond with ONLY a JSON object in this format (no other text):
    {
      "analysis": {
        "sentiment": string,
        "keyPoints": string[],
        "topic": string
      },
      "response": {
        "suggestedReply": string,
        "confidence": number,
        "requiresHumanResponse": boolean,
        "reason": string
      }
    }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: `Subject: Customer Inquiry\n\nFrom: ${email}\n\nBody: ${emailContent}`
        }
      ],
      temperature: 0.7
    });

    if (!response.choices[0].message.content) {
      throw new Error('No response from OpenAI');
    }

    const result = JSON.parse(response.choices[0].message.content);

    // Transform the response to match our expected format
    const transformedResult: EmailSimulationResult = {
      matches: [{
        faq: {
          id: 'ai-generated',
          question: emailContent,
          replyTemplate: result.response.suggestedReply,
          instructions: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          confidence: result.response.confidence,
          useCount: 0
        },
        confidence: result.response.confidence,
        suggestedReply: result.response.suggestedReply
      }],
      requiresHumanResponse: result.response.requiresHumanResponse,
      reason: result.response.reason,
      analysis: {
        sentiment: result.analysis.sentiment,
        keyPoints: result.analysis.keyPoints,
        concepts: [result.analysis.topic]
      }
    };

    return NextResponse.json(transformedResult);
  } catch (error) {
    console.error('Error simulating email:', error);
    return NextResponse.json(
      { error: 'Failed to simulate email' },
      { status: 500 }
    );
  }
} 