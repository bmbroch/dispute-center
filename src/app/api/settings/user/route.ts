import { NextResponse } from 'next/server';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';

interface UserSettings {
  confidenceThreshold: number;
  emailTemplates?: any[];
  // Add other settings as needed
}

export async function GET(req: Request) {
  try {
    const userEmail = req.headers.get('x-user-email');
    if (!userEmail) {
      return NextResponse.json(
        { error: 'User email is required' },
        { status: 400 }
      );
    }

    const db = getFirebaseDB();
    if (!db) {
      throw new Error('Failed to initialize Firebase');
    }

    const userSettingsRef = doc(db, 'userSettings', userEmail);
    const docSnap = await getDoc(userSettingsRef);

    if (!docSnap.exists()) {
      // Return default settings if none exist
      const defaultSettings: UserSettings = {
        confidenceThreshold: 80,
      };
      return NextResponse.json(defaultSettings);
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
  try {
    const userEmail = req.headers.get('x-user-email');
    if (!userEmail) {
      return NextResponse.json(
        { error: 'User email is required' },
        { status: 400 }
      );
    }

    const settings = await req.json();
    const db = getFirebaseDB();
    if (!db) {
      throw new Error('Failed to initialize Firebase');
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