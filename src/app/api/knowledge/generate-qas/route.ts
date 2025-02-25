import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { saveAIApiLog } from '@/lib/firebase/aiLogging';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = 'gpt-4o-mini' as const;

export async function POST(req: Request) {
  try {
    const { text, userEmail } = await req.json();
    console.log('Received text to analyze, length:', text.length);

    if (!text) {
      throw new Error('Text is required');
    }

    const prompt = `Given the following text, generate a list of relevant questions and answers that would be useful for a FAQ system. Focus on the most important and frequently asked questions that might arise from this content. Format your response as a JSON object with a 'qas' field containing an array of objects, each with 'question' and 'answer' fields.

Example format:
{
  "qas": [
    {
      "question": "What is...",
      "answer": "The answer is..."
    }
  ]
}

Text:
${text}

Generate clear, concise questions and detailed, helpful answers. Each answer should be self-contained and comprehensive.`;

    console.log('Sending request to OpenAI...');
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that generates high-quality questions and answers from provided text. Focus on creating practical, useful Q&As that would be valuable in a FAQ system."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const response = completion.choices[0].message.content;
    console.log('Received response from OpenAI:', response);

    if (!response) {
      throw new Error('No response from OpenAI');
    }

    const parsedResponse = JSON.parse(response);
    console.log('Parsed response:', parsedResponse);

    // Log the successful API call
    await saveAIApiLog({
      username: userEmail || 'unknown',
      functionName: 'generate-qas',
      inputTokens: completion.usage?.prompt_tokens || 0,
      outputTokens: completion.usage?.completion_tokens || 0,
      status: 'success',
      model: MODEL,
    });

    return NextResponse.json({
      qas: parsedResponse.qas,
      usage: completion.usage
    });

  } catch (error) {
    console.error('Error generating Q&As:', error);

    // Log the failed API call
    if (error instanceof Error) {
      try {
        const { userEmail } = await req.json();
        await saveAIApiLog({
          username: userEmail || 'unknown',
          functionName: 'generate-qas',
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
      { error: 'Failed to generate Q&As' },
      { status: 500 }
    );
  }
}
