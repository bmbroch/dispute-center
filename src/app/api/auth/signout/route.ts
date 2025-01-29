import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST() {
  // Remove the auth cookie
  const cookieStore = await cookies();
  cookieStore.delete('auth');
  
  return NextResponse.json({ success: true });
} 