import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Check OpenAI API key configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OpenAI API key is not configured');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || '',
});

export async function POST(req: Request) {
  try {
    // Validate OpenAI API key
    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key is not configured');
      return NextResponse.json(
        { error: 'OpenAI API key is not configured' },
        { status: 400 }  // Changed to 400 to indicate client configuration issue
      );
    }

    const { subject, content } = await req.json();

    // Validate required fields
    if (!subject || !content) {
      return NextResponse.json(
        { error: 'Subject and content are required' },
        { status: 400 }
      );
    }

    const prompt = `Analyze this customer support email and generate a generic question pattern that could help identify similar questions in the future.

Email Subject: ${subject}
Email Content: ${content}

Your task:
1. Identify the core question or request
2. Create a generic pattern that would match similar questions
3. Suggest similar variations of this question pattern
4. Determine if this requires customer-specific information
5. Suggest an appropriate category

For example:
If a customer asks "How do I connect my Spotify account to the app?", the pattern might be "How to integrate/connect {third_party_service} with the system"

Return a JSON object with:
{
  "genericPattern": string,  // The generic question pattern
  "similarPatterns": string[],  // 3-5 similar variations of this pattern
  "suggestedCategory": string,  // One of: support, setup, billing, feature, bug
  "requiresCustomerInfo": boolean,  // Whether answering requires customer-specific details
  "reasoning": string  // Brief explanation of your analysis
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { 
            role: "system", 
            content: "You are an AI expert at analyzing customer support emails and identifying reusable question patterns. Always respond in valid JSON format." 
          },
          { 
            role: "user", 
            content: `${prompt}\n\nRemember to respond with a valid JSON object containing only the following fields: genericPattern, similarPatterns, suggestedCategory, requiresCustomerInfo, and reasoning.` 
          }
        ],
        temperature: 0.1
      });

      if (!response.choices[0].message.content) {
        throw new Error('No response from OpenAI');
      }

      try {
        const analysis = JSON.parse(response.choices[0].message.content);
        
        // Validate the response format
        if (!analysis.genericPattern || !analysis.suggestedCategory) {
          throw new Error('Invalid response format from AI');
        }
        
        return NextResponse.json(analysis);
      } catch (parseError) {
        console.error('Error parsing OpenAI response:', parseError);
        return NextResponse.json(
          { 
            error: 'Failed to parse AI response',
            details: 'The AI response was not in the expected format'
          },
          { status: 500 }
        );
      }
      
    } catch (openAiError) {
      console.error('OpenAI API error:', openAiError);
      return NextResponse.json(
        { 
          error: 'Failed to analyze email with AI',
          details: openAiError instanceof Error ? openAiError.message : 'Unknown OpenAI error'
        },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error generating FAQ pattern:', error);
    return NextResponse.json(
      { 
        error: 'Failed to generate FAQ pattern',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 