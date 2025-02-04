import { NextResponse } from "next/server";
import OpenAI from 'openai';
import Replicate from "replicate";

// Initialize APIs
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
});

// Constants
const DEEPSEEK_MODEL = "meta/llama-2-70b-chat:02e509c789964a7ea8736978a43525956ef40397be9033abf9fd2badfe68c9e3";
const BATCH_SIZE = 5; // Process 5 emails at a time

// Add token validation
if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "The OPENAI_API_KEY environment variable is not set. See README.md for instructions on how to set it."
  );
}

// Constants
const MAX_INPUT_TOKENS = 4096;
const AVERAGE_CHARS_PER_TOKEN = 4;

interface ReplicateResponse {
  completed_at: string;
  created_at: string;
  error: string | null;
  id: string;
  input: {
    prompt: string;
    [key: string]: any;
  };
  logs: string;
  metrics: {
    predict_time: number;
    total_time: number;
  };
  output: string[];
  started_at: string;
  status: string;
  urls: {
    get: string;
    cancel: string;
  };
  version: string;
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / AVERAGE_CHARS_PER_TOKEN);
}

// Function to strip HTML and clean text
function cleanText(text: string): string {
  if (!text) return '';
  
  // Remove email thread markers and quoted text
  const cleanedText = text
    // Remove forwarded/replied markers
    .replace(/^-{3,}.*?-{3,}/gm, '')
    .replace(/^>+.*$/gm, '')
    // Remove email headers in threads
    .replace(/^On.*wrote:$/gm, '')
    .replace(/^From:.*$/gm, '')
    .replace(/^Sent:.*$/gm, '')
    .replace(/^To:.*$/gm, '')
    .replace(/^Subject:.*$/gm, '')
    .replace(/^Date:.*$/gm, '')
    // Remove HTML
    .replace(/<[^>]*>/g, '')
    // Replace HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // Remove multiple empty lines
    .replace(/\n{3,}/g, '\n\n')
    // Remove lines with just whitespace
    .replace(/^\s*[\r\n]/gm, '')
    .trim();

  // Get only the first message in the thread (usually the most recent)
  const messages = cleanedText.split(/\n{2,}On .+wrote:\n/);
  return messages[0].trim();
}

// Add after the cleanText function
function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// Add debug logging utilities
const DEBUG = true; // Enable debug mode

interface DebugLog {
  timestamp: string;
  stage: string;
  data: any;
}

let debugLogs: DebugLog[] = [];

function logDebug(stage: string, data: any) {
  if (DEBUG) {
    const log = {
      timestamp: new Date().toISOString(),
      stage,
      data
    };
    debugLogs.push(log);
    console.log(`[DEBUG] ${stage}:`, data);
  }
}

// Update the prompt to be more concise
function createAnalysisPrompt(email: any): string {
  return `Analyze this email and respond with ONLY a JSON object:

Email Subject: ${email.subject}
From: ${email.from}
Body: ${email.body}

Required JSON format:
{
  "isSupport": boolean,    // true if customer needs help
  "confidence": number,    // between 0.0 and 1.0
  "reason": string        // brief explanation
}

Mark as support if it contains:
- Questions/issues
- Requests for help
- Payment/billing issues
- Technical problems
- Account changes`;
}

// Helper function to create batched prompts
function createBatchPrompt(emails: any[]) {
  const emailPrompts = emails.map((email, index) => `
Email ${index + 1}:
Subject: ${email.subject}
From: ${email.from}
Body: ${email.body}
`).join('\n\n');

  return `Analyze the following emails and determine if each one is a customer support request. For each email, provide a JSON response with:
- isSupport (boolean): true if it's a support request
- confidence (number between 0-1): how confident you are in the classification
- reason (string): brief explanation for the classification
- wasGenerated (boolean): true if the email appears to be AI-generated

Analyze these ${emails.length} emails:

${emailPrompts}

Respond with a JSON array containing an analysis object for each email in order. Example:
[
  {
    "isSupport": true,
    "confidence": 0.95,
    "reason": "User reporting specific technical issue with login",
    "wasGenerated": false
  },
  ...
]`;
}

// Function to analyze emails using OpenAI
async function analyzeWithOpenAI(emails: any[]) {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: "You are an expert at analyzing emails to determine if they are customer support requests."
      },
      {
        role: "user",
        content: createBatchPrompt(emails)
      }
    ],
    temperature: 0.3,
    max_tokens: 1000,
    top_p: 0.95,
    frequency_penalty: 0,
    presence_penalty: 0
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI API");
  }

  try {
    const results = JSON.parse(content);
    // Ensure we handle both array and object responses
    const analysisResults = Array.isArray(results) ? results : results.results || results.analyses;
    if (!Array.isArray(analysisResults)) {
      throw new Error("Invalid response format from OpenAI API");
    }
    return {
      results: analysisResults,
      usage: response.usage
    };
  } catch (error) {
    console.error("Failed to parse OpenAI response:", error);
    throw new Error("Failed to parse API response");
  }
}

// Function to analyze emails using Deepseek
async function analyzeWithDeepseek(emails: any[]) {
  const prompt = createBatchPrompt(emails);
  const promptTokens = estimateTokenCount(prompt);
  
  const response = await replicate.run(DEEPSEEK_MODEL, {
    input: {
      prompt: prompt,
      temperature: 0.3,
      top_p: 0.95,
      max_tokens: 1000,
      repetition_penalty: 1
    }
  });

  if (!response || !Array.isArray(response)) {
    throw new Error("Invalid response from Deepseek API");
  }

  const responseText = response.join('');
  if (!responseText.trim()) {
    throw new Error("Empty response from Deepseek API");
  }

  try {
    const results = JSON.parse(responseText);
    // Ensure we handle both array and object responses
    const analysisResults = Array.isArray(results) ? results : results.results || results.analyses;
    if (!Array.isArray(analysisResults)) {
      throw new Error("Invalid response format from Deepseek API");
    }

    // Estimate completion tokens
    const completionTokens = estimateTokenCount(responseText);
    
    return {
      results: analysisResults,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    };
  } catch (error) {
    console.error("Failed to parse Deepseek response:", error);
    throw new Error("Failed to parse API response");
  }
}

export async function POST(req: Request) {
  debugLogs = [];
  
  try {
    const { emails, model = 'openai' } = await req.json();

    if (!emails || !Array.isArray(emails)) {
      return NextResponse.json(
        { error: 'Invalid request: emails array is required' },
        { status: 400 }
      );
    }

    if (model === 'openai' && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    if (model === 'deepseek' && !process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json(
        { error: 'Replicate API token not configured' },
        { status: 500 }
      );
    }

    // Process emails in batches
    const results = [];
    const usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      
      try {
        const batchResults = model === 'openai' 
          ? await analyzeWithOpenAI(batch)
          : await analyzeWithDeepseek(batch);

        results.push(...batchResults.results);

        // Accumulate token usage for both models
        if (batchResults.usage) {
          usage.prompt_tokens += batchResults.usage.prompt_tokens || 0;
          usage.completion_tokens += batchResults.usage.completion_tokens || 0;
          usage.total_tokens += batchResults.usage.total_tokens || 0;
        }
      } catch (error) {
        console.error(`Error processing batch ${i / BATCH_SIZE + 1}:`, error);
        results.push(...batch.map(() => ({
          isSupport: false,
          confidence: 0,
          reason: "Failed to analyze email",
          wasGenerated: false
        })));
      }
    }

    return NextResponse.json({
      results,
      usage // Now includes token counts for both OpenAI and Deepseek
    });

  } catch (error) {
    console.error('Error in analyze-email API:', error);
    return NextResponse.json(
      { error: 'Failed to analyze emails' },
      { status: 500 }
    );
  }
} 