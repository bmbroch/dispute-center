import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { AIInsights, EmailData } from '@/types/analysis';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { emails } = await req.json();

    const prompt = `
      Analyze the following collection of customer emails and generate insights.
      Focus on identifying common questions, customer sentiment, and actionable recommendations.

      Emails:
      ${emails.map((email: EmailData) => `
        Subject: ${email.subject}
        From: ${email.from}
        Body: ${email.body}
        Classification: ${email.isSupport ? 'Support Request' : 'Not Support'}
        Confidence: ${email.confidence}
        Reason: ${email.reason}
      `).join('\n\n')}

      Respond in JSON format:
      {
        "keyPoints": string[],
        "keyCustomerPoints": string[],
        "commonQuestions": [
          {
            "question": string,
            "typicalAnswer": string,
            "frequency": number
          }
        ],
        "suggestedActions": string[],
        "recommendedActions": string[],
        "customerSentiment": {
          "overall": string,
          "details": string
        }
      }
    `;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at analyzing customer communications and generating actionable insights.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
    });

    const insights: AIInsights = JSON.parse(completion.choices[0].message.content || '{}');

    return NextResponse.json(insights);
  } catch (error) {
    console.error('Error generating insights:', error);
    return NextResponse.json(
      { error: 'Failed to generate insights' },
      { status: 500 }
    );
  }
} 