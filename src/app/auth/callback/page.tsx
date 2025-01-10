'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      window.opener.postMessage({
        type: 'GOOGLE_AUTH_ERROR',
        error
      }, window.location.origin);
      return;
    }

    if (code) {
      fetch('/api/auth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code })
      })
      .then(response => response.json())
      .then(data => {
        window.opener.postMessage({
          type: 'GOOGLE_AUTH',
          ...data
        }, window.location.origin);
      })
      .catch(error => {
        console.error('Error exchanging code for token:', error);
        window.opener.postMessage({
          type: 'GOOGLE_AUTH_ERROR',
          error: error.message
        }, window.location.origin);
      });
    }
  }, [searchParams]);

  return null;
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CallbackContent />
    </Suspense>
  );
} 