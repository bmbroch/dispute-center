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
    <div className="w-[600px] mx-auto p-8 bg-white rounded-2xl shadow-xl">
      <div className="flex items-start justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Enter Your Stripe API Key</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="stripeKey" className="block text-sm font-medium text-gray-700">
            Stripe Secret Key
          </label>
          <div className="relative">
            <input
              id="stripeKey"
              type="password"
              value={stripeKey}
              onChange={(e) => setStripeKey(e.target.value)}
              className="block w-full px-4 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-[#635BFF] focus:border-transparent transition-colors"
              placeholder="sk_live_..."
              required
            />
          </div>
          <p className="text-sm text-gray-500">
            Your key will be encrypted and stored securely
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-[#635BFF] hover:bg-[#635BFF]/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#635BFF] disabled:opacity-50 transition-colors"
        >
          {isLoading ? 'Saving...' : 'Save API Key'}
        </button>
      </form>
    </div>
  );
} 