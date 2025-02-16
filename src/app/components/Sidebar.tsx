import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, User, CreditCard, Settings, HelpCircle, LogOut, BookOpen, Scale, Menu, X, MessageSquareQuote } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import Image from 'next/image';
import { useState, useEffect } from 'react';

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut, signIn } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (path: string) => pathname === path;

  const handleSignOut = async () => {
    await signOut();
  };

  const handleSignIn = async () => {
    try {
      await signIn();
    } catch (error) {
      console.error('Failed to sign in:', error);
    }
  };

  // Close sidebar when route changes on mobile
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close sidebar when clicking outside on mobile
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const sidebar = document.getElementById('sidebar');
      const menuButton = document.getElementById('menu-button');
      if (isOpen && sidebar && !sidebar.contains(event.target as Node) && menuButton && !menuButton.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        id="menu-button"
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 right-4 z-50 p-2 rounded-lg bg-white shadow-lg md:hidden"
      >
        <Menu className="w-6 h-6 text-gray-600" />
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        id="sidebar"
        className={`fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200 flex flex-col z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">SubHub</h1>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-lg hover:bg-gray-100 md:hidden"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* User Profile Section - Only shown when logged in */}
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

          <Link
            href="/faq_autoreply_v2"
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 mt-2 ${
              isActive('/faq_autoreply_v2') ? 'bg-red-100 text-red-600' : 'hover:bg-gray-50'
            }`}
          >
            <MessageSquareQuote className="w-5 h-5" />
            <span className="font-medium">FAQ Auto Reply</span>
          </Link>
        </div>

        {/* Bottom section with other navigation items */}
        {user ? (
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

            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-50 w-full"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        ) : (
          <div className="mt-auto p-4">
            <button
              onClick={handleSignIn}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </button>
          </div>
        )}
      </div>
    </>
  );
}
