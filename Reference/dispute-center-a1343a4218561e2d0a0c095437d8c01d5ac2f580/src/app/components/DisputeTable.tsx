'use client';

import { useEffect, useState, Fragment, useCallback, useMemo } from 'react';
import type { Stripe } from 'stripe';
import EmailCorrespondence from './EmailCorrespondence';
import { useAuth } from '@/lib/hooks/useAuth';
import DisputeSettingsModal from './DisputeSettingsModal';
import { toast } from 'react-hot-toast';
import EmailComposer from './EmailComposer';
import type { EmailThread } from './EmailCorrespondence';

interface DisputeTableProps {
  onDisputeCountChange: (count: number) => void;
}

// Define custom charge type that matches Stripe v14
interface CustomCharge extends Omit<Stripe.Charge, 'amount' | 'created' | 'description'> {
  amount: number;
  created: number;
  description: string | null;
}

// Define custom payment intent type
interface CustomPaymentIntent extends Omit<Stripe.PaymentIntent, 'amount' | 'description'> {
  amount: number;
  description: string | null;
}

// Use type intersection for better type safety
type DisputeWithMeta = Omit<Stripe.Dispute, 'charge' | 'payment_intent'> & {
  firstName?: string;
  customerEmail?: string;
  disputeCount?: number;
  lastEmailTime?: string;
  lastEmailSubject?: string;
  lastEmailFromCustomer?: boolean;
  dueDate?: string;
  charge?: CustomCharge | string;
  payment_intent?: CustomPaymentIntent | string;
  emailThreads?: EmailThread[];
};

// Constants with proper typing
const CACHE_DURATION: number = 15 * 60 * 1000; // 15 minutes
const POLLING_INTERVAL: number = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_BACKOFF: number = 60 * 1000; // 1 minute

const getTimeAgo = (date: string) => {
  const now = new Date();
  const past = new Date(date);
  const diff = now.getTime() - past.getTime();
  
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
};

const DisputeTable: React.FC<DisputeTableProps> = ({ onDisputeCountChange }) => {
  const [disputes, setDisputes] = useState<DisputeWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDispute, setSelectedDispute] = useState<DisputeWithMeta | null>(null);
  const [expandedDisputes, setExpandedDisputes] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showNewEmail, setShowNewEmail] = useState<string | null>(null);
  const { user } = useAuth();
  
  const fetchDisputes = useCallback(async () => {
    if (!user?.email) return;
    
    try {
      const response = await fetch(`/api/stripe/disputes?userEmail=${encodeURIComponent(user.email)}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch disputes');
      }
      
      const { data } = await response.json();
      setDisputes(data);
      onDisputeCountChange(data.length);
    } catch (error) {
      console.error('Error fetching disputes:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to fetch disputes');
    } finally {
      setLoading(false);
    }
  }, [user?.email, onDisputeCountChange]);
  
  useEffect(() => {
    fetchDisputes();
    
    const interval = setInterval(fetchDisputes, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchDisputes]);
  
  const sortedDisputes = useMemo(() => {
    return [...disputes].sort((a, b) => {
      const dateA = new Date(a.created * 1000);
      const dateB = new Date(b.created * 1000);
      return dateB.getTime() - dateA.getTime();
    });
  }, [disputes]);
  
  if (loading) {
    return <div>Loading disputes...</div>;
  }
  
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
        >
          <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Due Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedDisputes.map((dispute) => (
              <Fragment key={dispute.id}>
                <tr>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      dispute.status === 'needs_response' ? 'bg-red-100 text-red-800' :
                      dispute.status === 'warning_needs_response' ? 'bg-orange-100 text-orange-800' :
                      dispute.status === 'won' ? 'bg-green-100 text-green-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {dispute.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{dispute.customerEmail}</div>
                    {dispute.firstName && (
                      <div className="text-sm text-gray-500">{dispute.firstName}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${(dispute.amount / 100).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {getTimeAgo(new Date(dispute.created * 1000).toISOString())}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {dispute.dueDate ? new Date(dispute.dueDate).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {dispute.lastEmailTime ? (
                      <div>
                        <div className="text-sm text-gray-900 flex items-center">
                          {dispute.lastEmailFromCustomer ? (
                            <svg className="h-4 w-4 text-orange-500 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          ) : (
                            <svg className="h-4 w-4 text-blue-500 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                          )}
                          {getTimeAgo(dispute.lastEmailTime)}
                        </div>
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {dispute.lastEmailSubject}
                        </div>
                        <div className="text-xs text-gray-500">
                          {dispute.lastEmailFromCustomer ? 'From Customer' : 'From You'}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 flex items-center">
                        <svg className="h-4 w-4 text-gray-400 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                        No emails yet
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => setShowNewEmail(dispute.id)}
                        className="text-indigo-600 hover:text-indigo-900 flex items-center"
                      >
                        <svg className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Email
                      </button>
                      <button
                        onClick={() => {
                          const isExpanded = expandedDisputes.includes(dispute.id);
                          setExpandedDisputes(
                            isExpanded 
                              ? expandedDisputes.filter(id => id !== dispute.id)
                              : [...expandedDisputes, dispute.id]
                          );
                        }}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        {expandedDisputes.includes(dispute.id) ? 'Hide History' : 'Show History'}
                      </button>
                    </div>
                  </td>
                </tr>
                {(expandedDisputes.includes(dispute.id) || showNewEmail === dispute.id) && (
                  <tr>
                    <td colSpan={7} className="px-6 py-4">
                      {showNewEmail === dispute.id ? (
                        <EmailComposer
                          customerEmail={dispute.customerEmail || ''}
                          onClose={() => setShowNewEmail(null)}
                          onEmailSent={() => {
                            setShowNewEmail(null);
                            fetchDisputes();
                          }}
                          threads={dispute.emailThreads || []}
                        />
                      ) : (
                        <EmailCorrespondence
                          customerEmail={dispute.customerEmail || ''}
                          disputeId={dispute.id}
                          onEmailSent={fetchDisputes}
                          initialThreads={dispute.emailThreads || []}
                          showEmailHistory={true}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <DisputeSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onUpdate={fetchDisputes}
      />
    </div>
  );
};

export default DisputeTable; 