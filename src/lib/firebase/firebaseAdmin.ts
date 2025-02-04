import { getApps, initializeApp, cert } from 'firebase-admin/app';

export function initializeFirebaseAdmin() {
  if (getApps().length === 0) {
    try {
      const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      
      if (!serviceAccountKey) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set');
      }

      let serviceAccount;
      try {
        serviceAccount = JSON.parse(serviceAccountKey);
      } catch (error) {
        console.error('Error parsing service account key:', error);
        throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_KEY format');
      }

      // Validate required service account fields
      if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
        throw new Error('Service account key is missing required fields (project_id, private_key, or client_email)');
      }

      initializeApp({
        credential: cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
      console.log('Firebase Admin initialized successfully');
    } catch (error) {
      console.error('Error initializing Firebase Admin:', error);
      throw error;
    }
  }
} 