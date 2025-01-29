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

interface ValidationError {
  type: 'node' | 'env' | 'build' | 'typescript' | 'lint';
  message: string;
}

function checkNodeVersion(): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    const currentVersion = process.version;
    const current = currentVersion.slice(1); // Remove the 'v' prefix
    
    const currentParts = current.split('.').map(Number);
    const minParts = MIN_NODE_VERSION.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if (currentParts[i] > minParts[i]) break;
      if (currentParts[i] < minParts[i]) {
        errors.push({
          type: 'node',
          message: `Node.js version ${MIN_NODE_VERSION} or higher is required. Current version: ${currentVersion}`
        });
        break;
      }
    }
  } catch (error) {
    errors.push({
      type: 'node',
      message: `Node.js version check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
  return errors;
}

function checkEnvVars(): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    const missingVars = REQUIRED_ENV_VARS.filter(
      (envVar) => !process.env[envVar]
    );

    if (missingVars.length > 0) {
      errors.push({
        type: 'env',
        message: `Missing environment variables:\n${missingVars.join('\n')}`
      });
    }
  } catch (error) {
    errors.push({
      type: 'env',
      message: `Environment variables check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
  return errors;
}

function cleanBuildDir(): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    // Clean .next directory
    execSync('rm -rf .next');
    console.log('✓ Cleaned build directory');
  } catch (error) {
    errors.push({
      type: 'build',
      message: `Could not clean build directory: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
  return errors;
}

function runTypeCheck(): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    execSync('tsc --noEmit', { stdio: 'pipe' });
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      errors.push({
        type: 'typescript',
        message: `TypeScript errors found:\n${error.stdout || error.message}`
      });
    } else {
      errors.push({
        type: 'typescript',
        message: `TypeScript check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }
  return errors;
}

function runLintCheck(): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    execSync('next lint', { stdio: 'pipe' });
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      errors.push({
        type: 'lint',
        message: `ESLint errors found:\n${error.stdout || error.message}`
      });
    } else {
      errors.push({
        type: 'lint',
        message: `ESLint check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }
  return errors;
}

async function validateBuild() {
  console.log('🔍 Running complete build validation...\n');
  const allErrors: ValidationError[] = [];
  
  // Run all checks and collect errors
  console.log('Checking Node.js version...');
  allErrors.push(...checkNodeVersion());
  console.log('✓ Node.js version check completed\n');

  console.log('Checking environment variables...');
  allErrors.push(...checkEnvVars());
  console.log('✓ Environment variables check completed\n');

  console.log('Cleaning build directory...');
  allErrors.push(...cleanBuildDir());
  console.log('✓ Build directory check completed\n');

  console.log('Running TypeScript type check...');
  allErrors.push(...runTypeCheck());
  console.log('✓ TypeScript check completed\n');

  console.log('Running ESLint check...');
  allErrors.push(...runLintCheck());
  console.log('✓ ESLint check completed\n');

  // Report all errors if any were found
  if (allErrors.length > 0) {
    console.error('\n❌ Build validation found the following issues:\n');
    
    // Group errors by type
    const groupedErrors = allErrors.reduce((acc, error) => {
      if (!acc[error.type]) {
        acc[error.type] = [];
      }
      acc[error.type].push(error.message);
      return acc;
    }, {} as Record<string, string[]>);

    // Print grouped errors
    Object.entries(groupedErrors).forEach(([type, messages]) => {
      console.error(`\n${type.toUpperCase()} ERRORS:`);
      messages.forEach(message => console.error(`- ${message}\n`));
    });

    process.exit(1);
  }

  console.log('✅ All build validation checks passed!\n');
}

module.exports = { validateBuild }; 