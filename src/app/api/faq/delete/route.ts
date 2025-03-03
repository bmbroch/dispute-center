import { NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { doc, deleteDoc } from 'firebase/firestore';

export async function DELETE(req: Request) {
  try {
    // Get auth token from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const accessToken = authHeader.split(' ')[1];
    if (!accessToken) {
      return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 });
    }

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userInfoResponse.ok) {
      return NextResponse.json({ error: 'Failed to verify user' }, { status: 401 });
    }

    const userInfo = await userInfoResponse.json();
    const userEmail = userInfo.email;

    if (!userEmail) {
      return NextResponse.json({ error: 'User email not found' }, { status: 401 });
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: 'FAQ ID is required' },
        { status: 400 }
      );
    }

    // Get Firebase instance
    const db = getFirebaseDB();
    if (!db) {
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 500 }
      );
    }

    // Delete the FAQ document from the user's subcollection
    await deleteDoc(doc(db, 'users', userEmail, 'faqs', id));

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting FAQ:', error);
    return NextResponse.json(
      { error: 'Failed to delete FAQ' },
      { status: 500 }
    );
  }
}
