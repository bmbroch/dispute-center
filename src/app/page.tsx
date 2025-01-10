'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import StripeKeyInput from './components/StripeKeyInput';
import DisputesTable from './components/DisputesTable';
import Header from './components/Header';
import GoogleSignInButton from './components/GoogleSignInButton';
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/firebase';
import DisputeTable from '@/app/components/DisputeTable';

export default function Home() {
  const { user } = useAuth();
  const [hasStripeKey, setHasStripeKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showStripeKeyModal, setShowStripeKeyModal] = useState(false);

  const checkStripeKey = async () => {
    if (!user?.email) {
      setIsLoading(false);
      return;
    }

    try {
      const stripeKeysRef = collection(db, 'stripeKeys');
      const q = query(stripeKeysRef, where('userEmail', '==', user.email));
      const querySnapshot = await getDocs(q);
      setHasStripeKey(!querySnapshot.empty);
    } catch (error) {
      console.error('Error checking Stripe key:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkStripeKey();
  }, [user?.email]);

  const handleStripeKeySuccess = () => {
    checkStripeKey();
    setShowStripeKeyModal(false);
  };

  const handleStripeLogoClick = () => {
    setShowStripeKeyModal(true);
  };

  if (!user) {
    return (
      <>
        <Header onStripeLogoClick={handleStripeLogoClick} />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Welcome to Dispute Center</h1>
            <p className="text-gray-600 mb-6">Please sign in to continue.</p>
            <GoogleSignInButton />
          </div>
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <Header onStripeLogoClick={handleStripeLogoClick} />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header onStripeLogoClick={handleStripeLogoClick} />
      <main className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Modal */}
          {showStripeKeyModal && (
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                <div className="flex justify-between items-center p-4 border-b">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {hasStripeKey ? 'Update Stripe API Key' : 'Add Stripe API Key'}
                  </h2>
                  <button
                    onClick={() => setShowStripeKeyModal(false)}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="p-4">
                  <StripeKeyInput onSuccess={handleStripeKeySuccess} hasExistingKey={hasStripeKey} />
                </div>
              </div>
            </div>
          )}

          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Dispute Center</h1>
            <p className="mt-2 text-gray-600">Manage your Stripe disputes efficiently</p>
          </div>

          {!hasStripeKey ? (
            <div className="text-center">
              <p className="text-gray-600 mb-4">Please add your Stripe API key to get started</p>
              <button
                onClick={() => setShowStripeKeyModal(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Add Stripe API Key
              </button>
            </div>
          ) : (
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Your Disputes</h2>
              <DisputeTable />
            </div>
          )}
        </div>
      </main>
    </>
  );
}
