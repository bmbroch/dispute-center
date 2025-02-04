import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const { email } = await req.json();

    const systemPrompt = `You are an expert at analyzing customer support emails for Interview Sidekick, a product that helps with interview preparation.
    Analyze the email thread and provide a structured summary with the following information:
    1. Key points (3-5 bullet points)
    2. Customer sentiment (positive, neutral, or negative with brief explanation)
    3. Category (e.g., "Subscription Issue", "Technical Support", "Product Feedback", etc.)
    4. Action items (if any)

    Respond with ONLY a JSON object in this format (no other text):
    {
      "key_points": string[],
      "customer_sentiment": string,
      "category": string,
      "action_items": string[]
    }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: `Subject: ${email.subject || 'No Subject'}\n\nFrom: ${email.from || 'No Sender'}\n\nBody: ${email.body || 'No Body'}`
        }
      ],
      temperature: 0.1
    });

    if (!response.choices[0].message.content) {
      throw new Error('No response from OpenAI');
    }

    const summary = JSON.parse(response.choices[0].message.content);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error summarizing thread:', error);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
} 