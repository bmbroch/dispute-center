import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    console.log('Received text to analyze, length:', text.length);

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
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
      model: "gpt-4-turbo-preview",
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

    if (!parsedResponse.qas || !Array.isArray(parsedResponse.qas)) {
      console.error('Invalid response format from OpenAI:', parsedResponse);
      throw new Error('Invalid response format from OpenAI');
    }
    
    return NextResponse.json({
      qas: parsedResponse.qas
    });
  } catch (error) {
    console.error('Error generating Q&As:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate Q&As' },
      { status: 500 }
    );
  }
} 