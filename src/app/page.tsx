'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useStripeMetrics } from '@/lib/hooks/useStripeMetrics';
import LoginSplashScreen from './components/LoginSplashScreen';
import { motion } from "framer-motion";
import { MessageSquare, Video, FileText, Book, LogOut } from 'lucide-react';
import StripeKeyInput from './components/StripeKeyInput';
import { FeatureCard } from './components/FeatureCard';
import { Sidebar } from './components/Sidebar';

// Separate component for search params functionality
function SearchParamsHandler({ showLoginSplash, setShowLoginSplash }: { showLoginSplash: boolean; setShowLoginSplash: (show: boolean) => void }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    // Check if there's a redirect parameter and user is not authenticated
    const redirect = searchParams.get('redirect');
    if (redirect && !user) {
      setShowLoginSplash(true);
    }
  }, [searchParams, user, setShowLoginSplash]);

  // Handle successful login
  useEffect(() => {
    if (user && showLoginSplash) {
      const redirect = searchParams.get('redirect');
      if (redirect) {
        router.push(redirect);
      }
      setShowLoginSplash(false);
    }
  }, [user, showLoginSplash, searchParams, router, setShowLoginSplash]);

  return null;
}

export default function Home() {
  const [showLoginSplash, setShowLoginSplash] = useState(false);
  const [showStripeKeyInput, setShowStripeKeyInput] = useState(false);
  const router = useRouter();
  const { user, signOut, signIn } = useAuth();
  const { activeDisputes, responseDrafts, isLoading, hasStripeKey } = useStripeMetrics();
  const [disputeCount, setDisputeCount] = useState(0);

  // Wrap the search params functionality in Suspense
  const searchParamsHandler = (
    <Suspense fallback={null}>
      <SearchParamsHandler 
        showLoginSplash={showLoginSplash}
        setShowLoginSplash={setShowLoginSplash}
      />
    </Suspense>
  );

  const handleCloseLogin = () => {
    setShowLoginSplash(false);
    // Remove the redirect parameter from the URL without triggering a page reload
    const url = new URL(window.location.href);
    url.searchParams.delete('redirect');
    window.history.replaceState({}, '', url);
  };

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  const handleSignIn = async () => {
    try {
      await signIn();
    } catch (error) {
      console.error('Failed to sign in:', error);
      // You could add a toast notification here
    }
  };

  const handleStripeKeySuccess = () => {
    setShowStripeKeyInput(false);
    // The useStripeMetrics hook will automatically refetch the metrics
  };

  const renderSetupChecklist = () => {
    return (
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Setup</h3>
        <div className="space-y-4">
          {/* Gmail Connection Status */}
          <div className="flex items-start gap-3">
            <div className="mt-1 flex-shrink-0">
              <div className={`w-8 h-8 rounded-full ${user ? 'bg-white border border-gray-200' : 'bg-gray-200'} flex items-center justify-center p-1.5`}>
                <svg viewBox="0 0 24 24" className="w-full h-full">
                  <path
                    fill={user ? '#EA4335' : '#9CA3AF'}
                    d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
                  />
                </svg>
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-gray-900 font-medium">Connect Gmail Account</p>
                {user && (
                  <span className="text-sm text-blue-500 font-medium">{user.email}</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-2">Enable email automation for dispute responses</p>
              {!user && (
                <button 
                  onClick={handleSignIn}
                  className="text-sm text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                >
                  Connect Gmail <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          </div>

          {/* Stripe Connection Status */}
          <div className="flex items-start gap-3">
            <div className="mt-1 flex-shrink-0">
              <div className={`w-8 h-8 rounded-full ${hasStripeKey ? 'bg-[#635BFF]' : 'bg-gray-200'} flex items-center justify-center p-1.5`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-full h-full">
                  <path d="M13.976 9.15c-2.172-.806-3.396-1.38-3.396-2.418 0-.836.918-1.415 2.322-1.415 2.691 0 5.473 1.025 7.2 1.834V2.17C18.151 1.206 15.315.6 12.674.6 7.82.6 4.588 3.13 4.588 7.262c0 4.068 3.73 5.643 6.933 6.754 2.855.935 3.83 1.576 3.83 2.594 0 1.002-.987 1.673-2.611 1.673-2.172 0-5.514-1.025-7.844-2.049v5.124c2.467 1.09 5.449 1.642 7.844 1.642 5.017 0 8.249-2.497 8.249-6.673 0-4.132-3.462-5.55-7.013-6.754z" fill={hasStripeKey ? '#ffffff' : '#9CA3AF'}/>
                </svg>
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-gray-900 font-medium">Connect Stripe Account</p>
                {hasStripeKey && (
                  <span className="text-sm text-[#635BFF] font-medium">•••• 4242</span>
                )}
              </div>
              <p className="text-gray-600 mb-2">
                {hasStripeKey 
                  ? 'Your Stripe account is connected and ready to use'
                  : 'Add your Stripe API key to manage subscriptions and disputes'
                }
              </p>
              {user && !hasStripeKey && (
                <button 
                  onClick={() => setShowStripeKeyInput(true)}
                  className="text-sm text-[#635BFF] hover:text-[#635BFF]/80 font-medium flex items-center gap-1"
                >
                  Edit API Key <span aria-hidden="true">→</span>
                </button>
              )}
              {!user && (
                <button 
                  onClick={() => setShowLoginSplash(true)}
                  className="text-sm text-[#635BFF] hover:text-[#635BFF]/80 font-medium flex items-center gap-1"
                >
                  Add API Key <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {searchParamsHandler}
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="pl-64">
        <main className="max-w-5xl mx-auto px-4 py-12">
          <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 mb-12">
            <div className="flex justify-between items-start gap-12">
              <div className="flex-1">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }} 
                  animate={{ opacity: 1, y: 0 }} 
                >
                  <h2 className="text-3xl font-bold mb-2 text-gray-800">Quick Setup</h2>
                  <p className="text-gray-600">Connect your accounts to get started.</p>
                </motion.div>
              </div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ delay: 0.1 }}
                className="flex-1"
              >
                {renderSetupChecklist()}
              </motion.div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <FeatureCard
                title="Dispute Resolution"
                description="Handle customer disputes efficiently with AI-powered responses"
                icon={MessageSquare}
                stats={isLoading ? "Loading..." : `${activeDisputes || 0} active disputes • ${responseDrafts || 0} response drafts ready`}
                href={user ? "/dispute" : undefined}
                buttonText={user ? "Review Disputes" : "Get Started"}
                onClick={!user ? handleSignIn : undefined}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <FeatureCard
                title="Email Templates"
                description="Create and manage professional email templates for every scenario"
                icon={Video}
                stats="15+ templates available"
                href={user ? "/templates" : undefined}
                buttonText="Browse Templates"
                onClick={!user ? handleSignIn : undefined}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <FeatureCard
                title="Response Generator"
                description="AI-powered response generation for common customer inquiries"
                icon={FileText}
                stats="Generate unlimited responses"
                href={user ? "/responses" : undefined}
                buttonText="Start Writing"
                onClick={!user ? handleSignIn : undefined}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <FeatureCard
                title="Knowledge Center"
                description="AI-generated articles and resources for customer communication"
                icon={Book}
                stats="Access comprehensive knowledge base"
                href={user ? "/knowledge" : undefined}
                buttonText="Explore Articles"
                onClick={!user ? handleSignIn : undefined}
              />
            </motion.div>
          </div>
        </main>
      </div>

      <LoginSplashScreen
        isOpen={showLoginSplash}
        onClose={handleCloseLogin}
        message="Sign in to automate customer inquiries ❗ & get back to building 🛠️"
      />

      {showStripeKeyInput && user && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <StripeKeyInput 
            onClose={() => setShowStripeKeyInput(false)}
            onSuccess={handleStripeKeySuccess}
          />
        </div>
      )}
    </div>
  );
}
