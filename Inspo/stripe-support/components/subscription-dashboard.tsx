"use client"

import { AlertCircle, FileQuestion, Settings, CreditCard } from 'lucide-react'
import { SupportCard } from "./support-card"

export function SubscriptionDashboard() {
  const supportOptions = [
    {
      title: "Dispute Resolution",
      description: "Handle payment disputes and chargebacks",
      icon: AlertCircle,
      action: "Review",
      count: "2 active disputes",
      gradient: "from-red-400 via-red-500 to-red-600",
      className: "md:col-span-1",
    },
    {
      title: "FAQ Customer Inquiries",
      description: "Find answers to common billing questions",
      icon: FileQuestion,
      action: "Browse",
      count: "200+ articles",
      gradient: "from-blue-400 via-blue-500 to-blue-600",
      className: "md:col-span-1",
    },
    {
      title: "Subscription Management",
      description: "Manage customer subscriptions and plans",
      icon: CreditCard,
      action: "Review",
      count: "15 active subscriptions",
      gradient: "from-green-400 via-green-500 to-green-600",
      className: "md:col-span-2",
    },
    {
      title: "Settings & Fine Tuning",
      description: "Configure billing and notification preferences",
      icon: Settings,
      action: "Configure",
      count: "4 settings need review",
      gradient: "from-purple-400 via-purple-500 to-purple-600",
      className: "md:col-span-2",
    },
  ]

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {supportOptions.map((option) => (
        <SupportCard key={option.title} {...option} />
      ))}
    </div>
  )
}

