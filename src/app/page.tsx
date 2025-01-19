'use client';

import { Suspense } from 'react';
import { SubscriptionDashboard } from "@/app/components/SubscriptionDashboard"
import SignInWithGoogle from "@/app/components/SignInWithGoogle"

export default function Page() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="relative mx-auto max-w-7xl px-8 pt-12">
        <div className="mb-16 flex flex-col items-center text-center">
          <h1 className="text-5xl font-bold tracking-tight text-gray-900 mb-4">
            Stripe Dispute Center
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Manage your disputes with ease.
          </p>
          <SignInWithGoogle />
        </div>
        <Suspense fallback={<div className="animate-pulse h-96 bg-gray-100 rounded-lg"></div>}>
          <div className="mt-12">
            <SubscriptionDashboard />
          </div>
        </Suspense>
      </div>
    </main>
  )
}
