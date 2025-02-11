import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { FAQ } from '@/types/faq';

export async function POST(req: Request) {
  try {
    const { question, answer, category, emailIds } = await req.json();

    // Validate required fields
    if (!question || !answer || !category) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Initialize Firebase Admin
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Failed to initialize Firebase Admin');
    }
    const db = getFirestore(app);

    // Check if a FAQ with this question already exists
    const faqRef = db.collection('faqs');
    const snapshot = await faqRef.where('question', '==', question).get();

    const newFaq: FAQ = {
      question,
      answer,
      category,
      relatedEmailIds: emailIds || [],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      useCount: 0,
      confidence: 1, // This is a manually added/updated FAQ, so confidence is 1
    };

    let docRef;
    
    if (!snapshot.empty) {
      // Update existing FAQ
      docRef = snapshot.docs[0].ref;
      await docRef.update({
        ...newFaq,
        useCount: snapshot.docs[0].data().useCount || 0, // Preserve existing useCount
        createdAt: snapshot.docs[0].data().createdAt // Preserve original creation date
      });
    } else {
      // Add new FAQ
      docRef = await faqRef.add(newFaq);
    }

    return NextResponse.json({
      id: docRef.id,
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