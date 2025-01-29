'use client';

import { AuthProvider } from '@/lib/contexts/AuthContext';
import { ExtensionSafetyProvider } from '@/lib/contexts/ExtensionSafetyProvider';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ExtensionSafetyProvider>
      <AuthProvider>
        <Toaster richColors position="top-right" />
        {children}
      </AuthProvider>
    </ExtensionSafetyProvider>
  );
} 