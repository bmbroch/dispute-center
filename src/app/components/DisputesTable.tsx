'use client';

import { useEffect, useState, Fragment } from 'react';
import type Stripe from 'stripe';
import EmailCorrespondence from './EmailCorrespondence';
import { useAuth } from '@/lib/hooks/useAuth';

interface DisputesTableProps {
  onDisputeCountChange: (count: number) => void;
}

export default function DisputesTable({ onDisputeCountChange }: DisputesTableProps) {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<Stripe.Dispute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDispute, setExpandedDispute] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDisputes() {
      if (!user?.email) {
        setError('User email not found');
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/stripe/disputes', {
          headers: {
            'X-User-Email': user.email
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to fetch disputes');
        }
        
        const data = await response.json();
        setDisputes(data);
        onDisputeCountChange(data.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch disputes');
      } finally {
        setIsLoading(false);
      }
    }

    fetchDisputes();
  }, [user?.email, onDisputeCountChange]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-red-600 border-t-transparent"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (disputes.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <p className="text-gray-500">No disputes requiring attention</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Customer Email
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
                Created
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
                    {(dispute.charge as any)?.customer?.email || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {(dispute.amount / 100).toLocaleString('en-US', {
                      style: 'currency',
                      currency: dispute.currency.toUpperCase()
                    })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {dispute.reason}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                      ${dispute.status === 'needs_response' ? 'bg-red-100 text-red-800' :
                        dispute.status === 'warning_needs_response' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'}`}>
                      {dispute.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(dispute.created * 1000).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {dispute.evidence_details?.due_by
                      ? new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString()
                      : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button
                      onClick={() => setExpandedDispute(expandedDispute === dispute.id ? null : dispute.id)}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      {expandedDispute === dispute.id ? 'Hide Emails' : 'Show Emails'}
                    </button>
                  </td>
                </tr>
                {expandedDispute === dispute.id && (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 bg-gray-50">
                      <EmailCorrespondence 
                        customerEmail={(dispute.charge as any)?.customer?.email || ''} 
                        disputeId={dispute.id}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
} 