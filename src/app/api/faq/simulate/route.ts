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

    const { emailContent, email, existingFaqs, emailFormatting } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email address is required' },
        { status: 400 }
      );
    }

    // Format the email styling instructions based on settings
    const emailStyleGuide = `
Email Formatting Requirements:
- Use "${emailFormatting.greeting}" style greeting
- Use ${emailFormatting.listStyle === 'numbered' ? 'numbered lists (1. 2. 3.)' : 'bullet points'} for steps
- Apply ${emailFormatting.spacing} spacing between paragraphs
- End with signature style: "${emailFormatting.signatureStyle}"
${emailFormatting.customPrompt ? `\nCustom Instructions:\n${emailFormatting.customPrompt}` : ''}

Example Format:
${emailFormatting.greeting}

[Main content with ${emailFormatting.spacing} spacing]

${emailFormatting.listStyle === 'numbered' ? '1. First step\n2. Second step' : '• First step\n• Second step'}

${emailFormatting.signatureStyle}`;

    // Check if we have any FAQs to match against
    if (existingFaqs && existingFaqs.length > 0) {
      const matchingPrompt = `You are an expert at understanding customer questions and matching them to FAQ entries.

Task: Compare the customer's question against our FAQ library and determine if there's a semantic match.

Customer's Question: "${emailContent}"
Customer's Email: ${email}

FAQ Library:
${existingFaqs.map((faq: { question: string; replyTemplate: string }, i: number) => `${i + 1}. Question: "${faq.question}"
   Answer: "${faq.replyTemplate}"`).join('\n\n')}

Instructions:
1. Analyze if the customer's question is semantically asking the same thing as any FAQ entry
2. Consider variations in phrasing, word choice, and structure
3. If there's a match, generate a personalized response using the FAQ template
4. Assign a confidence score (0-100) based on semantic similarity

${emailStyleGuide}

Example matches that should be considered the same:
- "How do I reset my password?" = "I need to reset my password" = "Can you help me reset my password"
- "Where do I update my email?" = "How can I change my email address" = "Need to update email"

Respond with a JSON object:
{
  "match": {
    "found": boolean,
    "faqIndex": number | null,
    "confidence": number,
    "explanation": string
  },
  "response": {
    "personalizedReply": string | null,
    "requiresHumanReview": boolean
  },
  "analysis": {
    "sentiment": string,
    "keyPoints": string[]
  }
}`;

      const matchResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: matchingPrompt }
        ],
        temperature: 0.1 // Lower temperature for more consistent matching
      });

      if (!matchResponse.choices[0].message.content) {
        throw new Error('No response from OpenAI');
      }

      const matchResult = JSON.parse(matchResponse.choices[0].message.content);

      // If we found a match
      if (matchResult.match.found && matchResult.match.faqIndex !== null) {
        const matchedFaq = existingFaqs[matchResult.match.faqIndex];
        return NextResponse.json({
          matches: [{
            faq: {
              ...matchedFaq,
              confidence: matchResult.match.confidence
            },
            confidence: matchResult.match.confidence,
            suggestedReply: matchResult.response.personalizedReply
          }],
          requiresHumanResponse: matchResult.response.requiresHumanReview,
          reason: matchResult.match.explanation,
          analysis: matchResult.analysis
        });
      }
    }

    // If no match found or no FAQs exist, generate a new response
    const noMatchPrompt = `You are a helpful customer support agent. 
    Analyze this customer email and generate a properly formatted response.

    Customer's email: "${emailContent}"
    Customer's address: ${email}
    
    ${emailStyleGuide}
    
    Response format:
    {
      "analysis": {
        "sentiment": string,
        "keyPoints": string[]
      },
      "response": {
        "suggestedReply": string,
        "requiresHumanReview": boolean,
        "reason": string
      }
    }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: noMatchPrompt },
        { role: "user", content: emailContent }
      ],
      temperature: 0.7
    });

    if (!response.choices[0].message.content) {
      throw new Error('No response from OpenAI');
    }

    const result = JSON.parse(response.choices[0].message.content);

    return NextResponse.json({
      matches: [],
      requiresHumanResponse: true,
      reason: "No matching FAQ template found - new question type detected",
      analysis: result.analysis
    });

  } catch (error) {
    console.error('Error simulating email:', error);
    return NextResponse.json(
      { error: 'Failed to simulate email' },
      { status: 500 }
    );
  }
} 