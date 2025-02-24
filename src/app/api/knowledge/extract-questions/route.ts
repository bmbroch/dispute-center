import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  console.log('=== Question Extraction API Start ===');
  try {
    // First check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key not configured');
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch (e) {
      console.error('Failed to parse request body:', e);
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    console.log('Request body received:', {
      contentLength: body.emailContent?.length,
      contentPreview: body.emailContent?.substring(0, 100) + '...'
    });

    const { emailContent } = body;

    if (!emailContent) {
      console.log('Error: No email content provided');
      return NextResponse.json(
        { error: 'Email content is required' },
        { status: 400 }
      );
    }

    console.log('Calling OpenAI API...');
    let response;
    try {
      response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: `You are an expert at analyzing customer support emails and extracting GENERALIZED questions for a FAQ library.
            Your task is to identify the core issues and create generic questions that would help ANY customer with similar problems.

            STRICT RULES:
            1. Extract a MAXIMUM of 2 questions per email
            2. NEVER include customer-specific details (emails, names, dates) in questions
            3. Focus on the underlying issue, not the specific customer's situation
            4. Make questions as generic as possible while remaining useful
            5. Questions must be actionable and answerable
            6. Look for secondary issues that might need addressing

            EXAMPLES:

            Email: "Please cancel my subscription for john@example.com and jane@example.com"
            ❌ DON'T create specific questions:
            - "How do I cancel subscription for john@example.com?"
            - "How do I cancel multiple email subscriptions?"

            ✅ DO create generic questions:
            - "How do I cancel my subscription?"
            - "Can I manage multiple subscriptions under different email addresses?"

            Email: "Reset password not working for my account user123"
            ❌ DON'T use specific details:
            - "Why can't user123 reset their password?"

            ✅ DO make it generic:
            - "How do I troubleshoot password reset issues?"

            Email: "I paid $50 on May 5th but haven't received access"
            ❌ DON'T include specific amounts/dates:
            - "Why hasn't my $50 payment from May 5th been processed?"

            ✅ DO make it generic:
            - "Why hasn't my payment been processed?"
            - "How long does it take to get access after payment?"

            Remember: The goal is to build a FAQ library that helps ALL users, not just the current customer.

            NEW RULES FOR QUESTION GENERATION:
            7. Before creating a new question, check if it's just a rephrasing of:
               - "How do I...?"
               - "Can I...?"
               - "Why is...?"
               - "What happens if...?"
            8. If the question is a rephrasing, use the standard form:
               - "How to..." instead of "How do I..."
               - "Can I..." instead of "Is it possible to..."
            9. Group similar phrasings under a single canonical question

            Return a JSON object with an array of questions. Example:
            {"questions": ["How do I cancel my subscription?", "How do I manage multiple subscriptions?"]}`
          },
          {
            role: "user",
            content: emailContent
          }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      });
    } catch (error: any) {
      console.error('OpenAI API error:', error);
      // Check for specific OpenAI error types
      if (error.code === 'invalid_request_error') {
        // If the model doesn't support JSON response format, try again without it
        try {
          response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
              {
                role: "system",
                content: `You are an expert at analyzing customer support emails and extracting GENERALIZED questions for a FAQ library.
                Your task is to identify the core issues and create generic questions that would help ANY customer with similar problems.

                STRICT RULES:
                1. Extract a MAXIMUM of 2 questions per email
                2. NEVER include customer-specific details (emails, names, dates) in questions
                3. Focus on the underlying issue, not the specific customer's situation
                4. Make questions as generic as possible while remaining useful
                5. Questions must be actionable and answerable
                6. Look for secondary issues that might need addressing
                7. ALWAYS return response in this exact JSON format:
                {"questions": ["question1", "question2"]}

                EXAMPLES:

                Email: "Please cancel my subscription for john@example.com and jane@example.com"
                ❌ DON'T create specific questions:
                - "How do I cancel subscription for john@example.com?"
                - "How do I cancel multiple email subscriptions?"

                ✅ DO create generic questions:
                - "How do I cancel my subscription?"
                - "Can I manage multiple subscriptions under different email addresses?"

                Email: "Reset password not working for my account user123"
                ❌ DON'T use specific details:
                - "Why can't user123 reset their password?"

                ✅ DO make it generic:
                - "How do I troubleshoot password reset issues?"

                Email: "I paid $50 on May 5th but haven't received access"
                ❌ DON'T include specific amounts/dates:
                - "Why hasn't my $50 payment from May 5th been processed?"

                ✅ DO make it generic:
                - "Why hasn't my payment been processed?"
                - "How long does it take to get access after payment?"

                Remember: The goal is to build a FAQ library that helps ALL users, not just the current customer.`
              },
              {
                role: "user",
                content: emailContent
              }
            ],
            temperature: 0.1
          });
        } catch (retryError: any) {
          console.error('OpenAI API retry error:', retryError);
          return NextResponse.json(
            { error: retryError.message || 'Failed to call OpenAI API' },
            { status: 500 }
          );
        }
      } else {
        return NextResponse.json(
          { error: error.message || 'Failed to call OpenAI API' },
          { status: 500 }
        );
      }
    }

    console.log('OpenAI API response received:', {
      responseStatus: response.choices[0].finish_reason,
      responseContent: response.choices[0].message?.content
    });

    if (!response.choices[0].message?.content) {
      console.log('Error: Empty response from OpenAI');
      return NextResponse.json(
        { error: 'No response from AI' },
        { status: 500 }
      );
    }

    let analysis;
    try {
      console.log('Parsing AI response...');
      analysis = JSON.parse(response.choices[0].message.content);
      console.log('Parsed analysis:', analysis);
    } catch (parseError) {
      console.error('Error parsing AI response:', {
        error: parseError,
        rawResponse: response.choices[0].message.content
      });
      return NextResponse.json({
        error: 'Failed to parse AI response',
        rawResponse: response.choices[0].message.content
      }, { status: 500 });
    }

    // Validate the response structure and ensure consistent format
    if (!analysis || !Array.isArray(analysis.questions)) {
      console.error('Invalid AI response format:', {
        rawResponse: response.choices[0].message.content,
        parsedAnalysis: analysis
      });
      return NextResponse.json({
        error: 'Invalid response format from AI',
        rawResponse: response.choices[0].message.content,
        parsedAnalysis: analysis
      }, { status: 500 });
    }

    // Ensure we never return more than 2 questions and they're properly formatted
    const validQuestions = analysis.questions
      .filter((q: any) => typeof q === 'string' && q.trim().length > 0)
      .slice(0, 2)
      .map((q: string) => ({
        question: q.trim(),
        category: 'support',
        confidence: 1,
        requiresCustomerSpecificInfo: false
      }));

    if (validQuestions.length === 0) {
      console.log('No valid questions found in response');
      return NextResponse.json({
        error: 'No valid questions found in AI response',
        rawResponse: response.choices[0].message.content
      }, { status: 500 });
    }

    console.log('Processed questions:', validQuestions);
    return NextResponse.json({ questions: validQuestions });
  } catch (error: any) {
    console.error('Error in question extraction:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to extract questions' },
      { status: 500 }
    );
  }
}
