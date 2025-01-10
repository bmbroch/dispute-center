'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const error = searchParams.get('error');

      if (error) {
        window.opener?.postMessage(
          { type: 'GOOGLE_AUTH_ERROR', error },
          window.location.origin
        );
        return;
      }

      if (!code) {
        window.opener?.postMessage(
          { type: 'GOOGLE_AUTH_ERROR', error: 'No authorization code received' },
          window.location.origin
        );
        return;
      }

      try {
        const response = await fetch('/api/auth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
          throw new Error('Failed to exchange code for tokens');
        }

        const data = await response.json();
        
        window.opener?.postMessage(
          {
            type: 'GOOGLE_AUTH',
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            tokenExpiry: data.tokenExpiry,
          },
          window.location.origin
        );
      } catch (error) {
        console.error('Error in auth callback:', error);
        window.opener?.postMessage(
          { type: 'GOOGLE_AUTH_ERROR', error: 'Failed to complete authentication' },
          window.location.origin
        );
      } finally {
        // Close the popup window
        window.close();
      }
    };

    handleCallback();
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Completing authentication...</h1>
        <p className="mt-2 text-gray-600">This window will close automatically.</p>
      </div>
    </div>
  );
} 