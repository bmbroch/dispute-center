import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase configuration
const FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Debug Firebase config with actual values
console.log('Firebase Config Details:', {
  apiKey: FIREBASE_CONFIG.apiKey?.slice(0, 5) + '...',
  authDomain: FIREBASE_CONFIG.authDomain,
  projectId: FIREBASE_CONFIG.projectId,
  storageBucket: FIREBASE_CONFIG.storageBucket,
  messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
  appId: FIREBASE_CONFIG.appId?.split(':')[0] + '...',
});

// Debug Firebase config presence
console.log('Firebase Config Status:', {
  hasApiKey: !!FIREBASE_CONFIG.apiKey,
  hasAuthDomain: !!FIREBASE_CONFIG.authDomain,
  hasProjectId: !!FIREBASE_CONFIG.projectId,
  hasStorageBucket: !!FIREBASE_CONFIG.storageBucket,
  hasMessagingSenderId: !!FIREBASE_CONFIG.messagingSenderId,
  hasAppId: !!FIREBASE_CONFIG.appId,
});

// Initialize Firebase
let firebaseApp;
let firestoreDb: Firestore | null = null;

try {
  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    firebaseApp = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApp();
    firestoreDb = getFirestore(firebaseApp);
    console.log('Firebase app initialized successfully');
  }
} catch (error) {
  console.error('Error initializing Firebase:', error);
}

export function getFirebaseDB(): Firestore | null {
  try {
    console.log('Initializing Firebase...');
    
    // Check if app is already initialized
    let app;
    try {
      app = getApp();
      console.log('Using existing Firebase app');
    } catch {
      const config = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      };

      console.log('Firebase config check:', {
        hasApiKey: !!config.apiKey,
        hasAuthDomain: !!config.authDomain,
        hasProjectId: !!config.projectId,
        hasStorageBucket: !!config.storageBucket,
        hasMessagingSenderId: !!config.messagingSenderId,
        hasAppId: !!config.appId
      });

      app = initializeApp(config);
      console.log('Initialized new Firebase app');
    }

    const db = getFirestore(app);
    console.log('Firestore instance created');
    return db;
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    return null;
  }
}

// Initialize storage only if we have a Firebase app
export const storage = typeof window !== 'undefined' ? getStorage(firebaseApp) : null;

// Google Cloud OAuth Configuration
export const GOOGLE_OAUTH_CONFIG = {
  client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID as string,
  redirect_uri: typeof window !== 'undefined' 
    ? `${window.location.origin}/api/auth/callback/google`
    : process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3002/api/auth/callback/google',
  scope: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose'
  ].join(' '),
  response_type: 'code',
  access_type: 'offline',
  prompt: 'consent'
};

// Helper function to get all allowed redirect URIs
export const getAllowedRedirectUris = () => {
  const productionUri = 'https://dispute-center-leli.vercel.app/api/auth/callback/google';
  const localPorts = [3000, 3001, 3002, 3003];
  const localUris = localPorts.map(port => `http://localhost:${port}/api/auth/callback/google`);
  return [...localUris, productionUri];
};
