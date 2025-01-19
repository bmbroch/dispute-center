"use client";

import { useState } from 'react';
import { getFirebaseAuth, getFirebaseDB, getFirebaseStorage } from '@/lib/firebase/firebase';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { signInWithGoogle } from '@/lib/firebase/firebaseUtils';

export default function FirebaseTest() {
  const [status, setStatus] = useState<{auth: string, firestore: string, storage: string}>({
    auth: 'Not tested',
    firestore: 'Not tested',
    storage: 'Not tested'
  });

  const testAuth = async () => {
    try {
      const auth = getFirebaseAuth();
      if (!auth) throw new Error('Auth not initialized');
      setStatus(prev => ({ ...prev, auth: 'Auth initialized successfully' }));
    } catch (error) {
      setStatus(prev => ({ ...prev, auth: `Auth error: ${error.message}` }));
    }
  };

  const testFirestore = async () => {
    try {
      const db = getFirebaseDB();
      if (!db) throw new Error('Firestore not initialized');
      
      // Try to write and read from a test collection
      const testCollection = collection(db, 'test');
      const docRef = await addDoc(testCollection, { test: true, timestamp: new Date() });
      const snapshot = await getDocs(testCollection);
      
      setStatus(prev => ({ ...prev, firestore: 'Firestore working: Read/Write successful' }));
    } catch (error) {
      setStatus(prev => ({ ...prev, firestore: `Firestore error: ${error.message}` }));
    }
  };

  const testStorage = async () => {
    try {
      const storage = getFirebaseStorage();
      if (!storage) throw new Error('Storage not initialized');
      
      // Try to upload a test string
      const testRef = ref(storage, 'test/test.txt');
      await uploadString(testRef, 'Hello, Firebase!');
      const url = await getDownloadURL(testRef);
      
      setStatus(prev => ({ ...prev, storage: 'Storage working: Upload/Download successful' }));
    } catch (error) {
      setStatus(prev => ({ ...prev, storage: `Storage error: ${error.message}` }));
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Firebase Connection Test</h2>
      
      <div className="space-y-4">
        <div>
          <button 
            onClick={testAuth}
            className="bg-blue-500 text-white px-4 py-2 rounded mr-2"
          >
            Test Auth
          </button>
          <span>{status.auth}</span>
        </div>

        <div>
          <button 
            onClick={testFirestore}
            className="bg-green-500 text-white px-4 py-2 rounded mr-2"
          >
            Test Firestore
          </button>
          <span>{status.firestore}</span>
        </div>

        <div>
          <button 
            onClick={testStorage}
            className="bg-purple-500 text-white px-4 py-2 rounded mr-2"
          >
            Test Storage
          </button>
          <span>{status.storage}</span>
        </div>

        <div>
          <button 
            onClick={signInWithGoogle}
            className="bg-red-500 text-white px-4 py-2 rounded mr-2"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
} 