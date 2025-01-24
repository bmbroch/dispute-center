import { NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import Stripe from 'stripe';

export async function GET(request: Request) {
  try {
    // Get user email from the request headers or query params
    const { searchParams } = new URL(request.url);
    const userEmail = searchParams.get('email');

    if (!userEmail) {
      return NextResponse.json(
        { error: 'User email is required' },
        { status: 400 }
      );
    }

    // Get Stripe key from Firestore
    const db = getFirebaseDB();
    if (!db) {
      throw new Error('Database not initialized');
    }

    const stripeKeysRef = collection(db, 'stripeKeys');
    const q = query(stripeKeysRef, where('userEmail', '==', userEmail));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return NextResponse.json(
        { error: 'No Stripe key found for this user' },
        { status: 404 }
      );
    }

    const stripeKey = querySnapshot.docs[0].data().apiKey;
    
    // Initialize Stripe with the user's API key
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16'
    });

    // Fetch disputes that need response
    const disputes = await stripe.disputes.list({
      limit: 100,
      status: 'needs_response'
    });

    // For now, we'll set response drafts to 0 since we haven't implemented that feature yet
    const responseDrafts = 0;

    return NextResponse.json({
      activeDisputes: disputes.data.length,
      responseDrafts
    });
  } catch (error) {
    console.error('Error fetching Stripe metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Stripe metrics' },
      { status: 500 }
    );
  }
} 