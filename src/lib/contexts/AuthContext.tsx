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
  refreshAccessToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  signIn: async () => {},
  signOut: async () => {},
  refreshAccessToken: async () => null,
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
      setLoading(true);
      setError(null);
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

      toast.success('Successfully signed in!');
    } catch (err) {
      console.error('Sign in error:', err);
      let errorMessage = 'Failed to sign in with Google';
      
      // Handle specific error cases
      if (err instanceof Error) {
        if (err.message.includes('popup')) {
          errorMessage = 'Popup was blocked. Please allow popups and try again.';
        } else if (err.message.includes('cross-origin')) {
          errorMessage = 'Authentication failed due to a security restriction. Please try again.';
        } else if (err.message.includes('cancelled')) {
          errorMessage = 'Sign in was cancelled. Please try again.';
        } else if (err.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        }
      }
      
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setLoading(true);
      await googleAuthService.clearTokens();
      localStorage.removeItem('auth_tokens');
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

  const refreshAccessToken = async (): Promise<string | null> => {
    try {
      setLoading(true);
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
    } catch (err) {
      console.error('Error refreshing token:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh token';
      setError(errorMessage);
      toast.error(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signOut: handleSignOut, refreshAccessToken }}>
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

