import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeKey } from '@/lib/firebase/firebaseUtils';

export async function GET(request: Request) {
  console.log('Stripe check-subscription API called');
  
  try {
    // Parse request URL
    const url = new URL(request.url);
    const customerEmail = url.searchParams.get('customerEmail');
    const userEmail = url.searchParams.get('userEmail');

    // Validate parameters
    if (!customerEmail) {
      console.error('Missing customerEmail parameter');
      return NextResponse.json({ found: false, error: 'Customer email is required' }, { status: 400 });
    }

    if (!userEmail) {
      console.error('Missing userEmail parameter');
      return NextResponse.json({ found: false, error: 'User email is required' }, { status: 400 });
    }

    console.log(`Searching for Stripe customer with email: ${customerEmail}`);
    console.log(`Using Stripe key for user: ${userEmail}`);

    // Clean the customer email - remove any extra formatting, spaces, etc.
    let cleanedEmail = customerEmail.trim();
    
    // If email is in format "Name <email@example.com>", extract just the email part
    const emailRegex = /<([^>]+)>/;
    const emailMatch = cleanedEmail.match(emailRegex);
    if (emailMatch && emailMatch[1]) {
      cleanedEmail = emailMatch[1].trim();
    }
    
    // If we still don't have a clear email, try to extract any email format
    if (!cleanedEmail.includes('@')) {
      const anyEmailRegex = /[\w.-]+@[\w.-]+\.\w+/;
      const anyMatch = customerEmail.match(anyEmailRegex);
      if (anyMatch) {
        cleanedEmail = anyMatch[0].trim();
      }
    }
    
    console.log(`Cleaned email for Stripe search: ${cleanedEmail}`);
    
    // Get Stripe API key for the user
    const stripeKeyPromise = getStripeKey(userEmail);
    
    // Wait for the Stripe key with a timeout
    const stripeKeyPromiseWithTimeout = Promise.race([
      stripeKeyPromise,
      new Promise<string | null>((_, reject) => setTimeout(() => reject(new Error('Timeout getting Stripe key')), 5000))
    ]);
    
    const stripeKey = await stripeKeyPromiseWithTimeout;
    
    if (!stripeKey) {
      console.error('No Stripe API key found for user:', userEmail);
      return NextResponse.json(
        { found: false, error: 'Stripe API key not configured. Please set up your Stripe API key in account settings.' },
        { status: 400 }
      );
    }

    console.log('Stripe key found, initializing Stripe');
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    // Search for the customer using exact email match
    let customer = null;
    
    // Try both search and list methods
    try {
      console.log('Attempting to search for customer with email:', cleanedEmail);
      
      // First try using the search API with exact match
      const searchResult = await stripe.customers.search({
        query: `email:'${cleanedEmail}'`,
      });
      
      if (searchResult.data.length > 0) {
        console.log(`Found ${searchResult.data.length} customers via search API`);
        customer = searchResult.data[0];
      } else {
        console.log('No results from search API, trying list with exact match');
        
        // Try listing with filter if search didn't return results (older Stripe API versions/keys)
        const listResult = await stripe.customers.list({
          email: cleanedEmail,
          limit: 1,
        });
        
        if (listResult.data.length > 0) {
          console.log(`Found ${listResult.data.length} customers via list API`);
          customer = listResult.data[0];
        } else {
          // Try one more attempt with lowercase email
          console.log('Trying again with lowercase email');
          const lowercaseResult = await stripe.customers.list({
            email: cleanedEmail.toLowerCase(),
            limit: 1,
          });
          
          if (lowercaseResult.data.length > 0) {
            console.log(`Found ${lowercaseResult.data.length} customers via lowercase list API`);
            customer = lowercaseResult.data[0];
          }
        }
      }
    } catch (searchError: unknown) {
      console.error('Error during customer search:', searchError);
      // Fall back to list if search fails (older API versions)
      try {
        const errorMessage = searchError instanceof Error ? searchError.message : 'Unknown error';
        console.log('Search failed, falling back to list:', errorMessage);
        const listResult = await stripe.customers.list({
          email: cleanedEmail,
          limit: 1,
        });
        
        if (listResult.data.length > 0) {
          customer = listResult.data[0];
        }
      } catch (listError) {
        console.error('Both search and list methods failed:', listError);
      }
    }

    // If no customer is found, return a specific response
    if (!customer) {
      console.log('No customer found for email:', cleanedEmail);
      return NextResponse.json({ found: false });
    }

    // Customer found, proceed to get subscription info
    console.log(`Customer found: ${customer.id}`);
    
    // Get subscriptions for this customer
    let subscriptions;
    try {
      subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        limit: 1,
        status: 'all',
        expand: ['data.default_payment_method'],
      });
    } catch (err) {
      console.error('Error fetching subscriptions:', err);
      // Still return customer info even if subscription fetch fails
      return NextResponse.json({
        found: true,
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
          created: customer.created,
          metadata: customer.metadata,
        },
      });
    }

    // Get recent invoices
    let recentInvoices: Array<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      date: number;
      pdfUrl?: string | null;
    }> = [];

    try {
      const invoices = await stripe.invoices.list({
        customer: customer.id,
        limit: 5,
      });
      recentInvoices = invoices.data.map(invoice => ({
        id: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status || 'unknown',
        date: invoice.created,
        pdfUrl: invoice.invoice_pdf,
      }));
    } catch (err) {
      console.error('Error fetching invoices:', err);
      // Continue without invoice data
    }

    // Try to get upcoming invoice
    let upcomingInvoice = null;
    try {
      const upcoming = await stripe.invoices.retrieveUpcoming({
        customer: customer.id,
      });
      upcomingInvoice = {
        amount: upcoming.amount_due,
        currency: upcoming.currency,
        date: upcoming.next_payment_attempt,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.log('No upcoming invoice available:', errorMessage);
      // Continue without upcoming invoice data
    }

    const hasActiveSubscription = subscriptions.data.length > 0 && 
      subscriptions.data[0].status === 'active';

    // Prepare the response with customer and subscription info
    const response: any = {
      found: true,
      hasActiveSubscription,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        created: customer.created,
        metadata: customer.metadata,
      }
    };

    // Add subscription details if available
    if (subscriptions.data.length > 0) {
      const subscription = subscriptions.data[0];
      
      // The plan object might be at different locations depending on Stripe API version
      // Type casting is necessary because the Stripe types don't include the plan property directly
      const planData = (subscription as any).plan || (subscription as any).items?.data[0]?.plan;
      
      response.subscription = {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        plan: planData ? {
          id: planData.id,
          name: planData.nickname || 'Standard Plan',
          amount: planData.amount,
          currency: planData.currency,
          interval: planData.interval,
          intervalCount: planData.interval_count,
        } : null,
        paymentMethod: subscription.default_payment_method,
      };
    }

    // Add invoice data if available
    if (recentInvoices.length > 0) {
      response.recentInvoices = recentInvoices;
    }

    // Add upcoming invoice if available
    if (upcomingInvoice) {
      response.upcomingInvoice = upcomingInvoice;
    }

    console.log('Returning successful response with customer data');
    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('Error in Stripe API route:', error);
    
    // Provide more specific error messages for common Stripe errors
    if (error instanceof Stripe.errors.StripeAuthenticationError) {
      return NextResponse.json(
        { found: false, error: 'Invalid Stripe API key. Please check your Stripe settings.' },
        { status: 401 }
      );
    } else if (error instanceof Stripe.errors.StripeRateLimitError) {
      return NextResponse.json(
        { found: false, error: 'Too many requests to Stripe. Please try again later.' },
        { status: 429 }
      );
    } else if (error instanceof Stripe.errors.StripeConnectionError) {
      return NextResponse.json(
        { found: false, error: 'Could not connect to Stripe. Please check your internet connection and try again.' },
        { status: 503 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { found: false, error: errorMessage },
      { status: 500 }
    );
  }
}
