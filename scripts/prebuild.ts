const { validateBuild } = require('../src/lib/utils/validateBuild');
const { execSync } = require('child_process');

async function prebuild() {
  try {
    // Run build validation
    await validateBuild();

    // Run type checking
    console.log('\n🔍 Running type check...');
    execSync('tsc --noEmit', { stdio: 'inherit' });
    console.log('✓ TypeScript check passed');

    // Run linting
    console.log('\n🔍 Running ESLint...');
    execSync('next lint', { stdio: 'inherit' });
    console.log('✓ ESLint check passed');

    console.log('\n✅ All pre-build checks passed! Proceeding with build...\n');
  } catch (error) {
    console.error('\n❌ Pre-build checks failed');
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

prebuild(); 