"use client";

import React, { createContext, useEffect, useState, useCallback, useRef } from "react";

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
  const refreshTimerRef = useRef<NodeJS.Timeout>();
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const checkTokenExpiration = useCallback((tokenExpiry?: number) => {
    if (!tokenExpiry) return true;
    // Check if token is expired or will expire in the next 5 minutes
    return Date.now() >= (tokenExpiry - 5 * 60 * 1000);
  }, []);

  const signOut = useCallback(async () => {
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
    } finally {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    }
  }, []);

  const refreshToken = useCallback(async () => {
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

      // Update localStorage first
      localStorage.setItem('userData', JSON.stringify(updatedUser));
      // Then update state in a single batch
      if (mountedRef.current) {
        setUser(updatedUser);
      }
      return updatedUser;
    } catch (error) {
      console.error('Error refreshing token:', error);
      // If refresh fails, sign out user
      await signOut();
      throw error;
    }
  }, [user, signOut]);

  const scheduleTokenRefresh = useCallback((tokenExpiry: number) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const timeUntilExpiry = tokenExpiry - Date.now();
    const refreshTime = Math.max(0, timeUntilExpiry - (5 * 60 * 1000));

    if (refreshTime <= 0) {
      refreshToken().catch(console.error);
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        refreshToken().catch(console.error);
      }
    }, refreshTime);
  }, [refreshToken]);

  const signInWithGoogle = useCallback(async () => {
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
                  if (mountedRef.current) {
                    setUser(userData);
                  }
                  scheduleTokenRefresh(userData.tokenExpiry || 0);
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
  }, []);

  // Load persisted data on mount
  useEffect(() => {
    const loadPersistedData = async () => {
      try {
        const storedUserData = localStorage.getItem('userData');
        if (!storedUserData || !mountedRef.current) return;

        const userData = JSON.parse(storedUserData) as GoogleUser;
        
        if (checkTokenExpiration(userData.tokenExpiry)) {
          try {
            const refreshedUser = await refreshToken();
            if (mountedRef.current && refreshedUser) {
              setUser(refreshedUser);
              scheduleTokenRefresh(refreshedUser.tokenExpiry || 0);
            }
          } catch (error) {
            console.error('Error refreshing expired token:', error);
            localStorage.removeItem('userData');
            if (mountedRef.current) {
              setUser(null);
            }
          }
        } else {
          setUser(userData);
          scheduleTokenRefresh(userData.tokenExpiry || 0);
        }
      } catch (error) {
        console.error('Error loading persisted data:', error);
        localStorage.removeItem('userData');
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    };

    loadPersistedData();
  }, []); // Empty dependency array since we only want this to run once on mount

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

