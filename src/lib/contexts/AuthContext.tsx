"use client";

import React, { createContext, useEffect, useState } from "react";

interface GoogleUser {
  email: string;
  name: string | null;
  picture: string | null;
  accessToken: string;
  refreshToken?: string;
  tokenExpiry?: number;
}

interface AuthContextType {
  user: GoogleUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
  refreshToken: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkTokenExpiration = (tokenExpiry?: number) => {
    if (!tokenExpiry) return true;
    // Check if token is expired or will expire in the next 5 minutes
    return Date.now() >= (tokenExpiry - 5 * 60 * 1000);
  };

  // Load persisted data on mount
  useEffect(() => {
    try {
      const storedUserData = localStorage.getItem('userData');
      
      if (storedUserData) {
        const userData = JSON.parse(storedUserData) as GoogleUser;
        
        // Check if token is expired
        if (!checkTokenExpiration(userData.tokenExpiry)) {
          setUser(userData);
        } else {
          // Token is expired, just clear storage
          localStorage.removeItem('userData');
        }
      }
    } catch (error) {
      console.error('Error loading persisted data:', error);
      // Clear potentially corrupted data
      localStorage.removeItem('userData');
    } finally {
      setLoading(false);
    }
  }, []);

  const signInWithGoogle = async () => {
    try {
      // Create the OAuth URL with all necessary scopes
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '');
      authUrl.searchParams.append('redirect_uri', `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('access_type', 'offline');
      authUrl.searchParams.append('prompt', 'consent');
      authUrl.searchParams.append('scope', [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.labels',
        'email',
        'profile',
        'openid'
      ].join(' '));

      // Open the popup
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const authWindow = window.open(
        authUrl.toString(),
        'googleAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (authWindow) {
        return new Promise<void>((resolve, reject) => {
          const handleMessage = async (event: MessageEvent) => {
            // Strictly check that the origin matches our app URL exactly
            const appUrl = process.env.NEXT_PUBLIC_APP_URL;
            if (!appUrl) {
              console.error('NEXT_PUBLIC_APP_URL environment variable is not set');
              return;
            }

            // Only handle messages from our exact app origin, ignore all others including extensions
            if (event.origin !== appUrl || !event.data?.type) {
              return;
            }

            if (event.data.type === 'GOOGLE_AUTH') {
              try {
                const { access_token, refresh_token, tokenExpiry } = event.data;
                
                if (access_token) {
                  // Fetch user info
                  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: {
                      'Authorization': `Bearer ${access_token}`
                    }
                  });
                  
                  if (!userResponse.ok) {
                    throw new Error('Failed to fetch user info');
                  }
                  
                  const userInfo = await userResponse.json();
                  
                  // Create user data object
                  const userData: GoogleUser = {
                    email: userInfo.email,
                    name: userInfo.name,
                    picture: userInfo.picture,
                    accessToken: access_token,
                    refreshToken: refresh_token,
                    tokenExpiry
                  };
                  
                  localStorage.setItem('userData', JSON.stringify(userData));
                  setUser(userData);
                  resolve();
                } else {
                  reject(new Error('No access token received'));
                }
              } catch (error) {
                console.error('Error in auth callback:', error);
                reject(error);
              } finally {
                authWindow.close();
                window.removeEventListener('message', handleMessage);
              }
            } else if (event.data?.type === 'GOOGLE_AUTH_ERROR') {
              console.error('Authentication error:', event.data.error);
              reject(new Error(event.data.error));
              authWindow.close();
              window.removeEventListener('message', handleMessage);
            }
          };

          window.addEventListener('message', handleMessage);
          
          // Add timeout to prevent hanging
          setTimeout(() => {
            authWindow.close();
            window.removeEventListener('message', handleMessage);
            reject(new Error('Authentication timed out'));
          }, 300000); // 5 minute timeout
        });
      } else {
        throw new Error('Failed to open authentication window');
      }
    } catch (error: any) {
      console.error("Error signing in with Google:", error);
      throw error;
    }
  };

  const refreshToken = async () => {
    if (!user?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: user.refreshToken }),
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const { access_token, tokenExpiry } = await response.json();
      
      const updatedUser = {
        ...user,
        accessToken: access_token,
        tokenExpiry,
      };

      localStorage.setItem('userData', JSON.stringify(updatedUser));
      setUser(updatedUser);
    } catch (error) {
      console.error('Error refreshing token:', error);
      // If refresh fails, sign out user
      await signOut();
      throw error;
    }
  };

  const signOut = async () => {
    try {
      // Call the sign out endpoint to remove the auth cookie
      await fetch('/api/auth/signout', {
        method: 'POST',
      });
      
      // Clear local state
      setUser(null);
      localStorage.removeItem('userData');
    } catch (error) {
      console.error('Error signing out:', error);
      // Still clear local state even if the API call fails
      setUser(null);
      localStorage.removeItem('userData');
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading,
      signInWithGoogle, 
      signOut,
      refreshToken
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext };

