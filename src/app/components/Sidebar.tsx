import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, User, CreditCard, Settings, HelpCircle, LogOut, BookOpen, Scale } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import Image from 'next/image';

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  
  const isActive = (path: string) => pathname === path;

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900">SubHub</h1>
      </div>

      {/* User Profile Section */}
      {user && (
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {user.picture ? (
              <Image
                src={user.picture}
                alt={`${user.name || user.email}'s profile`}
                width={40}
                height={40}
                className="rounded-full"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  const parent = target.parentElement;
                  if (parent) {
                    const div = document.createElement('div');
                    div.className = 'w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center';
                    const userIcon = document.createElement('div');
                    userIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 text-gray-500"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
                    div.appendChild(userIcon);
                    target.remove();
                    parent.appendChild(div);
                  }
                }}
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                <User className="w-5 h-5 text-gray-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user.name || user.email}
              </p>
              {user.name && (
                <p className="text-xs text-gray-500 truncate">
                  {user.email}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Navigation Links */}
      <div className="p-4 flex-1">
        <Link 
          href="/"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 ${
            isActive('/') ? 'bg-red-100 text-red-600' : 'hover:bg-gray-50'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="font-medium">Home</span>
        </Link>

        <Link 
          href="/knowledge"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 mt-2 ${
            isActive('/knowledge') ? 'bg-red-100 text-red-600' : 'hover:bg-gray-50'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="font-medium">Knowledge Base</span>
        </Link>

        <Link 
          href="/dispute"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 mt-2 ${
            isActive('/dispute') ? 'bg-red-100 text-red-600' : 'hover:bg-gray-50'
          }`}
        >
          <Scale className="w-5 h-5" />
          <span className="font-medium">Dispute Resolution</span>
        </Link>
      </div>

      {/* Bottom section with other navigation items */}
      <div className="mt-auto p-4 space-y-2">
        <Link 
          href="/account"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 ${
            isActive('/account') ? 'bg-gray-100' : 'hover:bg-gray-50'
          }`}
        >
          <User className="w-5 h-5" />
          <span className="font-medium">Account</span>
        </Link>

        <Link 
          href="/subscription"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 ${
            isActive('/subscription') ? 'bg-gray-100' : 'hover:bg-gray-50'
          }`}
        >
          <CreditCard className="w-5 h-5" />
          <span className="font-medium">Subscription</span>
        </Link>

        <Link 
          href="/settings"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 ${
            isActive('/settings') ? 'bg-gray-100' : 'hover:bg-gray-50'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="font-medium">Settings</span>
        </Link>

        <Link 
          href="/support"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 ${
            isActive('/support') ? 'bg-gray-100' : 'hover:bg-gray-50'
          }`}
        >
          <HelpCircle className="w-5 h-5" />
          <span className="font-medium">Support</span>
        </Link>

        {/* Sign Out Button */}
        {user && (
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-50 w-full"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sign Out</span>
          </button>
        )}
      </div>
    </div>
  );
} 