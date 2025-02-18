import React from 'react';
import { Sidebar } from './Sidebar';
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  // Optionally specify which weights you need
  weight: ['400', '500', '600', '700'],
});

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className={`${inter.className} min-h-screen`}>
      <Sidebar />
      <div className="md:pl-64">
        <main className="max-w-7xl mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
