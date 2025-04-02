/**
 * test-safe-executor.js - Test for SafeExecutor with Direct API Integration
 * 
 * This script tests the SafeExecutor with our direct Safe Transaction Service API integration.
 * It finds the most recent Safe UI bundle and proposes it to the configured Safe.
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const SafeExecutor = require('./execution/executors/safeExecutor');

// Configuration
const CONFIG = {
    safeAddress: '0x561EF9Fdf5341EF3815E69E1010067b7EF179dad',
    rpcUrl: 'https://rpc.berachain.com',
    password: '68ouimoi', // Password for decryption
    signerAddress: '0x6c6eEbcBd13e2BBeC88e44f298B17Dea0d2ce46F', // The signer address from wallets.json
};

/**
 * Load a bundle file from output directory
 * @param {string} fileName - Bundle file name
 * @returns {Object} Loaded bundle
 */
function loadBundle(fileName) {
    const filePath = path.join(__dirname, 'output', fileName);
    console.log(`Loading bundle from ${filePath}`);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Run the test for SafeExecutor
 */
async function testSafeExecutor() {
    try {
        console.log('='.repeat(50));
        console.log('🔐 SAFE EXECUTOR TEST');
        console.log('='.repeat(50));
        
        // Step 1: Initialize the provider and SafeExecutor
        console.log(`\nConnecting to ${CONFIG.rpcUrl}...`);
        const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
        const safeExecutor = new SafeExecutor(provider);
        console.log(`SafeExecutor initialized`);
        
        // Step 2: Find and load the most recent bundle
        console.log('\nLooking for Safe UI bundles...');
        const outputDir = path.join(__dirname, 'output');
        const files = fs.readdirSync(outputDir);
        const bundleFiles = files.filter(f => f.endsWith('_safe_ui.json'));
        
        if (bundleFiles.length === 0) {
            throw new Error('No Safe UI bundles found in output directory');
        }
        
        // Sort by date (newest first)
        bundleFiles.sort((a, b) => {
            return fs.statSync(path.join(outputDir, b)).mtime.getTime() - 
                  fs.statSync(path.join(outputDir, a)).mtime.getTime();
        });
        
        const newestBundle = bundleFiles[0];
        console.log(`Using most recent bundle: ${newestBundle}`);
        const bundle = loadBundle(newestBundle);
        
        // Step 3: Verify the bundle has transactions
        if (!bundle.bundleData || !bundle.bundleData.transactions || bundle.bundleData.transactions.length === 0) {
            throw new Error('Bundle has no transactions');
        }
        
        const txCount = bundle.bundleData.transactions.length;
        console.log(`Found ${txCount} transactions in bundle`);
        console.log(`First transaction: To=${bundle.bundleData.transactions[0].to}`);
        
        // Step 4: Use the SafeExecutor to propose the transaction
        console.log('\nProposing transaction to Safe using SafeExecutor...');
        const result = await safeExecutor.execute({
            safeAddress: CONFIG.safeAddress,
            bundle: bundle,
            signerAddress: CONFIG.signerAddress,
            password: CONFIG.password
        });
        
        // Step 5: Display the result
        console.log('\n='.repeat(50));
        console.log('📋 RESULT:');
        console.log('='.repeat(50));
        console.log(JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ Success!');
            console.log(`Transaction hash: ${result.safeTxHash}`);
            console.log(`You can view your transaction at: ${result.transactionUrl}`);
            return {
                success: true,
                message: 'Transaction successfully proposed',
                safeTxHash: result.safeTxHash,
                transactionUrl: result.transactionUrl
            };
        } else {
            console.log('\n❌ Failed to propose transaction');
            return {
                success: false,
                message: result.message
            };
        }
    } catch (error) {
        console.error(`\n❌ ERROR: ${error.message}`);
        if (error.stack) console.error(error.stack);
        
        return {
            success: false,
            message: error.message
        };
    }
}

// Execute the test
testSafeExecutor().then(result => {
    if (result.success) {
        console.log('\nTest completed successfully!');
    } else {
        console.log(`\nTest failed: ${result.message}`);
    }
});