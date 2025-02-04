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

    // Create a new job document
    const jobRef = await db.collection('analysisJobs').add({
      userId,
      status: 'pending',
      progress: 0,
      totalEmails: 0,
      analyzedEmails: 0,
      supportEmailsFound: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Start the background process
    // In a production environment, this would trigger a serverless function or background worker
    // For now, we'll update the status to processing
    await jobRef.update({
      status: 'processing'
    });

    return NextResponse.json({
      id: jobRef.id,
      status: 'processing',
      progress: 0
    });
  } catch (error) {
    console.error('Error starting analysis job:', error);
    return NextResponse.json(
      { error: 'Failed to start analysis' },
      { status: 500 }
    );
  }
} 