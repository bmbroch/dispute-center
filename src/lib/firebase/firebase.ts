import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

// Prevent multiple initializations during SSR
const FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

function initializeFirebase() {
  if (typeof window === 'undefined') {
    return null; // Return null during SSR
  }

  try {
    if (!FIREBASE_CONFIG.apiKey) {
      console.warn('Firebase configuration is missing. Make sure to set the environment variables.');
      return null;
    }

    // Initialize Firebase only if not already initialized
    if (!app) {
      app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
      auth = getAuth(app);
      db = getFirestore(app);
      storage = getStorage(app);
    }

    return { app, auth, db, storage };
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    return null;
  }
}

export function getFirebaseApp() {
  return initializeFirebase()?.app;
}

export function getFirebaseAuth() {
  return initializeFirebase()?.auth;
}

export function getFirebaseDB() {
  return initializeFirebase()?.db;
}

export function getFirebaseStorage() {
  return initializeFirebase()?.storage;
}
