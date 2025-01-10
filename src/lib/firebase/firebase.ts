import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

function initializeFirebase() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.warn('Firebase configuration is missing. Make sure to set the environment variables.');
    return null;
  }

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  // Initialize Firebase only if not already initialized
  if (!app && typeof window !== 'undefined') {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
  }

  return { app, auth, db, storage };
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
