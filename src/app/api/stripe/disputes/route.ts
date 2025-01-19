import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

// Remove edge runtime as it's not compatible with Firestore
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Get user email from the request header
    const userEmail = request.headers.get('X-User-Email');
    if (!userEmail) {
      return NextResponse.json({ error: 'No user email provided' }, { status: 401 });
    }

    const db = getFirebaseDB();
    if (!db) {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 500 });
    }

    // Get Stripe API key from Firebase
    const stripeKeysRef = collection(db, 'stripeKeys');
    const q = query(stripeKeysRef, where('userEmail', '==', userEmail));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return NextResponse.json({ error: 'No Stripe API key found for this user' }, { status: 404 });
    }

    const stripeKey = querySnapshot.docs[0].data().apiKey;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Invalid Stripe API key' }, { status: 400 });
    }

    // Initialize Stripe with the user's API key
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia'
    });

    // Fetch all disputes and filter by status
    const disputes = await stripe.disputes.list({
      limit: 100,
      expand: ['data.charge', 'data.charge.customer']
    });

    // Filter disputes by status
    const allDisputes = disputes.data.filter(dispute => 
      dispute.status === 'needs_response' || dispute.status === 'warning_needs_response'
    );

    return NextResponse.json(allDisputes);
  } catch (error) {
    console.error('Error fetching disputes:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch disputes' },
      { status: 500 }
    );
  }
} 