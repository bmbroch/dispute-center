import { LucideIcon } from 'lucide-react';
import Link from 'next/link';

interface FeatureCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  stats?: string;
  href?: string;
  buttonText: string;
  onClick?: () => void;
}

export function FeatureCard({
  title,
  description,
  icon: Icon,
  stats,
  href,
  buttonText,
  onClick
}: FeatureCardProps) {
  const CardContent = (
    <div className="bg-white rounded-lg p-6 border border-gray-200 hover:border-gray-300 transition-all hover:shadow-lg h-full flex flex-col">
      {/* Icon */}
      <div className="mb-6">
        <div className="bg-red-50 w-12 h-12 rounded-lg flex items-center justify-center">
          <Icon className="w-6 h-6 text-red-500" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 mb-4">{description}</p>
        {stats && (
          <p className="text-sm text-gray-500 mb-4">{stats}</p>
        )}
      </div>

      {/* Button */}
      <button 
        onClick={onClick}
        className="w-full bg-white border border-gray-200 hover:border-gray-300 text-gray-900 px-4 py-2 rounded-lg transition-colors"
      >
        {buttonText}
      </button>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {CardContent}
      </Link>
    );
  }

  return CardContent;
} 