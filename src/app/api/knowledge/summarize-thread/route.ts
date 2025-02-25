import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { saveAIApiLog } from '@/lib/firebase/aiLogging';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

const MODEL = 'gpt-4o-mini' as const;

export async function POST(req: Request) {
  try {
    if (!openai.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const { email, userEmail } = await req.json();

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
      model: MODEL,
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

    // Log the successful API call
    await saveAIApiLog({
      username: userEmail || 'unknown',
      functionName: 'summarize-thread',
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      status: 'success',
      model: MODEL,
    });

    return NextResponse.json({
      ...summary,
      usage: response.usage
    });

  } catch (error) {
    console.error('Error summarizing thread:', error);

    // Log the failed API call
    if (error instanceof Error) {
      try {
        const { userEmail } = await req.json();
        await saveAIApiLog({
          username: userEmail || 'unknown',
          functionName: 'summarize-thread',
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
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}
