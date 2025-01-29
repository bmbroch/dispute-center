const { validateBuild } = require('../src/lib/utils/validateBuild');

async function prebuild() {
  try {
    // Run all validations
    await validateBuild();
  } catch (error) {
    // This should not happen as validateBuild handles its own errors
    console.error('\n❌ Unexpected error in prebuild script:');
    console.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

prebuild(); 