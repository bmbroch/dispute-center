"use client"

import { TypeIcon as type, LucideIcon } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface SupportCardProps {
  title: string
  description: string
  icon: LucideIcon
  action: string
  count: string
  gradient: string
  className?: string
}

export function SupportCard({
  title,
  description,
  icon: Icon,
  action,
  count,
  gradient,
  className = "",
}: SupportCardProps) {
  return (
    <Card className={`group relative overflow-hidden border-0 bg-white/5 backdrop-blur-sm transition-all hover:bg-white/10 ${className}`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-10`} />
      <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-gradient-to-br from-white/20 to-white/5 blur-2xl" />
      <CardContent className="relative p-8">
        <div className="mb-6 flex items-center justify-between">
          <div className={`rounded-2xl bg-gradient-to-br ${gradient} p-4`}>
            <Icon className="h-8 w-8 text-white" strokeWidth={1.5} />
          </div>
          <Button 
            variant="ghost" 
            className="rounded-full bg-white/10 px-6 text-white hover:bg-white/20"
          >
            {action}
          </Button>
        </div>
        <h3 className="mb-3 text-2xl font-semibold text-white">{title}</h3>
        <p className="mb-4 text-base text-purple-200">{description}</p>
        <p className="text-sm font-medium text-purple-300">{count}</p>
      </CardContent>
    </Card>
  )
}

