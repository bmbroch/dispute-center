'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useState, useEffect } from 'react';
import DisputesTable from '../components/DisputesTable';
import LoginSplashScreen from '../components/LoginSplashScreen';
import { useRouter } from 'next/navigation';

export default function DisputePage() {
  const { user, loading: authLoading } = useAuth();
  const [disputeCount, setDisputeCount] = useState(0);
  const [showLoginSplash, setShowLoginSplash] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!user && !authLoading) {
      setShowLoginSplash(true);
    }
  }, [user, authLoading]);

  // Close login splash when user is authenticated
  useEffect(() => {
    if (user && showLoginSplash) {
      setShowLoginSplash(false);
    }
  }, [user, showLoginSplash]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-red-600 border-t-transparent"></div>
        <p className="mt-4 text-gray-600">Loading...</p>
      </div>
    );
  }

  const handleCloseLogin = () => {
    setShowLoginSplash(false);
    // Only redirect to home if user is not authenticated
    if (!user) {
      router.push('/');
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold">Dispute Resolution</h1>
              <p className="text-gray-600 mt-2">
                {disputeCount === 0 
                  ? 'No disputes found' 
                  : `${disputeCount} dispute${disputeCount === 1 ? '' : 's'} found`}
              </p>
            </div>
          </div>
          
          {user && (
            <DisputesTable 
              onDisputeCountChange={setDisputeCount}
            />
          )}
        </div>
      </div>

      <LoginSplashScreen
        isOpen={showLoginSplash}
        onClose={handleCloseLogin}
        message="Sign in to manage your disputes and automate responses 🛡️"
      />
    </>
  );
} 