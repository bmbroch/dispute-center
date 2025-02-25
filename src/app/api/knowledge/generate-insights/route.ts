import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { saveAIApiLog } from '@/lib/firebase/aiLogging';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Add interface for the common question structure
interface CommonQuestion {
  question: string;
  typicalAnswer: string;
  frequency: number;
}

interface AIResponse {
  keyCustomerPoints: string[];
  customerSentiment: {
    overall: string;
    details: string;
  };
  commonQuestions: CommonQuestion[];
  recommendedActions: string[];
}

const MODEL = 'gpt-4o-mini' as const;

export async function POST(req: Request) {
  try {
    if (!openai.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    const { supportEmails, totalEmailsAnalyzed, tokenLimit = 20000, userEmail } = await req.json();

    if (!supportEmails || !Array.isArray(supportEmails)) {
      throw new Error('Invalid support emails data');
    }

    // Prepare emails for analysis
    const emailsForAnalysis = supportEmails.map(email => ({
      subject: email.subject || email.messages?.[0]?.subject || 'No subject',
      body: email.body || email.messages?.map((m: { body: string }) => m.body).join('\n\n') || '',
      category: email.category || 'uncategorized',
      priority: email.priority || 2,
      confidence: email.confidence || 0.7,
      sentiment: email.sentiment || 'neutral'
    }));

    // Truncate bodies to avoid token limits
    emailsForAnalysis.forEach(email => {
      if (email.body && email.body.length > 1000) {
        email.body = email.body.substring(0, 1000) + '... [truncated]';
      }
    });

    const prompt = `Analyze the following customer support emails and provide insights. Total emails analyzed: ${totalEmailsAnalyzed}

Email Data:
${JSON.stringify(emailsForAnalysis, null, 2)}

Provide insights in the following JSON format:
{
  "keyCustomerPoints": ["point1", "point2", ...],
  "customerSentiment": {
    "overall": "positive/neutral/negative",
    "details": "explanation"
  },
  "commonQuestions": [
    {
      "question": "What is...",
      "typicalAnswer": "The answer is...",
      "frequency": 3
    }
  ],
  "recommendedActions": ["action1", "action2", ...]
}`;

    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an expert customer support analyst. Provide detailed, actionable insights that match the exact format requested. Ensure all insights are specific and backed by the email data."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: MODEL,
      response_format: { type: "json_object" },
      max_tokens: Math.min(Math.floor(tokenLimit / 2), 4000),
      temperature: 0.3
    });

    if (!completion.choices[0].message.content) {
      throw new Error('Empty response from OpenAI');
    }

    const insights = JSON.parse(completion.choices[0].message.content);

    // Log the successful API call
    await saveAIApiLog({
      username: userEmail || 'unknown',
      functionName: 'generate-insights',
      inputTokens: completion.usage?.prompt_tokens || 0,
      outputTokens: completion.usage?.completion_tokens || 0,
      status: 'success',
      model: MODEL,
    });

    return NextResponse.json({
      keyCustomerPoints: insights.keyCustomerPoints || [
        "No key points identified",
        "Analysis needs more data"
      ],
      customerSentiment: {
        overall: insights.customerSentiment?.overall || "Insufficient data for sentiment analysis",
        details: insights.customerSentiment?.details || "More data needed for detailed sentiment analysis"
      },
      commonQuestions: (insights.commonQuestions || []).map((q: any) => ({
        question: q.question,
        typicalAnswer: q.typicalAnswer,
        frequency: q.frequency || 1
      })),
      recommendedActions: insights.recommendedActions || [
        "Gather more customer feedback",
        "Implement systematic support tracking"
      ],
      usage: completion.usage
    });

  } catch (error) {
    console.error('Error generating insights:', error);

    // Log the failed API call
    if (error instanceof Error) {
      try {
        const { userEmail } = await req.json();
        await saveAIApiLog({
          username: userEmail || 'unknown',
          functionName: 'generate-insights',
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
      { error: 'Failed to generate insights' },
      { status: 500 }
    );
  }
}
