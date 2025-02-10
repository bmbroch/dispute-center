import { NextResponse } from 'next/server';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';

export async function GET(req: Request) {
  const userEmail = req.headers.get('x-user-email');

  if (!userEmail) {
    return NextResponse.json(
      { error: 'User email is required' },
      { status: 400 }
    );
  }

  try {
    const db = getFirebaseDB();
    if (!db) {
      throw new Error('Failed to initialize Firebase');
    }

    const userSettingsRef = doc(db, 'userSettings', userEmail);
    const docSnap = await getDoc(userSettingsRef);

    if (!docSnap.exists()) {
      // Return default settings if none exist
      return NextResponse.json({
        confidenceThreshold: 80,
        emailFormatting: {
          greeting: "Hi [Name]!",
          listStyle: 'numbered',
          spacing: 'normal',
          signatureStyle: "Best,\n[Name]",
          customPrompt: "Please keep responses friendly but professional. Use proper spacing between paragraphs and lists."
        }
      });
    }

    return NextResponse.json(docSnap.data());
  } catch (error) {
    console.error('Error fetching user settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user settings' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const userEmail = req.headers.get('x-user-email');

  if (!userEmail) {
    return NextResponse.json(
      { error: 'User email is required' },
      { status: 400 }
    );
  }

  try {
    const settings = await req.json();
    const db = getFirebaseDB();
    if (!db) {
      throw new Error('Failed to initialize Firebase');
    }

    // Validate settings object
    if (!settings || typeof settings !== 'object') {
      return NextResponse.json(
        { error: 'Invalid settings format' },
        { status: 400 }
      );
    }

    const userSettingsRef = doc(db, 'userSettings', userEmail);
    await setDoc(userSettingsRef, {
      ...settings,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Error saving user settings:', error);
    return NextResponse.json(
      { error: 'Failed to save user settings' },
      { status: 500 }
    );
  }
} 