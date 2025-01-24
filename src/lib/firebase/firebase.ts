import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, Storage } from "firebase/storage";

// Firebase configuration
const FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: Storage | null = null;
let isInitialized = false;

function initializeFirebase() {
  if (isInitialized) {
    return { app, auth, db, storage };
  }

  try {
    // Initialize Firebase app if not already initialized
    app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
    
    if (typeof window !== 'undefined') {
      // Client-side initialization
      auth = getAuth(app);
      db = getFirestore(app);
      storage = getStorage(app);
    } else {
      // Server-side initialization
      db = getFirestore(app);
    }

    // Set initialized flag
    isInitialized = true;
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    throw error;
  }

  return { app, auth, db, storage };
}

// Initialize on module load
initializeFirebase();

export function getFirebaseApp() {
  return app;
}

export function getFirebaseAuth() {
  return auth;
}

export function getFirebaseDB() {
  if (!isInitialized) {
    throw new Error('Firebase not fully initialized');
  }
  return db;
}

export function getFirebaseStorage() {
  if (!isInitialized) {
    throw new Error('Firebase not fully initialized');
  }
  return storage;
}

export function isFirebaseInitialized() {
  return isInitialized;
}
