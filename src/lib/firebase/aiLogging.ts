import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from './firebaseAdmin';

// Initialize Firebase Admin
initializeFirebaseAdmin();
const db = getFirestore();

// Constants for OpenAI model pricing (per 1K tokens)
const MODEL_PRICING = {
  'gpt-4': {
    input: 0.03,    // $0.03 per 1K input tokens
    output: 0.06    // $0.06 per 1K output tokens
  },
  'gpt-3.5-turbo': {
    input: 0.0015,  // $0.0015 per 1K input tokens
    output: 0.002   // $0.002 per 1K output tokens
  },
  'gpt-4-turbo-preview': {
    input: 0.01,    // $0.01 per 1K input tokens
    output: 0.03    // $0.03 per 1K output tokens
  },
  'gpt-4o-mini': {
    input: 0.01,    // $0.01 per 1K input tokens
    output: 0.03    // $0.03 per 1K output tokens
  }
} as const;

// Type for the model names
export type OpenAIModel = 'gpt-4' | 'gpt-3.5-turbo' | 'gpt-4-turbo-preview' | 'gpt-4o-mini';

// Interface for the log entry
export interface AIApiLog {
  username: string;          // User's email
  functionName: string;      // Name of the API function called
  timestamp: Date;          // When the call was made
  inputTokens: number;      // Number of prompt tokens
  outputTokens: number;     // Number of completion tokens
  totalTokens: number;      // Total tokens used
  status: 'success' | 'failed'; // Whether the call succeeded or failed
  error?: string;           // Error message if failed
  model: OpenAIModel;       // The OpenAI model used
  cost: number;             // Calculated cost based on model and tokens
}

/**
 * Calculate the cost of an API call based on the model and token usage
 */
function calculateCost(model: OpenAIModel, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Save an AI API log entry to Firebase
 */
export async function saveAIApiLog({
  username,
  functionName,
  inputTokens,
  outputTokens,
  status,
  model,
  error
}: {
  username: string;
  functionName: string;
  inputTokens: number;
  outputTokens: number;
  status: 'success' | 'failed';
  model: OpenAIModel;
  error?: string;
}): Promise<void> {
  try {
    const timestamp = new Date();
    const totalTokens = inputTokens + outputTokens;
    const cost = calculateCost(model, inputTokens, outputTokens);

    const logEntry: AIApiLog = {
      username,
      functionName,
      timestamp,
      inputTokens,
      outputTokens,
      totalTokens,
      status,
      model,
      cost,
      ...(error && { error })
    };

    // Save to both collections for different viewing purposes
    await Promise.all([
      // Save to ai_api_logs for detailed logging
      db.collection('ai_api_logs').add(logEntry),

      // Save to ai-spend for cost tracking
      db.collection('ai-spend').add(logEntry)
    ]);

    console.log(`AI API log saved successfully for ${functionName}`);
  } catch (error) {
    console.error('Error saving AI API log:', error);
    // Don't throw the error - we don't want logging failures to break the main functionality
  }
}

/**
 * Helper function to create a log entry for failed API calls
 */
export async function logFailedAPICall({
  username,
  functionName,
  model,
  error
}: {
  username: string;
  functionName: string;
  model: OpenAIModel;
  error: string;
}): Promise<void> {
  await saveAIApiLog({
    username,
    functionName,
    inputTokens: 0,  // We don't have token info for failed calls
    outputTokens: 0,
    status: 'failed',
    model,
    error
  });
}
