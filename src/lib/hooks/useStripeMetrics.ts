import { useEffect, useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

interface StripeMetrics {
  activeDisputes: number | null;
  responseDrafts: number | null;
  isLoading: boolean;
  error: string | null;
  hasStripeKey: boolean;
}

// Cache for Stripe key status to avoid repeated Firebase queries
const stripeKeyCache = new Map<string, { hasKey: boolean; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function useStripeMetrics(): StripeMetrics & { checkStripeKey: () => Promise<void> } {
  const [metrics, setMetrics] = useState<StripeMetrics>({
    activeDisputes: null,
    responseDrafts: null,
    isLoading: true,
    error: null,
    hasStripeKey: false
  });
  const { user } = useAuth();

  const checkStripeKey = useCallback(async () => {
    if (!user?.email) {
      setMetrics(prev => ({ 
        ...prev, 
        isLoading: false,
        error: user ? 'User email is required' : 'Please sign in to view metrics',
        hasStripeKey: false
      }));
      return;
    }

    try {
      const db = getFirebaseDB();
      if (!db) {
        setMetrics(prev => ({
          ...prev,
          isLoading: false,
          error: 'Failed to initialize Firebase',
          hasStripeKey: false
        }));
        return;
      }

      // Check cache first
      const cachedResult = stripeKeyCache.get(user.email);
      const now = Date.now();
      if (cachedResult && (now - cachedResult.timestamp) < CACHE_DURATION) {
        // If we have a valid cache hit, use it and fetch metrics if needed
        if (cachedResult.hasKey) {
          // Fetch metrics in the background
          fetch(`/api/stripe/metrics?userEmail=${encodeURIComponent(user.email)}`)
            .then(response => response.json())
            .then(data => {
              setMetrics(prev => ({
                ...prev,
                activeDisputes: data.activeDisputes,
                responseDrafts: data.responseDrafts,
                isLoading: false,
                error: null,
                hasStripeKey: true
              }));
            })
            .catch(error => {
              console.error('Error fetching Stripe metrics:', error);
              setMetrics(prev => ({
                ...prev,
                isLoading: false,
                error: error instanceof Error ? error.message : 'Failed to fetch metrics',
                hasStripeKey: true
              }));
            });
          return;
        } else {
          setMetrics(prev => ({
            ...prev,
            isLoading: false,
            hasStripeKey: false,
            error: 'No Stripe key found. Please add your Stripe key to continue.'
          }));
          return;
        }
      }

      // If no cache or cache expired, check Firebase
      const stripeKeysRef = collection(db, 'stripeKeys');
      const q = query(stripeKeysRef, where('userEmail', '==', user.email));
      const querySnapshot = await getDocs(q);
      const hasKey = !querySnapshot.empty;

      // Update cache
      stripeKeyCache.set(user.email, { hasKey, timestamp: now });

      if (!hasKey) {
        setMetrics(prev => ({ 
          ...prev, 
          isLoading: false,
          hasStripeKey: false,
          error: 'No Stripe key found. Please add your Stripe key to continue.'
        }));
        return;
      }

      // If we have a key, fetch the metrics
      try {
        const response = await fetch(`/api/stripe/metrics?userEmail=${encodeURIComponent(user.email)}`);
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to fetch Stripe metrics');
        }

        const data = await response.json();
        setMetrics({
          activeDisputes: data.activeDisputes,
          responseDrafts: data.responseDrafts,
          isLoading: false,
          error: null,
          hasStripeKey: true
        });
      } catch (apiError) {
        console.error('Error fetching Stripe metrics:', apiError);
        setMetrics(prev => ({
          ...prev,
          isLoading: false,
          error: apiError instanceof Error ? apiError.message : 'Failed to fetch metrics',
          hasStripeKey: true
        }));
      }
    } catch (error) {
      console.error('Error in useStripeMetrics:', error);
      setMetrics(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to check Stripe key',
        hasStripeKey: false
      }));
    }
  }, [user]);

  // Initial check on mount and when user changes
  useEffect(() => {
    checkStripeKey();
  }, [checkStripeKey]);

  return {
    ...metrics,
    checkStripeKey
  };
} 