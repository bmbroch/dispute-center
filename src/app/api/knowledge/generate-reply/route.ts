import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { saveAIApiLog } from '@/lib/firebase/aiLogging';

const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
});

const MODEL = 'gpt-4o-mini' as const;

export async function POST(req: Request) {
  try {
    if (!openai.apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key is not configured' },
        { status: 500 }
      );
    }

    const { emailId, subject, content, matchedFAQ, questions, answeredFAQs, userEmail } = await req.json();

    // Create a comprehensive prompt for the AI
    const prompt = `You are a helpful customer support agent. Generate a professional and empathetic email reply.

Context:
- Original Email Subject: "${subject}"
- Original Email Content: "${content}"
- Main Question Matched: "${matchedFAQ.question}"
- Answer to Main Question: "${matchedFAQ.answer}"
${questions.length > 0 ? `- Other Questions from Email: ${questions.map((q: { question: string }) => `"${q.question}"`).join(', ')}` : ''}
${answeredFAQs.length > 0 ? `- Related FAQ Answers: ${answeredFAQs.map((faq: { question: string, answer: string }) => `Q: "${faq.question}" A: "${faq.answer}"`).join(' | ')}` : ''}

Instructions:
1. Start with a polite greeting using the sender's name
2. Acknowledge their specific concern/question
3. Provide a clear, comprehensive answer that incorporates all relevant FAQ information
4. Add any necessary context or related information from other matched FAQs
5. End with a professional closing
6. Keep the tone helpful, professional, and empathetic
7. Format the response with appropriate spacing and paragraphs

Generate the email reply:`;

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
      throw new Error('Failed to generate reply');
    }

    // Log the API usage
    await saveAIApiLog({
      username: userEmail || 'unknown',
      functionName: 'generate-reply',
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
    console.error('Error generating reply:', error);

    // Log the failed API call
    if (error instanceof Error) {
      try {
        const { userEmail } = await req.json();
        await saveAIApiLog({
          username: userEmail || 'unknown',
          functionName: 'generate-reply',
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
      { error: 'Failed to generate reply' },
      { status: 500 }
    );
  }
}
