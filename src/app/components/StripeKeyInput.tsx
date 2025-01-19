'use client';

import { useState } from 'react';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import { collection, addDoc } from 'firebase/firestore';

interface Props {
  userEmail: string;
  onSuccess: () => void;
}

export default function StripeKeyInput({ userEmail, onSuccess }: Props) {
  const [stripeKey, setStripeKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const db = getFirebaseDB();
      if (!db) {
        throw new Error('Database not initialized. Please refresh the page and try again.');
      }

      // Save to Firestore
      await addDoc(collection(db, 'stripeKeys'), {
        userEmail,
        apiKey: stripeKey,
        createdAt: new Date().toISOString()
      });

      setStripeKey('');
      onSuccess();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save Stripe key. Please try again.';
      setError(errorMessage);
      console.error('Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Enter Your Stripe API Key</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="stripeKey" className="block text-sm font-medium text-gray-700">
            Stripe Secret Key
          </label>
          <input
            id="stripeKey"
            type="password"
            value={stripeKey}
            onChange={(e) => setStripeKey(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="sk_live_..."
            required
          />
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {isLoading ? 'Saving...' : 'Save API Key'}
        </button>
      </form>
    </div>
  );
} 