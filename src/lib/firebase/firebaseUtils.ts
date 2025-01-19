import { getFirebaseAuth, getFirebaseDB } from "./firebase";
import {
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  Auth,
} from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  Firestore,
} from "firebase/firestore";

// Helper function to ensure Firebase is initialized
function ensureInitialized(): { auth: Auth; db: Firestore } | null {
  const auth = getFirebaseAuth();
  const db = getFirebaseDB();

  if (!auth || !db) {
    throw new Error('Firebase not initialized');
  }

  return { auth, db };
}

// Auth functions
export const logoutUser = async () => {
  const firebase = ensureInitialized();
  if (!firebase) return;
  return signOut(firebase.auth);
};

export const signInWithGoogle = async () => {
  const firebase = ensureInitialized();
  if (!firebase) throw new Error('Firebase not initialized');

  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(firebase.auth, provider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

// Firestore functions
export const addDocument = async (collectionName: string, data: any) => {
  const firebase = ensureInitialized();
  if (!firebase) throw new Error('Firebase not initialized');
  return addDoc(collection(firebase.db, collectionName), data);
};

export const getDocuments = async (collectionName: string) => {
  const firebase = ensureInitialized();
  if (!firebase) throw new Error('Firebase not initialized');

  const querySnapshot = await getDocs(collection(firebase.db, collectionName));
  return querySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

export const updateDocument = async (collectionName: string, id: string, data: any) => {
  const firebase = ensureInitialized();
  if (!firebase) throw new Error('Firebase not initialized');
  return updateDoc(doc(firebase.db, collectionName, id), data);
};

export const deleteDocument = async (collectionName: string, id: string) => {
  const firebase = ensureInitialized();
  if (!firebase) throw new Error('Firebase not initialized');
  return deleteDoc(doc(firebase.db, collectionName, id));
};
