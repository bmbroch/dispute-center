import { storage } from "./firebase";
import { getFirebaseDB } from "./firebase";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Stripe from "stripe";

// Stripe functions
export const getStripeKey = async (userEmail: string): Promise<string | null> => {
  const db = getFirebaseDB();
  if (!db) throw new Error('Firebase DB not initialized');

  try {
    const stripeKeysRef = collection(db, 'stripeKeys');
    const q = query(stripeKeysRef, where('userEmail', '==', userEmail));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      console.log('No Stripe key found for user:', userEmail);
      return null;
    }

    const stripeKey = querySnapshot.docs[0].data().stripeKey;
    if (!stripeKey) {
      console.log('Stripe key is empty for user:', userEmail);
      return null;
    }

    return stripeKey;
  } catch (error) {
    console.error('Error fetching Stripe key:', error);
    throw error;
  }
};

// Debug function for Stripe key
export const debugStripeKey = async (userEmail: string) => {
  const db = getFirebaseDB();
  if (!db) throw new Error('Firebase DB not initialized');

  try {
    // Check if Firebase is initialized
    console.log('Firebase DB initialized successfully');

    // Query for existing key
    const stripeKeysRef = collection(db, 'stripeKeys');
    const q = query(stripeKeysRef, where('userEmail', '==', userEmail));
    const querySnapshot = await getDocs(q);

    console.log('Stripe key query results:', {
      empty: querySnapshot.empty,
      size: querySnapshot.size,
      docs: querySnapshot.docs.map(doc => ({
        id: doc.id,
        exists: doc.exists(),
        data: { ...doc.data(), stripeKey: '***' }
      }))
    });

    if (querySnapshot.empty) {
      console.log('No Stripe key found for email:', userEmail);
      return false;
    }

    const stripeKey = querySnapshot.docs[0].data().stripeKey;
    
    // Log key format (safely)
    console.log('Stripe key format check:', {
      exists: !!stripeKey,
      startsWithSk: stripeKey?.startsWith('sk_'),
      length: stripeKey?.length
    });

    // Only validate format, don't test the key yet
    if (!stripeKey) {
      console.error('No Stripe key value found');
      return false;
    }

    // Return true if we have a key, let the actual API calls validate it
    console.log('Stripe key found and basic validation passed');
    return true;
  } catch (error) {
    console.error('Error in debugStripeKey:', error);
    throw error;
  }
};

// Firestore functions
export const addDocument = async (collectionName: string, data: any) => {
  const db = getFirebaseDB();
  if (!db) throw new Error('DB not initialized');
  return addDoc(collection(db, collectionName), data);
};

export const getDocuments = async (collectionName: string) => {
  const db = getFirebaseDB();
  if (!db) throw new Error('DB not initialized');
  const querySnapshot = await getDocs(collection(db, collectionName));
  return querySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

export const updateDocument = async (collectionName: string, id: string, data: any) => {
  const db = getFirebaseDB();
  if (!db) throw new Error('DB not initialized');
  return updateDoc(doc(db, collectionName, id), data);
};

export const deleteDocument = async (collectionName: string, id: string) => {
  const db = getFirebaseDB();
  if (!db) throw new Error('DB not initialized');
  return deleteDoc(doc(db, collectionName, id));
};

// Storage functions
export const uploadImage = async (imageFile: File, path: string) => {
  if (!storage) throw new Error('Storage not initialized');
  const storageRef = ref(storage, path);
  const snapshot = await uploadBytes(storageRef, imageFile);
  return getDownloadURL(snapshot.ref);
};

export const getImageUrl = async (path: string) => {
  if (!storage) throw new Error('Storage not initialized');
  const storageRef = ref(storage, path);
  return getDownloadURL(storageRef);
};
