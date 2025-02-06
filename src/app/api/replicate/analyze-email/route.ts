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
const LLAMA_MODEL = "meta/llama-2-70b-chat:02e509c789964a7ea8736978a43525956ef40397be9033abf9fd2badfe68c9e3";
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
  "isCustomer": boolean,    // true if from an actual/potential customer
  "confidence": number,    // between 0.0 and 0.95
  "reason": string,       // brief explanation
  "category": string,     // type of customer inquiry
  "priority": number,     // 1-3 (1=high, 2=medium, 3=low)
  "wasGenerated": boolean // true if automated/marketing email
}

Customer Identification (affects confidence score):
- High confidence (0.80-0.95): Clear customer inquiries, support requests, or feedback
- Medium confidence (0.50-0.79): Potential customers with questions or unclear requests
- Low confidence (0.0-0.49): Non-customer communications

Content Categories:
- product_support: Questions about features, how-to inquiries
- billing: Payment issues, subscription questions
- technical_support: Setup help, error reports
- access_issues: Login problems, account activation
- feature_request: Suggestions for improvement
- feedback: Product experience sharing
- other: Any other customer communication

Mark as customer email (isCustomer=true) if it contains:
- Questions/issues from users
- Requests for help
- Payment/billing issues
- Technical problems
- Account changes
- Product feedback
- Feature requests

NOT customer emails (should have low confidence and isCustomer=false):
- Security notifications
- Marketing outreach
- Partnership requests
- Spam or automated messages
- Internal communications
- Vendor outreach
- Job applications
- Newsletter subscriptions`;
}

// Helper function to create batched prompts
function createBatchPrompt(emails: any[]) {
  const emailPrompts = emails.map((email, index) => `
Email ${index + 1}:
Subject: ${email.subject}
From: ${email.from}
Body: ${email.body}
`).join('\n\n');

  return `You are analyzing emails received in a business/product's inbox. Your task is to identify emails from actual or potential customers who need assistance, have questions, or want to provide feedback. Be inclusive in your analysis - if there's any indication the email might be from a customer, classify it as such.

Context: These emails are received by a business/product team. We need to identify customer communications, erring on the side of including potential customer emails rather than excluding them.

Key Analysis Points:
1. Customer Identification (affects confidence score):
   - High confidence (0.80-0.95): Clear customer inquiries, support requests, or feedback
   - Medium confidence (0.50-0.79): Potential customers with questions or unclear requests
   - Low confidence (0.0-0.49): Clearly non-customer communications

2. Content Categories:
   - product_support: Questions about features, how-to inquiries
   - billing: Payment issues, subscription questions
   - technical_support: Setup help, error reports
   - access_issues: Login problems, account activation
   - feature_request: Suggestions for improvement
   - feedback: Product experience sharing
   - other: Any other customer communication

Mark as customer email (isCustomer=true) if it contains ANY of these:
- Questions or inquiries about the product/service
- Requests for help or information
- Payment/billing related messages
- Technical issues or problems
- Account-related messages
- Product feedback or suggestions
- Feature requests or suggestions
- General inquiries about functionality
- Messages indicating interest in the product
- Responses to previous support communications

ONLY mark as non-customer (isCustomer=false) if it is CLEARLY one of these:
- Automated system notifications
- Marketing emails from other companies
- Partnership/vendor outreach
- Clear spam messages
- Internal team communications
- Job applications
- Newsletter subscriptions from other companies

For each email, analyze and return a JSON object with these fields:
{
  "isCustomer": boolean,        // true if there's ANY indication of customer intent
  "confidence": number,         // 0.0-0.95 confidence score based on criteria above
  "reason": string,            // specific explanation for the classification
  "category": string,          // one of the categories listed above
  "priority": number,          // 1-3 (1=high, 2=medium, 3=low) based on urgency
  "wasGenerated": boolean      // true if automated/marketing email
}

Analyze these emails and respond with a JSON array containing an analysis object for each email in order.

${emailPrompts}`;
}

// Function to analyze emails using OpenAI
async function analyzeWithOpenAI(emails: any[]) {
  logDebug('analyzeWithOpenAI', { emailCount: emails.length });
  
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: "You are an expert at analyzing emails to determine if they are customer support requests. Be inclusive in your analysis - if there's any indication the email might be from a customer or potential customer, classify it as a customer email with appropriate confidence."
      },
      {
        role: "user",
        content: createBatchPrompt(emails)
      }
    ],
    temperature: 0.5,
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

    // Log analysis results for each email
    analysisResults.forEach((result, index) => {
      const email = emails[index];
      console.log(`\nEmail Analysis (OpenAI) - ${index + 1}/${emails.length}:`);
      console.log(`Subject: ${email.subject}`);
      console.log(`Classification: ${result.isCustomer ? 'CUSTOMER' : 'NON-CUSTOMER'}`);
      console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`Reason: ${result.reason}`);
      console.log(`Category: ${result.category}`);
      console.log('----------------------------------------');
    });

    return {
      results: analysisResults,
      usage: response.usage
    };
  } catch (error) {
    console.error("Failed to parse OpenAI response:", error);
    throw new Error("Failed to parse API response");
  }
}

// Function to analyze emails using Llama
async function analyzeWithLlama(emails: any[]) {
  logDebug('analyzeWithLlama', { emailCount: emails.length });
  
  const prompt = createBatchPrompt(emails);
  const promptTokens = estimateTokenCount(prompt);
  
  const response = await replicate.run(LLAMA_MODEL, {
    input: {
      prompt: prompt,
      temperature: 0.5,
      top_p: 0.95,
      max_tokens: 1000,
      repetition_penalty: 1
    }
  });

  if (!response || !Array.isArray(response)) {
    throw new Error("Invalid response from Llama API");
  }

  const responseText = response.join('');
  if (!responseText.trim()) {
    throw new Error("Empty response from Llama API");
  }

  try {
    const results = JSON.parse(responseText);
    // Ensure we handle both array and object responses
    const analysisResults = Array.isArray(results) ? results : results.results || results.analyses;
    if (!Array.isArray(analysisResults)) {
      throw new Error("Invalid response format from Llama API");
    }

    // Log analysis results for each email
    analysisResults.forEach((result, index) => {
      const email = emails[index];
      console.log(`\nEmail Analysis (Llama) - ${index + 1}/${emails.length}:`);
      console.log(`Subject: ${email.subject}`);
      console.log(`Classification: ${result.isCustomer ? 'CUSTOMER' : 'NON-CUSTOMER'}`);
      console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`Reason: ${result.reason}`);
      console.log(`Category: ${result.category}`);
      console.log('----------------------------------------');
    });

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
    console.error("Failed to parse Llama response:", error);
    throw new Error("Failed to parse API response");
  }
}

export async function POST(request: Request) {
  try {
    logDebug('start', { timestamp: new Date().toISOString() });
    
    const { emails, model } = await request.json();
    logDebug('request', { emailCount: emails?.length || 0, model });

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { error: 'No emails provided for analysis' },
        { status: 400 }
      );
    }

    // Process emails in batches
    const allResults = [];
    let totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      const batchResults = await (model === 'openai' 
        ? analyzeWithOpenAI(batch)
        : analyzeWithLlama(batch));
      
      // Add batch results to total results
      allResults.push(...batchResults.results);
      
      // Accumulate token usage
      if (batchResults.usage) {
        totalUsage.promptTokens += batchResults.usage.prompt_tokens || 0;
        totalUsage.completionTokens += batchResults.usage.completion_tokens || 0;
        totalUsage.totalTokens += batchResults.usage.total_tokens || 0;
      }
    }

    return NextResponse.json({
      results: allResults,
      usage: totalUsage,
      debug: debugLogs
    });
  } catch (error) {
    console.error('Error in analyze-email:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze emails' },
      { status: 500 }
    );
  }
} 