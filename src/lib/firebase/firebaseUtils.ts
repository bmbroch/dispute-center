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
  limit,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Stripe from "stripe";

// Stripe functions
export const getStripeKey = async (userEmail: string): Promise<string | null> => {
  if (!userEmail) {
    console.error('getStripeKey called with empty userEmail');
    return null;
  }

  console.log(`Getting Stripe key for user: ${userEmail}`);
  
  try {
    const db = getFirebaseDB();
    if (!db) {
      console.error('Firebase DB not initialized in getStripeKey');
      return null;
    }

    // Normalize the email to lowercase for consistent lookups
    const normalizedEmail = userEmail.toLowerCase().trim();
    console.log(`Normalized email for Stripe key lookup: ${normalizedEmail}`);
    
    const stripeKeysRef = collection(db, 'stripeKeys');
    const q = query(stripeKeysRef, where('userEmail', '==', normalizedEmail));
    
    console.log(`Querying stripeKeys collection with: userEmail == ${normalizedEmail}`);
    const querySnapshot = await getDocs(q);
    
    console.log(`Found ${querySnapshot.docs.length} stripe key documents for ${normalizedEmail}`);
    
    if (querySnapshot.empty) {
      console.log(`No Stripe key found for user: ${normalizedEmail}`);
      
      // Try a secondary lookup without normalization (for backward compatibility)
      const q2 = query(stripeKeysRef, where('userEmail', '==', userEmail));
      const querySnapshot2 = await getDocs(q2);
      
      console.log(`Secondary lookup found ${querySnapshot2.docs.length} stripe key documents for ${userEmail}`);
      
      if (querySnapshot2.empty) {
        console.log('No Stripe key found in secondary lookup either');
        return null;
      }
      
      const stripeKey = querySnapshot2.docs[0].data().stripeKey;
      if (!stripeKey) {
        console.log('Stripe key field exists but is empty in secondary lookup');
        return null;
      }
      
      console.log(`Found Stripe key in secondary lookup (length: ${stripeKey.length})`);
      return stripeKey;
    }
    
    const stripeKey = querySnapshot.docs[0].data().stripeKey;
    if (!stripeKey) {
      console.log(`Stripe key is empty for user: ${normalizedEmail}`);
      return null;
    }
    
    console.log(`Found Stripe key for ${normalizedEmail} (length: ${stripeKey.length})`);
    return stripeKey;
  } catch (error) {
    console.error('Error fetching Stripe key:', error);
    return null;
  }
};

interface DebugDocument {
  id: string;
  match: string;
  hasStripeKey: boolean;
  keyLength: any;
  fields: string[];
  userEmail: any;
  createdAt: any;
}

interface DebugInfo {
  userEmail: string;
  error: string | null;
  steps: string[];
  collections: {
    stripeKeys?: {
      exists: boolean;
      size: number;
    }
  };
  documents: DebugDocument[];
  queryTime: number;
}

export const debugStripeKey = async (userEmail: string) => {
  const startTime = Date.now();
  
  // Create a debug object to collect information
  const debug: DebugInfo = {
    userEmail,
    error: null,
    steps: [],
    collections: {},
    documents: [],
    queryTime: 0
  };
  
  try {
    const db = getFirebaseDB();
    if (!db) {
      debug.error = 'Firebase DB not initialized';
      return debug;
    }
    
    debug.steps.push('Firebase DB initialized successfully');
    
    try {
      // Get a reference to the stripeKeys collection
      const stripeKeysRef = collection(db, 'stripeKeys');
      debug.steps.push('Retrieved stripeKeys collection reference');
      
      // Add collection info to debug output
      debug.collections.stripeKeys = {
        exists: true,
        size: 0
      };
      
      // Get all documents to check if collection exists and is populated
      const allDocsSnapshot = await getDocs(stripeKeysRef);
      debug.collections.stripeKeys.size = allDocsSnapshot.size;
      debug.steps.push(`Found ${allDocsSnapshot.size} total documents in stripeKeys collection`);
      
      // Try exact match first
      const exactMatchQuery = query(stripeKeysRef, where('userEmail', '==', userEmail));
      const exactMatchSnapshot = await getDocs(exactMatchQuery);
      debug.steps.push(`Exact match query complete (found: ${exactMatchSnapshot.size})`);
      
      // Try lowercase match as fallback
      const lowercaseMatchQuery = query(stripeKeysRef, where('userEmail', '==', userEmail.toLowerCase()));
      const lowercaseMatchSnapshot = await getDocs(lowercaseMatchQuery);
      debug.steps.push(`Lowercase match query complete (found: ${lowercaseMatchSnapshot.size})`);
      
      // Process exact matches
      exactMatchSnapshot.forEach((doc) => {
        const data = doc.data();
        debug.documents.push({
          id: doc.id,
          match: 'exact',
          hasStripeKey: !!data.stripeKey,
          keyLength: data.stripeKey?.length || 0,
          fields: Object.keys(data),
          userEmail: data.userEmail,
          createdAt: data.createdAt?.toDate?.() || 'No createdAt field'
        });
      });
      
      // Process lowercase matches (only if not already found with exact match)
      if (exactMatchSnapshot.empty) {
        lowercaseMatchSnapshot.forEach((doc) => {
          const data = doc.data();
          debug.documents.push({
            id: doc.id,
            match: 'lowercase',
            hasStripeKey: !!data.stripeKey,
            keyLength: data.stripeKey?.length || 0,
            fields: Object.keys(data),
            userEmail: data.userEmail,
            createdAt: data.createdAt?.toDate?.() || 'No createdAt field'
          });
        });
      }
      
    } catch (collectionError: unknown) {
      const errorMessage = collectionError instanceof Error ? collectionError.message : 'Unknown error';
      debug.error = `Error accessing stripeKeys collection: ${errorMessage}`;
      debug.steps.push(`ERROR: ${debug.error}`);
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    debug.error = `Unhandled error in debugStripeKey: ${errorMessage}`;
    debug.steps.push(`ERROR: ${debug.error}`);
  }
  
  debug.queryTime = Date.now() - startTime;
  return debug;
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
