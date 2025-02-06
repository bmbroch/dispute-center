import { NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs, addDoc, updateDoc } from 'firebase/firestore';
import Stripe from 'stripe';

export async function POST(request: Request) {
  try {
    const { apiKey, userEmail } = await request.json();

    if (!apiKey || !userEmail) {
      return NextResponse.json({ error: 'API key and user email are required' }, { status: 400 });
    }

    // Validate the API key by making a test call to Stripe
    try {
      const stripe = new Stripe(apiKey, { apiVersion: '2023-10-16' });
      await stripe.balance.retrieve(); // Simple test call
    } catch (error) {
      return NextResponse.json({ error: 'Invalid Stripe API key' }, { status: 400 });
    }

    const db = getFirebaseDB();
    if (!db) {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 500 });
    }

    // Check if a key already exists for this user
    const stripeKeysRef = collection(db, 'stripeKeys');
    const q = query(stripeKeysRef, where('userEmail', '==', userEmail));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      // Update existing key
      const doc = querySnapshot.docs[0];
      await updateDoc(doc.ref, { 
        stripeKey: apiKey,
        updatedAt: new Date().toISOString()
      });
    } else {
      // Create new key
      await addDoc(stripeKeysRef, {
        userEmail,
        stripeKey: apiKey,
        createdAt: new Date().toISOString()
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error saving Stripe API key:', error);
    return NextResponse.json({ 
      error: 'Failed to save Stripe API key',
      details: error.message 
    }, { status: 500 });
  }
} 