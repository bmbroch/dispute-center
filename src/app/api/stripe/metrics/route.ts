import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeKey } from '@/lib/firebase/firebaseUtils';

export async function GET(request: Request) {
  try {
    // Get the user's email from the query parameters
    const { searchParams } = new URL(request.url);
    const userEmail = searchParams.get('userEmail');

    if (!userEmail) {
      return NextResponse.json({ error: 'User email is required' }, { status: 400 });
    }

    // Get the user's Stripe API key from Firebase
    const stripeKey = await getStripeKey(userEmail);

    if (!stripeKey) {
      return NextResponse.json({
        activeDisputes: null,
        responseDrafts: null,
        hasStripeKey: false,
      });
    }

    // Initialize Stripe with the user's API key
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia'
    });

    // Fetch disputes that need response
    const disputes = await stripe.disputes.list({
      limit: 100,
      status: 'needs_response',
    });

    // Fetch disputes that have response drafts
    const disputesWithDrafts = await stripe.disputes.list({
      limit: 100,
      status: 'warning_needs_response',
    });

    return NextResponse.json({
      activeDisputes: disputes.data.length,
      responseDrafts: disputesWithDrafts.data.length,
      hasStripeKey: true,
    });
  } catch (error) {
    console.error('Error fetching Stripe metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 