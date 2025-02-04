import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { EmailData } from '@/types/analysis';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { emails, model } = await req.json();

    const analyzedEmails: EmailData[] = [];
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for (const email of emails) {
      const prompt = `
        Analyze the following email and determine if it's a support request. 
        Also provide a confidence score (0-1) and reason for the classification.
        
        Subject: ${email.subject}
        From: ${email.from}
        Body: ${email.body}
        
        Respond in JSON format:
        {
          "isSupport": boolean,
          "confidence": number,
          "reason": string,
          "summary": {
            "subject": string,
            "content": string,
            "sentiment": string,
            "key_points": string[]
          }
        }
      `;

      const completion = await openai.chat.completions.create({
        model: model === 'gpt-4' ? 'gpt-4-turbo-preview' : 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing customer emails and determining if they are support requests.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
      });

      const result = JSON.parse(completion.choices[0].message.content || '{}');
      
      totalTokens += completion.usage?.total_tokens || 0;
      promptTokens += completion.usage?.prompt_tokens || 0;
      completionTokens += completion.usage?.completion_tokens || 0;

      analyzedEmails.push({
        ...email,
        isSupport: result.isSupport,
        confidence: result.confidence,
        reason: result.reason,
        summary: result.summary
      });
    }

    return NextResponse.json({
      emails: analyzedEmails,
      tokenUsage: {
        totalTokens,
        promptTokens,
        completionTokens
      }
    });
  } catch (error) {
    console.error('Error analyzing emails:', error);
    return NextResponse.json(
      { error: 'Failed to analyze emails' },
      { status: 500 }
    );
  }
} 