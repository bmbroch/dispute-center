import { ExecSyncOptionsWithStringEncoding } from 'child_process';
const { execSync } = require('child_process');
require('dotenv').config();

// Add required environment variables here
const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID'
] as const;

// Optional environment variables (uncomment if needed)
// const OPTIONAL_ENV_VARS = [
//   'OPENAI_API_KEY',
//   'ANTHROPIC_API_KEY',
//   'REPLICATE_API_TOKEN',
//   'DEEPGRAM_API_KEY'
// ] as const;

// Minimum Node.js version required
const MIN_NODE_VERSION = '18.17.0';

interface ValidationError {
  type: 'node' | 'env' | 'build' | 'typescript' | 'lint' | 'next-build';
  message: string;
  severity: 'error' | 'warning';
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
          severity: 'error',
          message: `Node.js version ${MIN_NODE_VERSION} or higher is required. Current version: ${currentVersion}`
        });
        break;
      }
    }
  } catch (error) {
    errors.push({
      type: 'node',
      severity: 'error',
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
        severity: 'error',
        message: `Missing environment variables:\n${missingVars.join('\n')}`
      });
    }
  } catch (error) {
    errors.push({
      type: 'env',
      severity: 'error',
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
      severity: 'warning',
      message: `Could not clean build directory: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
  return errors;
}

function runTypeCheck(): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    const options: ExecSyncOptionsWithStringEncoding = {
      stdio: 'pipe',
      encoding: 'utf-8'
    };
    execSync('tsc --noEmit', options);
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      errors.push({
        type: 'typescript',
        severity: 'error',
        message: `TypeScript errors found:\n${error.stdout || error.message}`
      });
    } else {
      errors.push({
        type: 'typescript',
        severity: 'error',
        message: `TypeScript check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }
  return errors;
}

function runLintCheck(): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    const options: ExecSyncOptionsWithStringEncoding = {
      stdio: 'pipe',
      encoding: 'utf-8'
    };
    execSync('next lint', options);
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      errors.push({
        type: 'lint',
        severity: 'warning',
        message: `ESLint errors found:\n${error.stdout || error.message}`
      });
    } else {
      errors.push({
        type: 'lint',
        severity: 'warning',
        message: `ESLint check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }
  return errors;
}

function runNextBuild(): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    const options: ExecSyncOptionsWithStringEncoding = {
      stdio: 'pipe',
      encoding: 'utf-8'
    };
    execSync('next build', options);
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      errors.push({
        type: 'next-build',
        severity: 'error',
        message: `Next.js build errors found:\n${error.stdout || error.message}`
      });
    } else {
      errors.push({
        type: 'next-build',
        severity: 'error',
        message: `Next.js build failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }
  return errors;
}

export async function validateBuild(): Promise<void> {
  console.log('🔍 Running complete build validation...\n');
  const allErrors: ValidationError[] = [];
  let hasBlockingErrors = false;
  
  // Run all checks and collect errors
  console.log('Phase 1: Pre-build Validation');
  
  console.log('\nChecking Node.js version...');
  const nodeErrors = checkNodeVersion();
  allErrors.push(...nodeErrors);
  console.log('✓ Node.js version check completed');
  
  if (nodeErrors.length === 0) {
    console.log('\nChecking environment variables...');
    const envErrors = checkEnvVars();
    allErrors.push(...envErrors);
    console.log('✓ Environment variables check completed');

    console.log('\nCleaning build directory...');
    const buildDirErrors = cleanBuildDir();
    allErrors.push(...buildDirErrors);
    console.log('✓ Build directory check completed');

    console.log('\nPhase 2: Code Quality Checks');
    
    console.log('\nRunning TypeScript type check...');
    const typeErrors = runTypeCheck();
    allErrors.push(...typeErrors);
    console.log('✓ TypeScript check completed');

    console.log('\nRunning ESLint check...');
    const lintErrors = runLintCheck();
    allErrors.push(...lintErrors);
    console.log('✓ ESLint check completed');

    // Only proceed with build if there are no blocking errors
    hasBlockingErrors = allErrors.some(error => 
      error.severity === 'error' && error.type !== 'next-build'
    );

    if (!hasBlockingErrors) {
      console.log('\nPhase 3: Next.js Build');
      console.log('\nRunning Next.js build...');
      const buildErrors = runNextBuild();
      allErrors.push(...buildErrors);
      console.log('✓ Next.js build completed');
    }
  }

  // Report all errors if any were found
  if (allErrors.length > 0) {
    console.error('\n❌ Build validation found the following issues:\n');
    
    // Group errors by severity and type
    const errorsByType = {
      errors: allErrors.filter(e => e.severity === 'error'),
      warnings: allErrors.filter(e => e.severity === 'warning')
    };

    if (errorsByType.errors.length > 0) {
      console.error('\n🚫 ERRORS:');
      Object.entries(
        errorsByType.errors.reduce((acc, error) => {
          if (!acc[error.type]) acc[error.type] = [];
          acc[error.type].push(error.message);
          return acc;
        }, {} as Record<string, string[]>)
      ).forEach(([type, messages]) => {
        console.error(`\n${type.toUpperCase()}:`);
        messages.forEach(message => console.error(`- ${message}\n`));
      });
    }

    if (errorsByType.warnings.length > 0) {
      console.error('\n⚠️  WARNINGS:');
      Object.entries(
        errorsByType.warnings.reduce((acc, error) => {
          if (!acc[error.type]) acc[error.type] = [];
          acc[error.type].push(error.message);
          return acc;
        }, {} as Record<string, string[]>)
      ).forEach(([type, messages]) => {
        console.error(`\n${type.toUpperCase()}:`);
        messages.forEach(message => console.error(`- ${message}\n`));
      });
    }

    if (hasBlockingErrors || allErrors.some(e => e.type === 'next-build' && e.severity === 'error')) {
      process.exit(1);
    }
  }

  console.log('✅ All build validation checks passed!\n');
} 