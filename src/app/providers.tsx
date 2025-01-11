'use client';

import { AuthProvider } from '@/lib/contexts/AuthContext';
import { ExtensionSafetyProvider } from '@/lib/contexts/ExtensionSafetyProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ExtensionSafetyProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </ExtensionSafetyProvider>
  );
} 