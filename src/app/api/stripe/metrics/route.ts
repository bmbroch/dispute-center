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

    // Fetch all disputes and filter by status
    const disputes = await stripe.disputes.list({
      created: {
        // Get disputes from the last 30 days
        gte: Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000),
      },
      limit: 100,
    });

    // Filter disputes by status
    const activeDisputes = disputes.data.filter(dispute => 
      dispute.status === 'needs_response' || 
      dispute.status === 'warning_needs_response'
    );

    // Count disputes with response drafts (those in warning_needs_response status)
    const disputesWithDrafts = activeDisputes.filter(dispute => 
      dispute.status === 'warning_needs_response'
    );

    return NextResponse.json({
      activeDisputes: activeDisputes.length,
      responseDrafts: disputesWithDrafts.length,
      hasStripeKey: true,
    });
  } catch (error) {
    console.error('Error fetching Stripe metrics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 