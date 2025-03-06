'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { toast } from 'sonner';
import StripeSubscriptionModal from './StripeSubscriptionModal';

interface StripeSubscriptionInfo {
  found: boolean;
  hasActiveSubscription?: boolean;
  customer?: {
    id: string;
    email: string;
    created: number;
  };
  subscription?: {
    id: string;
    status: string;
    currentPeriodStart: number;
    currentPeriodEnd: number;
    plan: {
      id: string;
      name: string;
      amount: number;
      currency: string;
    };
  };
}

interface StripeStatusIconProps {
  customerEmail: string;
}

export default function StripeStatusIcon({ customerEmail }: StripeStatusIconProps) {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [subscriptionInfo, setSubscriptionInfo] = useState<StripeSubscriptionInfo | null>(null);

  const checkStripeStatus = async () => {
    if (!user?.email) {
      toast.error('Please log in to check Stripe status');
      return;
    }

    setIsLoading(true);
    try {
      const cleanEmail = customerEmail.toLowerCase().trim();
      console.log('Checking Stripe status for email:', {
        original: customerEmail,
        cleaned: cleanEmail
      });

      const response = await fetch(
        `/api/stripe/check-subscription?customerEmail=${encodeURIComponent(cleanEmail)}&userEmail=${encodeURIComponent(user.email)}`
      );

      if (!response.ok) {
        const error = await response.json();
        console.error('Stripe check error:', error);
        throw new Error(error.error || error.details || 'Failed to check Stripe status');
      }

      const data = await response.json();
      console.log('Stripe check response:', data);
      setSubscriptionInfo(data);
      setShowModal(true);

      if (!data.found) {
        toast.info('Customer not found in Stripe');
      } else if (!data.hasActiveSubscription) {
        toast.info('Customer found but has no active subscription');
      } else {
        toast.success('Active subscription found');
      }
    } catch (error: any) {
      console.error('Error checking Stripe status:', error);
      toast.error(error.message);
      setSubscriptionInfo(null);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <>
      <button
        onClick={checkStripeStatus}
        className={`p-1.5 rounded-full transition-colors ${isLoading ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
        disabled={isLoading}
        title="Check Stripe Status"
      >
        <svg
          className={`w-4 h-4 ${isLoading ? 'animate-pulse text-gray-400' :
              subscriptionInfo?.hasActiveSubscription ? 'text-[#635BFF]' :
                subscriptionInfo?.found ? 'text-gray-400' : 'text-gray-400'
            }`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 23.01 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
        </svg>
      </button>

      <StripeSubscriptionModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        subscriptionInfo={subscriptionInfo}
      />
    </>
  );
}
