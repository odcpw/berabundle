#!/bin/bash
# Test script for the Safe bundle execution

# Find the newest Safe UI bundle
BUNDLE_FILE=$(ls -t /home/oliver/Projects/berabundle/output/*_safe_ui.json | head -1)

if [ -z "$BUNDLE_FILE" ]; then
    echo "No Safe UI bundle found in the output directory"
    exit 1
fi

echo "Using bundle file: $BUNDLE_FILE"
echo "Testing Safe bundle execution..."

# Run the test
node -e "
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const SafeExecutor = require('./execution/executors/safeExecutor');

async function testSafeBundleExecution() {
    console.log('='.repeat(50));
    console.log('🔐 SAFE BUNDLE EXECUTION TEST');
    console.log('='.repeat(50));
    
    // Configuration
    const CONFIG = {
        safeAddress: '0x561EF9Fdf5341EF3815E69E1010067b7EF179dad',
        signerAddress: '0x6c6eEbcBd13e2BBeC88e44f298B17Dea0d2ce46F',
        password: '68ouimoi',
        bundleFile: '$BUNDLE_FILE'
    };
    
    // Load the bundle
    console.log(\`Loading bundle from \${CONFIG.bundleFile}...\`);
    const bundle = JSON.parse(fs.readFileSync(CONFIG.bundleFile, 'utf8'));
    
    // Initialize the executor
    console.log('Initializing SafeExecutor...');
    const executor = new SafeExecutor();
    
    // Execute the bundle
    console.log('Executing bundle...');
    const result = await executor.execute({
        safeAddress: CONFIG.safeAddress,
        bundle: { bundleData: bundle, summary: { format: 'safe_ui' } },
        signerAddress: CONFIG.signerAddress,
        password: CONFIG.password
    });
    
    // Display the result
    console.log('\\n' + '='.repeat(50));
    console.log('📋 RESULT:');
    console.log('='.repeat(50));
    console.log(JSON.stringify(result, null, 2));
    
    if (result.success) {
        console.log('\\n✅ Success!');
        console.log(\`You can view your transaction at: \${result.transactionUrl}\`);
    } else {
        console.log('\\n❌ Failed to execute Safe transaction');
    }
}

testSafeBundleExecution().catch(error => {
    console.error(\`ERROR: \${error.message}\`);
    if (error.stack) console.error(error.stack);
});
"

echo "Test complete"