'use client';

import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { XIcon, CreditCard, Calendar, AlertCircle } from 'lucide-react';

interface StripeSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscriptionInfo: any;
}

const formatDate = (timestamp: number) => {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
};

const formatInterval = (interval: string, intervalCount: number) => {
  if (intervalCount === 1) return interval;
  return `${intervalCount} ${interval}s`;
};

export default function StripeSubscriptionModal({
  isOpen,
  onClose,
  subscriptionInfo
}: StripeSubscriptionModalProps) {
  if (!subscriptionInfo) return null;

  const { customer, subscription, paymentHistory, failedPayments, invoiceHistory } = subscriptionInfo;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-start justify-center sm:items-center p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden bg-white w-full min-h-screen sm:min-h-0 sm:rounded-lg sm:max-w-4xl transition-all">
                {/* Mobile-friendly header */}
                <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-4 sm:px-6 flex items-center justify-between">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    Stripe Customer Details
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XIcon className="h-6 w-6" />
                  </button>
                </div>

                <div className="px-4 py-4 sm:px-6 overflow-y-auto max-h-[calc(100vh-4rem)] sm:max-h-[calc(100vh-8rem)]">
                  <div className="space-y-6">
                    {/* Customer Information */}
                    <div className="border-b border-gray-200 pb-6">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
                        Customer Information
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <p className="text-xs text-gray-500">Customer ID</p>
                          <p className="text-sm font-medium break-all">{customer.id}</p>
                        </div>
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <p className="text-xs text-gray-500">Email</p>
                          <p className="text-sm font-medium break-all">{customer.email}</p>
                        </div>
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <p className="text-xs text-gray-500">Created</p>
                          <p className="text-sm font-medium">{formatDate(customer.created)}</p>
                        </div>
                        {customer.defaultPaymentMethod && (
                          <div className="bg-gray-50 p-3 rounded-lg">
                            <p className="text-xs text-gray-500">Payment Method</p>
                            <p className="text-sm font-medium flex items-center gap-1">
                              <CreditCard className="h-4 w-4" />
                              {customer.defaultPaymentMethod.brand.toUpperCase()} •••• {customer.defaultPaymentMethod.last4}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Active Subscription */}
                    {subscription && (
                      <div className="border-b border-gray-200 pb-6">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
                          Active Subscription
                        </h3>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs text-gray-500">Plan</p>
                              <p className="text-sm font-medium">{subscription.plan.name}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Status</p>
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${subscription.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                {subscription.status.toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Amount</p>
                              <p className="text-sm font-medium">
                                {formatCurrency(subscription.plan.amount, subscription.plan.currency)} / {formatInterval(subscription.plan.interval, subscription.plan.intervalCount)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Current Period</p>
                              <p className="text-sm font-medium flex items-center gap-1">
                                <Calendar className="h-4 w-4" />
                                <span className="hidden sm:inline">
                                  {formatDate(subscription.currentPeriodStart)} - {formatDate(subscription.currentPeriodEnd)}
                                </span>
                                <span className="sm:hidden">
                                  {new Date(subscription.currentPeriodStart * 1000).toLocaleDateString()} - {new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString()}
                                </span>
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Payment History */}
                    <div className="border-b border-gray-200 pb-6">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">
                        Payment History
                      </h3>
                      <div className="overflow-x-auto -mx-4 sm:mx-0">
                        <div className="inline-block min-w-full align-middle">
                          <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                            <table className="min-w-full divide-y divide-gray-300">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-xs font-medium text-gray-500 sm:pl-6">Date</th>
                                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-medium text-gray-500">Amount</th>
                                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-medium text-gray-500">Status</th>
                                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-medium text-gray-500">Receipt</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 bg-white">
                                {paymentHistory.map((payment: any) => (
                                  <tr key={payment.id}>
                                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm text-gray-900 sm:pl-6">
                                      <div className="hidden sm:block">{formatDate(payment.created)}</div>
                                      <div className="sm:hidden">{new Date(payment.created * 1000).toLocaleDateString()}</div>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                                      {formatCurrency(payment.amount, payment.currency)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${payment.status === 'succeeded' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                        }`}>
                                        {payment.status.toUpperCase()}
                                      </span>
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                                      {payment.receiptUrl && (
                                        <a
                                          href={payment.receiptUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:text-blue-800"
                                        >
                                          View
                                        </a>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Failed Payments */}
                    {failedPayments.length > 0 && (
                      <div className="pb-6">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                          <AlertCircle className="h-5 w-5 text-red-500" />
                          Failed Payments
                        </h3>
                        <div className="space-y-3">
                          {failedPayments.map((payment: any) => (
                            <div key={payment.id} className="bg-red-50 rounded-lg p-4">
                              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                                <div>
                                  <p className="text-sm font-medium text-red-800">
                                    {formatCurrency(payment.amount, payment.currency)}
                                  </p>
                                  <p className="text-sm text-red-700 mt-1">{payment.lastPaymentError}</p>
                                </div>
                                <p className="text-sm text-red-700">
                                  <span className="sm:hidden">Failed on: </span>
                                  {new Date(payment.created * 1000).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
