import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

// Statuses that require attention
const RELEVANT_STATUSES = [
  'needs_response',        // Immediate action required
  'warning_needs_response' // Will soon require a response
] as const;

// Add runtime config to optimize for edge
export const runtime = 'edge';
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

    try {
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

      const stripe = new Stripe(stripeKey, { 
        apiVersion: '2024-12-18.acacia',
        typescript: true 
      });

      // Fetch all disputes and filter by relevant statuses
      const disputes = await stripe.disputes.list({
        limit: 100,
        expand: ['data.evidence', 'data.charge', 'data.charge.customer']
      });

      // Filter disputes with relevant statuses
      const relevantDisputes = disputes.data.filter(dispute => 
        RELEVANT_STATUSES.includes(dispute.status as typeof RELEVANT_STATUSES[number])
      );

      // Get customer emails for each dispute
      const disputesWithEmail = await Promise.all(relevantDisputes.map(async (dispute) => {
        let customerEmail = 'N/A';
        if (dispute.charge && typeof dispute.charge !== 'string') {
          const customer = dispute.charge.customer;
          if (customer && typeof customer !== 'string' && !('deleted' in customer)) {
            customerEmail = customer.email || 'N/A';
          }
        }
        return {
          ...dispute,
          customerEmail
        };
      }));

      // Sort disputes by urgency (needs_response first, then others)
      const sortedDisputes = disputesWithEmail.sort((a, b) => {
        if (a.status === 'needs_response' && b.status !== 'needs_response') return -1;
        if (a.status !== 'needs_response' && b.status === 'needs_response') return 1;
        // If same status or neither is needs_response, sort by due date
        return (a.evidence_details?.due_by || 0) - (b.evidence_details?.due_by || 0);
      });

      return NextResponse.json({ disputes: sortedDisputes });
    } catch (dbError: any) {
      console.error('Database or Stripe API error:', dbError);
      return NextResponse.json({ 
        error: 'Failed to fetch data',
        details: dbError.message 
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error in disputes route:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error.message 
    }, { status: 500 });
  }
} 