'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { getEthereum, safelyAccessExtensionProperty } from '../utils/browserUtils';

interface ExtensionSafetyContextType {
  ethereum: any;
  safelyAccessProperty: <T>(propertyName: string, defaultValue: T) => T;
}

const defaultSafelyAccessProperty = <T,>(propertyName: string, defaultValue: T): T => defaultValue;

const ExtensionSafetyContext = createContext<ExtensionSafetyContextType>({
  ethereum: null,
  safelyAccessProperty: defaultSafelyAccessProperty,
});

export function ExtensionSafetyProvider({ children }: { children: React.ReactNode }) {
  const [ethereumValue, setEthereumValue] = useState<any>(null);

  // Set up safe access to ethereum and other injected properties
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Create a safe handler for ethereum injection
    const handleEthereumInjection = () => {
      try {
        const ethereum = getEthereum();
        setEthereumValue(ethereum);
      } catch (error) {
        console.warn('Error handling ethereum injection:', error);
      }
    };

    // Initial check
    handleEthereumInjection();

    // Listen for ethereum injection
    window.addEventListener('ethereum#initialized', handleEthereumInjection);
    // Also check when the DOM is loaded (some wallets inject after DOM load)
    window.addEventListener('DOMContentLoaded', handleEthereumInjection);

    return () => {
      window.removeEventListener('ethereum#initialized', handleEthereumInjection);
      window.removeEventListener('DOMContentLoaded', handleEthereumInjection);
    };
  }, []);

  const value = {
    ethereum: ethereumValue,
    safelyAccessProperty: safelyAccessExtensionProperty,
  };

  return (
    <ExtensionSafetyContext.Provider value={value}>
      {children}
    </ExtensionSafetyContext.Provider>
  );
}

export const useExtensionSafety = () => {
  const context = useContext(ExtensionSafetyContext);
  if (context === undefined) {
    throw new Error('useExtensionSafety must be used within an ExtensionSafetyProvider');
  }
  return context;
}; 