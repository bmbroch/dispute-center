"use client";

import { useAuth } from '@/lib/hooks/useAuth';
import Image from 'next/image';

export default function SignInWithGoogle() {
  const { signIn } = useAuth();

  return (
    <button
      onClick={signIn}
      className="flex items-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded-lg text-gray-700 shadow-sm"
    >
      <Image
        src="/google-logo.svg"
        alt="Google Logo"
        width={20}
        height={20}
      />
      <span className="text-sm font-medium">Sign in with Google</span>
    </button>
  );
}
