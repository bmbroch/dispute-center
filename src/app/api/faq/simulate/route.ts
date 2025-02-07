import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { EmailSimulationResult } from '@/types/faq';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

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

    const systemPrompt = `You are a helpful customer support agent for Interview Sidekick, a platform that helps with interview preparation.
    Your task is to analyze the incoming customer email and generate a professional, helpful response.
    
    Guidelines for responses:
    1. Be friendly and professional while maintaining a modern, approachable tone
    2. Address the customer's specific concerns directly and clearly
    3. Provide actionable solutions or clear next steps
    4. Use proper spacing with line breaks between paragraphs for better readability
    5. Keep responses concise but thorough
    6. Include a friendly greeting and sign-off
    7. Use 1-2 appropriate emojis where they add value (e.g., in greeting or sign-off)
    8. Format the response with clear spacing, for example:

    Hi [Name], 👋

    [First paragraph with main response]

    [Second paragraph with additional details if needed]

    [Final paragraph with next steps or invitation for further questions]

    Best regards,
    The Interview Sidekick Team ✨

    Note: Use HTML <br> tags for line breaks in the response.
    
    Also provide a confidence score (0-100) indicating how confident you are that this response fully addresses the user's question:
    - 100: Perfect response, covers everything clearly
    - 80-99: Very good response, covers most aspects well
    - 60-79: Adequate response but might need human review
    - Below 60: Complex issue, needs human attention
    
    Respond with ONLY a JSON object in this format (no other text):
    {
      "analysis": {
        "confidence": number,
        "sentiment": string,
        "keyPoints": string[]
      },
      "response": {
        "subject": string,
        "body": string
      }
    }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            email: {
              from: email,
              subject: "Customer Inquiry",
              body: emailContent
            }
          })
        }
      ],
      temperature: 0.7
    });

    if (!response.choices[0].message.content) {
      throw new Error('No response from OpenAI');
    }

    const result = JSON.parse(response.choices[0].message.content);
    
    // Determine if human response is needed based on confidence score
    const requiresHumanResponse = result.analysis.confidence < 80;
    const reason = requiresHumanResponse 
      ? "AI confidence below threshold - needs human review"
      : "";

    // Transform the response to match our expected format
    const transformedResult: EmailSimulationResult = {
      matches: [{
        faq: {
          id: 'ai-generated',
          question: 'AI Generated Response',
          replyTemplate: result.response.body,
          instructions: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          confidence: result.analysis.confidence,
          useCount: 0
        },
        confidence: result.analysis.confidence,
        suggestedReply: result.response.body
      }],
      requiresHumanResponse,
      reason,
      analysis: {
        sentiment: result.analysis.sentiment,
        keyPoints: result.analysis.keyPoints
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