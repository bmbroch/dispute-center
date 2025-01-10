"use client";

import React, { createContext, useEffect, useState } from "react";
import { User } from "firebase/auth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  gmailAccessToken: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshGmailToken: () => Promise<void>;
}

interface StoredUserData {
  email: string;
  displayName: string | null;
  photoURL: string | null;
  tokenExpiry?: number;
  refreshToken?: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  gmailAccessToken: null,
  signInWithGoogle: async () => {},
  signOut: async () => {},
  refreshGmailToken: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [gmailAccessToken, setGmailAccessToken] = useState<string | null>(null);

  const checkTokenExpiration = (tokenExpiry?: number) => {
    if (!tokenExpiry) return true;
    // Check if token is expired or will expire in the next 5 minutes
    return Date.now() >= (tokenExpiry - 5 * 60 * 1000);
  };

  // Load persisted data on mount
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem('gmailAccessToken');
      const storedUserData = localStorage.getItem('userData');
      
      if (storedToken && storedUserData) {
        const userData = JSON.parse(storedUserData) as StoredUserData;
        
        // Check if token is expired
        if (!checkTokenExpiration(userData.tokenExpiry)) {
          setGmailAccessToken(storedToken);
          // Create a minimal User object with the stored data
          setUser({
            email: userData.email,
            displayName: userData.displayName,
            photoURL: userData.photoURL,
            emailVerified: true,
            isAnonymous: false,
            uid: userData.email,
            providerData: [],
            metadata: {},
            delete: async () => {},
            getIdToken: async () => storedToken,
            getIdTokenResult: async () => ({ token: storedToken } as any),
            reload: async () => {},
            toJSON: () => ({}),
          } as User);
        } else {
          // Token is expired, clear storage and trigger sign in
          localStorage.removeItem('gmailAccessToken');
          localStorage.removeItem('userData');
          signInWithGoogle().catch(console.error);
        }
      }
    } catch (error) {
      console.error('Error loading persisted data:', error);
      // Clear potentially corrupted data
      localStorage.removeItem('gmailAccessToken');
      localStorage.removeItem('userData');
    } finally {
      setLoading(false);
    }
  }, []);

  const signInWithGoogle = async () => {
    try {
      // Create the OAuth URL with all necessary scopes for both authentication and Gmail
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
            if (event.origin === window.location.origin && event.data?.type === 'GOOGLE_AUTH') {
              try {
                const { access_token, refresh_token, tokenExpiry } = event.data;
                
                if (access_token) {
                  console.log('Got access token with Gmail permissions');
                  setGmailAccessToken(access_token);
                  
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
                  
                  // Store user data with token expiry and refresh token
                  const userData: StoredUserData = {
                    email: userInfo.email,
                    displayName: userInfo.name,
                    photoURL: userInfo.picture,
                    tokenExpiry,
                    refreshToken: refresh_token
                  };
                  
                  localStorage.setItem('gmailAccessToken', access_token);
                  localStorage.setItem('userData', JSON.stringify(userData));
                  
                  // Create a User object
                  setUser({
                    email: userInfo.email,
                    displayName: userInfo.name,
                    photoURL: userInfo.picture,
                    emailVerified: true,
                    isAnonymous: false,
                    uid: userInfo.email,
                    providerData: [],
                    metadata: {},
                    delete: async () => {},
                    getIdToken: async () => access_token,
                    getIdTokenResult: async () => ({ token: access_token } as any),
                    reload: async () => {},
                    toJSON: () => ({}),
                  } as User);
                  
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

  const signOutUser = async () => {
    setUser(null);
    setGmailAccessToken(null);
    localStorage.removeItem('gmailAccessToken');
    localStorage.removeItem('userData');
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      gmailAccessToken,
      signInWithGoogle, 
      signOut: signOutUser,
      refreshGmailToken: signInWithGoogle
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext };

