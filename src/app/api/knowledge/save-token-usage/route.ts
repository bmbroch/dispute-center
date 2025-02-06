import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from '@/lib/firebase/firebaseAdmin';

// Initialize Firebase Admin
initializeFirebaseAdmin();
const db = getFirestore();

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Extract user ID from the token
    const token = authHeader.replace('Bearer ', '');
    let userId = 'unknown';
    try {
      const tokenParts = token.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(atob(tokenParts[1]));
        userId = payload.sub || payload.user_id || 'unknown';
      }
    } catch (error) {
      console.error('Error extracting user ID from token:', error);
    }

    const data = await req.json();
    
    // Calculate cost (GPT-4 pricing)
    const GPT4_PROMPT_COST = 0.03 / 1000;   // $0.03 per 1K tokens
    const GPT4_COMPLETION_COST = 0.06 / 1000; // $0.06 per 1K tokens
    
    const cost = (data.promptTokens * GPT4_PROMPT_COST) + 
                (data.completionTokens * GPT4_COMPLETION_COST);

    // Save to Firebase
    await db.collection('tokenUsage').add({
      userId,
      timestamp: new Date(),
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens,
      feature: data.feature,
      emailsAnalyzed: data.emailsAnalyzed,
      model: 'gpt-4',
      cost: cost
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving token usage:', error);
    return NextResponse.json(
      { error: 'Failed to save token usage' },
      { status: 500 }
    );
  }
} 