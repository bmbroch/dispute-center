'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useStripeMetrics } from '@/lib/hooks/useStripeMetrics';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, query, where, getDocs, updateDoc, doc, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
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
    const fetchStripeKey = async () => {
      if (!user?.email) return;

      try {
        const db = getFirebaseDB();
        if (!db) {
          console.error('Failed to initialize Firebase');
          return;
        }

        const normalizedEmail = user.email.toLowerCase();
        const docRef = doc(db, 'stripeKeys', normalizedEmail);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setExistingKeyId(docSnap.id);
          // Only store the last 4 digits of the key
          setLastFourDigits(docSnap.data().stripeKey.slice(-4));
          setApiKey('');
        }
      } catch (error) {
        console.error('Error fetching Stripe key:', error);
        toast.error('Failed to load Stripe key');
      } finally {
        setIsLoading(false);
      }
    };

    fetchStripeKey();
  }, [user?.email]);

  const checkKeyStatus = async () => {
    if (!user?.email) return false;
    
    const db = getFirebaseDB();
    if (!db) {
      console.error('Failed to initialize Firebase');
      return false;
    }
    
    const normalizedEmail = user.email.toLowerCase();
    const docRef = doc(db, 'stripeKeys', normalizedEmail);
    const docSnap = await getDoc(docRef);
    
    return docSnap.exists();
  };

  const handleDelete = async () => {
    if (!user?.email) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      const db = getFirebaseDB();
      if (!db) {
        throw new Error('Failed to initialize Firebase');
      }
      
      const normalizedEmail = user.email.toLowerCase();
      const docRef = doc(db, 'stripeKeys', normalizedEmail);
      await deleteDoc(docRef);

      toast.success('API key deleted successfully');
      onClose();
      
      // Wait a moment for Firebase to process, then refresh
      setTimeout(() => {
        window.location.reload();
      }, 2000); // Increased timeout to ensure Firebase processes the write
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
      const db = getFirebaseDB();
      if (!db) {
        throw new Error('Failed to initialize Firebase');
      }

      // Validate the API key format
      if ((!apiKey.startsWith('sk_') && !apiKey.startsWith('rk_')) || apiKey.length < 20) {
        throw new Error('Invalid API key format. It should start with "sk_" or "rk_" and be at least 20 characters long.');
      }

      // Use email as document ID and store email in lowercase
      const normalizedEmail = user.email.toLowerCase();
      const docRef = doc(db, 'stripeKeys', normalizedEmail);
      
      // Save or update the key
      interface StripeKeyDoc {
  userEmail: string;
  stripeKey: string;
  updatedAt: string;
  createdAt?: string;
}

const docData: StripeKeyDoc = {
        userEmail: normalizedEmail,
        stripeKey: apiKey,
        updatedAt: new Date().toISOString(),
      };

      // Only add createdAt if this is a new key
      if (!existingKeyId) {
        docData.createdAt = new Date().toISOString();
      }

      // Save with merge to preserve existing fields
      await setDoc(docRef, docData, { merge: true });

      // Verify the key after saving
      const response = await fetch('/api/stripe/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripeKey: apiKey })
      });

      const data = await response.json();
      if (!data.valid) {
        throw new Error('Invalid Stripe key. Please check your key and try again.');
      }

      toast.success(existingKeyId ? 'API key updated successfully' : 'API key added successfully');
      onSuccess();
      onClose();
      
      // Wait a moment for Firebase to process, then refresh
      setTimeout(() => {
        window.location.reload();
      }, 2000); // Increased timeout to ensure Firebase processes the write
    } catch (err) {
      console.error('Error saving Stripe key:', err);
      setError(err instanceof Error ? err.message : 'Failed to save API key');
      toast.error(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse flex space-x-4 p-4">
        <div className="flex-1 space-y-4 py-1">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

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