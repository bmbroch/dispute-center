import { OAuth2Client } from 'google-auth-library';

export function getOAuth2Client(): OAuth2Client {
  // Check for required environment variables
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID environment variable is not set');
  }
  if (!process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_SECRET environment variable is not set');
  }
  if (!process.env.GOOGLE_REDIRECT_URI) {
    throw new Error('GOOGLE_REDIRECT_URI environment variable is not set');
  }

  console.log('Initializing Google OAuth2 client...');
  console.log('Redirect URI:', process.env.GOOGLE_REDIRECT_URI);
  
  const client = new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI
  });

  return client;
} 