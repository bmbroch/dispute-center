'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';

interface SearchParamsHandlerProps {
  showLoginSplash: boolean;
  setShowLoginSplash: (show: boolean) => void;
}

export default function SearchParamsHandler({ showLoginSplash, setShowLoginSplash }: SearchParamsHandlerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    // Check if there's a redirect parameter and user is not authenticated
    const redirect = searchParams.get('redirect');
    // Only show login splash for non-public paths
    const PUBLIC_PATHS = ['/', '/auth', '/login', '/knowledge'];
    if (redirect && !user && !PUBLIC_PATHS.includes(redirect)) {
      setShowLoginSplash(true);
    }
  }, [searchParams, user, setShowLoginSplash]);

  // Handle successful login
  useEffect(() => {
    if (user && showLoginSplash) {
      const redirect = searchParams.get('redirect');
      if (redirect) {
        router.push(redirect);
      }
      setShowLoginSplash(false);
    }
  }, [user, showLoginSplash, searchParams, router, setShowLoginSplash]);

  return null;
} 