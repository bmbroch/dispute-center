'use client';

import { useEffect, useState } from 'react';

export default function AuthCallback() {
  const [status, setStatus] = useState('Processing...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the code from URL
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const error = params.get('error');
        const errorDescription = params.get('error_description');

        console.log('Auth callback received:', {
          hasCode: !!code,
          code: code ? `${code.substring(0, 10)}...` : null,
          error,
          errorDescription,
          hasOpener: !!window.opener,
          origin: window.location.origin
        });

        if (error) {
          const errorMsg = errorDescription || error;
          setStatus('Authentication failed');
          setError(errorMsg);
          window.opener?.postMessage({ 
            type: 'auth-error', 
            error: errorMsg 
          }, window.location.origin);
        } else if (code) {
          setStatus('Completing sign in...');
          
          // Attempt to send the code to the opener window
          if (!window.opener) {
            throw new Error('Popup window lost reference to opener');
          }

          window.opener.postMessage({ 
            type: 'auth-success', 
            code 
          }, window.location.origin);

          // Close the popup after a short delay
          setTimeout(() => {
            window.close();
          }, 1500);
        } else {
          const errorMsg = 'No authentication code received';
          setStatus('Authentication failed');
          setError(errorMsg);
          window.opener?.postMessage({ 
            type: 'auth-error', 
            error: errorMsg 
          }, window.location.origin);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in auth callback:', error);
        setStatus('Authentication error occurred');
        setError(errorMsg);
        window.opener?.postMessage({ 
          type: 'auth-error', 
          error: errorMsg 
        }, window.location.origin);
      }
    };

    handleCallback();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mx-auto"></div>
        <p className="mt-4 text-gray-600">{status}</p>
        {error && (
          <p className="mt-2 text-red-600 text-sm">
            Error: {error}
          </p>
        )}
      </div>
    </div>
  );
} 