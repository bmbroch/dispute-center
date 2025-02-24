import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { FAQ } from '@/types/faq';
import { calculatePatternSimilarity } from '@/lib/utils/similarity';

const SIMILARITY_THRESHOLD = 0.6; // Threshold for question similarity matching

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

    // Add similarity check for existing FAQs
    const allFaqs = await faqRef.get();
    const similarExistingFaq = allFaqs.docs.find(doc => {
      const existingQuestion = doc.data().question;
      return calculatePatternSimilarity(existingQuestion, question) > SIMILARITY_THRESHOLD;
    });

    if (similarExistingFaq) {
      // Update existing FAQ instead of creating new one
      const existingData = similarExistingFaq.data();
      const updatedFaq = {
        ...existingData,
        emailIds: [...new Set([...existingData.emailIds, ...(emailIds || [])])],
        confidence: Math.min(1, existingData.confidence + 0.1), // Boost confidence
        updatedAt: new Date().toISOString()
      };

      await similarExistingFaq.ref.update(updatedFaq);
      return NextResponse.json({ id: similarExistingFaq.id, ...updatedFaq });
    }

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
