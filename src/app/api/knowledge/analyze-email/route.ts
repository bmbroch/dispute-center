import { NextResponse } from 'next/server';
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const MODEL_VERSION = "deepseek-ai/deepseek-coder-33b-instruct:0.3.0";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      return NextResponse.json({ 
        error: 'Unauthorized',
        reason: 'Missing authorization header'
      }, { status: 401 });
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      console.error('Replicate API token is not configured');
      return NextResponse.json({ 
        error: 'Replicate API token is not configured',
        reason: "Server configuration error"
      }, { status: 500 });
    }

    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json({ 
        error: 'Invalid request body',
        reason: 'Failed to parse JSON body'
      }, { status: 400 });
    }

    const { email } = body;

    if (!email || typeof email !== 'object') {
      console.error('Invalid email object:', email);
      return NextResponse.json({ 
        error: 'Invalid email format',
        reason: "Email must be an object"
      }, { status: 400 });
    }

    if (!email.subject && !email.body) {
      console.log('Email has no content to analyze');
      return NextResponse.json({ 
        error: 'Invalid email content',
        reason: "Email has no subject or body content to analyze"
      }, { status: 400 });
    }

    // Construct the prompt for analysis
    const systemPrompt = `You are an expert at identifying customer-related emails for Interview Sidekick, a product that helps with interview preparation.

    Consider an email customer-related if it matches ANY of these criteria:
    1. Questions or inquiries about the product or service
    2. Subscription-related emails (cancellations, changes, inquiries)
    3. Technical support requests
    4. Product feedback or feature requests
    5. Account-related questions
    6. Billing or payment inquiries
    7. General customer questions about interview preparation
    
    You must respond with ONLY a JSON object in this exact format (no other text):
    {
      "isSupport": boolean,
      "confidence": number between 0 and 1,
      "reason": string explanation
    }`;

    const emailContent = `Subject: ${email.subject || 'No Subject'}\n\nFrom: ${email.from || 'No Sender'}\n\nBody: ${email.body || 'No Body'}`;
    const prompt = `${systemPrompt}\n\nAnalyze this email:\n${emailContent}`;

    try {
      // Get token count for input
      const inputTokenCount = await replicate.run(
        MODEL_VERSION,
        {
          input: {
            prompt: prompt,
            max_tokens: 0,
          }
        }
      );

      // Run the actual analysis
      const output = await replicate.run(
        MODEL_VERSION,
        {
          input: {
            prompt: prompt,
            max_tokens: 2000,
            temperature: 0.1,
            top_p: 0.9,
            repetition_penalty: 1.1,
          }
        }
      );

      // Get token count for output
      const outputTokenCount = (output as string).split(' ').length * 1.3;

      // Parse the response
      const analysis = JSON.parse(output as string);

      return NextResponse.json({
        ...analysis,
        usage: {
          input_tokens: Number(inputTokenCount),
          output_tokens: Math.ceil(outputTokenCount),
          total_tokens: Number(inputTokenCount) + Math.ceil(outputTokenCount)
        }
      });

    } catch (error) {
      console.error('Error from Replicate API:', error);
      return NextResponse.json({ 
        isSupport: false, 
        confidence: 0, 
        reason: error instanceof Error ? error.message : "Error during analysis"
      });
    }
  } catch (error) {
    console.error('Error analyzing email:', error);
    return NextResponse.json({ 
      isSupport: false, 
      confidence: 0, 
      reason: error instanceof Error ? error.message : "Error during analysis" 
    });
  }
} 