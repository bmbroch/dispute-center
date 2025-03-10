'use client';

import { useState } from 'react';

interface Email {
  id: string;
  snippet: string;
  payload: {
    headers: {
      name: string;
      value: string;
    }[];
    parts?: {
      mimeType: string;
      body: {
        data?: string;
      };
    }[];
    body?: {
      data?: string;
    };
  };
  internalDate: string;
}

// This is a dummy component that has been deprecated and is scheduled for removal
// The current email display functionality uses EmailRenderNew in src/app/components/EmailRenderNew.tsx
export default function EmailDisplay({ userEmail }: { userEmail: string }) {
  console.log('EmailDisplay component is deprecated and should be replaced with EmailRenderNew');
  
  return (
    <div className="p-4">
      <p className="text-yellow-600">
        This component is deprecated. Please use EmailRenderNew component instead.
      </p>
    </div>
  );
} 