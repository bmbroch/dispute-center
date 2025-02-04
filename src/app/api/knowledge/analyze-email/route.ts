import { NextResponse } from 'next/server';
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MODEL_VERSION = "deepseek-ai/deepseek-coder-33b-instruct:0.3.0";

export async function POST(req: Request) {
  try {
    const { emails } = await req.json();
    
    // Validate input
    if (!Array.isArray(emails)) {
      return new Response(JSON.stringify({ error: 'Invalid input: emails must be an array' }), {
        status: 400,
      });
    }

    // Process each email
    const results = await Promise.all(emails.map(async (email) => {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          // ... request config
        });

        const data = await response.json();
        
        // Ensure we have a string response and convert it safely
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('Invalid response format from OpenAI');
        }

        // Parse the response
        const result = JSON.parse(content);
        
        return {
          isSupport: result.isSupport,
          confidence: result.confidence,
          reason: result.reason,
          wasGenerated: false
        };
      } catch (error) {
        console.error('Error processing email:', error);
        return {
          error: 'Failed to process email',
          isSupport: false,
          confidence: 0,
          reason: 'Error during analysis'
        };
      }
    }));

    return new Response(JSON.stringify({ results }), {
      status: 200,
    });
  } catch (error) {
    console.error('Error in analyze-email route:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
    });
  }
} 