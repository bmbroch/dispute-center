import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, User, CreditCard, Settings, HelpCircle, LogOut, BookOpen, Scale, Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import Image from 'next/image';
import { useState, useEffect } from 'react';

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  
  const isActive = (path: string) => pathname === path;

  const handleSignOut = async () => {
    await signOut();
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
    </>
  );
} 