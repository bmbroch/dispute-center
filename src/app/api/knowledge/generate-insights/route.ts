import { NextResponse } from 'next/server';
import OpenAI from 'openai';

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

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OpenAI API key is not configured' },
      { status: 500 }
    );
  }

  try {
    const { supportEmails, totalEmailsAnalyzed, tokenLimit = 20000 } = await req.json();

    if (!supportEmails || !Array.isArray(supportEmails)) {
      return NextResponse.json(
        { error: 'Invalid support emails data' },
        { status: 400 }
      );
    }

    // Prepare emails for analysis
    const emailsForAnalysis = supportEmails.map(email => ({
      subject: email.subject || email.messages?.[0]?.subject || 'No subject',
      body: email.body || email.messages?.map((m: { body: string }) => m.body).join('\n\n') || '', // Handle both direct body and messages array
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

    // Create a more detailed prompt that will generate insights similar to the example
    const prompt = `Analyze these ${supportEmails.length} customer support emails and provide comprehensive insights. 

Context: These are customer support emails that need detailed analysis for improving customer service.

Emails to analyze:
${JSON.stringify(emailsForAnalysis, null, 2)}

Return a detailed JSON response with the following structure:

{
  "keyCustomerPoints": [
    "Subscription and payment issues are prevalent, with customers expressing confusion over charges",
    "Technical difficulties related to service access and functionality",
    "Repeated follow-ups on unresolved queries",
    "Mixed sentiment on customer support interactions"
  ],
  "customerSentiment": {
    "overall": "A clear one-line summary of overall sentiment (e.g., 'Mixed, with a leaning towards negative due to unresolved issues')",
    "details": "A paragraph explaining key sentiment trends, customer satisfaction levels, and notable patterns in customer feedback"
  },
  "commonQuestions": [
    {
      "question": "How do I cancel my subscription and get a refund?",
      "typicalAnswer": "Clear step-by-step answer",
      "frequency": 5
    },
    {
      "question": "Why isn't my subscription showing as active after payment?",
      "typicalAnswer": "Clear explanation of the issue and resolution",
      "frequency": 4
    }
  ],
  "recommendedActions": [
    "Improve the clarity and accessibility of information regarding subscription management",
    "Enhance technical support and develop more detailed troubleshooting guides",
    "Invest in customer service training focused on empathy and responsiveness"
  ]
}

Focus on identifying:
1. Clear patterns in customer issues and questions
2. Specific areas of customer confusion or frustration
3. Actionable recommendations for improvement
4. Accurate frequency counts for common questions
5. Balanced sentiment analysis considering both positive and negative feedback`;

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
      model: "gpt-4-turbo-preview",
      response_format: { type: "json_object" },
      max_tokens: Math.min(Math.floor(tokenLimit / 2), 4000),
      temperature: 0.3 // Lower temperature for more consistent output
    });

    if (!completion.choices[0].message.content) {
      throw new Error('Empty response from OpenAI');
    }

    try {
      const insights = JSON.parse(completion.choices[0].message.content) as AIResponse;
      
      // Ensure all required fields exist with proper formatting
      return NextResponse.json({
        keyCustomerPoints: insights.keyCustomerPoints || [
          "No key points identified",
          "Analysis needs more data"
        ],
        customerSentiment: {
          overall: insights.customerSentiment?.overall || "Insufficient data for sentiment analysis",
          details: insights.customerSentiment?.details || "More data needed for detailed sentiment analysis"
        },
        commonQuestions: (insights.commonQuestions || []).map((q: CommonQuestion) => ({
          question: q.question,
          typicalAnswer: q.typicalAnswer,
          frequency: q.frequency || 1
        })),
        recommendedActions: insights.recommendedActions || [
          "Gather more customer feedback",
          "Implement systematic support tracking"
        ]
      });
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      throw new Error('Failed to parse AI response');
    }
  } catch (error) {
    console.error('Error generating insights:', error);
    return NextResponse.json(
      { error: 'Failed to generate insights' },
      { status: 500 }
    );
  }
} 