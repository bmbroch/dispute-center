'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';
import Image from 'next/image';
import GoogleSignInButton from './GoogleSignInButton';
import { useRouter } from 'next/navigation';

export default function Header() {
  const { user, signOut } = useAuth();
  const [hasStripeKey, setHasStripeKey] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkStripeKey = async () => {
      if (!user?.email) return;

      try {
        const db = getFirebaseDB();
        if (!db) {
          console.error('Database not initialized');
          return;
        }

        const stripeKeysRef = collection(db, 'stripeKeys');
        const q = query(stripeKeysRef, where('userEmail', '==', user.email));
        const querySnapshot = await getDocs(q);
        setHasStripeKey(!querySnapshot.empty);
      } catch (error) {
        console.error('Error checking Stripe key:', error);
      }
    };

    checkStripeKey();
  }, [user?.email]);

  const handleStripeLogoClick = () => {
    // Navigate to stripe key input page or open modal
    // For now, we'll just console.log
    console.log('Stripe logo clicked');
  };

  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo/Title */}
          <div className="flex-shrink-0">
            <h1 className="text-2xl font-bold text-gray-900">Subspond</h1>
          </div>

          {/* Right side items */}
          <div className="flex items-center space-x-4">
            {user ? (
              <>
                {/* Stripe Status */}
                <div className="flex items-center space-x-2">
                  <button 
                    onClick={handleStripeLogoClick}
                    className="relative group"
                    title={hasStripeKey ? "Stripe API key loaded" : "Stripe API still needs to be uploaded"}
                  >
                    <Image
                      src="/stripe-logo.svg"
                      alt="Stripe"
                      width={24}
                      height={24}
                      className="opacity-90"
                    />
                    <div className="absolute -bottom-1 -right-1">
                      {hasStripeKey ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <circle cx="12" cy="12" r="10" className="fill-white" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" className="stroke-green-500" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <circle cx="12" cy="12" r="10" className="fill-white" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" className="stroke-red-500" />
                        </svg>
                      )}
                    </div>
                    
                    {/* Tooltip */}
                    <div className="absolute left-1/2 -translate-x-1/2 -bottom-8 hidden group-hover:block bg-gray-800 text-white text-xs rounded py-1 px-2 whitespace-nowrap">
                      {hasStripeKey ? "Stripe API key loaded" : "Stripe API still needs to be uploaded"}
                    </div>
                  </button>
                </div>

                {/* User Profile */}
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    {user.picture ? (
                      <div className="w-8 h-8 rounded-full overflow-hidden">
                        <Image
                          src={user.picture}
                          alt={user.name || 'User'}
                          width={32}
                          height={32}
                          className="object-cover w-full h-full"
                          priority
                        />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                        <span className="text-gray-500 text-sm">
                          {user.email?.[0]?.toUpperCase() || '?'}
                        </span>
                      </div>
                    )}
                    <span className="hidden sm:inline text-sm text-gray-700">
                      {user.email}
                    </span>
                  </div>

                  {/* Logout Button */}
                  <button
                    onClick={() => signOut()}
                    className="text-sm bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 border border-gray-300 rounded-md shadow-sm transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <GoogleSignInButton />
            )}
          </div>
        </div>
      </div>
    </header>
  );
} 