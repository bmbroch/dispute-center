import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';

export async function POST(request: Request) {
  try {
    const { userEmail } = await request.json();

    if (!userEmail) {
      return NextResponse.json({ error: 'User email is required' }, { status: 400 });
    }

    // Find and delete the key
    const stripeKeysRef = collection(db, 'stripeKeys');
    const q = query(stripeKeysRef, where('userEmail', '==', userEmail));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return NextResponse.json({ error: 'No Stripe API key found' }, { status: 404 });
    }

    // Delete the document
    await deleteDoc(querySnapshot.docs[0].ref);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting Stripe API key:', error);
    return NextResponse.json({ 
      error: 'Failed to delete Stripe API key',
      details: error.message 
    }, { status: 500 });
  }
} 