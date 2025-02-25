import { NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, addDoc, getDoc } from 'firebase/firestore';
import type { FAQ } from '@/types/faq';

export async function POST(req: Request) {
  try {
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

    const faqRef = collection(db, 'faqs');
    let existingDoc;
    let docId = id; // Store the ID we'll use

    // If ID is provided, try to find the document directly
    if (id) {
      console.log('Looking up existing FAQ by ID:', id);
      const docRef = doc(db, 'faqs', id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        console.log('Found existing FAQ by ID');
        existingDoc = docSnap;
      } else {
        console.log('No FAQ found with ID:', id);
      }
    }

    // If no ID or document not found, check by question
    if (!existingDoc) {
      console.log('Checking for existing FAQ by question');
      const q = query(faqRef, where('question', '==', question));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        existingDoc = snapshot.docs[0];
        docId = existingDoc.id;
        console.log('Found existing FAQ by question, ID:', docId);
      }
    }

    const newFaq: FAQ = {
      question,
      answer,
      category: category || 'general',
      relatedEmailIds: emailIds || [],
      similarPatterns: similarPatterns || [],
      confidence: confidence || 1,
      requiresCustomerSpecificInfo: requiresCustomerSpecificInfo || false,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      useCount: 0,
    };

    if (existingDoc) {
      // Update existing FAQ
      console.log('Updating existing FAQ:', docId);
      const existingData = existingDoc.data();

      // Use setDoc with merge option instead of updateDoc to ensure all fields are updated
      await setDoc(doc(db, 'faqs', docId), {
        ...newFaq,
        useCount: existingData.useCount || 0, // Preserve existing useCount
        createdAt: existingData.createdAt // Preserve original creation date
      }, { merge: true });

      console.log('Successfully updated FAQ');
    } else {
      // Add new FAQ
      console.log('Creating new FAQ');
      if (docId) {
        // If we have an ID but no existing doc, create with specific ID
        await setDoc(doc(db, 'faqs', docId), newFaq);
      } else {
        // Otherwise let Firebase generate an ID
        const docRef = await addDoc(faqRef, newFaq);
        docId = docRef.id;
      }
      console.log('Successfully created new FAQ with ID:', docId);
    }

    // Verify the update
    const verifyDoc = await getDoc(doc(db, 'faqs', docId));
    if (!verifyDoc.exists()) {
      throw new Error('Failed to verify FAQ update');
    }

    console.log('Verified FAQ exists in database');

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
