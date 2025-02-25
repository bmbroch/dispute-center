import { NextResponse } from 'next/server';
import { StreamingTextResponse } from 'ai';
import OpenAI from 'openai';
import { saveAIApiLog } from '@/lib/firebase/aiLogging';

const MODEL = 'gpt-4o-mini' as const;

export async function POST(req: Request) {
  try {
    const { messages, userEmail } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    const openai = new OpenAI();
    const encoder = new TextEncoder();

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages,
        stream: true,
        temperature: 0.7,
      });

      const transformStream = new TransformStream();
      const writer = transformStream.writable.getWriter();

      // Process each chunk
      let totalCompletionTokens = 0;
      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          totalCompletionTokens += Math.ceil(content.length / 4);
          await writer.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
        }
      }

      // Log after stream completes
      try {
        await saveAIApiLog({
          username: userEmail || 'unknown',
          functionName: 'chat',
          inputTokens: messages.reduce((acc: number, msg: any) => acc + Math.ceil(msg.content.length / 4), 0),
          outputTokens: totalCompletionTokens,
          status: 'success',
          model: 'gpt-4-turbo-preview',
        });
      } catch (logError) {
        console.error('Error logging streaming chat:', logError);
      }

      writer.close();
      return new StreamingTextResponse(transformStream.readable);

    } catch (error) {
      console.error('Error in chat completion:', error);
      return NextResponse.json(
        { error: 'Failed to generate response' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'Invalid request format' },
      { status: 400 }
    );
  }
}
