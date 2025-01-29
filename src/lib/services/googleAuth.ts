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

  private constructor() {
    // Load saved auth state
    if (typeof window !== 'undefined') {
      const savedTokens = localStorage.getItem('auth_tokens');
      const savedUserInfo = localStorage.getItem('user_info');
      if (savedTokens) {
        this.tokens = JSON.parse(savedTokens);
      }
      if (savedUserInfo) {
        this.userInfo = JSON.parse(savedUserInfo);
      }
    }
  }

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

  isSignedIn(): boolean {
    return !!(this.tokens && this.userInfo);
  }

  async signInWithPopup(): Promise<{ tokens: GoogleTokens; userInfo: GoogleUserInfo }> {
    try {
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
      
      // Open popup for Gmail account selection
      const popup = window.open(url, 'Google Sign In', 'width=500,height=600,scrollbars=yes,resizable=yes');
      
      if (!popup) {
        throw new Error('Popup was blocked. Please allow popups and try again.');
      }

      return new Promise((resolve, reject) => {
        let authTimeout: NodeJS.Timeout;
        let checkClosed: NodeJS.Timer;

        const cleanup = () => {
          clearInterval(checkClosed);
          clearTimeout(authTimeout);
          window.removeEventListener('message', handleMessage);
          if (popup && !popup.closed) {
            popup.close();
          }
        };

        const handleMessage = async (event: MessageEvent) => {
          // Verify origin
          if (event.origin !== origin) {
            return;
          }

          try {
            const { tokens, userInfo, error } = event.data;
            
            if (error) {
              cleanup();
              reject(new Error(error));
              return;
            }

            if (tokens && userInfo) {
              cleanup();
              
              // Store the tokens and user info
              this.tokens = tokens;
              this.userInfo = userInfo;
              
              // Store in localStorage
              localStorage.setItem('auth_tokens', JSON.stringify(tokens));
              localStorage.setItem('user_info', JSON.stringify(userInfo));
              
              resolve({ tokens, userInfo });
            }
          } catch (error) {
            cleanup();
            reject(error);
          }
        };

        window.addEventListener('message', handleMessage);
        
        // Set timeout for auth flow
        authTimeout = setTimeout(() => {
          cleanup();
          reject(new Error('Authentication timed out. Please try again.'));
        }, 120000); // 2 minute timeout

        // Handle popup closure
        checkClosed = setInterval(() => {
          if (!popup || popup.closed) {
            cleanup();
            // Don't show error if we already have tokens (successful auth)
            if (!this.tokens) {
              reject(new Error('Sign in was cancelled. Please try again.'));
            }
          }
        }, 1000);

        // Handle window unload
        window.addEventListener('unload', cleanup);
      });
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  }

  getUserInfo(): GoogleUserInfo | null {
    return this.userInfo;
  }

  getTokens(): GoogleTokens | null {
    return this.tokens;
  }

  signOut(): void {
    this.tokens = null;
    this.userInfo = null;
    localStorage.removeItem('auth_tokens');
    localStorage.removeItem('user_info');
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }
}

export const googleAuthService = GoogleAuthService.getInstance(); 