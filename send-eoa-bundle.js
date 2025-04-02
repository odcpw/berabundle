/**
 * Standalone script to send EOA transaction bundles through Multicall3
 * 
 * This script directly reads a bundle file and uses the Multicall3 contract
 * to send all transactions in a single transaction.
 */
const { ethers } = require('ethers');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

// Configuration
const config = {
  rpcUrl: 'https://rpc.berachain.com',
  multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
  gasFees: {
    maxFeePerGas: '0x3b9aca00', // 1 Gwei
    maxPriorityFeePerGas: '0x3b9aca00' // 1 Gwei
  }
};

// Create console input interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Prompt for input
function prompt(question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer));
  });
}

// Main function
async function main() {
  try {
    // Check command line arguments
    const bundleFile = process.argv[2];
    if (!bundleFile) {
      console.error('Usage: node send-eoa-bundle.js <bundle-file>');
      process.exit(1);
    }

    console.log(`\n===== EOA Bundle Sender =====`);
    console.log(`Loading bundle from: ${bundleFile}`);
    
    // Load and parse the bundle file
    const bundleContent = await fs.readFile(bundleFile, 'utf8');
    const bundle = JSON.parse(bundleContent);
    
    // Verify it's an EOA bundle with transactions
    if (!bundle.transactions || !Array.isArray(bundle.transactions)) {
      console.error('❌ Error: Bundle does not contain a transactions array');
      process.exit(1);
    }
    
    console.log(`✅ Found ${bundle.transactions.length} transactions in bundle`);
    console.log(`From address: ${bundle.fromAddress}`);
    
    // Set up provider
    console.log(`\nConnecting to ${config.rpcUrl}...`);
    const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    
    // Get private key from user
    const privateKey = await prompt("\nEnter your private key (will not be stored): ");
    if (!privateKey || privateKey.trim() === '') {
      console.error('❌ Error: Private key is required');
      process.exit(1);
    }
    
    // Create signer
    try {
      const signer = new ethers.Wallet(privateKey, provider);
      const address = await signer.getAddress();
      console.log(`✅ Wallet loaded: ${address}`);
      
      // Verify address matches bundle
      if (bundle.fromAddress && bundle.fromAddress.toLowerCase() !== address.toLowerCase()) {
        console.warn(`⚠️  Warning: Bundle address (${bundle.fromAddress}) doesn't match your wallet (${address})`);
        const proceed = await prompt("Continue anyway? (yes/no): ");
        if (proceed.toLowerCase() !== 'yes') {
          console.log("Operation cancelled by user");
          process.exit(0);
        }
      }
      
      // Create multicall contract instance
      const multicallAbi = [
        "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[])"
      ];
      const multicall = new ethers.Contract(config.multicallAddress, multicallAbi, signer);
      
      // Format transactions for multicall3
      const calls = bundle.transactions.map(tx => ({
        target: tx.to,
        allowFailure: false, // Require all transactions to succeed
        callData: tx.data
      }));
      
      console.log(`\nPrepared ${calls.length} transactions for Multicall3:`);
      bundle.transactions.forEach((tx, i) => {
        console.log(`${i+1}. To: ${tx.to.substring(0, 10)}...`);
      });
      
      // Confirm with user before sending
      const confirm = await prompt("\nSend these transactions? (yes/no): ");
      if (confirm.toLowerCase() !== 'yes') {
        console.log("Operation cancelled by user");
        process.exit(0);
      }
      
      try {
        // Estimate gas first
        console.log("\nEstimating gas...");
        const gasEstimate = await multicall.estimateGas.aggregate3(calls);
        console.log(`Estimated gas: ${gasEstimate.toString()}`);
        
        // Add 20% buffer
        const gasWithBuffer = gasEstimate.mul(12).div(10);
        console.log(`Gas with 20% buffer: ${gasWithBuffer.toString()}`);
        
        // Send the transaction
        console.log("\nSending transaction to Multicall3...");
        const tx = await multicall.aggregate3(calls, {
          gasLimit: gasWithBuffer,
          maxFeePerGas: ethers.BigNumber.from(config.gasFees.maxFeePerGas),
          maxPriorityFeePerGas: ethers.BigNumber.from(config.gasFees.maxPriorityFeePerGas)
        });
        
        console.log(`✅ Transaction sent! Hash: ${tx.hash}`);
        console.log(`Transaction URL: https://berascan.com/tx/${tx.hash}`);
        
        // Wait for confirmation
        console.log("\nWaiting for confirmation...");
        const receipt = await tx.wait(1);
        
        console.log(`\n====== TRANSACTION CONFIRMED ======`);
        console.log(`Block #: ${receipt.blockNumber}`);
        console.log(`Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`Status: ${receipt.status === 1 ? '✅ Success' : '❌ Failed'}`);
        console.log(`Explorer: https://berascan.com/tx/${receipt.transactionHash}`);
        
        return true;
      } catch (txError) {
        console.error(`\n❌ Error sending transaction:`);
        if (txError.error && txError.error.message) {
          console.error(`RPC Error: ${txError.error.message}`);
        } else {
          console.error(txError.message);
        }
        return false;
      }
      
    } catch (walletError) {
      console.error(`\n❌ Error loading wallet: ${walletError.message}`);
      return false;
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    return false;
  } finally {
    rl.close();
  }
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`\nUnhandled error: ${error.message}`);
    process.exit(1);
  });