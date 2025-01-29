import { GOOGLE_OAUTH_CONFIG } from '../firebase/firebase';

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
}

interface GoogleUserInfo {
  email: string;
  name: string;
  picture: string;
}

const GOOGLE_AUTH_ORIGINS = {
  development: 'http://localhost:3002',
  production: 'https://dispute-center-leli.vercel.app'
};

class GoogleAuthService {
  private static instance: GoogleAuthService;
  private tokens: GoogleTokens | null = null;
  private userInfo: GoogleUserInfo | null = null;
  private isAuthenticated: boolean = false;

  private constructor() {}

  static getInstance(): GoogleAuthService {
    if (!GoogleAuthService.instance) {
      GoogleAuthService.instance = new GoogleAuthService();
    }
    return GoogleAuthService.instance;
  }

  private getOrigin() {
    return typeof window !== 'undefined' 
      ? window.location.origin
      : GOOGLE_AUTH_ORIGINS[process.env.NODE_ENV === 'production' ? 'production' : 'development'];
  }

  isUserAuthenticated(): boolean {
    return this.isAuthenticated;
  }

  async signInWithPopup(): Promise<{ tokens: GoogleTokens; userInfo: GoogleUserInfo }> {
    try {
      // First ensure user is authenticated on the main site
      if (!this.isAuthenticated) {
        throw new Error('Please sign in to your account first');
      }

      const origin = this.getOrigin();
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': origin
        },
        body: JSON.stringify({ redirectUri: `${origin}/auth/callback` })
      });

      if (!response.ok) {
        throw new Error('Authentication failed');
      }

      const { url } = await response.json();
      
      // Open popup with proper origin for Gmail account selection
      const popup = window.open(url, 'Google Sign In', 'width=500,height=600');
      
      if (!popup) {
        throw new Error('Popup was blocked. Please allow popups and try again.');
      }

      return new Promise((resolve, reject) => {
        let authTimeout: NodeJS.Timeout;

        const handleMessage = async (event: MessageEvent) => {
          // Verify origin
          if (event.origin !== origin) {
            return;
          }

          try {
            const { tokens, userInfo, error } = event.data;
            
            if (error) {
              reject(new Error(error));
              return;
            }

            if (tokens && userInfo) {
              window.removeEventListener('message', handleMessage);
              clearTimeout(authTimeout);
              
              // Store the tokens and user info
              this.tokens = tokens;
              this.userInfo = userInfo;
              
              // The callback will handle:
              // 1. Storing tokens in localStorage
              // 2. Updating parent window state
              // 3. Closing the popup
              
              resolve({ tokens, userInfo });
            }
          } catch (error) {
            reject(error);
          }
        };

        window.addEventListener('message', handleMessage);
        
        // Set timeout for auth flow
        authTimeout = setTimeout(() => {
          window.removeEventListener('message', handleMessage);
          popup.close();
          reject(new Error('Authentication timed out. Please try again.'));
        }, 60000); // 1 minute timeout

        // Handle popup closure
        const checkClosed = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(checkClosed);
            clearTimeout(authTimeout);
            window.removeEventListener('message', handleMessage);
            reject(new Error('Authentication cancelled'));
          }
        }, 1000);
      });
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  }

  // Add method for main site authentication
  async authenticateUser(email: string, password: string): Promise<void> {
    try {
      // Implement your main site authentication here
      // This should be called before attempting Gmail authentication
      
      // On successful authentication:
      this.isAuthenticated = true;
    } catch (error) {
      console.error('Main site authentication error:', error);
      throw error;
    }
  }

  async handleAuthCode(code: string): Promise<GoogleTokens> {
    try {
      console.log('Exchanging auth code for tokens...');
      
      const response = await fetch('/api/auth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('Token exchange failed:', {
          status: response.status,
          statusText: response.statusText,
          data
        });
        throw new Error(data.details || data.error || 'Failed to get tokens');
      }

      // Validate token response and ensure it matches GoogleTokens interface
      if (!data.access_token || !data.id_token || !data.expires_in) {
        console.error('Invalid token response:', data);
        throw new Error('Invalid token response from server');
      }

      const tokens: GoogleTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        id_token: data.id_token,
        expires_in: data.expires_in
      };

      this.tokens = tokens;
      return tokens;
    } catch (error) {
      console.error('Error in handleAuthCode:', error);
      throw error;
    }
  }

  async getUserInfo(): Promise<GoogleUserInfo> {
    if (!this.tokens?.access_token) {
      throw new Error('No access token available');
    }

    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${this.tokens.access_token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    const data = await response.json();

    // Validate user info response
    if (!data.email || !data.name || !data.picture) {
      console.error('Invalid user info response:', data);
      throw new Error('Invalid user info response from Google');
    }

    const userInfo: GoogleUserInfo = {
      email: data.email,
      name: data.name,
      picture: data.picture
    };

    this.userInfo = userInfo;
    return userInfo;
  }

  async refreshTokens(): Promise<GoogleTokens> {
    if (!this.tokens?.refresh_token) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: this.tokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Token refresh failed:', errorData);
      throw new Error(errorData.error || 'Failed to refresh tokens');
    }

    const data = await response.json();

    // Validate token response
    if (!data.access_token || !data.id_token || !data.expires_in) {
      console.error('Invalid token refresh response:', data);
      throw new Error('Invalid token refresh response from server');
    }

    // Create new tokens object with proper typing
    const newTokens: GoogleTokens = {
      access_token: data.access_token,
      id_token: data.id_token,
      expires_in: data.expires_in,
      refresh_token: this.tokens.refresh_token // Keep the existing refresh token
    };

    this.tokens = newTokens;
    return newTokens;
  }

  getTokens(): GoogleTokens | null {
    return this.tokens;
  }

  setTokens(tokens: GoogleTokens): void {
    this.tokens = tokens;
  }

  clearTokens(): void {
    this.tokens = null;
    this.userInfo = null;
    this.isAuthenticated = false;
  }
}

export const googleAuthService = GoogleAuthService.getInstance(); 