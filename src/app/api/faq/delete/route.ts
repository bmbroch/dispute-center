import { NextResponse } from 'next/server';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { doc, deleteDoc } from 'firebase/firestore';

export async function DELETE(req: Request) {
  try {
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

    console.log('Deleting FAQ with ID:', id);

    // Delete the FAQ document by ID
    await deleteDoc(doc(db, 'faqs', id));

    console.log('Successfully deleted FAQ');

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting FAQ:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete FAQ',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
