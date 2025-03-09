"use client";

import React from 'react';
import Link from 'next/link';
import { Home, BookOpen, Shield, MessageSquareText } from 'lucide-react';

export function SidebarRedesign() {
  return (
    <div className="w-64 bg-white shadow-sm flex flex-col h-full">
      <div className="p-6 border-b border-gray-100">
        <h1 className="text-xl font-bold text-indigo-600">SubHub</h1>
      </div>
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          <li>
            <Link
              href="/"
              className="flex items-center gap-3 px-4 py-3 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <Home className="h-5 w-5" />
              <span>Home</span>
            </Link>
          </li>
          <li>
            <Link
              href="#"
              className="flex items-center gap-3 px-4 py-3 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <BookOpen className="h-5 w-5" />
              <span>Knowledge Base</span>
            </Link>
          </li>
          <li>
            <Link
              href="/dispute"
              className="flex items-center gap-3 px-4 py-3 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <Shield className="h-5 w-5" />
              <span>Dispute Resolution</span>
            </Link>
          </li>
          <li>
            <Link
              href="/redesign"
              className="flex items-center gap-3 px-4 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-medium"
            >
              <MessageSquareText className="h-5 w-5" />
              <span>FAQ Auto Reply</span>
            </Link>
          </li>
        </ul>
      </nav>
      <div className="p-4 border-t border-gray-100">
        <button className="flex items-center gap-2 px-4 py-3 w-full text-gray-700 rounded-xl hover:bg-gray-50 transition-colors">
          <img src="/google-logo.svg" alt="Google" className="h-5 w-5" />
          <span className="text-sm">Sign in with Google</span>
        </button>
      </div>
    </div>
  );
} 