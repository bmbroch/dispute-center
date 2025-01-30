"use client";

import React, { createContext, useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { googleAuthService } from '../services/googleAuth';
import { toast } from 'react-hot-toast';

interface User {
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  name?: string;
  picture?: string;
  hasGmailAccess?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  checkGmailAccess: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  signIn: async () => {},
  signOut: async () => {},
  refreshAccessToken: async () => null,
  checkGmailAccess: async () => false,
});

const PUBLIC_PATHS = ['/', '/auth', '/login'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
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
        setLoading(true);
        const savedTokens = localStorage.getItem('auth_tokens');
        
        if (!savedTokens) {
          setLoading(false);
          return;
        }

        const tokens = JSON.parse(savedTokens);
        
        // Validate token structure
        if (!tokens.access_token) {
          throw new Error('Invalid token structure');
        }

        // Set the tokens in the service
        googleAuthService.setTokens(tokens);
        
        try {
          // Try to get user info with current token
          const userInfo = await googleAuthService.getUserInfo();
          const newUser = {
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || null,
          };
          setUser(newUser);
        } catch (userInfoError) {
          console.log('Token expired, attempting refresh...');
          // If user info fails, try to refresh the token
          if (tokens.refresh_token) {
            try {
              const newTokens = await googleAuthService.refreshTokens();
              // Retry getting user info with new token
              const userInfo = await googleAuthService.getUserInfo();
              const newUser = {
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture,
                accessToken: newTokens.access_token,
                refreshToken: newTokens.refresh_token || tokens.refresh_token,
              };
              setUser(newUser);
              
              // Save the new tokens
              localStorage.setItem('auth_tokens', JSON.stringify({
                access_token: newTokens.access_token,
                refresh_token: newTokens.refresh_token || tokens.refresh_token,
                id_token: newTokens.id_token,
                expires_in: newTokens.expires_in
              }));
            } catch (refreshError) {
              console.error('Error refreshing token:', refreshError);
              // Only clear tokens if refresh explicitly fails
              if (refreshError.message === 'Invalid refresh token') {
                localStorage.removeItem('auth_tokens');
                googleAuthService.clearTokens();
              }
              setUser(null);
            }
          } else {
            // No refresh token available
            localStorage.removeItem('auth_tokens');
            googleAuthService.clearTokens();
            setUser(null);
          }
        }
      } catch (error) {
        console.error('Error loading saved auth:', error);
        // Only clear tokens on critical errors
        if (error.message === 'Invalid token structure') {
          localStorage.removeItem('auth_tokens');
          googleAuthService.clearTokens();
          setUser(null);
        }
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
      if (tokens && tokens.access_token) {
        if (user) {
          const newUser = {
            ...user,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || user.refreshToken,
          };
          setUser(newUser);
          // Update stored tokens
          localStorage.setItem('auth_tokens', JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || user.refreshToken,
            id_token: tokens.id_token,
            expires_in: tokens.expires_in
          }));
        }
        return tokens.access_token;
      }
      return null;
    } catch (error) {
      console.error('Error refreshing token:', error);
      // Clear invalid tokens on refresh error
      localStorage.removeItem('auth_tokens');
      setUser(null);
      return null;
    }
  };

  const checkGmailAccess = async () => {
    if (!user?.accessToken) return false;

    try {
      const response = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
        },
      });

      if (response.ok) {
        setUser(prev => prev ? { ...prev, hasGmailAccess: true } : null);
        return true;
      }

      if (response.status === 401) {
        // Token expired, try to refresh
        const newToken = await refreshAccessToken();
        if (newToken) {
          const retryResponse = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
            headers: {
              Authorization: `Bearer ${newToken}`,
            },
          });
          const hasAccess = retryResponse.ok;
          setUser(prev => prev ? { ...prev, hasGmailAccess: hasAccess } : null);
          return hasAccess;
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking Gmail access:', error);
      return false;
    }
  };

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        loading, 
        error, 
        signIn, 
        signOut: handleSignOut, 
        refreshAccessToken,
        checkGmailAccess 
      }}
    >
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

