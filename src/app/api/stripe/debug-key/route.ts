import { NextResponse } from 'next/server';
import { getStripeKey, debugStripeKey } from '@/lib/firebase/firebaseUtils';

export async function GET(request: Request) {
  console.log('Stripe debug-key API called');
  
  try {
    const { searchParams } = new URL(request.url);
    const userEmail = searchParams.get('userEmail');

    console.log('API params:', { userEmail });

    if (!userEmail) {
      console.log('Error: Missing userEmail parameter');
      return NextResponse.json({ error: 'User email is required' }, { status: 400 });
    }

    // Get detailed debug information about the Stripe key lookup
    console.log(`Running debug check for user: ${userEmail}`);
    
    // Check if the key exists first
    const stripeKey = await getStripeKey(userEmail);
    const keyExists = !!stripeKey;
    
    // Run more detailed debugging if available
    let debugInfo = {};
    try {
      if (typeof debugStripeKey === 'function') {
        debugInfo = await debugStripeKey(userEmail);
      }
    } catch (debugError) {
      console.error('Error in debug function:', debugError);
    }
    
    return NextResponse.json({
      userEmail,
      keyExists,
      keyLength: stripeKey ? stripeKey.length : 0,
      keyStartsWith: stripeKey ? `${stripeKey.substring(0, 3)}...` : null,
      debugInfo
    });
  } catch (error) {
    console.error('Error in debug-key route:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json({ 
      error: 'Failed to debug Stripe key',
      details: errorMessage,
    }, { status: 500 });
  }
} 