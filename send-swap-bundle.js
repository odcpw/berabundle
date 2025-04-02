/**
 * Direct script to send a swap bundle using multicall
 * This script fixes the bundleData issue by loading the bundle correctly
 */
const { ethers } = require('ethers');
const fs = require('fs').promises;
const config = require('./config');
const WalletService = require('./storage/repositories/walletRepository');

// Main function to send the bundle
async function sendBundle() {
  try {
    console.log("===== SENDING SWAP BUNDLE =====");
    const bundleFile = process.argv[2];
    
    if (!bundleFile) {
      console.error("Usage: node send-swap-bundle.js <bundle-file>");
      console.error("Example: node send-swap-bundle.js output/swap_bundle_signer_2025-03-31T20-48-23_eoa.json");
      process.exit(1);
    }
    
    // 1. Load bundle
    console.log(`Loading bundle from: ${bundleFile}`);
    const bundleData = JSON.parse(await fs.readFile(bundleFile, 'utf8'));
    
    console.log(`Bundle format: ${bundleData.format}`);
    console.log(`Transaction count: ${bundleData.transactions.length}`);
    
    if (bundleData.transactions.length === 0) {
      console.error("Error: Bundle has no transactions");
      process.exit(1);
    }
    
    // 2. Set up provider
    console.log("\nConnecting to Berachain...");
    const provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
    
    // 3. Set up wallet service and decrypt signer's key
    console.log("\nSetting up wallet service...");
    const walletService = new WalletService(provider);
    await walletService.initialize();
    
    const walletName = "signer";
    const password = "68ouimoi";
    
    console.log(`Getting signer for wallet: ${walletName}`);
    const signerResult = await walletService.createSigner(walletName, password);
    
    if (!signerResult.success) {
      console.error(`Error creating signer: ${signerResult.message}`);
      process.exit(1);
    }
    
    const signer = signerResult.signer;
    const signerAddress = await signer.getAddress();
    console.log(`Signer address: ${signerAddress}`);
    
    // 4. Set up multicall contract
    console.log("\nSetting up Multicall3 contract...");
    const multicallAddress = config.networks.berachain.multicall.address;
    const multicallAbi = config.abis.multicall3;
    
    console.log(`Multicall3 address: ${multicallAddress}`);
    const multicall = new ethers.Contract(multicallAddress, multicallAbi, signer);
    
    // 5. Prepare transactions for multicall
    console.log("\nPreparing transactions for Multicall3...");
    const calls = bundleData.transactions.map(tx => ({
      target: tx.to,
      allowFailure: false,
      callData: tx.data
    }));
    
    console.log(`Prepared ${calls.length} calls`);
    
    // 6. Estimate gas
    console.log("\nEstimating gas...");
    let gasEstimate;
    try {
      gasEstimate = await multicall.estimateGas.aggregate3(calls);
      console.log(`Estimated gas: ${gasEstimate.toString()}`);
      
      // Add 20% buffer
      gasEstimate = gasEstimate.mul(12).div(10);
      console.log(`With 20% buffer: ${gasEstimate.toString()}`);
    } catch (error) {
      console.error(`Gas estimation failed: ${error.message}`);
      console.log("Using fallback gas limit of 3,000,000");
      gasEstimate = ethers.BigNumber.from("3000000");
    }
    
    // 7. Send transaction
    console.log("\nSending multicall transaction...");
    const tx = await multicall.aggregate3(calls, {
      gasLimit: gasEstimate,
      maxFeePerGas: ethers.BigNumber.from(config.gas.maxFeePerGas),
      maxPriorityFeePerGas: ethers.BigNumber.from(config.gas.maxPriorityFeePerGas)
    });
    
    console.log(`Transaction sent! Hash: ${tx.hash}`);
    console.log(`Explorer link: https://berascan.com/tx/${tx.hash}`);
    
    // 8. Wait for confirmation
    console.log("\nWaiting for confirmation...");
    const receipt = await tx.wait(1);
    
    console.log("\n===== TRANSACTION CONFIRMED =====");
    console.log(`Block: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
    
    return true;
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    if (error.error && error.error.message) {
      console.error(`Provider error: ${error.error.message}`);
    }
    return false;
  }
}

// Run the main function
sendBundle()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });