const { execSync } = require('child_process');

// Add required environment variables here
const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'REPLICATE_API_TOKEN',
  'DEEPGRAM_API_KEY'
] as const;

// Minimum Node.js version required
const MIN_NODE_VERSION = '18.17.0';

function checkNodeVersion() {
  try {
    const currentVersion = process.version;
    const current = currentVersion.slice(1); // Remove the 'v' prefix
    
    const currentParts = current.split('.').map(Number);
    const minParts = MIN_NODE_VERSION.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if (currentParts[i] > minParts[i]) break;
      if (currentParts[i] < minParts[i]) {
        throw new Error(`Node.js version ${MIN_NODE_VERSION} or higher is required. Current version: ${currentVersion}`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Node.js version check failed: ${error.message}`);
    }
    throw error;
  }
}

function checkEnvVars() {
  try {
    const missingVars = REQUIRED_ENV_VARS.filter(
      (envVar) => !process.env[envVar]
    );

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables:\n${missingVars.join('\n')}`
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Environment variables check failed: ${error.message}`);
    }
    throw error;
  }
}

function cleanBuildDir() {
  try {
    // Clean .next directory
    execSync('rm -rf .next');
    console.log('✓ Cleaned build directory');
  } catch (error) {
    console.warn('Warning: Could not clean build directory', error instanceof Error ? error.message : error);
  }
}

async function validateBuild() {
  console.log('🔍 Running pre-build validation...');
  
  try {
    // Check Node.js version
    checkNodeVersion();
    console.log('✓ Node.js version is compatible');

    // Check environment variables
    checkEnvVars();
    console.log('✓ All required environment variables are set');

    // Clean build directory
    cleanBuildDir();
    
    console.log('✅ Pre-build validation passed!');
  } catch (error) {
    console.error('\n❌ Pre-build validation failed:');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('An unknown error occurred during validation');
    }
    process.exit(1);
  }
}

module.exports = { validateBuild }; 