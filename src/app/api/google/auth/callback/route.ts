import { NextResponse } from 'next/server';
import { getTokens } from '@/lib/google/auth';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { getAuth } from '@/lib/firebase/firebaseUtils';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      console.error('Google OAuth error:', error);
      return NextResponse.redirect('/knowledge?error=auth_failed');
    }

    if (!code) {
      return NextResponse.redirect('/knowledge?error=no_code');
    }

    // Get tokens from Google
    const tokens = await getTokens(code);

    // Get current user
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      return NextResponse.redirect('/knowledge?error=not_authenticated');
    }

    // Save tokens to Firestore
    const db = getFirebaseDB();
    await setDoc(doc(db, 'users', user.uid), {
      googleTokens: tokens,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    return NextResponse.redirect('/knowledge?success=true');
  } catch (error) {
    console.error('Error in Google OAuth callback:', error);
    return NextResponse.redirect('/knowledge?error=callback_failed');
  }
} 