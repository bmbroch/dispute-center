const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function validateEnvironmentVariables() {
  const requiredVars = [
    'FIREBASE_SERVICE_ACCOUNT_KEY',
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID',
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET'
  ];

  const missingVars = [];
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    process.exit(1);
  }

  // Validate Firebase service account key is valid JSON
  try {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    JSON.parse(serviceAccountKey);
  } catch (error) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON');
    process.exit(1);
  }

  console.log('✅ Environment variables validated');
}

function validateTypeScript() {
  try {
    console.log('Running TypeScript validation...');
    execSync('tsc --noEmit', { stdio: 'inherit' });
    console.log('✅ TypeScript validation passed');
  } catch (error) {
    console.error('❌ TypeScript validation failed');
    process.exit(1);
  }
}

function validateESLint() {
  try {
    console.log('Running ESLint validation...');
    execSync('next lint', { stdio: 'inherit' });
    console.log('✅ ESLint validation passed');
  } catch (error) {
    console.error('❌ ESLint validation failed');
    process.exit(1);
  }
}

function validateBuild() {
  try {
    console.log('Running build validation...');
    execSync('next build', { stdio: 'inherit' });
    console.log('✅ Build validation passed');
  } catch (error) {
    console.error('❌ Build validation failed');
    process.exit(1);
  }
}

function main() {
  console.log('🔍 Starting pre-deployment validation...\n');

  validateEnvironmentVariables();
  validateTypeScript();
  validateESLint();
  validateBuild();

  console.log('\n✨ All validations passed! Ready for deployment.');
}

main();
