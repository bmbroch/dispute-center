import { useEffect, useState } from 'react';
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

export function useStripeMetrics(): StripeMetrics {
  const [metrics, setMetrics] = useState<StripeMetrics>({
    activeDisputes: null,
    responseDrafts: null,
    isLoading: true,
    error: null,
    hasStripeKey: false
  });
  const { user } = useAuth();

  useEffect(() => {
    async function checkStripeKey() {
      if (!user) {
        setMetrics(prev => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        console.log('Checking Stripe key for user:', user.email);
        const db = getFirebaseDB();
        if (!db) {
          throw new Error('Database not initialized');
        }

        // Check if user has a Stripe key in Firestore
        const stripeKeysRef = collection(db, 'stripeKeys');
        const q = query(stripeKeysRef, where('userEmail', '==', user.email));
        const querySnapshot = await getDocs(q);
        console.log('Query results:', querySnapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })));
        const hasKey = !querySnapshot.empty;
        console.log('Has Stripe key:', hasKey);

        if (!hasKey) {
          setMetrics(prev => ({ 
            ...prev, 
            isLoading: false,
            hasStripeKey: false 
          }));
          return;
        }

        // If we have a key, fetch the metrics
        const response = await fetch(`/api/stripe/metrics?email=${encodeURIComponent(user.email)}`);
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to fetch Stripe metrics');
        }

        const data = await response.json();
        console.log('Stripe metrics:', data);
        setMetrics({
          activeDisputes: data.activeDisputes,
          responseDrafts: data.responseDrafts,
          isLoading: false,
          error: null,
          hasStripeKey: true
        });
      } catch (error) {
        console.error('Error in useStripeMetrics:', error);
        setMetrics({
          activeDisputes: null,
          responseDrafts: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch metrics',
          hasStripeKey: false
        });
      }
    }

    checkStripeKey();
  }, [user]);

  return metrics;
} 