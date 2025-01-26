"use client";

import React, { createContext, useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { googleAuthService } from '../services/googleAuth';

interface User {
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  name?: string;
  picture?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  refreshAccessToken: async () => null,
});

const PUBLIC_PATHS = ['/', '/auth', '/login'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
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
    const loadSavedAuth = async () => {
      try {
        const savedTokens = localStorage.getItem('auth_tokens');
        if (savedTokens) {
          const tokens = JSON.parse(savedTokens);
          googleAuthService.setTokens(tokens);
          
          const userInfo = await googleAuthService.getUserInfo();
          setUser({
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || null,
          });
        }
      } catch (error) {
        console.error('Error loading saved auth:', error);
        // Clear invalid saved state
        localStorage.removeItem('auth_tokens');
        googleAuthService.clearTokens();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    loadSavedAuth();
  }, []);

  // Handle navigation
  useEffect(() => {
    handleNavigation();
  }, [handleNavigation]);

  const signIn = async () => {
    try {
      const { tokens, userInfo } = await googleAuthService.signInWithPopup();
      
      // Save auth state
      localStorage.setItem('auth_tokens', JSON.stringify(tokens));
      
      setUser({
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
      });

      // Navigation will be handled by the effect
    } catch (error) {
      console.error('Error signing in:', error);
      // Don't throw error for user cancellation
      if ((error as Error).message === 'Sign in cancelled') {
        return;
      }
      // For other errors, show them to the user
      throw error;
    }
  };

  const handleSignOut = async () => {
    try {
      googleAuthService.clearTokens();
      localStorage.removeItem('auth_tokens');
      setUser(null);
      // Navigation will be handled by the effect
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const refreshAccessToken = async (): Promise<string | null> => {
    try {
      const tokens = await googleAuthService.refreshTokens();
      if (user) {
        const newUser = {
          ...user,
          accessToken: tokens.access_token,
        };
        setUser(newUser);
        localStorage.setItem('auth_tokens', JSON.stringify(tokens));
      }
      return tokens.access_token;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut: handleSignOut, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

