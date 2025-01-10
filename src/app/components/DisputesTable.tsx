import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import EmailCorrespondence from './EmailCorrespondence';

interface Dispute {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  customerEmail: string;
  evidence_details: {
    due_by: number;
  };
  charge: string;
  created: number;
}

interface Props {
  onDisputeCountChange?: (count: number) => void;
}

const getStatusStyle = (status: string) => {
  switch (status) {
    case 'needs_response':
      return 'bg-red-100 text-red-800'; // Red for immediate attention
    case 'warning_needs_response':
      return 'bg-yellow-100 text-yellow-800'; // Yellow for warning
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'needs_response':
      return 'Needs Response';
    case 'warning_needs_response':
      return 'Response Required Soon';
    default:
      return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }
};

export default function DisputesTable({ onDisputeCountChange }: Props) {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDispute, setExpandedDispute] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const fetchDisputes = async () => {
      if (!user?.email) return;

      try {
        const response = await fetch('/api/stripe/disputes', {
          headers: {
            'X-User-Email': user.email,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch disputes');
        }

        setDisputes(data.disputes);
        onDisputeCountChange?.(data.disputes.length);
      } catch (err: any) {
        setError(err.message);
        onDisputeCountChange?.(0);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDisputes();

    // Set up polling every 5 minutes
    const intervalId = setInterval(fetchDisputes, 5 * 60 * 1000);

    return () => {
      clearInterval(intervalId);
      onDisputeCountChange?.(0);
    };
  }, [user?.email, onDisputeCountChange]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600 text-center p-4">
        {error}
      </div>
    );
  }

  if (!disputes.length) {
    return (
      <div className="text-center p-4 text-gray-500">
        No disputes found that need response.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Reason
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Due Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {disputes.map((dispute) => (
              <React.Fragment key={dispute.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {dispute.customerEmail}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: dispute.currency.toUpperCase(),
                    }).format(dispute.amount / 100)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {dispute.reason}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusStyle(dispute.status)}`}>
                      {getStatusLabel(dispute.status)}
                    </span>
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
                    <td colSpan={6} className="px-6 py-4">
                      <EmailCorrespondence customerEmail={dispute.customerEmail} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
} 