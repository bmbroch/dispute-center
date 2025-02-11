import { OAuth2Client, Credentials } from 'google-auth-library';

export function getOAuth2Client(credentials?: Credentials): OAuth2Client {
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

  if (credentials) {
    // Set credentials and refresh handler
    client.setCredentials(credentials);
    
    // Set up refresh handler
    client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        // Store the new refresh token
        credentials.refresh_token = tokens.refresh_token;
      }
      // Update the access token
      credentials.access_token = tokens.access_token;
      credentials.expiry_date = tokens.expiry_date;
      
      client.setCredentials(credentials);
    });
  }

  return client;
} 