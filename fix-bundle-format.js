/**
 * Bundle format fixer to handle both EOA and Safe bundle formats
 */
const fs = require('fs');
const path = require('path');

// Load and normalize bundle - handle both formats correctly
async function loadAndNormalizeBundle(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const bundle = JSON.parse(content);
        
        console.log("Detected bundle format:", bundle.format);
        
        // If bundle has transactions array directly at top level (EOA format),
        // return in a standardized format
        if (bundle.format === 'eoa' && Array.isArray(bundle.transactions)) {
            return {
                success: true,
                bundle: bundle,
                normalizedTransactions: bundle.transactions,
                format: bundle.format,
                fromAddress: bundle.fromAddress
            };
        }
        // Safe format has transactions under bundleData.transactions
        else if ((bundle.bundleData && Array.isArray(bundle.bundleData.transactions))) {
            return {
                success: true,
                bundle: bundle,
                normalizedTransactions: bundle.bundleData.transactions,
                format: bundle.summary?.format || 'unknown',
                fromAddress: bundle.bundleData?.meta?.from || bundle.fromAddress
            };
        }
        else {
            return {
                success: false,
                message: "Unknown bundle format - cannot find transactions array"
            };
        }
    } catch (error) {
        return {
            success: false,
            message: `Error loading bundle: ${error.message}`
        };
    }
}

// Process command line arguments
const bundleFile = process.argv[2];
if (!bundleFile) {
    console.error('Usage: node fix-bundle-format.js <bundle-file>');
    process.exit(1);
}

// Execute the bundle loading to test
loadAndNormalizeBundle(bundleFile).then(result => {
    if (result.success) {
        console.log(`Successfully loaded bundle with ${result.normalizedTransactions.length} transactions`);
        console.log(`Format: ${result.format}`);
        console.log(`From: ${result.fromAddress}`);
    } else {
        console.error(result.message);
    }
});