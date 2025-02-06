'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useState, useEffect } from 'react';
import DisputeTable from '../components/DisputeTable';
import LoginSplashScreen from '../components/LoginSplashScreen';
import { useRouter } from 'next/navigation';
import { Sidebar } from '../components/Sidebar';
import { LogOut } from 'lucide-react';

export default function DisputePage() {
  const { user, loading: authLoading, signOut } = useAuth();
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

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="pl-64">
        <main className="max-w-7xl mx-auto px-4 py-8">
          {user ? (
            <DisputeTable onDisputeCountChange={setDisputeCount} />
          ) : null}
        </main>
      </div>

      <LoginSplashScreen
        isOpen={showLoginSplash}
        onClose={handleCloseLogin}
        message="Sign in to manage your disputes"
      />
    </div>
  );
} 