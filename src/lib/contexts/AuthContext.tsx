"use client";

import React, { createContext, useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { googleAuthService } from '../services/googleAuth';
import { toast } from 'react-hot-toast';

interface AuthUser {
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  name?: string;
  picture?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  signIn: async () => {},
  signOut: async () => {},
});

const PUBLIC_PATHS = ['/', '/auth', '/login'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Memoize the navigation logic
  const handleNavigation = useCallback(() => {
    if (loading) return;

    const currentPath = pathname || '/';

    if (!user && !PUBLIC_PATHS.includes(currentPath)) {
      router.replace('/');
      return;
    }

    if (user && PUBLIC_PATHS.includes(currentPath) && currentPath !== '/') {
      router.replace('/disputes');
    }
  }, [loading, pathname, router, user]);

  // Load saved auth state
  useEffect(() => {
    const userInfo = googleAuthService.getUserInfo();
    const tokens = googleAuthService.getTokens();
    
    if (userInfo && tokens) {
      setUser({
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
      });
    }
    
    setLoading(false);
  }, []);

  // Handle navigation
  useEffect(() => {
    handleNavigation();
  }, [handleNavigation]);

  const signIn = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { tokens, userInfo } = await googleAuthService.signInWithPopup();
      
      setUser({
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
      });

      toast.success('Successfully signed in!');
      
    } catch (err) {
      console.error('Sign in error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign in';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setLoading(true);
      googleAuthService.signOut();
      setUser(null);
      toast.success('Successfully signed out');
    } catch (err) {
      console.error('Sign out error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign out';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

