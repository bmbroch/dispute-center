import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

export async function DELETE(req: Request) {
  try {
    const { question } = await req.json();

    if (!question) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    // Initialize Firebase Admin
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    const db = getFirestore(app);

    // Find and delete the FAQ with the matching question
    const faqRef = db.collection('faqs');
    const snapshot = await faqRef.where('question', '==', question).get();

    if (snapshot.empty) {
      return NextResponse.json(
        { error: 'FAQ not found' },
        { status: 404 }
      );
    }

    // Delete all documents found with this question (should only be one)
    const deletePromises = snapshot.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting FAQ:', error);
    return NextResponse.json(
      { 
        error: 'Failed to delete FAQ',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 