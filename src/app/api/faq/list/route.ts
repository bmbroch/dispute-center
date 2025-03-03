import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

export async function GET(request: Request) {
  try {
    // Get auth token from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const accessToken = authHeader.split(' ')[1];
    if (!accessToken) {
      return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 });
    }

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userInfoResponse.ok) {
      return NextResponse.json({ error: 'Failed to verify user' }, { status: 401 });
    }

    const userInfo = await userInfoResponse.json();
    const userEmail = userInfo.email;

    if (!userEmail) {
      return NextResponse.json({ error: 'User email not found' }, { status: 401 });
    }

    const app = getFirebaseAdmin();
    if (!app) {
      return NextResponse.json(
        { error: 'Failed to initialize Firebase Admin' },
        { status: 500 }
      );
    }

    const db = getFirestore(app);

    // Get user-specific FAQs from Firestore
    try {
      const userFaqsRef = db.collection('users').doc(userEmail).collection('faqs');
      const snapshot = await userFaqsRef.get();

      // Convert the snapshot to an array of FAQs
      const faqs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return NextResponse.json({ faqs });

    } catch (firestoreError) {
      console.error('Firestore operation failed:', firestoreError);
      return NextResponse.json(
        { error: 'Failed to fetch FAQs from Firestore' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error in FAQ list endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to fetch FAQs' },
      { status: 500 }
    );
  }
}
