'use client';

import { useEffect, useState } from 'react';

export default function AuthCallback() {
  const [status, setStatus] = useState('Processing...');

  useEffect(() => {
    try {
      // Get the code from URL
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error');
      const errorDescription = params.get('error_description');

      console.log('Auth callback received:', {
        hasCode: !!code,
        error,
        errorDescription
      });

      if (error) {
        setStatus('Authentication failed');
        window.opener?.postMessage({ 
          type: 'auth-error', 
          error: errorDescription || error 
        }, window.location.origin);
      } else if (code) {
        setStatus('Completing sign in...');
        window.opener?.postMessage({ 
          type: 'auth-success', 
          code 
        }, window.location.origin);
      } else {
        setStatus('No authentication code received');
        window.opener?.postMessage({ 
          type: 'auth-error', 
          error: 'No authentication code received' 
        }, window.location.origin);
      }

      // Close the popup after a short delay
      setTimeout(() => {
        window.close();
      }, 1000);
    } catch (error) {
      console.error('Error in auth callback:', error);
      setStatus('Authentication error occurred');
      window.opener?.postMessage({ 
        type: 'auth-error', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, window.location.origin);
    }
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mx-auto"></div>
        <p className="mt-4 text-gray-600">{status}</p>
      </div>
    </div>
  );
} 