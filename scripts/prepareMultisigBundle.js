#!/usr/bin/env node
// prepareMultisigBundle.js - Script to check for rewards and prepare a multisig bundle

const { ethers } = require('ethers');
const BeraBundle = require('../berabundle');
const config = require('../config');
const { ClaimBundler, OutputFormat } = require('../claimBundler');
const fs = require('fs').promises;
const path = require('path');

// Command-line arguments
const args = process.argv.slice(2);
const walletName = args[0];  // The wallet to check for rewards
const safeAddress = args[1]; // The Safe multisig address for receiving rewards
const format = args[2] || 'safe_ui'; // Default to safe_ui format

// Display usage if arguments are missing
if (!walletName || !safeAddress) {
    console.log('Usage: node prepareMultisigBundle.js <walletName> <safeAddress> [format]');
    console.log('Example: node prepareMultisigBundle.js myWallet 0x123... safe_ui');
    console.log('Formats: safe_ui (default), safe_cli');
    process.exit(1);
}

// Validate format argument
if (format !== 'safe_ui' && format !== 'safe_cli') {
    console.error(`Error: Invalid format "${format}". Must be one of: safe_ui, safe_cli`);
    process.exit(1);
}

/**
 * Main function to check rewards and prepare a multisig bundle
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
        console.log(`Safe address for receiving rewards: ${safeAddress}`);

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

        // Convert format string to OutputFormat enum value
        const outputFormat = format === 'safe_ui' ? OutputFormat.SAFE_UI : OutputFormat.SAFE_CLI;

        // Generate bundle for Safe multisig
        console.log(`\nGenerating ${format} bundle for Safe multisig...`);
        const bundle = await app.claimBundler.generateClaimBundle(
            claimableRewards,
            address,
            safeAddress, // Send rewards to the Safe multisig address
            outputFormat,
            walletName,
            { redelegate: includeRedelegation }
        );

        if (!bundle.success) {
            console.error(`Error generating bundle: ${bundle.message}`);
            process.exit(1);
        }

        console.log(`\nBundle generated successfully: ${bundle.filepath}`);
        console.log(`Summary: ${bundle.summary.vaultCount} vaults${bundle.summary.hasBGTStaker ? " + BGT Staker" : ""}${bundle.summary.redelegationCount > 0 ? ` + ${bundle.summary.redelegationCount} redelegation transactions` : ""}`);
        console.log(`Rewards: ${bundle.summary.rewardSummary}`);
        console.log(`Total transactions: ${bundle.summary.totalTransactions}`);

        // Create a user-friendly file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const infoPath = path.join(config.paths.outputDir, `multisig_bundle_info_${timestamp}.txt`);
        
        let infoContent = `BeraBundle Multisig Bundle - ${new Date().toISOString()}\n`;
        infoContent += `Wallet: ${walletName} (${address})\n`;
        infoContent += `Safe address: ${safeAddress}\n`;
        infoContent += `Format: ${format}\n\n`;
        infoContent += `Claimed Rewards:\n`;
        
        Object.entries(rewardsByToken).forEach(([symbol, amount]) => {
            infoContent += `${amount.toFixed(4)} ${symbol}\n`;
        });
        
        infoContent += `\nBundle Summary:\n`;
        infoContent += `- ${bundle.summary.vaultCount} vaults${bundle.summary.hasBGTStaker ? " + BGT Staker" : ""}\n`;
        if (bundle.summary.redelegationCount > 0) {
            infoContent += `- ${bundle.summary.redelegationCount} redelegation transactions\n`;
        }
        infoContent += `- Total: ${bundle.summary.totalTransactions} transactions\n\n`;
        
        infoContent += `Bundle file: ${bundle.filepath}\n\n`;
        
        // Instructions for usage
        infoContent += "Instructions for Safe Web UI:\n";
        infoContent += "1. Go to app.safe.global and connect to your Safe\n";
        infoContent += "2. Go to New Transaction > Transaction Builder\n";
        infoContent += "3. Click 'Load' and select the bundle file\n";
        infoContent += "4. Review, sign, and execute the transactions\n";
        
        await fs.writeFile(infoPath, infoContent);
        console.log(`\nBundle info saved to: ${infoPath}`);
        
    } catch (error) {
        console.error(`Error preparing multisig bundle: ${error.message}`);
        process.exit(1);
    }
}

// Execute the main function
main().catch(console.error);