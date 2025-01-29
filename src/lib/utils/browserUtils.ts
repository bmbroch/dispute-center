// Utility functions for safely handling browser extension interactions

// Safely access window.ethereum without triggering redefine property errors
export const getEthereum = () => {
  if (typeof window === 'undefined') return null;
  
  try {
    return (window as any).ethereum || null;
  } catch (error) {
    console.warn('Error accessing ethereum provider:', error);
    return null;
  }
};

// Safely check if MetaMask is installed
export const isMetaMaskInstalled = () => {
  const ethereum = getEthereum();
  return Boolean(ethereum && ethereum.isMetaMask);
};

// Safely handle any browser extension that might inject properties
export const safelyAccessExtensionProperty = <T>(propertyName: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  
  try {
    return (window as any)[propertyName] as T || defaultValue;
  } catch (error) {
    console.warn(`Error accessing ${propertyName}:`, error);
    return defaultValue;
  }
}; 