import { NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs, doc, setDoc, addDoc, getDoc } from 'firebase/firestore';
import type { FAQ } from '@/types/faq';

export async function POST(req: Request) {
  try {
    // Get auth token from Authorization header
    const authHeader = req.headers.get('Authorization');
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

    // Create user object for consistency with other routes
    const user = { email: userEmail };

    // Validate request body
    const body = await req.json();
    const { id, question, answer, category, emailIds, similarPatterns, confidence, requiresCustomerSpecificInfo } = body;

    console.log('Processing FAQ update/create request:', { id, question });

    if (!question || typeof question !== 'string') {
      return NextResponse.json({ error: 'Question is required and must be a string' }, { status: 400 });
    }

    if (!answer || typeof answer !== 'string') {
      return NextResponse.json({ error: 'Answer is required and must be a string' }, { status: 400 });
    }

    // Get Firebase instance
    const db = getFirebaseDB();
    if (!db) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    // Create a user-specific FAQ collection reference
    const userFaqsRef = collection(db, 'users', user.email, 'faqs');
    let existingDoc;
    let docId = id;

    // If ID is provided, try to find the document directly
    if (id) {
      const docRef = doc(db, 'users', user.email, 'faqs', id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        existingDoc = docSnap;
      }
    }

    // If no ID or document not found, check by question
    if (!existingDoc) {
      const q = query(userFaqsRef, where('question', '==', question));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        existingDoc = snapshot.docs[0];
        docId = existingDoc.id;
      }
    }

    const newFaq: FAQ = {
      question,
      answer,
      category: category || 'General',
      emailIds: emailIds || [],
      similarPatterns: similarPatterns || [],
      confidence: confidence || 1,
      requiresCustomerSpecificInfo: requiresCustomerSpecificInfo || false,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      useCount: 0,
    };

    if (existingDoc) {
      const existingData = existingDoc.data();
      await setDoc(doc(db, 'users', user.email, 'faqs', docId), {
        ...newFaq,
        useCount: existingData.useCount || 0,
        createdAt: existingData.createdAt
      }, { merge: true });
    } else {
      if (docId) {
        await setDoc(doc(db, 'users', user.email, 'faqs', docId), newFaq);
      } else {
        const docRef = await addDoc(userFaqsRef, newFaq);
        docId = docRef.id;
      }
    }

    return NextResponse.json({
      success: true,
      id: docId,
      ...newFaq
    });

  } catch (error) {
    console.error('Error adding/updating FAQ:', error);
    return NextResponse.json(
      {
        error: 'Failed to add/update FAQ',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
