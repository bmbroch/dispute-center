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
      gradient: "from-rose-500 via-rose-600 to-rose-700",
      bgColor: "bg-rose-50",
      iconColor: "bg-rose-500",
      className: "md:col-span-1",
      href: "/dispute"
    },
    {
      title: "FAQ Customer Inquiries",
      description: "Find answers to common billing questions",
      icon: FileQuestion,
      action: "Browse",
      count: "200+ articles",
      gradient: "from-indigo-500 via-indigo-600 to-indigo-700",
      bgColor: "bg-indigo-50",
      iconColor: "bg-indigo-500",
      className: "md:col-span-1"
    },
    {
      title: "Subscription Management",
      description: "Manage customer subscriptions and plans",
      icon: CreditCard,
      action: "Review",
      count: "15 active subscriptions",
      gradient: "from-emerald-500 via-emerald-600 to-emerald-700",
      bgColor: "bg-emerald-50",
      iconColor: "bg-emerald-500",
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