// transactionService.js - Handles transaction signing and sending
const { ethers } = require('ethers');
const config = require('../../config');
const inquirer = require('inquirer');
const fs = require('fs').promises;
const path = require('path');
const { ErrorHandler } = require('../../utils/errorHandler');
const SafeService = require('./safeExecutor'); // Direct Safe Transaction Service API integration

/**
 * Service for managing transaction creation, signing and sending
 */
class TransactionService {
    constructor(app) {
        this.app = app;
        this.provider = app.provider;
        this.walletService = app.walletService;
        this.uiHandler = app.uiHandler;
        this.claimBundler = app.claimBundler;
        // Use the safeExecutor from the app if available, otherwise create a new one
        if (app.safeExecutor) {
            this.safeService = app.safeExecutor;
        } else {
            this.safeService = new SafeService(app.provider);
        }
    }

    /**
     * Flow for signing and sending a bundle with a private key
     * @param {Object} bundle - The bundle to sign and send
     */
    async signAndSendBundleFlow(bundle) {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("SIGN AND SEND BUNDLE");

        // Get wallets with private keys
        const wallets = this.walletService.getWallets();
        const walletEntries = Object.entries(wallets);
        
        // Filter wallets that have private keys
        const walletsWithKeys = [];
        for (const [name, address] of walletEntries) {
            const hasKey = await this.walletService.hasPrivateKey(name);
            if (hasKey) {
                walletsWithKeys.push([name, address]);
            }
        }

        if (walletsWithKeys.length === 0) {
            console.log("\nNo wallets with private keys found. Please add a private key first.");
            await this.uiHandler.pause();
            return;
        }

        // Show wallet selection
        console.log("\nSelect wallet to sign transactions:");
        walletsWithKeys.forEach(([name, address], index) => {
            console.log(`${index + 1}. ${name} (${address})`);
        });

        // Get wallet selection
        const walletNumber = await this.uiHandler.getUserInput(
            "\nEnter wallet number:",
            input => {
                const num = parseInt(input);
                return !isNaN(num) && num > 0 && num <= walletsWithKeys.length;
            },
            "Invalid wallet number"
        );

        const index = parseInt(walletNumber) - 1;
        const [name, address] = walletsWithKeys[index];

        // Get password
        const password = await this.uiHandler.getUserInput(
            "\nEnter password to decrypt the private key:",
            input => input.trim() !== '',
            "Password cannot be empty"
        );

        console.log("\nDecrypting private key and creating signer...");
        const signerResult = await this.walletService.createSigner(name, password);

        if (!signerResult.success) {
            console.log(`\n❌ Error: ${signerResult.message}`);
            await this.uiHandler.pause();
            return;
        }

        // Get the signer and connect it to the provider
        let signer = signerResult.signer;
        
        // Connect the signer to the provider to fix "missing provider" error
        if (signer && this.provider) {
            console.log("Connecting signer to provider...");
            signer = signer.connect(this.provider);
        } else {
            console.log("⚠️ Warning: Could not connect signer to provider");
        }
        
        console.log(`✅ Successfully created signer for ${name}`);

        // Confirm sending transactions
        console.log("\nBundle summary:");
        let summaryText = `${bundle.summary.vaultCount} vaults`;
        if (bundle.summary.hasBGTStaker) {
            summaryText += " + BGT Staker";
        }
        if (bundle.summary.redelegationCount > 0) {
            summaryText += ` + ${bundle.summary.redelegationCount} redelegation transactions`;
        }
        console.log(`- Total: ${summaryText}`);
        console.log(`- Rewards: ${bundle.summary.rewardSummary}`);
        console.log(`- Total transactions: ${bundle.summary.totalTransactions}`);
        
        const confirmSend = await this.uiHandler.confirm("\nDo you want to send these transactions?");
        if (!confirmSend) {
            return;
        }

        let success = false;
        
        try {
            // First, determine if this is a Safe multisig or EOA transaction
            if (bundle.summary.format === 'safe_ui' || bundle.summary.format === 'safe_cli') {
                console.log("\nDetected Safe transaction format. Processing as Safe multisig transaction...");
                
                // Get signer address (Safe owner or proposer)
                const signerAddress = await signer.getAddress();
                console.log(`Signer address: ${signerAddress}`);
                
                // Try to find Safes this signer is an owner of
                console.log("\nChecking for Safes associated with this signer...");
                const ownerSafesResult = await this.safeService.getSafesByOwner(signerAddress);
                
                // If API error, provide more detailed information
                if (!ownerSafesResult.success) {
                    console.log(`\nWarning: Safe API error: ${ownerSafesResult.message}`);
                    console.log("This is often due to the Safe Transaction Service not being available or");
                    console.log("the Safe API not supporting the specific endpoint.");
                    console.log("You can proceed by manually entering a Safe address.");
                }
                
                let safeAddress;
                
                if (ownerSafesResult.success) {
                    if (ownerSafesResult.safes && ownerSafesResult.safes.length > 0) {
                        console.log(`\nFound ${ownerSafesResult.safes.length} Safe(s) associated with this address:`);
                        
                        // Create options for Safe selection with better formatting
                        const safeOptions = ownerSafesResult.safes.map((safe, index) => {
                            // Format address for better readability
                            const formattedAddr = `${safe.slice(0, 6)}...${safe.slice(-4)}`;
                            return {
                                key: (index + 1).toString(),
                                label: `Safe #${index + 1}: ${formattedAddr}`,
                                value: safe
                            };
                        });
                        
                        // Add custom address option
                        safeOptions.push({
                            key: (safeOptions.length + 1).toString(),
                            label: "Enter a different Safe address",
                            value: "custom"
                        });
                        
                        const options = this.uiHandler.createMenuOptions(safeOptions);
                        this.uiHandler.displayMenu(options);
                        
                        const choice = await this.uiHandler.getSelection(options);
                        
                        if (choice === 'back' || choice === 'quit') {
                            console.log("Operation cancelled.");
                            return;
                        }
                        
                        if (choice === 'custom') {
                            // Manual entry of Safe address
                            safeAddress = await this.uiHandler.getUserInput(
                                "\nEnter the Safe multisig address that will execute these transactions:",
                                input => this.walletService.constructor.isValidAddress(input),
                                "Invalid Ethereum address format"
                            );
                        } else {
                            // Use selected Safe address
                            safeAddress = choice;
                        }
                    } else {
                        // No Safes found but API is working
                        if (ownerSafesResult.message) {
                            console.log(`\n${ownerSafesResult.message}`);
                        } else {
                            console.log("\nNo Safes found for this address.");
                        }
                        
                        // Ask for Safe address
                        safeAddress = await this.uiHandler.getUserInput(
                            "\nEnter the Safe multisig address that will execute these transactions:",
                            input => this.walletService.constructor.isValidAddress(input),
                            "Invalid Ethereum address format"
                        );
                    }
                } else {
                    // API error occurred
                    console.log(`\nSafe Service error: ${ownerSafesResult.message || "Unknown error"}`);
                    
                    // Ask for Safe address
                    safeAddress = await this.uiHandler.getUserInput(
                        "\nEnter the Safe multisig address that will execute these transactions:",
                        input => this.walletService.constructor.isValidAddress(input),
                        "Invalid Ethereum address format"
                    );
                }
                
                console.log(`\nTarget Safe address: ${safeAddress}`);
                console.log(`You are proposing this transaction as an owner/proposer: ${signerAddress}`);
                
                // Ask for confirmation
                const confirmSafe = await this.uiHandler.confirm(
                    "\nThis transaction will be proposed to the Safe Transaction Service " +
                    "and will appear in the Safe UI for all owners to review and confirm. Continue?"
                );
                
                if (!confirmSafe) {
                    console.log("Operation cancelled.");
                    return;
                }
                
                // Use the safeService to propose the transaction using the working direct API approach
                console.log("Using Direct Safe Transaction Service API...");
                const proposalResult = await this.safeService.execute({
                    safeAddress: safeAddress,
                    bundle: bundle,
                    signerAddress: signerAddress,
                    password: password // Pass the password to decrypt the key again
                });
                
                if (proposalResult.success) {
                    console.log(`\n✅ Transaction successfully proposed to Safe!`);
                    console.log(`Transaction hash: ${proposalResult.safeTxHash}`);
                    console.log(`\nYou can view and execute this transaction in the Safe UI:`);
                    console.log(proposalResult.transactionUrl);
                    success = true;
                } else {
                    console.log(`\n❌ Failed to propose Safe transaction: ${proposalResult.message}`);
                    
                    console.log("\nUpload the transaction file manually:");
                    console.log(`- Go to https://app.safe.global/home?safe=ber:${safeAddress}`);
                    console.log("- Click 'New Transaction' > 'Transaction Builder'");
                    console.log(`- Import the transaction file from: ${bundle.filepath || "output directory"}`);
                    
                    success = false;
                }
            } else {
                // Handle as standard EOA transactions
                success = await this.sendAsSingleOwnerEOA(bundle, signer);
            }
            
            if (!success) {
                console.log("\n❌ Transaction sending was not completed successfully.");
            }
        } catch (error) {
            console.log(`\n❌ Error in transaction flow: ${error.message}`);
        }
        
        await this.uiHandler.pause();
    }

    /**
     * Send as EOA transactions (used for both EOA bundles and Safe fallback)
     * @param {Object} bundle - The bundle to convert and send
     * @param {Object} signer - The ethers.js signer
     * @returns {Promise<boolean>} Success status
     */
    async sendAsSingleOwnerEOA(bundle, signer) {
        try {
            console.log("\nProcessing transactions for EOA sending...");
            
            let txData;
            
            // Handle different bundle formats - log bundle format for debugging
            console.log(`Bundle format info: Keys=${Object.keys(bundle).join(', ')}`);
            
            // With our standardized format, all bundles use bundleData
            // This handles both EOA and Safe bundles consistently
            if (bundle.bundleData && bundle.bundleData.transactions) {
                console.log("Detected standardized bundle format with bundleData structure");
                return await this.sendWithMulticall(bundle, signer);
            }
            // Support legacy bundles with transactions at the top level as a fallback
            else if (bundle.format === 'eoa' && bundle.transactions && Array.isArray(bundle.transactions)) {
                console.log("Detected legacy EOA bundle with transactions array - converting to standardized format");
                // Create a standardized bundle structure to pass forward
                const standardizedBundle = {
                    bundleData: {
                        transactions: bundle.transactions,
                        meta: {
                            from: bundle.fromAddress
                        }
                    },
                    format: 'eoa',
                    summary: {
                        format: 'eoa'
                    }
                };
                return await this.sendWithMulticall(standardizedBundle, signer);
            }
            // Handle another legacy case where transactions is directly at top level
            else if (bundle.transactions && Array.isArray(bundle.transactions)) {
                console.log("Using 'transactions' array from bundle and converting to standardized format");
                txData = bundle.transactions;
            } else if (bundle.bundleData) {
                // Bundle data format
                txData = bundle.bundleData;
                
                // Check if conversion is needed
                if (bundle.summary && bundle.summary.format !== 'eoa') {
                    console.log("\nConverting transactions to EOA format...");
                    
                    // Extract transactions based on format
                    let transactions;
                    if (bundle.summary.format === 'safe_ui') {
                        transactions = txData.transactions;
                    } else if (bundle.summary.format === 'safe_cli') {
                        transactions = txData.transactions;
                    } else {
                        console.log("\n❌ Error: Unknown format cannot be converted.");
                        console.log("Try generating a new bundle using the 'Claim Rewards' option.");
                        return false;
                    }
                    
                    // Use claimBundler to convert to EOA format
                    const fromAddress = await signer.getAddress();
                    txData = await this.claimBundler.estimateGasForPayloads(
                        transactions.map(tx => ({
                            to: tx.to,
                            data: tx.data,
                            value: tx.value || "0x0"
                        })),
                        fromAddress
                    );
                    
                    // Get the current chain ID
                    const network = await this.provider.getNetwork();
                    const chainId = '0x' + network.chainId.toString(16);
                    
                    // Format as EOA transactions
                    txData = txData.map(payload => ({
                        to: payload.to,
                        from: fromAddress,
                        data: payload.data,
                        value: payload.value || "0x0",
                        gasLimit: payload.gasLimit,
                        maxFeePerGas: config.gas.maxFeePerGas,
                        maxPriorityFeePerGas: config.gas.maxPriorityFeePerGas,
                        type: "0x2", // EIP-1559 transaction
                        chainId
                    }));
                    
                    console.log(`Successfully converted ${txData.length} transactions to EOA format.`);
                }
            } else {
                console.log("\n❌ Error: Unsupported bundle format");
                return false;
            }
            
            // Send the EOA transactions using multicall
            return await this.sendWithMulticall(txData, signer);
        } catch (error) {
            console.log(`\n❌ Error processing EOA transactions: ${error.message}`);
            return false;
        }
    }

    /**
     * Send EOA transactions using multicall
     * @param {Array|Object} transactions - The transactions to send or a bundle object
     * @param {Object} signer - The ethers.js signer
     * @returns {Promise<boolean>} Success status
     */
    async sendEOATransactions(transactions, signer) {
        try {
            console.log("\nPreparing transactions...");
            
            // Validate transactions is available
            if (!transactions) {
                console.log(`\n❌ Error: Transactions object is null or undefined`);
                return false;
            }
            
            // Extract information from the bundle
            console.log("Analyzing bundle format...");
            console.log(`Bundle type: ${typeof transactions}`);
            
            if (typeof transactions === 'object') {
                if (transactions.format === 'eoa' && Array.isArray(transactions.transactions)) {
                    console.log(`Detected EOA swap bundle format with ${transactions.transactions.length} transactions`);
                    
                    // Print a summary of what we're about to do
                    if (transactions.approvalCount || transactions.swapCount) {
                        console.log(`Bundle contains: ${transactions.approvalCount || 0} approvals, ${transactions.swapCount || 0} swaps`);
                    }
                    
                    if (transactions.tokenSwaps && Array.isArray(transactions.tokenSwaps)) {
                        console.log("Tokens being swapped:");
                        transactions.tokenSwaps.forEach(token => {
                            console.log(`- ${token.amount} ${token.symbol} (${token.address.substring(0,10)}...)`);
                        });
                    }
                    
                    if (transactions.totalExpectedBera) {
                        console.log(`Expected output: ${transactions.formattedTotalExpectedBera || transactions.totalExpectedBera}`);
                    }
                    
                    // Use the transactions array from the bundle
                    transactions = transactions.transactions;
                } else if (Array.isArray(transactions.transactions)) {
                    console.log(`Detected bundle with a transactions array property`);
                    transactions = transactions.transactions;
                } else if (Array.isArray(transactions)) {
                    console.log(`Bundle is already an array of ${transactions.length} transactions`);
                    // No transformation needed
                } else {
                    console.log(`Unknown bundle format: ${Object.keys(transactions).join(', ')}`);
                    
                    // Try to extract transactions from any property that's an array
                    for (const key in transactions) {
                        if (Array.isArray(transactions[key]) && transactions[key].length > 0 && transactions[key][0].to) {
                            console.log(`Found transactions array in property: ${key}`);
                            transactions = transactions[key];
                            break;
                        }
                    }
                }
            }
            
            // Final check to ensure we have an array
            if (!Array.isArray(transactions)) {
                console.log(`\n❌ Error: Could not extract a transactions array from the bundle`);
                console.log(`Bundle keys: ${Object.keys(transactions).join(', ')}`);
                return false;
            }
            
            console.log(`Successfully extracted ${transactions.length} transactions from bundle`);
            
            // Additional check to ensure signer has a provider
            if (!signer.provider && this.provider) {
                console.log("Connecting signer to provider for transaction sending...");
                signer = signer.connect(this.provider);
            }
            
            // Check if we should use multicall for bundling
            const txCount = transactions.length;
            
            if (txCount <= 1) {
                // If only one transaction, send it directly without multicall
                console.log("\nOnly one transaction - sending directly without multicall");
                
                const tx = transactions[0];
                
                // Validate transaction fields
                if (!tx.to || !tx.data) {
                    console.log(`❌ Transaction is missing required fields (to: ${!!tx.to}, data: ${!!tx.data})`);
                    return false;
                }
                
                // Properly format transaction for ethers.js
                const formattedTx = {
                    to: tx.to,
                    from: tx.from, 
                    data: tx.data,
                    // Convert value to BigNumber
                    value: ethers.BigNumber.from(tx.value || "0x0"),
                    // Convert gasLimit to BigNumber with a more generous default
                    gasLimit: ethers.BigNumber.from(tx.gasLimit || "0x100000") // Increased default gas limit
                };
                
                // Handle EIP-1559 transaction type specifically
                if (tx.type === "0x2") {
                    // Convert maxFeePerGas and maxPriorityFeePerGas to BigNumber
                    formattedTx.maxFeePerGas = ethers.BigNumber.from(tx.maxFeePerGas);
                    formattedTx.maxPriorityFeePerGas = ethers.BigNumber.from(tx.maxPriorityFeePerGas);
                    // Type should be a number for EIP-1559
                    formattedTx.type = 2; // numeric 2 instead of "0x2" string
                    console.log("Sending as EIP-1559 transaction");
                } else {
                    formattedTx.gasPrice = ethers.BigNumber.from(tx.gasPrice || tx.maxFeePerGas);
                    console.log("Sending as legacy transaction");
                }
                
                console.log(`Transaction details: to=${formattedTx.to.substring(0, 10)}...`);
                
                // Send the transaction with properly formatted fields
                const txResponse = await signer.sendTransaction(formattedTx);
                console.log(`✅ Transaction sent! Hash: ${txResponse.hash}`);
                
                // Wait for confirmation
                console.log("Waiting for confirmation...");
                await txResponse.wait(1);
                console.log("✅ Transaction confirmed!");
                
                return true;
            } else {
                // Multiple transactions - always use MultiSendCallsOnly for better efficiency
                console.log(`\nFound ${txCount} transactions in bundle.`);
                console.log(`\n🔄 Bundling ${txCount} transactions using Safe's MultiSendCallsOnly...`);
                return await this.sendWithMulticall(transactions, signer);
            }
        } catch (error) {
            console.log(`\n❌ Error sending transactions: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Send transactions using Safe's MultiSend contract
     * @param {Array|Object} transactions - Array of transactions to send or a bundle object containing transactions
     * @param {Object} signer - The ethers.js signer
     * @returns {Promise<boolean>} Success status
     */
    async sendWithMulticall(inputTransactions, signer) {
        let txArray;
        // Handle the case where we received a bundle object instead of transactions array
        if (!Array.isArray(inputTransactions)) {
            console.log("Received bundle object - extracting transactions array");
            
            // STANDARDIZED FORMAT: All bundles have transactions under bundleData.transactions
            if (inputTransactions.bundleData && inputTransactions.bundleData.transactions) {
                txArray = inputTransactions.bundleData.transactions;
                console.log(`Found ${txArray.length} transactions in standardized bundle format`);
            }
            // Support legacy EOA format where transactions are at the top level as a fallback
            else if (inputTransactions.transactions && Array.isArray(inputTransactions.transactions)) {
                txArray = inputTransactions.transactions;
                console.log(`Found ${txArray.length} transactions in legacy EOA bundle format`);
            }
            else {
                console.log("Could not find transactions array in bundle");
                console.log("Bundle keys:", Object.keys(inputTransactions).join(", "));
                return false;
            }
        } else if (Array.isArray(inputTransactions)) {
            txArray = inputTransactions;
            console.log(`Using direct array of ${txArray.length} transactions`);
        } else {
            console.log("Invalid transaction input - cannot process");
            return false;
        }

        try {
            console.log("\n🔄 Bundling transactions with Safe's MultiSendCallsOnly...");
            
            // Get signer address
            const fromAddress = await signer.getAddress();
            console.log(`Signer address: ${fromAddress}`);
            
            // Use Safe's MultiSendCallsOnly contract instead of MultiSend or Multicall3
            // This contract is designed to be called directly (not via delegatecall)
            // and will internally use 'call' operations for each transaction
            const multiSend = new ethers.Contract(
                config.currentNetwork.safe.multiSendCallsOnlyAddress, // Using the calls-only version that can be called directly
                config.abis.multiSend, // Same ABI as regular MultiSend
                signer
            );
            
            // Validate and prepare transactions
            const validTransactions = [];
            console.log("\nValidating transactions...");
            
            for (let i = 0; i < txArray.length; i++) {
                const tx = txArray[i];
                
                // Validate required fields
                if (!tx.to) {
                    console.log(`⚠️ Transaction ${i + 1} is missing 'to' address, skipping...`);
                    continue;
                }
                
                if (!tx.data) {
                    console.log(`⚠️ Transaction ${i + 1} is missing 'data', skipping...`);
                    continue;
                }
                
                validTransactions.push(tx);
                console.log(`✅ Transaction ${i + 1} validated: to=${tx.to.substring(0, 10)}...`);
            }
            
            if (validTransactions.length === 0) {
                console.log("\n❌ No valid transactions to send.");
                return false;
            }
            
            // Format transactions for Safe MultiSend
            // MultiSend expects a single bytes parameter that encodes all transactions
            // Format: <operation><to><value><dataLength><data>
            // - operation: 0 for call, 1 for delegatecall (uint8)
            // - to: address (20 bytes)
            // - value: amount of ETH to send (uint256)
            // - dataLength: length of data (uint256)
            // - data: transaction data (bytes)
            
            console.log(`\nPreparing ${validTransactions.length} transactions for MultiSendCallsOnly...`);
            
            // The proper way to encode transactions for Safe's MultiSendCallsOnly
            // MultiSendCallsOnly expects a specific format for the transactions batch
            console.log("Formatting transactions for MultiSendCallsOnly...");
            
            // Let's completely simplify our approach to transaction encoding
            // First, create a cleaner array of transaction objects
            const simpleTxs = validTransactions.map((tx, index) => {
                console.log(`Transaction ${index + 1}: to=${tx.to}, data length=${tx.data ? tx.data.length : 0}`);
                // Convert any non-hex value to hex
                let value = tx.value;
                if (value && !value.startsWith('0x')) {
                    value = '0x' + parseInt(value).toString(16);
                }
                return {
                    to: ethers.utils.getAddress(tx.to), // Ensure address is checksummed
                    value: value || '0x0',
                    data: tx.data || '0x',
                    operation: 0 // 0 = Call (MultiSendCallsOnly only supports calls)
                };
            });
            
            // We'll continue with MultiSendCallsOnly approach but with simplified encoding
            console.log("\nContinuing with MultiSendCallsOnly but with simplified encoding...");
            
            // Log the transactions in detail for debugging
            console.log("\nDetailed transaction data:");
            simpleTxs.forEach((tx, i) => {
                console.log(`TX ${i+1}:`);
                console.log(`  To: ${tx.to}`);
                console.log(`  Value: ${tx.value}`);
                console.log(`  Data prefix: ${tx.data.substring(0, 10)}${tx.data.length > 10 ? '...' : ''}`);
                console.log(`  Data length: ${tx.data.length} chars`);
            });
            
            // Since we need to preserve msg.sender, we have to send transactions individually
            // This is the only way to ensure the correct msg.sender context
            console.log("\nMulticall and MultiSend both change msg.sender context.");
            console.log("To preserve your wallet as msg.sender, we need to send transactions individually.");
            
            // Get confirmation from user
            const confirmIndividual = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'confirmIndividual',
                    message: 'Send transactions individually to preserve your wallet as msg.sender? (y/n)',
                    default: 'y'
                }
            ]);
            
            if (confirmIndividual.confirmIndividual.toLowerCase() !== 'y') {
                console.log("Operation cancelled.");
                return false;
            }
            
            // Send transactions individually to preserve msg.sender
            console.log("\nSending transactions individually to preserve msg.sender context...");
            let successCount = 0;
            
            for (let i = 0; i < simpleTxs.length; i++) {
                const tx = simpleTxs[i];
                console.log(`\nSending transaction ${i+1}/${simpleTxs.length}...`);
                console.log(`To: ${tx.to}`);
                console.log(`Data prefix: ${tx.data.substring(0, 10)}...`);
                
                try {
                    // Format as individual transaction
                    const txData = {
                        to: tx.to,
                        data: tx.data,
                        value: ethers.BigNumber.from(tx.value),
                        gasLimit: ethers.BigNumber.from("5000000"), // Very high gas limit by default
                        maxFeePerGas: ethers.BigNumber.from(config.gas.maxFeePerGas),
                        maxPriorityFeePerGas: ethers.BigNumber.from(config.gas.maxPriorityFeePerGas),
                        type: 2 // EIP-1559
                    };
                    
                    // Try to estimate gas for this specific transaction
                    try {
                        const estimatedGas = await signer.estimateGas(txData);
                        // Add 50% buffer for swaps
                        txData.gasLimit = estimatedGas.mul(15).div(10);
                        console.log(`Estimated gas: ${estimatedGas.toString()}, with buffer: ${txData.gasLimit.toString()}`);
                    } catch (gasError) {
                        console.log(`Gas estimation failed: ${gasError.message}`);
                        console.log("Using default gas limit");
                    }
                    
                    // Send the transaction
                    const txResponse = await signer.sendTransaction(txData);
                    console.log(`Transaction sent! Hash: ${txResponse.hash}`);
                    
                    // Wait for confirmation
                    console.log("Waiting for confirmation...");
                    const receipt = await txResponse.wait(1);
                    
                    if (receipt.status === 1) {
                        console.log(`✅ Transaction ${i+1} succeeded! Block: ${receipt.blockNumber}`);
                        console.log(`Gas used: ${receipt.gasUsed.toString()}`);
                        console.log(`Explorer link: https://berascan.com/tx/${receipt.transactionHash}`);
                        successCount++;
                    } else {
                        console.log(`❌ Transaction ${i+1} failed!`);
                    }
                } catch (txError) {
                    console.log(`❌ Error sending transaction ${i+1}: ${txError.message}`);
                }
                
                // Small delay between transactions
                if (i < simpleTxs.length - 1) {
                    console.log("Waiting 2 seconds before next transaction...");
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            console.log(`\nTransaction summary: ${successCount}/${simpleTxs.length} succeeded`);
            return successCount > 0; // Return true if at least one transaction succeeded
        } catch (error) {
            console.log(`\n❌ Error during transaction execution: ${error.message}`);
            
            // Provide specific error messages for common Multicall3 issues
            if (error.message.includes("execution reverted")) {
                console.log("\nTransaction reverted during execution. Common reasons include:");
                console.log("1. Incorrect transaction encoding format");
                console.log("2. One of the transactions in the bundle failed");
                console.log("3. Insufficient token allowances for swaps");
                console.log("4. Insufficient gas for the entire bundle");
                
                // Extract transaction details for debugging
                console.log("\nTransaction details for debugging:");
                simpleTxs.forEach((tx, index) => {
                    console.log(`[Tx ${index+1}] To: ${tx.to}`);
                    console.log(`[Tx ${index+1}] Value: ${tx.value}`);
                    console.log(`[Tx ${index+1}] Data length: ${tx.data.length}`);
                    console.log(`[Tx ${index+1}] Data prefix: ${tx.data.substring(0, 10)}...`);
                });
                
                // Offer fallback to send transactions individually
                console.log("\nWould you like to attempt sending these transactions individually? (y/n)");
                const answer = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'shouldFallback',
                        message: 'Send individually?',
                        default: 'n'
                    }
                ]);
                
                if (answer.shouldFallback.toLowerCase() === 'y') {
                    console.log("\nAttempting to send transactions individually...");
                    let successCount = 0;
                    
                    for (let i = 0; i < simpleTxs.length; i++) {
                        const tx = simpleTxs[i];
                        console.log(`\nSending transaction ${i+1}/${simpleTxs.length}...`);
                        
                        try {
                            // Format as individual transaction
                            const txData = {
                                to: tx.to,
                                data: tx.data,
                                value: ethers.BigNumber.from(tx.value),
                                gasLimit: ethers.BigNumber.from("3000000"), // Higher default gas limit
                                maxFeePerGas: ethers.BigNumber.from(config.gas.maxFeePerGas),
                                maxPriorityFeePerGas: ethers.BigNumber.from(config.gas.maxPriorityFeePerGas),
                                type: 2 // EIP-1559
                            };
                            
                            // Try to estimate gas for this specific transaction
                            try {
                                const estimatedGas = await signer.estimateGas(txData);
                                // Add 30% buffer
                                txData.gasLimit = estimatedGas.mul(13).div(10);
                                console.log(`Estimated gas: ${estimatedGas.toString()}, with buffer: ${txData.gasLimit.toString()}`);
                            } catch (gasError) {
                                console.log(`Gas estimation failed: ${gasError.message}`);
                                console.log("Using default gas limit");
                            }
                            
                            // Send the transaction
                            const txResponse = await signer.sendTransaction(txData);
                            console.log(`Transaction sent! Hash: ${txResponse.hash}`);
                            
                            // Wait for confirmation
                            console.log("Waiting for confirmation...");
                            const receipt = await txResponse.wait(1);
                            
                            if (receipt.status === 1) {
                                console.log(`✅ Transaction ${i+1} succeeded! Block: ${receipt.blockNumber}`);
                                successCount++;
                            } else {
                                console.log(`❌ Transaction ${i+1} failed!`);
                            }
                        } catch (txError) {
                            console.log(`❌ Error sending transaction ${i+1}: ${txError.message}`);
                        }
                    }
                    
                    console.log(`\nTransaction summary: ${successCount}/${simpleTxs.length} succeeded`);
                    return successCount > 0; // Return true if at least one transaction succeeded
                }
            }
            
            console.log("Error details:", error);
            return false;
        }
    }
}

module.exports = TransactionService;