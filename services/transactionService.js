// transactionService.js - Handles transaction signing and sending
const { ethers } = require('ethers');
const config = require('./config');
const inquirer = require('inquirer');
const fs = require('fs').promises;
const path = require('path');
const { ErrorHandler } = require('./errorHandler');

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
            // Process EOA transactions
            try {
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
                        return;
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
                await this.sendEOATransactions(txData, signer);
                success = true;
            } catch (error) {
                console.log(`\n❌ Error sending EOA transactions: ${error.message}`);
                success = false;
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