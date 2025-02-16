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

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

const DisputeTable: React.FC<DisputeTableProps> = ({ onDisputeCountChange }) => {
  const [disputes, setDisputes] = useState<DisputeWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);
  const [selectedDispute, setSelectedDispute] = useState<DisputeWithMeta | null>(null);
  const [expandedDisputes, setExpandedDisputes] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showNewEmail, setShowNewEmail] = useState<string | null>(null);
  const { user } = useAuth();
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'created', direction: 'desc' });

  const fetchDisputes = useCallback(async () => {
    if (!user?.email) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/stripe/disputes?userEmail=${encodeURIComponent(user.email || '')}`);
      if (!response.ok) throw new Error('Failed to fetch disputes');

      const { success, data, error } = await response.json();

      if (!success) {
        throw new Error(error || 'Failed to fetch disputes');
      }

      // Ensure data is an array
      const disputesArray = Array.isArray(data) ? data : [];

      // Fetch email history for each dispute
      const disputesWithEmails = await Promise.all(
        disputesArray.map(async (dispute) => {
          if (!dispute.customerEmail) return dispute;

          try {
            const emailResponse = await fetch('/api/gmail', {
              headers: {
                'Authorization': `Bearer ${user.accessToken}`,
                'X-Dispute-Email': dispute.customerEmail
              }
            });

            if (emailResponse.ok) {
              const { threads } = await emailResponse.json();

              // Transform threads so they have a "messages" array
              // instead of "threadMessages". Also fill any missing fields
              // to match the EmailThread interface used by <EmailCorrespondence>.
              const transformedThreads = (threads || []).map((thread: any) => {
                // If a thread already has a "messages" array, keep it as-is;
                // otherwise transform its "threadMessages" to "messages".
                const messages = thread.threadMessages?.map((msg: any) => ({
                  id: msg.id,
                  threadId: thread.threadId || thread.id,
                  from: msg.sender || '',
                  subject: msg.subject || '',
                  content: msg.content || '',
                  date: msg.receivedAt || '',
                  // Include extra fields as needed
                })) || [];

                return {
                  id: thread.id || thread.threadId,
                  threadId: thread.threadId || thread.id,
                  messages,
                  // Keep or map any other fields needed by EmailCorrespondence:
                  historyId: thread.historyId || '',
                };
              });

              return {
                ...dispute,
                emailThreads: transformedThreads
              };
            }
          } catch (error) {
            console.error('Error fetching emails for dispute:', error);
          }
          return dispute;
        })
      );

      setDisputes(disputesWithEmails);
      onDisputeCountChange(disputesWithEmails.length);
      setIsLoading(false);
    } catch (err: unknown) {
      // Only show error if it's not a chrome extension error
      if (err instanceof Error) {
        if (!err.message.includes('chrome-extension://')) {
          console.error('Failed to fetch disputes:', err);
          toast.error(err.message || 'Failed to fetch disputes');
        }
      } else {
        toast.error('Failed to fetch disputes');
      }
      // Initialize disputes as empty array on error
      setDisputes([]);
      onDisputeCountChange(0);
    } finally {
      setIsLoading(false);
    }
  }, [user?.email, user?.accessToken, onDisputeCountChange]);

  useEffect(() => {
    fetchDisputes();

    const interval = setInterval(fetchDisputes, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchDisputes]);

  const sortedDisputes = useMemo(() => {
    if (!Array.isArray(disputes)) {
      console.error('Disputes is not an array:', disputes);
      return [];
    }

    return [...disputes].sort((a, b) => {
      if (!a || !b) return 0;

      switch (sortConfig.key) {
        case 'created':
          const dateA = new Date(a.created * 1000);
          const dateB = new Date(b.created * 1000);
          return sortConfig.direction === 'asc'
            ? dateA.getTime() - dateB.getTime()
            : dateB.getTime() - dateA.getTime();

        case 'amount':
          const amountA = typeof a.amount === 'number' ? a.amount : 0;
          const amountB = typeof b.amount === 'number' ? b.amount : 0;
          return sortConfig.direction === 'asc'
            ? amountA - amountB
            : amountB - amountA;

        case 'status':
          return sortConfig.direction === 'asc'
            ? (a.status || '').localeCompare(b.status || '')
            : (b.status || '').localeCompare(a.status || '');

        default:
          return 0;
      }
    });
  }, [disputes, sortConfig]);

  const getLastEmailInfo = (dispute: DisputeWithMeta) => {
    if (!dispute.emailThreads || dispute.emailThreads.length === 0) {
      return null;
    }

    // Get all messages from all threads
    const allMessages = dispute.emailThreads.flatMap(thread => thread.messages || []);

    // Sort all messages by date in descending order
    const sortedMessages = allMessages.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });

    if (sortedMessages.length === 0 || !sortedMessages[0]) return null;

    // Get the most recent message
    const lastMessage = sortedMessages[0];

    // Add null check for lastMessage.from
    if (!lastMessage.from) return null;

    const isFromCustomer = lastMessage.from.toLowerCase().includes(dispute.customerEmail?.toLowerCase() || '');

    return {
      time: lastMessage.date,
      subject: lastMessage.subject,
      isFromCustomer,
      from: lastMessage.from
    };
  };

  const handleTemplateEmail = (dispute: DisputeWithMeta, templateIndex: number = 0) => {
    setShowNewEmail(dispute.id);
    // Pass the template index through URL state
    const url = new URL(window.location.href);
    url.searchParams.set('template', templateIndex.toString());
    window.history.replaceState({}, '', url.toString());
  };

  const handleSort = (column: string) => {
    const direction = sortConfig.key === column && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key: column, direction });
  };

  const getSortValue = (item: any, column: string): string | number | boolean => {
    // Handle null values by converting them to empty strings for sorting
    const value = item[column];
    return value === null ? '' : value;
  };

  const handleStatusUpdate = async (disputeId: string, newStatus: string) => {
    try {
      // ... existing code ...
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (!err.message.includes('chrome-extension://')) {
          console.error('Failed to update status:', err);
          toast.error(err.message || 'Failed to update status');
        }
      } else {
        console.error('An unknown error occurred:', err);
        toast.error('Failed to update status');
      }
    }
  };

  const updateDisputeEmailThreads = async (disputeId: string) => {
    if (!user?.email) return;

    try {
      const dispute = disputes.find(d => d.id === disputeId);
      if (!dispute?.customerEmail) return;

      const emailResponse = await fetch('/api/gmail', {
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'X-Dispute-Email': dispute.customerEmail
        }
      });

      if (emailResponse.ok) {
        const { threads } = await emailResponse.json();
        // Update only the specific dispute's email threads
        setDisputes(prevDisputes =>
          prevDisputes.map(d =>
            d.id === disputeId
              ? { ...d, emailThreads: threads || [] }
              : d
          )
        );
      }
    } catch (error) {
      console.error('Error updating email threads:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="animate-pulse">
          {/* Header Skeleton */}
          <div className="flex items-center justify-between mb-6">
            <div className="h-8 w-48 bg-gray-200 rounded"></div>
            <div className="h-8 w-32 bg-gray-200 rounded"></div>
          </div>

          {/* Table Skeleton */}
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  {[...Array(7)].map((_, i) => (
                    <th key={i} className="pb-3">
                      <div className="h-4 bg-gray-200 rounded w-20"></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...Array(5)].map((_, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-gray-100">
                    {/* Status */}
                    <td className="py-4">
                      <div className="h-6 w-24 bg-gray-200 rounded-full"></div>
                    </td>
                    {/* Customer */}
                    <td className="py-4">
                      <div className="space-y-2">
                        <div className="h-4 w-40 bg-gray-200 rounded"></div>
                        <div className="h-3 w-32 bg-gray-200 rounded"></div>
                      </div>
                    </td>
                    {/* Amount */}
                    <td className="py-4">
                      <div className="h-4 w-20 bg-gray-200 rounded"></div>
                    </td>
                    {/* Created */}
                    <td className="py-4">
                      <div className="h-4 w-24 bg-gray-200 rounded"></div>
                    </td>
                    {/* Due Date */}
                    <td className="py-4">
                      <div className="h-4 w-28 bg-gray-200 rounded"></div>
                    </td>
                    {/* Last Email */}
                    <td className="py-4">
                      <div className="h-10 w-36 bg-gray-200 rounded-full"></div>
                    </td>
                    {/* Actions */}
                    <td className="py-4">
                      <div className="flex space-x-3">
                        <div className="h-8 w-20 bg-gray-200 rounded"></div>
                        <div className="h-8 w-24 bg-gray-200 rounded"></div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {error && !error.includes('chrome-extension') && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-amber-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-amber-800">{error}</span>
          </div>
        </div>
      )}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => {
            setIsSettingsOpen(true);
            // Set template index to 0 (First Response) when opening settings
            const url = new URL(window.location.href);
            url.searchParams.set('template', '0');
            window.history.replaceState({}, '', url.toString());
          }}
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
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${dispute.status === 'needs_response' ? 'bg-red-100 text-red-800' :
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
                    {(() => {
                      const lastEmail = getLastEmailInfo(dispute);
                      if (lastEmail) {
                        return (
                          <div className="flex items-center">
                            {lastEmail.isFromCustomer ? (
                              <div className="flex items-center bg-blue-50 border border-blue-200 rounded-full px-3 py-1">
                                <svg className="h-5 w-5 text-blue-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                <div>
                                  <div className="text-sm font-medium text-blue-800">
                                    {getTimeAgo(lastEmail.time)}
                                  </div>
                                  <div className="text-xs text-blue-600">
                                    Awaiting Response
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center text-gray-500">
                                <svg className="h-4 w-4 text-gray-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                                <div>
                                  <div className="text-sm">
                                    {getTimeAgo(lastEmail.time)}
                                  </div>
                                  <div className="text-xs">
                                    From You
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      } else {
                        return (
                          <button
                            onClick={() => handleTemplateEmail(dispute, 0)}
                            className="flex items-center bg-blue-50 border border-blue-200 rounded-full px-3 py-1.5 hover:bg-blue-100 transition-colors group"
                          >
                            <svg className="h-5 w-5 text-blue-500 mr-2 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <div>
                              <div className="text-sm font-medium text-blue-800">
                                No Contact
                              </div>
                              <div className="text-xs text-blue-600">
                                Send First Response
                              </div>
                            </div>
                          </button>
                        );
                      }
                    })()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => {
                          setShowNewEmail(dispute.id);
                          // Set template index to 1 (Second Response) when clicking email button
                          const url = new URL(window.location.href);
                          url.searchParams.set('template', '1');
                          window.history.replaceState({}, '', url.toString());
                        }}
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
                          firstName={dispute.firstName}
                          onClose={() => {
                            setShowNewEmail(null);
                            // Clear template param when closing
                            const url = new URL(window.location.href);
                            url.searchParams.delete('template');
                            window.history.replaceState({}, '', url.toString());
                          }}
                          onEmailSent={async () => {
                            setShowNewEmail(null);
                            // Clear template param after sending
                            const url = new URL(window.location.href);
                            url.searchParams.delete('template');
                            window.history.replaceState({}, '', url.toString());
                            // Only update email threads for this dispute
                            await updateDisputeEmailThreads(dispute.id);
                          }}
                          threads={dispute.emailThreads || []}
                          initialTemplate={new URLSearchParams(window.location.search).get('template')}
                        />
                      ) : (
                        <EmailCorrespondence
                          customerEmail={dispute.customerEmail || ''}
                          firstName={dispute.firstName}
                          disputeId={dispute.id}
                          onEmailSent={async () => {
                            // Only update email threads for this dispute
                            await updateDisputeEmailThreads(dispute.id);
                          }}
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
      />
    </div>
  );
};

export default DisputeTable;
