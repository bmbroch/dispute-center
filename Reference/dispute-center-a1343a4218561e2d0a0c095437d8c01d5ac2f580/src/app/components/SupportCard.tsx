"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LucideIcon } from 'lucide-react'

interface SupportCardProps {
  title: string
  description: string
  icon: LucideIcon
  action: string
  count: string
  gradient: string
  bgColor: string
  iconColor: string
  className?: string
  href?: string
}

export function SupportCard({
  title,
  description,
  icon: Icon,
  action,
  count,
  gradient,
  bgColor,
  iconColor,
  className = "",
  href
}: SupportCardProps) {
  const router = useRouter();
  
  const handleAction = (e: React.MouseEvent) => {
    e.preventDefault();
    if (href) {
      router.push(href);
    }
  };

  const CardContent = (
    <>
      <div className="relative p-8">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* App icon */}
            <div className={`mb-6 inline-flex ${iconColor} rounded-2xl p-3`}>
              <Icon className="h-8 w-8 text-white" strokeWidth={2} />
            </div>
            
            <div>
              <h3 className="mb-2 text-2xl font-semibold text-gray-900">{title}</h3>
              <p className="mb-4 text-base text-gray-600">{description}</p>
              <p className="text-sm font-medium text-gray-500">{count}</p>
            </div>
          </div>

          {/* Review button */}
          <div className="ml-4">
            <button 
              onClick={handleAction}
              className={`rounded-lg px-5 py-2 text-sm font-medium hover:opacity-90 transition-colors ${iconColor} text-white`}
            >
              {action}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const cardClasses = `group relative overflow-hidden rounded-2xl border border-gray-100 ${bgColor} transition-all hover:shadow-lg hover:scale-[1.02] ${className}`;

  if (href) {
    return (
      <Link href={href} className={cardClasses}>
        {CardContent}
      </Link>
    );
  }

  return (
    <div className={cardClasses}>
      {CardContent}
    </div>
  );
} 