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
  className = "",
  href
}: SupportCardProps) {
  const router = useRouter();
  
  // Convert gradient classes to background color classes
  const bgColor = gradient.includes('red') ? 'bg-red-50/30' 
    : gradient.includes('blue') ? 'bg-blue-50/30'
    : gradient.includes('green') ? 'bg-green-50/30'
    : 'bg-purple-50/30';

  const iconBg = gradient.includes('red') ? 'bg-red-500' 
    : gradient.includes('blue') ? 'bg-blue-500'
    : gradient.includes('green') ? 'bg-green-500'
    : 'bg-purple-500';

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
            <div className={`mb-6 inline-flex ${iconBg} rounded-2xl p-3`}>
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
              className="rounded-full bg-white shadow-sm px-5 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {action}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const cardClasses = `group relative overflow-hidden rounded-2xl border border-gray-100 ${bgColor} transition-all hover:shadow-md ${className}`;

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