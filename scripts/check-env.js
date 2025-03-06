const requiredEnvVars = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID'
];

console.log('Checking environment variables...');
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`- ${varName}`);
    // Check if it exists in .env.local
    const envLocalValue = require('fs').readFileSync('.env.local', 'utf8')
      .split('\n')
      .find(line => line.startsWith(`${varName}=`));
    if (envLocalValue) {
      console.log(`  Found in .env.local: ${envLocalValue}`);
    }
  });
  process.exit(1);
} else {
  console.log('All required environment variables are present.');
  process.exit(0);
}
