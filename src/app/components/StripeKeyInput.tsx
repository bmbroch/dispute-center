'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useStripeMetrics } from '@/lib/hooks/useStripeMetrics';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, addDoc, query, where, getDocs, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { toast } from 'sonner';

interface StripeKeyInputProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function StripeKeyInput({ onClose, onSuccess }: StripeKeyInputProps) {
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingKeyId, setExistingKeyId] = useState<string | null>(null);
  const [lastFourDigits, setLastFourDigits] = useState<string>('');
  const { user } = useAuth();
  const { checkStripeKey, hasStripeKey } = useStripeMetrics();

  // Check for existing key on mount
  useEffect(() => {
    async function fetchExistingKey() {
      if (!user?.email) return;

      try {
        const db = getFirebaseDB();
        if (!db) throw new Error('Database not initialized');

        const stripeKeysRef = collection(db, 'stripeKeys');
        const q = query(stripeKeysRef, where('userEmail', '==', user.email));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          const data = doc.data();
          setExistingKeyId(doc.id);
          // Only store the last 4 digits of the key
          setLastFourDigits(data.stripeKey.slice(-4));
          setApiKey('');
        }
      } catch (err) {
        console.error('Error fetching existing key:', err);
      }
    }

    fetchExistingKey();
  }, [user?.email]);

  const checkKeyStatus = async () => {
    if (!user?.email) return;
    
    const db = getFirebaseDB();
    if (!db) return;

    const stripeKeysRef = collection(db, 'stripeKeys');
    const q = query(stripeKeysRef, where('userEmail', '==', user.email));
    const querySnapshot = await getDocs(q);
    
    return !querySnapshot.empty;
  };

  const handleDelete = async () => {
    if (!existingKeyId || !user?.email) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      const db = getFirebaseDB();
      if (!db) throw new Error('Database not initialized');

      const keyRef = doc(db, 'stripeKeys', existingKeyId);
      await deleteDoc(keyRef);

      toast.success('API key deleted successfully');
      onClose();
      
      // Wait a moment for Firebase to process, then refresh
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.error('Error deleting Stripe key:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete API key');
      toast.error('Failed to delete API key');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;

    setIsLoading(true);
    setError(null);

    try {
      // Validate the API key format
      if ((!apiKey.startsWith('sk_') && !apiKey.startsWith('rk_')) || apiKey.length < 20) {
        throw new Error('Invalid API key format. It should start with "sk_" or "rk_" and be at least 20 characters long.');
      }

      const db = getFirebaseDB();
      if (!db) throw new Error('Database not initialized');

      if (existingKeyId) {
        // Update existing key
        const keyRef = doc(db, 'stripeKeys', existingKeyId);
        await updateDoc(keyRef, {
          stripeKey: apiKey,
          updatedAt: new Date().toISOString()
        });
        toast.success('API key updated successfully');
      } else {
        // Add new key
        await addDoc(collection(db, 'stripeKeys'), {
          userEmail: user.email,
          stripeKey: apiKey,
          createdAt: new Date().toISOString()
        });
        toast.success('API key added successfully');
      }

      onClose();
      
      // Wait a moment for Firebase to process, then refresh
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.error('Error saving Stripe key:', err);
      setError(err instanceof Error ? err.message : 'Failed to save API key');
      toast.error(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold mb-4">
          {hasStripeKey ? 'Edit Your Stripe API Key' : 'Add Your Stripe API Key'}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
              Secret Key
            </label>
            <input
              type="password"
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              placeholder={hasStripeKey ? `Current: •••• ${lastFourDigits}` : 'sk_live_...'}
              required
            />
            {hasStripeKey && (
              <p className="mt-1 text-sm text-gray-500">
                Enter your new API key to update the existing one
              </p>
            )}
          </div>
          {error && (
            <div className="mb-4 text-sm text-red-600">
              {error}
            </div>
          )}
          <div className="flex justify-between items-center">
            {hasStripeKey && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                disabled={isLoading}
              >
                Delete Key
              </button>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg border border-gray-300"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                disabled={isLoading}
              >
                {isLoading ? 'Saving...' : (hasStripeKey ? 'Update API Key' : 'Save API Key')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
} 