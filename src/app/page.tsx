'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useStripeMetrics } from '@/lib/hooks/useStripeMetrics';
import LoginSplashScreen from './components/LoginSplashScreen';
import { SubscriptionDashboard } from "@/app/components/SubscriptionDashboard";
import { motion } from "framer-motion";
import Image from "next/image";
import { CheckCircle2, Circle, Mail, CreditCard, LogOut, HelpCircle } from 'lucide-react';
import StripeKeyInput from './components/StripeKeyInput';
import * as Tooltip from '@radix-ui/react-tooltip';
import Link from 'next/link';

function PageContent() {
  const [showLoginSplash, setShowLoginSplash] = useState(false);
  const [showStripeKeyInput, setShowStripeKeyInput] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { activeDisputes, responseDrafts, isLoading, hasStripeKey } = useStripeMetrics();
  
  useEffect(() => {
    // Check if there's a redirect parameter and user is not authenticated
    const redirect = searchParams.get('redirect');
    if (redirect && !user) {
      setShowLoginSplash(true);
    }
  }, [searchParams, user]);

  // Handle successful login
  useEffect(() => {
    if (user && showLoginSplash) {
      const redirect = searchParams.get('redirect');
      if (redirect) {
        router.push(redirect);
      }
      setShowLoginSplash(false);
    }
  }, [user, showLoginSplash, searchParams, router]);

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

  const handleStripeKeySuccess = () => {
    setShowStripeKeyInput(false);
    // The useStripeMetrics hook will automatically refetch the metrics
  };

  const renderSetupChecklist = () => {
    return (
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Setup</h3>
        <div className="space-y-4">
          <div className="flex items-start gap-3 group">
            <div className="mt-1 flex-shrink-0">
              {user ? (
                <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center p-1.5">
                  <svg viewBox="0 0 24 24" className="w-full h-full">
                    <path
                      fill="#EA4335"
                      d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
                    />
                  </svg>
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center p-1.5">
                  <svg viewBox="0 0 24 24" className="w-full h-full">
                    <path
                      fill="#9CA3AF"
                      d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
                    />
                  </svg>
                </div>
              )}
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
                  onClick={() => setShowLoginSplash(true)}
                  className="text-sm text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                >
                  Connect Gmail <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3 group">
            <div className="mt-1 flex-shrink-0">
              {hasStripeKey ? (
                <div className="w-8 h-8 rounded-full bg-[#635BFF] flex items-center justify-center p-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-full h-full">
                    <path d="M13.976 9.15c-2.172-.806-3.396-1.38-3.396-2.418 0-.836.918-1.415 2.322-1.415 2.691 0 5.473 1.025 7.2 1.834V2.17C18.151 1.206 15.315.6 12.674.6 7.82.6 4.588 3.13 4.588 7.262c0 4.068 3.73 5.643 6.933 6.754 2.855.935 3.83 1.576 3.83 2.594 0 1.002-.987 1.673-2.611 1.673-2.172 0-5.514-1.025-7.844-2.049v5.124c2.467 1.09 5.449 1.642 7.844 1.642 5.017 0 8.249-2.497 8.249-6.673 0-4.132-3.462-5.55-7.013-6.754z" fill="#ffffff"/>
                  </svg>
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center p-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-full h-full">
                    <path d="M13.976 9.15c-2.172-.806-3.396-1.38-3.396-2.418 0-.836.918-1.415 2.322-1.415 2.691 0 5.473 1.025 7.2 1.834V2.17C18.151 1.206 15.315.6 12.674.6 7.82.6 4.588 3.13 4.588 7.262c0 4.068 3.73 5.643 6.933 6.754 2.855.935 3.83 1.576 3.83 2.594 0 1.002-.987 1.673-2.611 1.673-2.172 0-5.514-1.025-7.844-2.049v5.124c2.467 1.09 5.449 1.642 7.844 1.642 5.017 0 8.249-2.497 8.249-6.673 0-4.132-3.462-5.55-7.013-6.754z" fill="#9CA3AF"/>
                  </svg>
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-gray-900 font-medium">Connect Stripe Account</p>
                  <Tooltip.Provider delayDuration={300}>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <button className="inline-flex items-center justify-center text-gray-400 hover:text-gray-500">
                          <HelpCircle className="w-4 h-4" />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          className="max-w-[320px] bg-white p-4 rounded-xl shadow-lg border border-gray-200"
                          sideOffset={5}
                        >
                          <div className="space-y-2 text-sm text-gray-600">
                            <p>We need your API key 🔑 to securely connect Subspond to your subscription platform.</p>
                            <p>This allows us to fetch subscription details 🛍️ and automate responses to customer inquiries ✉️, saving you time and effort.</p>
                            <p>Don&apos;t worry—your data is safe with us 🔒, and we only use it to make your support process smooth and hassle-free! 😊</p>
                          </div>
                          <Tooltip.Arrow className="fill-white" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </Tooltip.Provider>
                </div>
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
                  Add API Key <span aria-hidden="true">→</span>
                </button>
              )}
              {user && hasStripeKey && (
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
      <header className="border-b border-gray-100 bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">SubHub</h1>
          {!user ? (
            <button 
              onClick={() => setShowLoginSplash(true)}
              className="flex items-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded-lg text-gray-700 shadow-sm"
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span className="text-sm font-medium">Sign in with Google</span>
            </button>
          ) : (
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 px-4 py-2 rounded-lg text-gray-700 shadow-sm"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-medium">Sign Out</span>
            </button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100 mb-12">
          <div className="flex justify-between items-start gap-12">
            <div className="flex-1">
              <motion.div 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
              >
                <h2 className="text-3xl font-bold mb-2 text-gray-800">Welcome to SubHub</h2>
                <p className="text-gray-600">Your subscription management command center.</p>
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

        <div className="grid lg:grid-cols-3 gap-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="group"
          >
            <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-coral/50 transition-all duration-300 shadow-sm hover:shadow-xl">
              <div className="relative h-64 overflow-hidden">
                <Image
                  src="/dispute_image.webp"
                  alt="3D illustration of dispute resolution system with floating messages and scales of justice"
                  className="object-cover transform group-hover:scale-105 transition-transform duration-300"
                  fill
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <h3 className="absolute bottom-4 left-6 text-2xl font-semibold text-white">Dispute Resolution</h3>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div className="w-2 h-2 rounded-full bg-coral animate-ping absolute" />
                      <div className="w-2 h-2 rounded-full bg-coral relative" />
                    </div>
                    <span className="text-sm text-gray-600 font-medium">
                      {isLoading ? (
                        <div className="h-4 w-16 bg-gray-200 animate-pulse rounded" />
                      ) : activeDisputes === null ? (
                        "Connect Stripe"
                      ) : (
                        `${activeDisputes} active disputes`
                      )}
                    </span>
                  </div>
                  <div className="w-px h-4 bg-gray-200" />
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div className="w-2 h-2 rounded-full bg-teal animate-ping absolute" />
                      <div className="w-2 h-2 rounded-full bg-teal relative" />
                    </div>
                    <span className="text-sm text-gray-600 font-medium">
                      {isLoading ? (
                        <div className="h-4 w-24 bg-gray-200 animate-pulse rounded" />
                      ) : responseDrafts === null ? (
                        "Connect Stripe"
                      ) : (
                        `${responseDrafts} response drafts ready`
                      )}
                    </span>
                  </div>
                </div>
                <p className="text-gray-600 mb-6 font-medium">
                  Automate customer inquiries and manage disputes efficiently.
                </p>
                {user ? (
                  <Link 
                    href="/dispute"
                    className="group/button relative w-full bg-[#EE6352] text-white overflow-hidden px-6 py-3 rounded-xl text-sm font-medium hover:shadow-lg transition-all duration-300 inline-flex items-center justify-center"
                  >
                    <span className="font-semibold">Review Disputes 🚀</span>
                  </Link>
                ) : (
                  <button 
                    onClick={() => setShowLoginSplash(true)}
                    className="group/button relative w-full bg-[#EE6352] text-white overflow-hidden px-6 py-3 rounded-xl text-sm font-medium hover:shadow-lg transition-all duration-300"
                  >
                    <div className="relative flex items-center justify-center gap-2">
                      <span className="font-semibold">Get Started 🚀</span>
                    </div>
                  </button>
                )}
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="group"
          >
            <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-teal/50 transition-all duration-300 shadow-sm hover:shadow-xl">
              <div className="relative h-64 overflow-hidden">
                <Image
                  src="/faq-support.webp"
                  alt="Abstract visualization of knowledge base and FAQ system"
                  className="object-cover transform group-hover:scale-105 transition-transform duration-300"
                  fill
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <h3 className="absolute bottom-4 left-6 text-2xl font-semibold text-white">FAQ & Support</h3>
              </div>
              <div className="p-6">
                <p className="text-gray-600 mb-6">
                  Access our comprehensive knowledge base for instant answers to billing questions.
                </p>
                <button 
                  onClick={() => user ? router.push('/faq') : setShowLoginSplash(true)}
                  className="group/button relative w-full bg-[#EE6352] text-white overflow-hidden px-6 py-3 rounded-xl text-sm font-medium hover:shadow-lg transition-all duration-300"
                >
                  <div className="relative flex items-center justify-center gap-2">
                    <span className="font-semibold">{user ? 'View Articles' : 'Browse Articles'} 📚</span>
                  </div>
                </button>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="group"
          >
            <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-navy/50 transition-all duration-300 shadow-sm hover:shadow-xl">
              <div className="relative h-64 overflow-hidden">
                <Image
                  src="/subscription-management.webp"
                  alt="Abstract visualization of subscription management system"
                  className="object-cover transform group-hover:scale-105 transition-transform duration-300"
                  fill
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <h3 className="absolute bottom-4 left-6 text-2xl font-semibold text-white">Subscription Management</h3>
              </div>
              <div className="p-6">
                <p className="text-gray-600 mb-6">
                  Efficiently manage all your customer subscriptions and billing plans.
                </p>
                <button 
                  onClick={() => user ? router.push('/subscriptions') : setShowLoginSplash(true)}
                  className="group/button relative w-full bg-[#EE6352] text-white overflow-hidden px-6 py-3 rounded-xl text-sm font-medium hover:shadow-lg transition-all duration-300"
                >
                  <div className="relative flex items-center justify-center gap-2">
                    <span className="font-semibold">{user ? 'View Subscriptions' : 'Start Managing'} 📊</span>
                  </div>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      <LoginSplashScreen
        isOpen={showLoginSplash}
        onClose={handleCloseLogin}
        message="Sign in to automate customer inquiries ⁉️ & get back to building ⚙️"
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

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </div>
    }>
      <PageContent />
    </Suspense>
  );
}
