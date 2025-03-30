// claimAndRedelegate.js - Script for claiming rewards and redelegating BGT
const { ethers } = require('ethers');
const fs = require('fs').promises;
const inquirer = require('inquirer');
const config = require('./config');
const { ClaimBundler, OutputFormat } = require('./claimBundler');
const { ErrorHandler } = require('./errorHandler');
const WalletService = require('./walletService');
const RedelegationManager = require('./redelegationManager');

/**
 * Main function to run the claim and redelegate script
 */
async function main() {
    try {
        // Initialize provider
        const provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
        console.log(`Connected to ${config.networks.berachain.name}`);

        // Initialize services
        const walletService = new WalletService(provider);
        await walletService.initialize();
        
        const redelegationManager = new RedelegationManager(provider);
        await redelegationManager.initialize();
        
        const claimBundler = new ClaimBundler(provider);

        // Get wallets
        const wallets = walletService.getWallets();
        if (Object.keys(wallets).length === 0) {
            console.log('No wallets found. Please add a wallet first.');
            return;
        }

        // Select wallet
        const walletNames = Object.keys(wallets);
        const { selectedWallet } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedWallet',
                message: 'Select wallet:',
                choices: walletNames
            }
        ]);

        const userAddress = wallets[selectedWallet];
        console.log(`Selected wallet: ${selectedWallet} (${userAddress})`);

        // Mock reward info (in a real implementation, this would be fetched from RewardChecker)
        const rewardInfo = [
            {
                type: 'vault',
                vaultAddress: '0x1234567890123456789012345678901234567890',
                stakeToken: { symbol: 'LP-TOKEN', decimals: 18 },
                rewardToken: { symbol: 'BGT', decimals: 18 },
                earned: '10.5'
            },
            {
                type: 'bgtStaker',
                contractAddress: config.networks.berachain.bgtStakerAddress,
                rewardToken: { symbol: 'HONEY', decimals: 18 },
                earned: '25.75'
            }
        ];

        // Ask if the user wants to include redelegation
        const { includeRedelegation } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'includeRedelegation',
                message: 'Would you like to redelegate BGT rewards to validators?',
                default: false
            }
        ]);

        // Check delegation preferences if redelegation is requested
        if (includeRedelegation) {
            const userPrefs = redelegationManager.getUserPreferences(userAddress);
            
            if (!userPrefs.validators || userPrefs.validators.length === 0) {
                console.log('No delegation preferences found. Please set up delegation preferences first.');
                
                const { setupNow } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'setupNow',
                        message: 'Would you like to set up delegation preferences now?',
                        default: true
                    }
                ]);
                
                if (setupNow) {
                    // Launch validator selector (ideally this would be a module import and function call,
                    // but for simplicity we'll suggest running the validator selector script separately)
                    console.log('Please run the validator selector script first:');
                    console.log('  node validatorSelector.js');
                    return;
                } else {
                    console.log('Continuing without redelegation...');
                }
            } else {
                // Display current preferences
                console.log('\nCurrent Delegation Preferences:');
                for (const validator of userPrefs.validators) {
                    const allocation = userPrefs.allocations ? userPrefs.allocations[validator.pubkey] || 0 : 0;
                    console.log(`- ${validator.name} (${validator.pubkey.substring(0, 10)}...): ${allocation}%`);
                }
                
                // Ask if user wants to use these preferences
                const { usePreferences } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'usePreferences',
                        message: 'Use these delegation preferences?',
                        default: true
                    }
                ]);
                
                if (!usePreferences) {
                    console.log('Please update your preferences using the validator selector script:');
                    console.log('  node validatorSelector.js');
                    return;
                }
            }
        }

        // Select output format
        const { format } = await inquirer.prompt([
            {
                type: 'list',
                name: 'format',
                message: 'Select output format:',
                choices: [
                    { name: 'EOA Transaction (for wallets like MetaMask)', value: OutputFormat.EOA },
                    { name: 'Safe SDK Format', value: OutputFormat.SAFE_SDK },
                    { name: 'Safe UI Format', value: OutputFormat.SAFE_UI }
                ]
            }
        ]);

        // Generate the claim bundle
        const bundle = await claimBundler.generateClaimBundle(
            rewardInfo,
            userAddress,
            userAddress, // recipient is the same as user
            format,
            selectedWallet,
            { redelegate: includeRedelegation }
        );

        if (!bundle.success) {
            console.log(`Error: ${bundle.message}`);
            return;
        }

        // Success message
        console.log('\nClaim bundle generated successfully!');
        console.log(`File saved to: ${bundle.filepath}`);
        
        // Display summary
        console.log('\nSummary:');
        console.log(`- Total rewards: ${bundle.summary.rewardSummary}`);
        console.log(`- Sources: ${bundle.summary.totalSources} (${bundle.summary.vaultCount} vaults${bundle.summary.hasBGTStaker ? ', BGT Staker' : ''})`);
        
        if (bundle.summary.includesRedelegation) {
            console.log(`- Redelegation: ${bundle.summary.redelegationCount} transactions`);
        }
        
        console.log(`- Total transactions: ${bundle.summary.totalTransactions}`);
        console.log(`- Output format: ${format}`);

    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Run the script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };