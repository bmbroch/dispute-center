import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from '@/lib/firebase/firebaseAdmin';

// Initialize Firebase Admin
initializeFirebaseAdmin();
const db = getFirestore();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sortField = searchParams.get('sortField') || 'timestamp';
    const sortDirection = searchParams.get('sortDirection') || 'desc';

    const logsRef = db.collection('ai_api_logs');
    const q = logsRef.orderBy(sortField, sortDirection as 'asc' | 'desc').limit(100);
    const querySnapshot = await q.get();

    const logs = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        // Convert Firestore Timestamp to ISO string for JSON serialization
        timestamp: data.timestamp.toDate().toISOString()
      };
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}
