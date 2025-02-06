import * as admin from 'firebase-admin';

let adminApp: admin.app.App | undefined;

export function getFirebaseAdmin() {
  if (adminApp) return adminApp;

  try {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    
    if (!serviceAccountKey) {
      console.error('Firebase Admin SDK initialization failed: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set');
      return undefined;
    }

    let parsedKey;
    try {
      // First try to parse as JSON
      try {
        parsedKey = JSON.parse(serviceAccountKey);
        console.log('Successfully parsed service account key as JSON');
      } catch {
        // If JSON parsing fails, try decoding from base64
        const decoded = Buffer.from(serviceAccountKey, 'base64').toString('utf-8');
        parsedKey = JSON.parse(decoded);
        console.log('Successfully parsed service account key from base64');
      }
    } catch (error) {
      console.error('Error parsing service account key:', error);
      throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_KEY format - must be valid JSON or base64 encoded JSON');
    }

    // Validate required service account fields
    if (!parsedKey.project_id || !parsedKey.private_key || !parsedKey.client_email) {
      throw new Error('Service account key is missing required fields (project_id, private_key, or client_email)');
    }

    // Ensure private key has proper line breaks
    parsedKey.private_key = parsedKey.private_key.replace(/\\n/g, '\n');

    if (!admin.apps.length) {
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(parsedKey),
        projectId: parsedKey.project_id
      });
      console.log('Successfully initialized Firebase Admin SDK');
    } else {
      adminApp = admin.app();
    }

    return adminApp;
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
    return undefined;
  }
} 