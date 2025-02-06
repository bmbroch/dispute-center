import { NextResponse } from "next/server";
import OpenAI from 'openai';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Constants
const BATCH_SIZE = 5; // Process 5 threads at a time
const MAX_TOKENS_PER_EMAIL = 1000; // Maximum tokens per email
const MAX_TOKENS_PER_THREAD = 2000; // Maximum tokens per thread

function truncateEmailBody(body: string): string {
  // More conservative truncation to ensure we stay within limits
  const maxChars = MAX_TOKENS_PER_EMAIL * 3; // Using 3 chars per token to be safe
  if (body.length <= maxChars) return body;
  return body.slice(0, maxChars) + '... [truncated]';
}

function truncateThread(thread: any): any {
  const truncatedMessages = thread.messages.map((message: any) => ({
    ...message,
    body: truncateEmailBody(message.body)
  }));

  return {
    ...thread,
    messages: truncatedMessages
  };
}

async function analyzeBatch(threads: any[]) {
  console.log('\n=== Starting Batch Analysis ===');
  console.log('Input threads:', {
    count: threads.length,
    threadIds: threads.map(t => t.threadId),
    firstThreadSample: threads[0] ? {
      subject: threads[0].messages[0]?.subject,
      messageCount: threads[0].messages.length,
      preview: threads[0].messages[0]?.body?.substring(0, 100)
    } : null
  });

  const truncatedThreads = threads.map(truncateThread);

  // Prepare thread data with complete conversation context
  const threadData = truncatedThreads.map(t => {
    // First, get the thread-level metadata
    const threadMetadata = {
      subject: t.subject || t.rawHeaders?.subject || t.messages[0]?.subject,
      from: t.from || t.rawHeaders?.from || t.messages[0]?.from
    };

    console.log('Thread metadata:', {
      threadId: t.id || t.threadId,
      originalSubject: t.subject,
      originalFrom: t.from,
      rawHeadersSubject: t.rawHeaders?.subject,
      rawHeadersFrom: t.rawHeaders?.from,
      firstMessageSubject: t.messages[0]?.subject,
      firstMessageFrom: t.messages[0]?.from,
      finalSubject: threadMetadata.subject,
      finalFrom: threadMetadata.from
    });

    return {
      threadId: t.id || t.threadId,
      subject: threadMetadata.subject || 'No subject',
      from: threadMetadata.from || 'Unknown Sender',
      messageCount: t.messages.length,
      hasUserReply: t.hasUserReply,
      rawHeaders: {
        subject: t.rawHeaders?.subject || threadMetadata.subject,
        from: t.rawHeaders?.from || threadMetadata.from
      },
      conversation: t.messages.map((m: any, idx: number) => ({
        position: idx + 1,
        from: m.from || threadMetadata.from,
        subject: m.subject || threadMetadata.subject,
        body: m.body || '',
        date: m.date,
        rawHeaders: m.rawHeaders || {
          subject: m.subject || threadMetadata.subject,
          from: m.from || threadMetadata.from
        }
      }))
    };
  });

  // Log the constructed thread data
  console.log('Constructed thread data:', {
    threadCount: threadData.length,
    sample: threadData[0] ? {
      threadId: threadData[0].threadId,
      subject: threadData[0].subject,
      from: threadData[0].from,
      messageCount: threadData[0].messageCount,
      firstMessageSubject: threadData[0].conversation[0]?.subject,
      firstMessageFrom: threadData[0].conversation[0]?.from
    } : null
  });

  // Enhanced prompt for better thread analysis
  const prompt = `Analyze these email conversation threads. Each thread contains multiple messages that form a complete conversation.
  
  Thread Structure:
  - threadId: Unique identifier
  - subject: Original thread subject (from first message)
  - from: Original sender (from first message)
  - rawHeaders: Original email headers
  - messageCount: Number of messages
  - hasUserReply: Whether user has replied
  - conversation: Array of messages with position, from, subject, body, date

  Key Instructions:
  1. Use the thread-level subject and from fields as the primary source of thread metadata
  2. Only fall back to message-level data if thread-level is not available
  3. Analyze the ENTIRE conversation thread, not just individual messages
  4. Consider the context, tone, and progression of the conversation
  5. Pay attention to back-and-forth exchanges and user replies
  6. Look for indicators of customer issues, questions, or support needs across all messages

For each thread, return a JSON object with this structure:
{
  "isCustomer": boolean,         // true if ANY message in the thread indicates customer interaction
  "confidence": number,          // confidence score between 0.1 and 0.95
  "reason": string,             // explain why this thread is classified as customer/non-customer, citing specific messages
  "category": string,           // "support", "billing", "feature_request", "technical", "feedback", "other"
  "priority": number,           // 1 (high), 2 (medium), 3 (low)
  "summary": string,            // summary of the entire conversation thread
  "sentiment": string          // "positive", "neutral", "negative" based on overall conversation tone
}

Classification Guidelines:
Customer Threads (isCustomer: true):
- ANY message in thread asking for help/support
- Product or service related questions
- Bug reports or technical issues
- Feature requests or feedback
- Billing or account inquiries
- Pre-sales questions
- Post-purchase follow-up

Non-Customer Threads (isCustomer: false):
- Pure marketing/promotional content
- System notifications
- Internal team discussions
- Newsletters
- Job applications
- Spam

Priority Guidelines:
1 (High): 
- Service disruptions
- Urgent technical issues
- Billing problems
- Security concerns
- Data loss issues

2 (Medium):
- Feature requests
- Non-urgent technical questions
- Account configuration
- General product questions

3 (Low):
- Feature suggestions
- General feedback
- Documentation questions
- Newsletter responses

Analyze each thread as a complete conversation unit. Consider how the conversation evolves across messages.

Input data format for each thread:
{
  "threadId": string,
  "subject": string,
  "messageCount": number,
  "hasUserReply": boolean,
  "conversation": [
    {
      "position": number,
      "from": string,
      "body": string,
      "date": string
    }
  ]
}

Return a JSON array with one analysis object per thread.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-1106",
      messages: [
        {
          role: "system",
          content: "You are an expert email analyst specializing in customer support classification. You analyze entire conversation threads to identify customer interactions and support needs. Return an array of analyses, one per thread."
        },
        {
          role: "user",
          content: `${prompt}\n\nIMPORTANT: Return a JSON object with a 'threads' array containing one analysis object per thread. Example format:\n{
  "threads": [
    {
      "isCustomer": true,
      "confidence": 0.9,
      "reason": "...",
      "category": "support",
      "priority": 2,
      "summary": "...",
      "sentiment": "neutral"
    },
    // ... one object per thread
  ]
}`
        },
        {
          role: "user",
          content: JSON.stringify(threadData)
        }
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const analysisText = response.choices[0]?.message?.content;
    console.log('Raw OpenAI response:', analysisText?.substring(0, 200) + '...');
    
    if (!analysisText) {
      console.error('Empty response from OpenAI');
      return threads.map((thread, index) => createDefaultResult(thread, threadData[index]));
    }

    let parsed;
    try {
      parsed = JSON.parse(analysisText);
      
      // Ensure we have an array of analyses
      let results = parsed.threads;
      if (!results) {
        console.warn('No threads array in response, checking other formats');
        if (Array.isArray(parsed)) {
          results = parsed;
        } else if (parsed.results) {
          results = parsed.results;
        } else if (parsed.analysis) {
          results = parsed.analysis;
        } else {
          // If we got a single analysis object, convert it to an array
          const singleAnalysis: Record<string, any> = {
            isCustomer: parsed.isCustomer,
            confidence: parsed.confidence,
            reason: parsed.reason,
            category: parsed.category,
            priority: parsed.priority,
            summary: parsed.summary,
            sentiment: parsed.sentiment
          };
          if (Object.keys(singleAnalysis).some(k => singleAnalysis[k] !== undefined)) {
            results = threads.map(() => singleAnalysis);
          }
        }
      }

      if (!Array.isArray(results)) {
        console.error('Failed to get array of results:', results);
        return threads.map((thread, index) => createDefaultResult(thread, threadData[index]));
      }

      // Ensure we have the right number of results
      while (results.length < threads.length) {
        results.push({ ...results[results.length - 1] });
      }
      results = results.slice(0, threads.length);

      // Validate and normalize each result
      const normalizedResults = results.map((analysis: any, index: number) => {
        const thread = threads[index];
        const threadInfo = threadData[index];
        const messages = thread.messages || [];
        
        try {
          return {
            threadId: thread.id || thread.threadId,
            subject: thread.subject || thread.rawHeaders?.subject || messages[0]?.subject || 'No subject',
            from: thread.from || thread.rawHeaders?.from || messages[0]?.from || 'Unknown Sender',
            messages: messages.map((m: { body: string }) => m.body).join('\n\n'),
            hasUserReply: thread.hasUserReply,
            isCustomer: Boolean(analysis.isCustomer),
            confidence: Math.min(Math.max(Number(analysis.confidence) || 0.5, 0.1), 0.95),
            reason: String(analysis.reason || `Analysis based on ${messages.length} messages`),
            category: String(analysis.category || 'other').toLowerCase(),
            priority: Number(analysis.priority) || 2,
            summary: String(analysis.summary || thread.subject || messages[0]?.subject || 'No subject'),
            sentiment: String(analysis.sentiment || 'neutral').toLowerCase(),
            body: messages.map((m: { body: string }) => m.body).join('\n\n'),
            rawHeaders: thread.rawHeaders || {
              subject: messages[0]?.subject,
              from: messages[0]?.from
            }
          };
        } catch (err) {
          console.error(`Error normalizing result ${index}:`, err);
          return createDefaultResult(thread, threadInfo);
        }
      });

      console.log('Batch analysis complete:', {
        inputThreads: threads.length,
        outputResults: normalizedResults.length,
        customersFound: normalizedResults.filter((r: { isCustomer: boolean }) => r.isCustomer).length,
        sample: {
          threadId: normalizedResults[0]?.threadId,
          messageCount: normalizedResults[0]?.messages?.length,
          isCustomer: normalizedResults[0]?.isCustomer,
          category: normalizedResults[0]?.category,
          sentiment: normalizedResults[0]?.sentiment
        }
      });

      return normalizedResults;

    } catch (error) {
      console.error('Failed to parse OpenAI response:', error);
      return threads.map((thread, index) => createDefaultResult(thread, threadData[index]));
    }

  } catch (error) {
    console.error('Error in analyzeBatch:', error);
    return threads.map((thread, index) => createDefaultResult(thread, threadData[index]));
  }
}

// Helper function to create a default result
function createDefaultResult(thread: any, threadData: any) {
  return {
    threadId: thread.id || thread.threadId,
    subject: thread.subject || thread.rawHeaders?.subject || thread.messages?.[0]?.subject || 'No subject',
    from: thread.from || thread.rawHeaders?.from || thread.messages?.[0]?.from || 'Unknown Sender',
    messages: thread.messages,
    hasUserReply: thread.hasUserReply,
    isCustomer: thread.hasUserReply,
    confidence: 0.3,
    reason: `Default classification based on ${threadData.messageCount} messages`,
    category: "other",
    priority: 2,
    summary: thread.subject || thread.rawHeaders?.subject || thread.messages?.[0]?.subject || 'No subject',
    sentiment: "neutral",
    rawHeaders: thread.rawHeaders || {
      subject: thread.messages?.[0]?.subject,
      from: thread.messages?.[0]?.from
    }
  };
}

export async function POST(req: Request) {
  console.log('\n=== Starting Email Analysis ===');
  try {
    const { threads } = await req.json();
    
    // Log detailed thread structure
    console.log('\nReceived Threads Structure:', JSON.stringify({
      threadCount: threads?.length,
      sampleThread: threads?.[0] ? {
        threadId: threads[0].threadId,
        messageCount: threads[0].messages?.length,
        hasUserReply: threads[0].hasUserReply,
        firstMessage: threads[0].messages?.[0] ? {
          subject: threads[0].messages[0].subject,
          from: threads[0].messages[0].from,
          bodyPreview: threads[0].messages[0].body?.substring(0, 100) + '...',
          date: threads[0].messages[0].date
        } : null
      } : null
    }, null, 2));

    if (!threads || !Array.isArray(threads) || threads.length === 0) {
      console.error('Invalid or empty threads array received');
      return NextResponse.json(
        { error: 'Invalid request: non-empty threads array is required' },
        { status: 400 }
      );
    }

    const results = [];
    let totalTokensUsed = 0;
    const totalBatches = Math.ceil(threads.length / BATCH_SIZE);
    let failedBatches = 0;

    // Process threads in batches
    for (let i = 0; i < threads.length; i += BATCH_SIZE) {
      const batch = threads.slice(i, i + BATCH_SIZE);
      const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
      
      try {
        console.log(`Processing batch ${currentBatch} of ${totalBatches}`, {
          batchSize: batch.length,
          startIndex: i,
          endIndex: i + batch.length
        });

        const batchResults = await analyzeBatch(batch);
        
        if (batchResults && batchResults.length > 0) {
          results.push(...batchResults);
        } else {
          console.warn(`No results from batch ${currentBatch}, using defaults`);
          const defaultResults = batch.map((thread, index) => createDefaultResult(thread, {
            subject: thread.messages[0].subject,
            messageCount: thread.messages.length
          }));
          results.push(...defaultResults);
          failedBatches++;
        }

        // Calculate progress
        const progress = {
          currentEmail: i + batch.length,
          totalEmails: threads.length,
          currentBatch,
          totalBatches,
          percentComplete: Math.round(((i + batch.length) / threads.length) * 100)
        };

        console.log('Batch complete:', {
          batchNumber: currentBatch,
          resultsCount: batchResults?.length || 0,
          progress
        });

      } catch (error) {
        console.error(`Error processing batch ${currentBatch}:`, error);
        failedBatches++;
        
        const defaultResults = batch.map(thread => createDefaultResult(thread, {
          subject: thread.messages[0].subject,
          messageCount: thread.messages.length
        }));
        results.push(...defaultResults);
      }
    }

    // Even if some batches failed, return what we have
    console.log('Analysis complete:', {
      totalThreads: threads.length,
      analyzedThreads: results.length,
      customersFound: results.filter(r => r.isCustomer).length,
      failedBatches
    });

    return NextResponse.json({
      results,
      usage: {
        total_tokens: totalTokensUsed,
        failed_batches: failedBatches
      },
      model: "gpt-3.5-turbo-1106",
      progress: {
        currentEmail: threads.length,
        totalEmails: threads.length,
        currentBatch: totalBatches,
        totalBatches,
        percentComplete: 100
      }
    });

  } catch (error) {
    console.error('Fatal error in analyze-email:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to analyze emails',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
} 