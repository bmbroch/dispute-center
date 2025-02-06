import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';

export async function GET(request: Request) {
  try {
    const admin = getFirebaseAdmin();
    
    if (!admin) {
      return NextResponse.json({ error: 'Firebase Admin not initialized' }, { status: 503 });
    }

    const db = admin.firestore();
    const authHeader = request.headers.get('Authorization');
    
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
    const { searchParams } = new URL(request.url);
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
        .where('status', '==', 'processing')  // First try processing
        .limit(1)
        .get();

      if (jobsQuery.empty) {
        // If no processing jobs found, try pending
        const pendingJobsQuery = await db.collection('analysisJobs')
          .where('userId', '==', userId)
          .where('status', '==', 'pending')
          .limit(1)
          .get();

        if (pendingJobsQuery.empty) {
          return NextResponse.json({ 
            status: 'no_active_jobs',
            message: 'No active analysis jobs found'
          });
        }

        const jobDoc = pendingJobsQuery.docs[0];
        return NextResponse.json({
          id: jobDoc.id,
          ...jobDoc.data()
        });
      }

      const jobDoc = jobsQuery.docs[0];
      return NextResponse.json({
        id: jobDoc.id,
        ...jobDoc.data()
      });
    }
  } catch (error) {
    console.error('Error in job-status route:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { 
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
} 