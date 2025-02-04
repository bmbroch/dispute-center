import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google/auth';

export async function GET() {
  try {
    const url = getAuthUrl();
    return NextResponse.json({ url });
  } catch (error) {
    console.error('Error getting auth URL:', error);
    return NextResponse.json(
      { error: 'Failed to get auth URL' },
      { status: 500 }
    );
  }
} 