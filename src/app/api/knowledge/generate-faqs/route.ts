import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { emails } = await req.json();

    // First, filter support emails
    const systemPrompt = `You are an expert at identifying customer support emails. 
    Analyze each email and return true only if it appears to be a customer support related email. 
    Ignore promotional emails, newsletters, and other non-support communications.`;

    const supportEmails = [];
    
    for (const email of emails) {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Subject: ${email.subject}\n\nBody: ${email.body}` }
        ],
        temperature: 0.1,
      });

      const isSupport = response.choices[0].message.content?.toLowerCase().includes('true');
      if (isSupport) {
        supportEmails.push(email);
      }
    }

    // Now generate FAQs from support emails
    const faqPrompt = `Analyze these customer support emails and generate the top 10 most frequently asked questions with their corresponding answers. 
    Format the output as a JSON array with objects containing:
    1. question: The frequently asked question
    2. frequency: Number of times this type of question appears
    3. answer: The best standardized answer based on the responses in the emails
    4. category: The general category this FAQ belongs to (e.g., "Technical Issue", "Billing", "Account Management")`;

    const faqResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: faqPrompt },
        { 
          role: "user", 
          content: JSON.stringify(supportEmails.map(e => ({
            subject: e.subject,
            body: e.body
          })))
        }
      ],
      temperature: 0.5,
      response_format: { type: "json_object" }
    });

    const faqs = JSON.parse(faqResponse.choices[0].message.content || '{"faqs": []}');

    return NextResponse.json({
      totalEmails: emails.length,
      supportEmails: supportEmails.length,
      faqs: faqs.faqs
    });
  } catch (error) {
    console.error('Error generating FAQs:', error);
    return NextResponse.json(
      { error: 'Failed to generate FAQs' },
      { status: 500 }
    );
  }
} 