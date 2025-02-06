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

      // First check if we have a key in Firebase
      const stripeKeysRef = collection(db, 'stripeKeys');
      const q = query(stripeKeysRef, where('userEmail', '==', user.email));
      const querySnapshot = await getDocs(q);
      const hasKey = !querySnapshot.empty;

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
        // If the API call fails, we still have a key, just can't get metrics
        console.error('Error fetching Stripe metrics:', apiError);
        setMetrics(prev => ({
          ...prev,
          isLoading: false,
          error: apiError instanceof Error ? apiError.message : 'Failed to fetch metrics',
          hasStripeKey: true // Keep this true since we have a key
        }));
      }
    } catch (error) {
      // This catch block is for Firebase errors
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