import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { debugStripeKey, getStripeKey } from '@/lib/firebase/firebaseUtils';

// Remove edge runtime as it's not compatible with Firestore
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Get user email from query parameter
    const { searchParams } = new URL(request.url);
    const userEmail = searchParams.get('userEmail');
    
    if (!userEmail) {
      return NextResponse.json({ 
        success: false,
        error: 'User email is required',
        data: [] 
      }, { status: 400 });
    }

    // Get Stripe key from Firebase
    const stripeKey = await getStripeKey(userEmail);
    if (!stripeKey) {
      return NextResponse.json({ 
        success: false,
        error: 'No Stripe key found. Please add your Stripe API key in settings.',
        data: []
      }, { status: 404 });
    }

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    // Fetch disputes
    const disputes = await stripe.disputes.list({
      limit: 100,
      expand: [
        'data.charge',
        'data.payment_intent',
        'data.evidence_details'
      ]
    });

    // Transform disputes data
    const activeDisputes = disputes.data
      .filter(dispute => dispute.status === 'needs_response' || dispute.status === 'warning_needs_response')
      .map(dispute => {
        const charge = dispute.charge as Stripe.Charge;
        const paymentIntent = dispute.payment_intent as Stripe.PaymentIntent;
        
        // Get customer email from charge or payment intent
        let customerEmail = '';
        if (charge?.receipt_email) {
          customerEmail = charge.receipt_email;
        } else if (charge?.billing_details?.email) {
          customerEmail = charge.billing_details.email;
        } else if (paymentIntent?.customer) {
          // Try to get email from customer object if available
          const customer = paymentIntent.customer as Stripe.Customer;
          customerEmail = customer.email || '';
        }

        // Get first name from email
        const firstName = customerEmail 
          ? customerEmail.split('@')[0].split(/[^a-zA-Z]/)[0]
          : '';

        // Format due date
        const dueBy = dispute.evidence_details?.due_by 
          ? new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })
          : 'N/A';

        return {
          id: dispute.id,
          amount: dispute.amount,
          currency: dispute.currency,
          status: dispute.status,
          reason: dispute.reason,
          created: dispute.created,
          customerEmail,
          firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
          dueDate: dueBy,
          emailThreads: [], // Initialize empty email threads array
          charge: charge || null,
          payment_intent: paymentIntent || null
        };
      });

    return NextResponse.json({ 
      success: true,
      data: activeDisputes,
      error: null
    });

  } catch (error) {
    console.error('Error in disputes route:', error);
    return NextResponse.json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch disputes',
      data: []
    }, { status: 500 });
  }
} 