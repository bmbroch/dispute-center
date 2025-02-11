import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OpenAI API key is not configured. Please set NEXT_PUBLIC_OPENAI_API_KEY or OPENAI_API_KEY environment variable.');
} else {
  console.log('OpenAI API Key format check:', {
    length: OPENAI_API_KEY.length,
    prefix: OPENAI_API_KEY.substring(0, 8),
    isPresent: !!OPENAI_API_KEY
  });
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || '',
});

export async function POST(req: Request) {
  try {
    // Check API key first
    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key is missing');
      return NextResponse.json(
        { 
          error: 'OpenAI API key is not configured',
          details: 'Please set NEXT_PUBLIC_OPENAI_API_KEY or OPENAI_API_KEY environment variable'
        },
        { status: 400 }
      );
    }

    const { emailId, content } = await req.json();
    console.log('Analyzing email:', { emailId, contentLength: content?.length });
    
    if (!content || !emailId) {
      return NextResponse.json(
        { error: 'Email content and ID are required' },
        { status: 400 }
      );
    }

    // First check if we have cached analysis
    const app = getFirebaseAdmin();
    const db = getFirestore(app as any);
    const emailAnalysisRef = db.collection('email_analyses').doc(emailId);
    const cachedAnalysis = await emailAnalysisRef.get();

    if (cachedAnalysis.exists) {
      const data = cachedAnalysis.data();
      if (data?.questions) {
        console.log('Using cached questions for email:', emailId);
        return NextResponse.json({ questions: data.questions });
      }
    }

    console.log('Analyzing email content:', content.substring(0, 100) + '...');

    // Analyze the email with OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an expert at analyzing customer support emails and extracting questions that need answers. Your task is to:
          1. Identify explicit and implicit questions in the email
          2. Rephrase them as clear, standalone questions
          3. Generalize them so they can be reused for similar questions
          4. Ensure each question captures a single, distinct inquiry
          5. Format questions to be clear and concise
          
          Return a JSON object with an array of questions. Each question should be a string.
          Example: {"questions": ["How do I reset my password?", "What are the system requirements?"]}
          
          Important guidelines:
          - Focus on actionable questions that can be answered
          - Combine very similar questions
          - Exclude rhetorical questions
          - Make questions generic enough to help future users
          - Keep questions concise but clear
          - ALWAYS return at least one question if there's any kind of inquiry in the email
          - Look for implicit questions (e.g., "I can't login" implies "How do I resolve login issues?")`
        },
        {
          role: "user",
          content: content
        }
      ],
      temperature: 0.1
    });

    if (!response.choices[0].message?.content) {
      console.error('No content in OpenAI response');
      return NextResponse.json(
        { error: 'No response from AI analysis' },
        { status: 500 }
      );
    }

    console.log('OpenAI response:', response.choices[0].message.content);

    try {
      const analysis = JSON.parse(response.choices[0].message.content);
      
      // Validate the response structure
      if (!Array.isArray(analysis.questions)) {
        console.error('Invalid analysis structure:', analysis);
        return NextResponse.json({ 
          error: 'Invalid response format',
          questions: [] 
        });
      }

      // Filter out any empty or invalid questions
      const validQuestions = analysis.questions.filter((q: string) => 
        typeof q === 'string' && q.trim().length > 0
      );

      console.log('Extracted questions:', validQuestions);

      // Store the questions in Firebase
      await emailAnalysisRef.set({
        questions: validQuestions,
        timestamp: Date.now(),
        emailId: emailId
      }, { merge: true });

      if (validQuestions.length === 0) {
        console.log('No valid questions found in the analysis');
      }

      return NextResponse.json({ questions: validQuestions });
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return NextResponse.json({ 
        error: 'Failed to parse AI response',
        details: parseError instanceof Error ? parseError.message : 'Unknown parsing error',
        questions: [] 
      });
    }
  } catch (error) {
    console.error('Error analyzing email:', error);
    return NextResponse.json(
      { 
        error: 'Failed to analyze email',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 