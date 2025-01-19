'use client';

import { AlertCircle, FileQuestion, Settings, CreditCard } from 'lucide-react'
import { SupportCard } from "./SupportCard"

export function SubscriptionDashboard() {
  const supportOptions = [
    {
      title: "Dispute Resolution",
      description: "Handle payment disputes and chargebacks",
      icon: AlertCircle,
      action: "Review",
      count: "2 active disputes",
      gradient: "from-red-500 via-red-600 to-red-700",
      className: "md:col-span-1",
      href: "/dispute"
    },
    {
      title: "FAQ Customer Inquiries",
      description: "Find answers to common billing questions",
      icon: FileQuestion,
      action: "Browse",
      count: "200+ articles",
      gradient: "from-blue-500 via-blue-600 to-blue-700",
      className: "md:col-span-1"
    },
    {
      title: "Subscription Management",
      description: "Manage customer subscriptions and plans",
      icon: CreditCard,
      action: "Review",
      count: "15 active subscriptions",
      gradient: "from-green-500 via-green-600 to-green-700",
      className: "md:col-span-2"
    }
  ]

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {supportOptions.map((option) => (
        <SupportCard key={option.title} {...option} />
      ))}
    </div>
  )
} 