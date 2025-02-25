import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { saveAIApiLog } from '@/lib/firebase/aiLogging';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = 'gpt-4o-mini' as const;

export async function POST(req: Request) {
  try {
    if (!openai.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    const { email, matchedFAQs, userEmail } = await req.json();

    if (!email || !matchedFAQs) {
      throw new Error('Email and matched FAQs are required');
    }

    const prompt = `Generate an email reply based on the following:

Original Email:
Subject: ${email.subject}
Content: ${email.content}

Matched FAQs:
${matchedFAQs.map((faq: any) => `Q: ${faq.question}
A: ${faq.answer}
Confidence: ${faq.confidence}
`).join('\n')}

Instructions:
1. Write a professional and empathetic response
2. Address all questions from the original email
3. Use the matched FAQ answers as reference
4. Keep the tone helpful and friendly
5. Format with appropriate paragraphs and spacing`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an experienced customer support agent who writes clear, helpful, and empathetic responses.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    const reply = response.choices[0]?.message?.content;

    if (!reply) {
      throw new Error('Failed to generate auto-reply');
    }

    // Log the successful API call
    await saveAIApiLog({
      username: userEmail || 'unknown',
      functionName: 'auto-reply',
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      status: 'success',
      model: MODEL,
    });

    return NextResponse.json({
      reply,
      usage: response.usage
    });

  } catch (error) {
    console.error('Error generating auto-reply:', error);

    // Log the failed API call
    if (error instanceof Error) {
      try {
        const { userEmail } = await req.json();
        await saveAIApiLog({
          username: userEmail || 'unknown',
          functionName: 'auto-reply',
          inputTokens: 0,
          outputTokens: 0,
          status: 'failed',
          model: MODEL,
          error: error.message
        });
      } catch (logError) {
        console.error('Error logging API failure:', logError);
      }
    }

    return NextResponse.json(
      { error: 'Failed to generate auto-reply' },
      { status: 500 }
    );
  }
}
