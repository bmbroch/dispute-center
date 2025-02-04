import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from '@/lib/firebase/firebaseAdmin';

// Initialize Firebase Admin
initializeFirebaseAdmin();
const db = getFirestore();

export async function GET(req: Request) {
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

    // Get jobId from query params
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');

    if (jobId) {
      // Get specific job
      const jobDoc = await db.collection('analysisJobs').doc(jobId).get();
      
      if (!jobDoc.exists) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      const jobData = jobDoc.data();
      
      // Verify the job belongs to the user
      if (jobData?.userId !== userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      return NextResponse.json({
        id: jobDoc.id,
        ...jobData
      });
    } else {
      // Get most recent active job for the user
      const jobsQuery = await db.collection('analysisJobs')
        .where('userId', '==', userId)
        .where('status', 'in', ['pending', 'processing'])
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (jobsQuery.empty) {
        return NextResponse.json(null);
      }

      const jobDoc = jobsQuery.docs[0];
      return NextResponse.json({
        id: jobDoc.id,
        ...jobDoc.data()
      });
    }
  } catch (error) {
    console.error('Error getting job status:', error);
    return NextResponse.json(
      { error: 'Failed to get job status' },
      { status: 500 }
    );
  }
} 