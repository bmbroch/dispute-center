import { OpenAI } from "openai";
import { StreamingTextResponse, OpenAIStream } from 'ai';

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      stream: true,
    });

    const stream = OpenAIStream(response);
    return new StreamingTextResponse(stream);
  } catch (error) {
    console.error('Error in chat:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process chat request' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
