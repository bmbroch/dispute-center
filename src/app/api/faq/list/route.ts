import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

export async function GET() {
  try {
    // Initialize Firebase Admin with detailed error logging
    console.log('Attempting to initialize Firebase Admin...');
    const app = getFirebaseAdmin();
    
    if (!app) {
      console.error('Firebase Admin initialization failed');
      return NextResponse.json(
        { 
          error: 'Failed to initialize Firebase Admin',
          details: 'Firebase service account key may be missing or invalid'
        },
        { status: 500 }
      );
    }
    
    console.log('Firebase Admin initialized successfully');
    const db = getFirestore(app);

    // Get all FAQs from Firestore with error handling
    try {
      console.log('Attempting to fetch FAQs from Firestore...');
      const faqRef = db.collection('faqs');
      const snapshot = await faqRef.get();
      
      // Convert the snapshot to an array of FAQs
      const faqs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log(`Successfully fetched ${faqs.length} FAQs`);
      return NextResponse.json({ faqs });
      
    } catch (firestoreError) {
      console.error('Firestore operation failed:', firestoreError);
      return NextResponse.json(
        { 
          error: 'Failed to fetch FAQs from Firestore',
          details: firestoreError instanceof Error ? firestoreError.message : 'Unknown Firestore error'
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in FAQ list endpoint:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch FAQs',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 