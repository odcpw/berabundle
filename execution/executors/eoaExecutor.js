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

        const signer = signerResult.signer;
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
                
                // Use the safeService to propose the transaction
                // Check which method is available - proposeSafeTransactionWithSdk or proposeSafeTransaction
                let proposalResult;
                
                if (this.safeService.proposeSafeTransactionWithSdk) {
                    proposalResult = await this.safeService.proposeSafeTransactionWithSdk(
                        safeAddress, 
                        bundle, 
                        signer
                    );
                } else if (this.safeService.proposeSafeTransaction) {
                    proposalResult = await this.safeService.proposeSafeTransaction(
                        safeAddress, 
                        bundle, 
                        signer
                    );
                } else {
                    throw new Error("Safe Service does not have a method to propose transactions");
                }
                
                if (proposalResult.success) {
                    console.log(`\n✅ Transaction successfully proposed to Safe!`);
                    console.log(`Transaction hash: ${proposalResult.safeTxHash}`);
                    console.log(`\nYou can view and execute this transaction in the Safe UI:`);
                    console.log(proposalResult.transactionUrl);
                    success = true;
                } else {
                    console.log(`\n❌ Failed to propose Safe transaction: ${proposalResult.message}`);
                    
                    // General error case
                    console.log("\nAlternative options:");
                    console.log("1. Check your internet connection and try again");
                    console.log("2. Try using a different owner wallet to propose");
                    console.log("3. Manually upload the transaction JSON file to the Safe UI:");
                    console.log(`   - Go to https://app.safe.global/home?safe=ber:${safeAddress}`);
                    console.log("   - Click 'New Transaction' > 'Transaction Builder'");
                    console.log(`   - Import the transaction file from: ${bundle.filepath || "output directory"}`)
                    
                    success = false;
                }
            } else {
                // Handle as standard EOA transactions
                await this.sendAsSingleOwnerEOA(bundle, signer);
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
            
            let txData = bundle.bundleData;
            
            // Check if conversion is needed
            if (bundle.summary.format !== 'eoa') {
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
            
            // Send the EOA transactions
            return await this.sendEOATransactions(txData, signer);
        } catch (error) {
            console.log(`\n❌ Error processing EOA transactions: ${error.message}`);
            return false;
        }
    }

    /**
     * Send EOA transactions
     * @param {Array} transactions - The transactions to send
     * @param {Object} signer - The ethers.js signer
     * @returns {Promise<boolean>} Success status
     */
    async sendEOATransactions(transactions, signer) {
        try {
            console.log("\nSending transactions...");
            
            const txHashes = [];
            const txCount = transactions.length;
            
            for (let i = 0; i < txCount; i++) {
                const tx = transactions[i];
                console.log(`\nSending transaction ${i + 1}/${txCount}...`);
                
                // Send the transaction
                const txResponse = await signer.sendTransaction(tx);
                txHashes.push(txResponse.hash);
                
                console.log(`✅ Transaction sent! Hash: ${txResponse.hash}`);
                
                // Wait for confirmation
                console.log("Waiting for confirmation...");
                await txResponse.wait(1);
                console.log("✅ Transaction confirmed!");
            }
            
            console.log("\n✅ All transactions sent and confirmed successfully!");
            console.log("\nTransaction hashes:");
            txHashes.forEach((hash, index) => {
                console.log(`${index + 1}. ${hash}`);
            });
            
            return true;
        } catch (error) {
            console.log(`\n❌ Error sending transactions: ${error.message}`);
            return false;
        }
    }
}

module.exports = TransactionService;