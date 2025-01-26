'use client';


import { useEffect, useState, Fragment, useCallback } from 'react';
import type Stripe from 'stripe';
import EmailCorrespondence from './EmailCorrespondence';
import { useAuth } from '@/lib/hooks/useAuth';
import DisputeSettingsModal from './DisputeSettingsModal';
import { toast } from 'react-hot-toast';
import EmailComposer from './EmailComposer';

interface DisputeTableProps {
  onDisputeCountChange: (count: number) => void;
}

// Define a custom charge type that matches our needs
interface CustomCharge {
  id: string;
  amount: number;
  created: number;
  description: string;
}

// Define a custom payment intent type
interface CustomPaymentIntent {
  id: string;
  amount: number;
  description: string;
}

// Use type intersection instead of extends
type DisputeWithMeta = Stripe.Dispute & {
  firstName?: string;
  customerEmail?: string;
  disputeCount?: number;
  lastEmailTime?: string;
  lastEmailFromCustomer?: boolean;
  dueDate?: string;
  // Override the charge and payment_intent properties
  charge?: CustomCharge;
  payment_intent?: CustomPaymentIntent;
};

const getTimeSinceLastEmail = (date: string | undefined) => {
  if (!date) return null;
  
  const now = new Date();
  const emailDate = new Date(date);
  const diffTime = Math.abs(now.getTime() - emailDate.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  
  if (diffMonths > 0) {
    return `${diffMonths}mo`;
  }
  if (diffWeeks > 0) {
    return `${diffWeeks}w`;
  }
  if (diffDays > 0) {
    return `${diffDays}d`;
  }
  if (diffHours > 0) {
    return `${diffHours}h`;
  }
  return '<1h';
};

export default function DisputeTable({ onDisputeCountChange }: DisputeTableProps) {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<DisputeWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expandedDispute, setExpandedDispute] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [selectedCustomerEmail, setSelectedCustomerEmail] = useState<string>('');
  const [selectedDisputeId, setSelectedDisputeId] = useState<string>('');

  const refreshDisputes = useCallback(async () => {
    if (!user?.email) {
      setError('User email not found');
      return;
    }

    try {
      setIsRefreshing(true);
      console.log('Fetching disputes for:', user.email);
      
      const response = await fetch(`/api/stripe/disputes?userEmail=${encodeURIComponent(user.email)}`);
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error response:', errorData);
        throw new Error(errorData.error || 'Failed to fetch disputes');
      }
      
      const data = await response.json();
      console.log('Response data:', data);
      
      if (!data.success || !data.data) {
        console.error('Invalid response format:', data);
        throw new Error(data.error || 'Failed to fetch disputes');
      }

      setDisputes(data.data);
      onDisputeCountChange(data.data.length);
    } catch (err) {
      console.error('Error fetching disputes:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch disputes');
      toast.error('Failed to fetch disputes');
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [user?.email, onDisputeCountChange]);

  useEffect(() => {
    refreshDisputes();
  }, [refreshDisputes]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={refreshDisputes}
          className="text-blue-600 hover:text-blue-800"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">
          {disputes.length} disputes found
        </h2>
        <button
          onClick={() => setShowSettings(true)}
          className="text-gray-600 hover:text-gray-900"
          title="Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Customer Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                First Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Reason
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Due Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {disputes.map((dispute) => (
              <Fragment key={dispute.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {dispute.customerEmail || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {dispute.firstName || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {(dispute.amount / 100).toLocaleString('en-US', {
                      style: 'currency',
                      currency: dispute.currency.toUpperCase()
                    })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {dispute.reason.replace(/_/g, ' ')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                      ${dispute.status === 'needs_response' 
                        ? 'bg-red-100 text-red-800' 
                        : 'bg-yellow-100 text-yellow-800'}`}
                    >
                      {dispute.status === 'needs_response' ? 'needs response' : 'warning needs response'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {dispute.lastEmailTime ? (
                      <div className="flex items-center gap-2">
                        <span className={`${
                          dispute.lastEmailFromCustomer 
                            ? 'text-blue-600' 
                            : 'text-gray-500'
                        }`}>
                          {getTimeSinceLastEmail(dispute.lastEmailTime)}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          dispute.lastEmailFromCustomer
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {dispute.lastEmailFromCustomer ? '← From them' : '→ From you'}
                        </span>
                        {dispute.lastEmailFromCustomer && (
                          <span className="text-xs text-red-500">• Needs reply</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {dispute.dueDate || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => setExpandedDispute(expandedDispute === dispute.id ? null : dispute.id)}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        {expandedDispute === dispute.id ? 'Hide Emails' : 'Show Emails'}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCustomerEmail(dispute.customerEmail || '');
                          setSelectedDisputeId(dispute.id);
                          setShowComposer(true);
                        }}
                        className="text-blue-600 hover:text-blue-800"
                        title="New Email"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => refreshDisputes()}
                        disabled={isRefreshing}
                        className={`text-gray-600 hover:text-gray-900 ${isRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Refresh"
                      >
                        <svg 
                          className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedDispute === dispute.id && (
                  <tr>
                    <td colSpan={8} className="px-6 py-4">
                      <div className="bg-white rounded-lg">
                        <EmailCorrespondence 
                          customerEmail={dispute.customerEmail || ''} 
                          disputeId={dispute.id}
                          onEmailSent={refreshDisputes}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <DisputeSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {showComposer && (
        <EmailComposer
          customerEmail={selectedCustomerEmail}
          onClose={() => setShowComposer(false)}
          onEmailSent={() => {
            setShowComposer(false);
            refreshDisputes();
          }}
          threads={[]}
        />
      )}
    </div>
  );
} 