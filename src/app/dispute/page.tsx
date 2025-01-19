'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useState } from 'react';
import DisputesTable from '../components/DisputesTable';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function DisputePage() {
  const { user, loading: authLoading } = useAuth();
  const [disputeCount, setDisputeCount] = useState(0);

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-red-600 border-t-transparent"></div>
        <p className="mt-4 text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <h1 className="text-4xl font-bold mb-8">Stripe Dispute Center</h1>
        <GoogleSignInButton />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Stripe Dispute Center</h1>
            <p className="text-gray-600 mt-2">
              {disputeCount === 0 
                ? 'No disputes found' 
                : `${disputeCount} dispute${disputeCount === 1 ? '' : 's'} found`}
            </p>
          </div>
        </div>
        
        <DisputesTable 
          onDisputeCountChange={setDisputeCount}
        />
      </div>
    </div>
  );
} 