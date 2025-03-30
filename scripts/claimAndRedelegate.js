#!/usr/bin/env node
// claimAndRedelegate.js - Script to automatically claim rewards and redelegate them

const { ethers } = require('ethers');
const BeraBundle = require('../berabundle');
const config = require('../config');
const { ClaimBundler, OutputFormat } = require('../claimBundler');
const fs = require('fs').promises;
const path = require('path');

// Command-line arguments
const args = process.argv.slice(2);
const walletName = args[0];
const password = args[1];

// Display usage if arguments are missing
if (!walletName || !password) {
    console.log('Usage: node claimAndRedelegate.js <walletName> <password>');
    console.log('Example: node claimAndRedelegate.js myWallet mySecurePassword');
    process.exit(1);
}

/**
 * Main function to claim and redelegate
 */
async function main() {
    try {
        // Initialize BeraBundle
        const app = new BeraBundle();
        await app.initialize();

        // Get wallet address
        const address = app.walletService.getWalletByName(walletName);
        if (!address) {
            console.error(`Error: Wallet "${walletName}" not found.`);
            process.exit(1);
        }

        console.log(`Using wallet: ${walletName} (${address})`);

        // Verify private key exists
        const hasKey = await app.walletService.hasPrivateKey(walletName);
        if (!hasKey) {
            console.error(`Error: No private key found for wallet "${walletName}".`);
            process.exit(1);
        }

        // Create a signer
        const signerResult = await app.walletService.createSigner(walletName, password);
        if (!signerResult.success) {
            console.error(`Error: ${signerResult.message}`);
            process.exit(1);
        }
        const signer = signerResult.signer;

        // Check for claimable rewards
        console.log("Checking for claimable rewards...");
        const rewardInfo = await app.rewardChecker.checkAllRewards(
            address, true, true,
            (current, total, status) => {
                // Progress reporting
                const percentage = Math.floor((current / total) * 100);
                process.stdout.write(`\r${status} (${percentage}%)`);
            },
            false // Don't include validator boosts
        );

        // Handle the rewards format
        const rewards = rewardInfo.rewards || rewardInfo;

        // Filter rewards that are claimable
        const claimableRewards = rewards.filter(item =>
            item.earned && parseFloat(item.earned) > 0
        );

        if (claimableRewards.length === 0) {
            console.log("\nNo rewards to claim at this time.");
            process.exit(0);
        }

        // Display reward summary
        console.log("\nClaimable Rewards:");
        console.log("═════════════════════════════════════════");
        
        // Format rewards for display
        let rewardsByToken = {};
        claimableRewards.forEach(reward => {
            const symbol = reward.rewardToken?.symbol || 'Unknown';
            if (!rewardsByToken[symbol]) {
                rewardsByToken[symbol] = 0;
            }
            rewardsByToken[symbol] += parseFloat(reward.earned);
        });

        // Display formatted rewards
        Object.entries(rewardsByToken).forEach(([symbol, amount]) => {
            console.log(`${amount.toFixed(4)} ${symbol}`);
        });
        
        console.log("═════════════════════════════════════════");

        // Check for BGT rewards
        const hasBgtRewards = claimableRewards.some(reward => 
            reward.rewardToken && reward.rewardToken.symbol === 'BGT' && 
            parseFloat(reward.earned) > 0
        );

        // Check for delegation preferences if BGT rewards exist
        let includeRedelegation = false;
        if (hasBgtRewards) {
            const userPrefs = app.redelegationManager.getUserPreferences(address);
            const hasValidPrefs = userPrefs.validators && userPrefs.validators.length > 0;
            
            if (hasValidPrefs) {
                includeRedelegation = true;
                console.log("\nFound delegation preferences. BGT rewards will be redelegated.");
                
                // Display delegation preferences
                console.log("\nDelegation Preferences:");
                for (const validator of userPrefs.validators) {
                    const allocation = userPrefs.allocations ? userPrefs.allocations[validator.pubkey] || 0 : 0;
                    console.log(`- ${validator.name} (${validator.pubkey.substring(0, 10)}...): ${allocation}%`);
                }
            } else {
                console.log("\nNo delegation preferences found. BGT rewards will not be redelegated.");
            }
        }

        // Generate claim bundle for EOA transactions
        console.log("\nGenerating transaction bundle...");
        const bundle = await app.claimBundler.generateClaimBundle(
            claimableRewards,
            address,
            address, // Send rewards to the same address
            OutputFormat.EOA, // Use EOA format for direct transactions
            walletName,
            { redelegate: includeRedelegation }
        );

        if (!bundle.success) {
            console.error(`Error generating bundle: ${bundle.message}`);
            process.exit(1);
        }

        // Send EOA transactions
        console.log("\nSending transactions...");
        
        const txHashes = [];
        const txCount = bundle.bundleData.length;
        
        for (let i = 0; i < txCount; i++) {
            const tx = bundle.bundleData[i];
            console.log(`\nSending transaction ${i + 1}/${txCount}...`);
            
            try {
                // Send the transaction
                const txResponse = await signer.sendTransaction(tx);
                txHashes.push(txResponse.hash);
                
                console.log(`✅ Transaction sent! Hash: ${txResponse.hash}`);
                console.log(`Explorer link: ${config.networks.berachain.blockExplorer}/tx/${txResponse.hash}`);
                
                // Wait for confirmation
                console.log("Waiting for confirmation...");
                await txResponse.wait(1);
                console.log("✅ Transaction confirmed!");
            } catch (error) {
                console.error(`❌ Error sending transaction: ${error.message}`);
                // Continue with next transaction even if one fails
            }
        }
        
        // Final status
        const successCount = txHashes.length;
        if (successCount === txCount) {
            console.log("\n✅ All transactions sent and confirmed successfully!");
        } else {
            console.log(`\n⚠️ ${successCount}/${txCount} transactions were successful.`);
        }
        
        // Log transaction hashes
        if (txHashes.length > 0) {
            console.log("\nTransaction hashes:");
            txHashes.forEach((hash, index) => {
                console.log(`${index + 1}. ${hash}`);
            });
            
            // Save transaction hashes to a file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logPath = path.join(config.paths.outputDir, `tx_log_${timestamp}.txt`);
            
            let logContent = `BeraBundle Transaction Log - ${new Date().toISOString()}\n`;
            logContent += `Wallet: ${walletName} (${address})\n\n`;
            logContent += `Claimed Rewards:\n`;
            
            Object.entries(rewardsByToken).forEach(([symbol, amount]) => {
                logContent += `${amount.toFixed(4)} ${symbol}\n`;
            });
            
            logContent += `\nTransactions:\n`;
            txHashes.forEach((hash, index) => {
                logContent += `${index + 1}. ${hash}\n`;
            });
            
            await fs.writeFile(logPath, logContent);
            console.log(`\nTransaction log saved to: ${logPath}`);
        }
        
    } catch (error) {
        console.error(`Error in claim and redelegate script: ${error.message}`);
        process.exit(1);
    }
}

// Execute the main function
main().catch(console.error);