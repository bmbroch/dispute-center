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

class GoogleAuthService {
  private static instance: GoogleAuthService;
  private tokens: GoogleTokens | null = null;
  private userInfo: GoogleUserInfo | null = null;

  private constructor() { }

  static getInstance(): GoogleAuthService {
    if (!GoogleAuthService.instance) {
      GoogleAuthService.instance = new GoogleAuthService();
    }
    return GoogleAuthService.instance;
  }

  private getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: GOOGLE_OAUTH_CONFIG.client_id,
      redirect_uri: GOOGLE_OAUTH_CONFIG.redirect_uri,
      scope: GOOGLE_OAUTH_CONFIG.scope,
      response_type: GOOGLE_OAUTH_CONFIG.response_type,
      access_type: GOOGLE_OAUTH_CONFIG.access_type,
      prompt: GOOGLE_OAUTH_CONFIG.prompt
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async signInWithPopup(): Promise<{ tokens: GoogleTokens; userInfo: GoogleUserInfo }> {
    return new Promise((resolve, reject) => {
      // Calculate center position for the popup
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      // Open the popup
      const popup = window.open(
        this.getAuthUrl(),
        'Google Sign In',
        `width=${width},height=${height},left=${left},top=${top},toolbar=0,scrollbars=0,status=0,resizable=1,location=1,menuBar=0`
      );

      if (!popup) {
        reject(new Error('Failed to open popup. Please allow popups for this site.'));
        return;
      }

      // Focus the popup
      popup.focus();

      // Handle messages from the popup
      const handleMessage = async (event: MessageEvent) => {
        // Verify origin is from allowed domains
        const allowedOrigins = [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:3002',
          window.location.origin
        ];

        if (!allowedOrigins.includes(event.origin)) return;

        if (event.data.type === 'auth-success') {
          cleanup();
          try {
            const tokens = await this.handleAuthCode(event.data.code);
            const userInfo = await this.getUserInfo();
            resolve({ tokens, userInfo });
          } catch (error) {
            reject(error);
          }
        } else if (event.data.type === 'auth-error') {
          cleanup();
          reject(new Error(event.data.error || 'Authentication failed'));
        }
      };

      // Handle popup closure
      const checkClosed = setInterval(() => {
        if (!popup || popup.closed) {
          cleanup();
          reject(new Error('Sign in cancelled'));
        }
      }, 1000);

      // Set a timeout for the entire operation
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Sign in timed out'));
      }, 5 * 60 * 1000); // 5 minutes timeout

      // Cleanup function
      const cleanup = () => {
        if (checkClosed) clearInterval(checkClosed);
        if (timeout) clearTimeout(timeout);
        window.removeEventListener('message', handleMessage);
        if (popup && !popup.closed) {
          popup.close();
        }
      };

      window.addEventListener('message', handleMessage);

      // Clean up on window unload
      window.addEventListener('unload', cleanup);
    });
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

      // Validate token response
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

    try {
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

        // Check if the refresh token is invalid
        if (response.status === 400 || response.status === 401) {
          this.clearTokens(); // Clear invalid tokens
          throw new Error('Invalid refresh token');
        }

        throw new Error(errorData.error || 'Failed to refresh tokens');
      }

      const data = await response.json();

      // Validate token response
      if (!data.access_token || !data.id_token || !data.expires_in) {
        console.error('Invalid token refresh response:', data);
        this.clearTokens(); // Clear invalid tokens
        throw new Error('Invalid token refresh response from server');
      }

      const newTokens: GoogleTokens = {
        access_token: data.access_token,
        id_token: data.id_token,
        expires_in: data.expires_in,
        refresh_token: this.tokens.refresh_token // Keep the existing refresh token
      };

      // Store the new tokens
      this.tokens = newTokens;

      // Validate the new access token by making a test request
      try {
        await this.validateAccessToken(newTokens.access_token);
      } catch (validationError) {
        console.error('New access token validation failed:', validationError);
        this.clearTokens();
        throw new Error('New access token validation failed');
      }

      return newTokens;
    } catch (error) {
      console.error('Error in refreshTokens:', error);
      throw error;
    }
  }

  private async validateAccessToken(accessToken: string): Promise<void> {
    try {
      const response = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Token validation failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Token validation failed: ${response.status} ${response.statusText}`);
      }

      // Token is valid
      console.log('Access token successfully validated');
    } catch (error) {
      console.error('Error validating access token:', error);
      throw error;
    }
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
  }
}

export const googleAuthService = GoogleAuthService.getInstance();
