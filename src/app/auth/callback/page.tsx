'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function CallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    async function handleCallback() {
      try {
        const code = searchParams.get('code');
        
        if (!code) {
          throw new Error('No authorization code received');
        }

        // Exchange the code for tokens
        const response = await fetch('/api/auth/google/callback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
          throw new Error('Failed to exchange code for tokens');
        }

        const { access_token, refresh_token, expires_in } = await response.json();

        // Calculate token expiry
        const tokenExpiry = Date.now() + (expires_in * 1000);

        // Send tokens back to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'GOOGLE_AUTH',
            access_token,
            refresh_token,
            tokenExpiry
          }, window.location.origin);
        }

      } catch (error) {
        console.error('Auth callback error:', error);
        // Optionally send error to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'GOOGLE_AUTH_ERROR',
            error: error instanceof Error ? error.message : 'Authentication failed'
          }, window.location.origin);
        }
      } finally {
        // Close the popup window
        window.close();
      }
    }

    handleCallback();
  }, [searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Completing Authentication</h2>
        <p className="text-gray-600">Please wait...</p>
      </div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Loading...</h2>
          <p className="text-gray-600">Please wait...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
} 