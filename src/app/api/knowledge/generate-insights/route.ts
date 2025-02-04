import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    // Prepare the email data for analysis, being more concise
    const emailsForAnalysis = supportEmails.map(email => ({
      subject: email.subject,
      body: email.body.substring(0, 1000), // Limit body length to control tokens
      key_points: email.analysis.reason // Include the initial analysis
    }));

    // Create a more focused prompt
    const prompt = `Analyze these ${supportEmails.length} customer support emails from Interview Sidekick and provide key insights. Focus on identifying patterns and actionable insights.

Context: These are customer support emails that have been pre-filtered with 75%+ confidence of being support-related.

Emails to analyze:
${JSON.stringify(emailsForAnalysis, null, 2)}

Return a focused JSON response with:
{
  "keyCustomerPoints": [3-5 main issues/patterns],
  "customerSentiment": {
    "overall": "brief summary",
    "details": "key trends"
  },
  "commonQuestions": [
    {
      "question": "common question",
      "typicalAnswer": "brief answer",
      "frequency": number
    }
  ],
  "recommendedActions": [2-3 most important actions]
}`;

    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a concise business analyst. Provide clear, actionable insights focusing on the most important patterns and issues."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "gpt-4-turbo-preview",
      response_format: { type: "json_object" },
      max_tokens: Math.min(Math.floor(tokenLimit / 2), 4000), // Use at most half of remaining token budget
      temperature: 0.5, // Lower temperature for more focused responses
    });

    const insights = JSON.parse(completion.choices[0].message.content || '{}');

    return NextResponse.json(insights);
  } catch (error) {
    console.error('Error generating insights:', error);
    return NextResponse.json(
      { error: 'Failed to generate insights' },
      { status: 500 }
    );
  }
} 