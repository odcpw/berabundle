// menuManager.js - Manages menu navigation and user flows
const config = require('../config');
const { ErrorHandler } = require('../utils/errorHandler');
const fs = require('fs').promises;
const path = require('path');
const inquirer = require('inquirer');
const { OutputFormat } = require('../services/claimBundler');

/**
 * Manages all menu flows and user interactions
 */
class MenuManager {
    constructor(app) {
        this.app = app;
        this.uiHandler = app.uiHandler;
        this.walletService = app.walletService;
        this.rewardChecker = app.rewardChecker;
        this.claimBundler = app.claimBundler;
        this.redelegationManager = app.redelegationManager;
    }

    /**
     * Main menu handler
     */
    async mainMenu() {
        while (true) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("BERABUNDLE");

            const options = this.uiHandler.createMenuOptions([
                // Setup section
                { key: '1', label: 'Setup Wallets', value: 'wallets' },
                { key: '2', label: 'Setup Validator Boosting', value: 'validators' },
                
                // Spacer
                { key: '', label: '', value: 'spacer' },
                
                // Rewards section
                { key: '3', label: 'Claim Rewards', value: 'claim' },
                { key: '4', label: 'Send Bundle', value: 'send' }
            ], false, true, '', 'Exit');

            this.uiHandler.displayMenu(options);
            this.uiHandler.displayFooter();

            const choice = await this.uiHandler.getSelection(options);

            switch (choice) {
                case 'wallets':
                    await this.walletMenu();
                    break;
                case 'validators':
                    await this.validatorMenu();
                    break;
                case 'claim':
                    await this.claimRewardsMenu();
                    break;
                case 'send':
                    await this.sendBundleMenu();
                    break;
                case 'spacer':
                    // Do nothing for spacer
                    break;
                case 'quit':
                    this.uiHandler.clearScreen();
                    console.log("Thank you for using BeraBundle!");
                    this.uiHandler.close();
                    return;
            }
        }
    }

    /**
     * Wallet management menu
     */
    async walletMenu() {
        while (true) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("WALLETS");

            // Display current wallets
            const wallets = this.walletService.getWallets();
            const walletEntries = this.uiHandler.displayWallets(wallets);

            // Menu options
            const options = this.uiHandler.createMenuOptions([
                { key: '1', label: 'Add Wallet', value: 'add' },
                { key: '2', label: 'Remove Wallet', value: 'remove' },
                { key: '3', label: 'Add Private Key', value: 'add_key' },
                { key: '4', label: 'Remove Private Key', value: 'remove_key' },
                { key: '5', label: 'View Wallet Status', value: 'view_status' }
            ], true, false);

            this.uiHandler.displayMenu(options);
            this.uiHandler.displayFooter();

            const choice = await this.uiHandler.getSelection(options);

            switch (choice) {
                case 'add':
                    await this.addWalletFlow();
                    break;
                case 'remove':
                    await this.removeWalletFlow(walletEntries);
                    break;
                case 'add_key':
                    await this.addPrivateKeyFlow();
                    break;
                case 'remove_key':
                    await this.removePrivateKeyFlow();
                    break;
                case 'view_status':
                    await this.viewWalletStatusFlow();
                    break;
                case 'back':
                    return;
            }
        }
    }

    /**
     * Flow for adding a wallet
     */
    async addWalletFlow() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("ADD WALLET");

        // Get wallet name
        const name = await this.uiHandler.getUserInput(
            "Enter wallet name:",
            input => input.trim() !== '',
            "Wallet name cannot be empty"
        );

        // Get wallet address
        const address = await this.uiHandler.getUserInput(
            "Enter wallet address:",
            input => this.walletService.constructor.isValidAddress(input),
            "Invalid Ethereum address format"
        );

        // Add the wallet
        const success = await this.walletService.addWallet(name, address);

        if (success) {
            console.log("Wallet added successfully!");
        }

        await this.uiHandler.pause();
    }

    /**
     * Flow for removing a wallet
     * @param {Array} walletEntries - Array of wallet entries [name, address]
     */
    async removeWalletFlow(walletEntries) {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("REMOVE WALLET");

        // Display wallets again
        this.uiHandler.displayWallets(this.walletService.getWallets());

        if (walletEntries.length === 0) {
            await this.uiHandler.pause();
            return;
        }

        // Get wallet selection
        const walletNumber = await this.uiHandler.getUserInput(
            "Enter wallet number to remove:",
            input => {
                const num = parseInt(input);
                return !isNaN(num) && num > 0 && num <= walletEntries.length;
            },
            "Invalid wallet number"
        );

        const index = parseInt(walletNumber) - 1;
        const [name, address] = walletEntries[index];

        // Confirm removal
        const confirmed = await this.uiHandler.confirm(
            `Are you sure you want to remove ${name} (${address})?`
        );

        if (confirmed) {
            const success = await this.walletService.removeWallet(name);
            if (success) {
                console.log("Wallet removed successfully!");
            }
        }

        await this.uiHandler.pause();
    }
    
    /**
     * Flow for adding a private key to a wallet
     */
    async addPrivateKeyFlow() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("ADD PRIVATE KEY");
        
        // First, ensure the userprefs directory exists
        await fs.mkdir(config.paths.userprefsDir, { recursive: true });

        // Get wallets
        const wallets = this.walletService.getWallets();
        const walletEntries = this.uiHandler.displayWallets(wallets);

        if (walletEntries.length === 0) {
            console.log("\nNo wallets found. Please add a wallet first.");
            await this.uiHandler.pause();
            return;
        }

        // Get wallet selection
        const walletNumber = await this.uiHandler.getUserInput(
            "Enter wallet number to add private key for:",
            input => {
                const num = parseInt(input);
                return !isNaN(num) && num > 0 && num <= walletEntries.length;
            },
            "Invalid wallet number"
        );

        const index = parseInt(walletNumber) - 1;
        const [name, address] = walletEntries[index];

        // Check if wallet already has a private key
        const hasKey = await this.walletService.hasPrivateKey(name);
        if (hasKey) {
            console.log(`\nWallet already has a private key. Use 'Remove Private Key' first if you want to replace it.`);
            await this.uiHandler.pause();
            return;
        }

        // Get private key with password input for security
        console.log("\nYour private key will be hidden as you type it.");
        const { privateKey } = await inquirer.prompt([
            {
                type: 'password',
                name: 'privateKey',
                message: 'Enter private key (this will be encrypted):',
                validate: input => {
                    if (input.trim() === '') {
                        return "Private key cannot be empty";
                    }
                    return true;
                }
            }
        ]);
        
        // Clear clipboard for security
        try {
            await this.app.clearClipboard();
            console.log("\n✅ Clipboard cleared for security");
        } catch (error) {
            console.log("\n🔒 Consider clearing your clipboard manually for security");
        }

        // Get password for encryption
        const { password } = await inquirer.prompt([
            {
                type: 'password',
                name: 'password',
                message: "\nCreate a password to encrypt the private key (minimum 8 characters):",
                validate: input => {
                    if (input.length < 8) {
                        return "Password must be at least 8 characters long";
                    }
                    return true;
                }
            }
        ]);

        // Confirm password
        const { confirmPassword } = await inquirer.prompt([
            {
                type: 'password',
                name: 'confirmPassword',
                message: "Confirm password:",
                validate: input => {
                    if (input !== password) {
                        return "Passwords do not match";
                    }
                    return true;
                }
            }
        ]);

        console.log("\nValidating and encrypting private key...");
        this.uiHandler.startProgress(100, "Encrypting private key...");
        const result = await this.walletService.addPrivateKey(name, privateKey, password);
        this.uiHandler.stopProgress();

        if (result.success) {
            console.log("\n✅ " + result.message);
            
            // Verify the key was actually stored
            const hasKey = await this.walletService.hasPrivateKey(name);
            if (hasKey) {
                console.log("\nIMPORTANT: Your private key is now encrypted and stored. You will need your password to use it for sending transactions.");
            } else {
                console.log("\n⚠️ Warning: The key was supposed to be stored, but verification failed. Please try again.");
            }
        } else {
            console.log("\n❌ Error: " + result.message);
        }

        await this.uiHandler.pause();
    }

    /**
     * Flow for removing a private key from a wallet
     */
    async removePrivateKeyFlow() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("REMOVE PRIVATE KEY");

        // Get wallets
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
            console.log("\nNo wallets with private keys found.");
            await this.uiHandler.pause();
            return;
        }

        // Display only wallets with private keys
        console.log("\nWallets with private keys:");
        walletsWithKeys.forEach(([name, address], index) => {
            console.log(`${index + 1}. ${name} (${address}) [Has private key]`);
        });

        // Get wallet selection
        const walletNumber = await this.uiHandler.getUserInput(
            "\nEnter wallet number to remove private key from:",
            input => {
                const num = parseInt(input);
                return !isNaN(num) && num > 0 && num <= walletsWithKeys.length;
            },
            "Invalid wallet number"
        );

        const index = parseInt(walletNumber) - 1;
        const [name, address] = walletsWithKeys[index];

        // Confirm removal
        const confirmed = await this.uiHandler.confirm(
            `Are you sure you want to remove the private key for ${name} (${address})?`
        );

        if (confirmed) {
            const result = await this.walletService.removePrivateKey(name);
            if (result.success) {
                console.log("\n✅ " + result.message);
            } else {
                console.log("\n❌ Error: " + result.message);
            }
        }

        await this.uiHandler.pause();
    }

    /**
     * Flow for viewing wallet status
     */
    async viewWalletStatusFlow() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("WALLET STATUS");

        // Get wallets
        const wallets = this.walletService.getWallets();
        const walletEntries = Object.entries(wallets);

        if (walletEntries.length === 0) {
            console.log("\nNo wallets found.");
            await this.uiHandler.pause();
            return;
        }

        // Display wallet status
        console.log("\nWallet Status:");
        console.log("══════════════════════════════════════════════════════════");
        
        for (const [name, address] of walletEntries) {
            const hasKey = await this.walletService.hasPrivateKey(name);
            const status = hasKey ? "✅ Has private key" : "❌ No private key";
            console.log(`${name} (${address})`);
            console.log(`Status: ${status}`);
            console.log("──────────────────────────────────────────────────────────");
        }

        await this.uiHandler.pause();
    }

    /**
     * Send bundle menu
     */
    async sendBundleMenu() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("SEND BUNDLE");

        // Check if there are any bundles in the output directory
        try {
            // Read all bundle files and get their stats
            const files = await fs.readdir(config.paths.outputDir);
            const bundleFilesWithStats = await Promise.all(
                files
                    .filter(file => file.endsWith('.json'))
                    .map(async file => {
                        const filePath = path.join(config.paths.outputDir, file);
                        const stat = await fs.stat(filePath);
                        return { file, mtime: stat.mtime.getTime() };
                    })
            );
            
            // Sort bundle files by modification time (newest first)
            bundleFilesWithStats.sort((a, b) => b.mtime - a.mtime);
            
            // Extract just the filenames for display
            const bundleFiles = bundleFilesWithStats.map(entry => entry.file);

            if (bundleFiles.length === 0) {
                console.log("\nNo bundles found in the output directory. Generate a bundle first using 'Claim Rewards'.");
                await this.uiHandler.pause();
                return;
            }

            // Display bundle files
            console.log("\nSelect a bundle to send:");
            const bundleOptions = bundleFiles.map((file, index) => ({
                key: (index + 1).toString(),
                label: file,
                value: file
            }));

            const options = this.uiHandler.createMenuOptions(bundleOptions);
            this.uiHandler.displayMenu(options);
            
            const choice = await this.uiHandler.getSelection(options);
            
            if (choice === 'back') {
                return;
            }
            
            if (choice === 'quit') {
                process.exit(0);
            }
            
            // Load the selected bundle file
            const bundleFile = path.join(config.paths.outputDir, choice);
            const bundleContent = await fs.readFile(bundleFile, 'utf8');
            const bundleData = JSON.parse(bundleContent);
            
            // Create a simplified bundle object for the signAndSendBundleFlow
            let format;
            if (choice.includes('_eoa.json')) {
                format = 'eoa';
            } else if (choice.includes('_safe_ui.json')) {
                format = 'safe_ui';
            } else if (choice.includes('_safe_cli.json')) {
                format = 'safe_cli';
            } else {
                // Try to determine format from the content
                if (Array.isArray(bundleData)) {
                    format = 'eoa';
                } else if (bundleData.transactions && bundleData.meta) {
                    format = 'safe_ui';
                } else {
                    format = 'unknown';
                }
            }
            
            console.log(`\nDetected bundle format: ${format}`);
            
            // Validate the format
            if (format === 'unknown') {
                console.log("\n❌ Error: Could not determine the bundle format.");
                console.log("This could happen if the bundle file was created with a different version of the tool.");
                console.log("Try generating a new bundle using the 'Claim Rewards' option.");
                await this.uiHandler.pause();
                return;
            }
            
            // Extract summary information from the bundle
            let vaultCount = 0;
            let hasBGTStaker = false;
            let redelegationCount = 0;
            let rewardsByType = {};
            let rewardSummary = "Unknown";
            
            if (format === 'eoa') {
                // For EOA bundles
                for (const tx of bundleData) {
                    // Try to determine transaction type from the data
                    if (tx.data.includes('getReward')) {
                        if (tx.data.length > 200) {
                            // Vault transactions are longer due to parameters
                            vaultCount++;
                        } else {
                            hasBGTStaker = true;
                        }
                    } else if (tx.data.includes('queueBoost')) {
                        redelegationCount++;
                    }
                }
            } else if (format === 'safe_ui' && bundleData.meta) {
                // For Safe UI bundles, extract from meta info
                const desc = bundleData.meta.description;
                
                // Extract vault count
                const vaultMatch = desc.match(/(\d+) vault claim/);
                vaultCount = vaultMatch ? parseInt(vaultMatch[1]) : 0;
                
                // Check for BGT Staker
                hasBGTStaker = desc.includes('BGT Staker');
                
                // Extract redelegation count
                const redelegationMatch = desc.match(/(\d+) validator boost/);
                redelegationCount = redelegationMatch ? parseInt(redelegationMatch[1]) : 0;
                
                // Extract rewards summary if present in description
                const rewardsMatch = desc.match(/Rewards: ([^:]+(?:, [^:]+)*)/);
                if (rewardsMatch) {
                    rewardSummary = rewardsMatch[1].trim();
                    
                    // Parse rewards into rewardsByType
                    const rewards = rewardSummary.split(', ');
                    rewards.forEach(reward => {
                        const [amount, symbol] = reward.trim().split(' ');
                        if (symbol) {
                            rewardsByType[symbol] = parseFloat(amount);
                        }
                    });
                }
            }
            
            // Create a simplified bundle object
            const bundle = {
                bundleData: bundleData,
                summary: {
                    format: format,
                    vaultCount: vaultCount,
                    hasBGTStaker: hasBGTStaker,
                    rewardSummary: rewardSummary,
                    rewardsByType: rewardsByType,
                    redelegationCount: redelegationCount,
                    totalTransactions: Array.isArray(bundleData) ? bundleData.length : 
                                      (bundleData.transactions ? bundleData.transactions.length : 0),
                    includesRedelegation: redelegationCount > 0
                }
            };
            
            // Pass the bundle to the transaction service for sending
            await this.app.transactionService.signAndSendBundleFlow(bundle);
        } catch (error) {
            console.log(`\n❌ Error: ${error.message}`);
            await this.uiHandler.pause();
        }
    }

    /**
     * Check rewards menu
     */
    async checkRewardsMenu() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("CHECK REWARDS");

        // Get wallets but don't display them yet
        const wallets = this.walletService.getWallets();
        const walletEntries = Object.entries(wallets);

        if (walletEntries.length === 0) {
            console.log("\nNo wallets found. Please add a wallet first.");
            await this.uiHandler.pause();
            return;
        }

        // Show reward check options
        const checkOptions = this.uiHandler.createMenuOptions([
            { key: '1', label: 'Check Rewards (Vaults & BGT Staker)', value: 'rewards' },
            { key: '2', label: 'Check Validator Boosts', value: 'validators' },
            { key: '3', label: 'Check Both', value: 'both' },
            { key: '4', label: 'Update Vaults, Validators, and Tokens from GitHub', value: 'update_metadata' }
        ]);

        this.uiHandler.displayMenu(checkOptions);
        const checkType = await this.uiHandler.getSelection(checkOptions);

        if (checkType === 'back' || checkType === 'quit') {
            return checkType === 'quit' ? process.exit(0) : undefined;
        }
        
        if (checkType === 'update_metadata') {
            // Directly update all metadata without submenu
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("UPDATE METADATA");
            
            console.log("\nUpdating all metadata from GitHub...");
            
            this.uiHandler.startProgress(100, "Fetching data...");
            await this.rewardChecker.updateAllMetadata();
            this.uiHandler.stopProgress();
            
            console.log("All metadata updated successfully!");
            
            await this.uiHandler.pause();
            return await this.checkRewardsMenu(); // Go back to check rewards menu
        }

        // Now show wallet selection
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader(`CHECK ${checkType === 'rewards' ? 'REWARDS' : checkType === 'validators' ? 'VALIDATOR BOOSTS' : 'ALL INFORMATION'}`);

        // Display wallet options as part of the menu
        console.log("\nSelect Wallet:");
        
        // Create wallet options for the menu
        const walletOptions = walletEntries.map(([name, address], index) => ({
            key: (index + 1).toString(),
            label: `${name} (${address})`,
            value: { name, address }
        }));

        const options = this.uiHandler.createMenuOptions([
            ...walletOptions,
            { key: 'a', label: 'All Wallets', value: 'all' }
        ]);

        this.uiHandler.displayMenu(options);
        this.uiHandler.displayFooter();

        const choice = await this.uiHandler.getSelection(options);

        if (choice === 'back') {
            return;
        }

        if (choice === 'quit') {
            process.exit(0);
        }

        if (choice === 'all') {
            // Check all wallets
            this.uiHandler.clearScreen();
            console.log(`Checking ${checkType === 'rewards' ? 'rewards' : checkType === 'validators' ? 'validator boosts' : 'all information'} for all wallets...\n`);

            for (const [name, address] of walletEntries) {
                console.log(`\nWallet: ${name} (${address})`);
                console.log("───────────────────────────────────────");

                this.uiHandler.startProgress(100, `Checking for ${name}...`);

                if (checkType === 'rewards') {
                    const result = await this.rewardChecker.checkAllRewards(
                        address, true, false,
                        (current, total, status) => {
                            const percentage = Math.floor((current / total) * 100);
                            this.uiHandler.updateProgress(percentage, status);
                        },
                        false // Don't include validator boosts
                    );
                    this.uiHandler.stopProgress();
                    console.log(result);
                } else if (checkType === 'validators') {
                    const result = await this.rewardChecker.checkValidatorBoosts(
                        address, false,
                        (current, total, status) => {
                            const percentage = Math.floor((current / total) * 100);
                            this.uiHandler.updateProgress(percentage, status);
                        },
                        false // Don't refresh validator list automatically
                    );
                    this.uiHandler.stopProgress();
                    console.log(result);
                } else {
                    // Check both
                    const result = await this.rewardChecker.checkAllRewards(
                        address, true, false,
                        (current, total, status) => {
                            const percentage = Math.floor((current / total) * 100);
                            this.uiHandler.updateProgress(percentage, status);
                        },
                        true // Include validator boosts
                    );
                    this.uiHandler.stopProgress();
                    console.log(result);
                }
            }
        } else {
            // Check specific wallet
            const { name, address } = choice;

            this.uiHandler.clearScreen();
            console.log(`Checking ${checkType === 'rewards' ? 'rewards' : checkType === 'validators' ? 'validator boosts' : 'all information'} for ${name} (${address})...\n`);

            this.uiHandler.startProgress(100, "Scanning...");

            if (checkType === 'rewards') {
                const result = await this.rewardChecker.checkAllRewards(
                    address, true, false,
                    (current, total, status) => {
                        const percentage = Math.floor((current / total) * 100);
                        this.uiHandler.updateProgress(percentage, status);
                    },
                    false // Don't include validator boosts
                );
                this.uiHandler.stopProgress();
                console.log(result);
            } else if (checkType === 'validators') {
                const result = await this.rewardChecker.checkValidatorBoosts(
                    address, false,
                    (current, total, status) => {
                        const percentage = Math.floor((current / total) * 100);
                        this.uiHandler.updateProgress(percentage, status);
                    }
                );
                this.uiHandler.stopProgress();
                console.log(result);
            } else {
                // Check both
                const result = await this.rewardChecker.checkAllRewards(
                    address, true, false,
                    (current, total, status) => {
                        const percentage = Math.floor((current / total) * 100);
                        this.uiHandler.updateProgress(percentage, status);
                    },
                    true // Include validator boosts
                );
                this.uiHandler.stopProgress();
                console.log(result);
            }
        }

        await this.uiHandler.pause();
    }

    /**
     * Claim rewards menu
     */
    async claimRewardsMenu() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("CLAIM REWARDS");

        // Get wallets but don't display them here
        const wallets = this.walletService.getWallets();
        const walletEntries = Object.entries(wallets);

        if (walletEntries.length === 0) {
            console.log("\nNo wallets found. Please add a wallet first.");
            await this.uiHandler.pause();
            return;
        }

        console.log("\nNote: Each wallet can only claim its own rewards.");
        console.log("\nSelect a wallet to claim rewards:");

        // Create wallet options for the menu
        const walletOptions = walletEntries.map(([name, address], index) => ({
            key: (index + 1).toString(),
            label: `${name} (${address})`,
            value: { name, address }
        }));

        const options = this.uiHandler.createMenuOptions(walletOptions);

        this.uiHandler.displayMenu(options);
        this.uiHandler.displayFooter();

        const choice = await this.uiHandler.getSelection(options);

        if (choice === 'back') {
            return;
        }

        if (choice === 'quit') {
            process.exit(0);
        }

        // Process specific wallet
        const { name, address } = choice;
        await this.processClaimForWallet(name, address);
    }
    
    /**
     * Process claim for a specific wallet
     * @param {string} name - Wallet name
     * @param {string} address - Wallet address
     */
    async processClaimForWallet(name, address) {
        this.uiHandler.clearScreen();
        console.log(`Processing claims for ${name} (${address})...\n`);

        // Check rewards first
        this.uiHandler.startProgress(100, "Checking for claimable rewards...");

        const rewardInfo = await this.rewardChecker.checkAllRewards(
            address, true, true,
            (current, total, status) => {
                const percentage = Math.floor((current / total) * 100);
                this.uiHandler.updateProgress(percentage, status);
            },
            false // Don't include validator boosts here
        );

        this.uiHandler.stopProgress();

        // Handle the new format where we have rewards and validatorBoosts
        const rewards = rewardInfo.rewards || rewardInfo;

        // Filter rewards that are claimable
        const claimableRewards = rewards.filter(item =>
            item.earned && parseFloat(item.earned) > 0
        );

        if (claimableRewards.length === 0) {
            console.log("No rewards to claim for this wallet.");
            await this.uiHandler.pause();
            return;
        }

        // Display reward summary
        console.log("Claimable Rewards:");
        console.log("═════════════════════════════════════════");
        console.log(this.uiHandler.formatRewardSummary(claimableRewards));
        console.log("═════════════════════════════════════════");

        // Step 1: Confirm claim
        const proceedWithClaim = await this.uiHandler.confirm(
            "Do you want to proceed with claiming these rewards?"
        );

        if (!proceedWithClaim) {
            return;
        }

        // Step 2: Select destination wallet
        console.log("\nSelect destination wallet:");
        const recipientOptions = this.uiHandler.createMenuOptions([
            { key: '1', label: 'Same wallet (default)', value: address },
            { key: '2', label: 'Custom address', value: 'custom' }
        ], true, false);

        this.uiHandler.displayMenu(recipientOptions);
        const recipientChoice = await this.uiHandler.getSelection(recipientOptions);

        if (recipientChoice === 'back') {
            return;
        }

        let recipient;
        if (recipientChoice === 'custom') {
            recipient = await this.uiHandler.getUserInput(
                "Enter recipient address:",
                input => this.walletService.constructor.isValidAddress(input),
                "Invalid Ethereum address format"
            );
        } else {
            recipient = recipientChoice;
        }

        // Step 3: Check if user wants to redelegate BGT rewards
        let includeRedelegation = false;
        
        // Check if wallet has delegation preferences
        const userPrefs = this.redelegationManager.getUserPreferences(address);
        const hasValidPrefs = userPrefs.validators && userPrefs.validators.length > 0;
        
        if (hasValidPrefs) {
            // Check if any BGT rewards are included
            const hasBgtRewards = claimableRewards.some(reward => 
                reward.rewardToken && reward.rewardToken.symbol === 'BGT' && 
                parseFloat(reward.earned) > 0
            );
            
            if (hasBgtRewards) {
                console.log("\nYou have BGT rewards and delegation preferences set.");
                console.log("\nCurrent Delegation Preferences:");
                
                for (const validator of userPrefs.validators) {
                    const allocation = userPrefs.allocations ? userPrefs.allocations[validator.pubkey] || 0 : 0;
                    console.log(`- ${validator.name} (${validator.pubkey.substring(0, 10)}...): ${allocation}%`);
                }
                
                includeRedelegation = await this.uiHandler.confirm(
                    "\nWould you like to redelegate your BGT rewards to these validators?"
                );
            }
        } else if (claimableRewards.some(r => r.rewardToken && r.rewardToken.symbol === 'BGT')) {
            console.log("\nYou have BGT rewards but no delegation preferences set.");
            const setupNow = await this.uiHandler.confirm(
                "Would you like to set up delegation preferences now?"
            );
            
            if (setupNow) {
                await this.validatorMenu(address);
                // Refresh preferences after setup
                const updatedPrefs = this.redelegationManager.getUserPreferences(address);
                if (updatedPrefs.validators && updatedPrefs.validators.length > 0) {
                    includeRedelegation = await this.uiHandler.confirm(
                        "\nWould you like to redelegate your BGT rewards to these validators?"
                    );
                }
            }
        }

        // Step 4: Select transaction format
        // We can't reliably detect wallet type just based on private key presence
        // The user might be using a hardware wallet, watch-only EOA, or other non-Safe wallet
        console.log("\nSelect transaction format:");
        const formatOptions = this.uiHandler.createMenuOptions([
            { key: '1', label: 'EOA Wallet', value: OutputFormat.EOA },
            { key: '2', label: 'Safe Multisig', value: OutputFormat.SAFE_UI }
        ], true, false);

        this.uiHandler.displayMenu(formatOptions);
        const formatChoice = await this.uiHandler.getSelection(formatOptions);

        // Generate the claim bundle
        console.log("\nGenerating claim bundle...");
        const bundle = await this.claimBundler.generateClaimBundle(
            claimableRewards,
            address,
            recipient,
            formatChoice,
            name,
            { redelegate: includeRedelegation }
        );

        if (!bundle.success) {
            console.log(`Error: ${bundle.message}`);
            await this.uiHandler.pause();
            return;
        }

        // Show enhanced summary that includes BGT Staker info and redelegation
        console.log("\nClaim bundle generated successfully!");
        let summaryText = `${bundle.summary.vaultCount} vaults`;
        if (bundle.summary.hasBGTStaker) {
            summaryText += " + BGT Staker";
        }
        if (bundle.summary.redelegationCount > 0) {
            summaryText += ` + ${bundle.summary.redelegationCount} redelegation transactions`;
        }
        console.log(`Summary: ${summaryText}`);
        console.log(`Rewards: ${bundle.summary.rewardSummary}`);
        console.log(`Total transactions: ${bundle.summary.totalTransactions}`);
        
        // Display information based on wallet type
        if (formatChoice === OutputFormat.EOA) {
            // For EOA wallets
            console.log(`\nClaim bundle saved to ${bundle.filepath}`);
            
            // Ask if user wants to sign and send the bundle with a private key
            const signBundle = await this.uiHandler.confirm("\nWould you like to sign and send this bundle with a private key?");
            
            if (signBundle) {
                await this.app.transactionService.signAndSendBundleFlow(bundle);
            }
        } else {
            // For Safe wallets - show direct transaction builder link
            console.log(`\nTo use this file with Safe:
1. Go to https://app.safe.global/home?safe=ber:${recipient}
2. Click "New Transaction" > "Transaction Builder"
3. Click "Load" and select the generated file at:
   ${bundle.filepath}`);
        }

        await this.uiHandler.pause();
    }

    /**
     * Validator delegation menu
     * @param {string} preselectedAddress - Optional address to preselect
     */
    async validatorMenu(preselectedAddress = null) {
        let walletAddress = preselectedAddress;

        if (!walletAddress) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("VALIDATOR DELEGATION");

            // Get wallets
            const wallets = this.walletService.getWallets();
            const walletEntries = Object.entries(wallets);

            if (walletEntries.length === 0) {
                console.log("\nNo wallets found. Please add a wallet first.");
                await this.uiHandler.pause();
                return;
            }

            // Display wallet options as part of the menu
            console.log("\nSelect Wallet for Validator Delegation:");
            
            // Create wallet options for the menu
            const walletOptions = walletEntries.map(([name, address], index) => ({
                key: (index + 1).toString(),
                label: `${name} (${address})`,
                value: { name, address }
            }));

            const options = this.uiHandler.createMenuOptions(walletOptions);

            this.uiHandler.displayMenu(options);
            this.uiHandler.displayFooter();

            const choice = await this.uiHandler.getSelection(options);

            if (choice === 'back') {
                return;
            }

            if (choice === 'quit') {
                process.exit(0);
            }

            walletAddress = choice.address;
        }

        // Main validator menu
        while (true) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("VALIDATOR DELEGATION");
            
            // Get current preferences
            const userPrefs = this.redelegationManager.getUserPreferences(walletAddress);
            
            // Show current validator preferences if any exist
            if (userPrefs.validators && userPrefs.validators.length > 0) {
                console.log(`\nCurrent Delegation Preferences:`);
                console.log("═════════════════════════════════════════");
                
                // Sort validators alphabetically
                const sortedValidators = [...userPrefs.validators].sort((a, b) => {
                    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                });
                
                for (const validator of sortedValidators) {
                    const allocation = userPrefs.allocations ? userPrefs.allocations[validator.pubkey] || 0 : 0;
                    console.log(`${validator.name} (${validator.pubkey.substring(0, 10)}...): ${allocation}%`);
                }
                
                console.log("═════════════════════════════════════════");
            } else {
                console.log(`\nNo delegation preferences set yet.`);
            }
            
            // Show validator menu options
            console.log("");
            const validatorOptions = this.uiHandler.createMenuOptions([
                { key: '1', label: 'Select Validators', value: 'select' },
                { key: '2', label: 'Set Allocation Percentages', value: 'allocate' },
                { key: '3', label: 'Update Validator List', value: 'update' }
            ], true, false);
            
            this.uiHandler.displayMenu(validatorOptions);
            const action = await this.uiHandler.getSelection(validatorOptions);
            
            if (action === 'back') {
                return;
            }
            
            if (action === 'quit') {
                process.exit(0);
            }
            
            switch (action) {
                case 'select':
                    await this.selectValidatorsFlow(walletAddress);
                    break;
                case 'allocate':
                    await this.setAllocationsFlow(walletAddress);
                    break;
                case 'update':
                    await this.updateValidatorsFlow();
                    break;
            }
        }
    }
    
    /**
     * Flow for selecting validators
     * @param {string} walletAddress - User's wallet address
     */
    async selectValidatorsFlow(walletAddress) {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("SELECT VALIDATORS");
        
        // Get validators
        let validators = this.redelegationManager.getValidators();
        
        if (validators.length === 0) {
            console.log("\nNo validators found. Fetching validators from the network...");
            
            this.uiHandler.startProgress(100, "Fetching validators...");
            
            // Fetch validators using the RedelegationManager
            const result = await this.redelegationManager.updateValidatorsFromNetwork();
            if (result.success) {
                validators = this.redelegationManager.getValidators();
            } else {
                console.log(`\nFailed to fetch validators: ${result.message}`);
                await this.uiHandler.pause();
                return;
            }
            
            this.uiHandler.stopProgress();
        }
        
        // Get user's current preferences
        const userPrefs = this.redelegationManager.getUserPreferences(walletAddress);
        
        // Initialize selected validators with current preferences
        const selectedValidators = userPrefs.validators?.length > 0 
            ? [...userPrefs.validators] 
            : [];
        
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("SELECT VALIDATORS FOR DELEGATION");
        
        console.log("\nChoose validators to delegate to:");
        
        // Create choices for a simplified selection process - just name and pubkey
        // Sort validators alphabetically by name
        const sortedValidators = [...validators].sort((a, b) => {
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        
        const choices = sortedValidators.map(validator => {
            const isSelected = selectedValidators.some(v => v.pubkey === validator.pubkey);
            
            // Simplify the display - just show validator name
            return {
                name: validator.name,
                value: validator,
                checked: isSelected
            };
        });
        
        const { selectedVals } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selectedVals',
                message: 'Select validators (use spacebar to toggle, enter to confirm):',
                choices: choices,
                pageSize: 15
            }
        ]);
        
        // Update selected validators
        if (selectedVals.length === 0) {
            console.log("\nNo validators selected. Operation cancelled.");
            await this.uiHandler.pause();
            return;
        }
        
        // Replace selected validators with new selection
        selectedValidators.length = 0;
        selectedValidators.push(...selectedVals);
        
        // Show validator details option for selected validators
        const { showDetails } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'showDetails',
                message: `You selected ${selectedValidators.length} validators. Would you like to see details?`,
                default: false
            }
        ]);
        
        if (showDetails) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("SELECTED VALIDATORS");
            
            console.log(`\nSelected ${selectedValidators.length} validators:`);
            console.log("═════════════════════════════════════════");
            
            // Sort selected validators alphabetically
            const sortedSelected = [...selectedValidators].sort((a, b) => {
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });
            
            // Display each selected validator with full details
            for (let i = 0; i < sortedSelected.length; i++) {
                const validator = sortedSelected[i];
                
                console.log(`\n${i+1}. ${validator.name}`);
                if (validator.pubkey) {
                    console.log(`   Pubkey: ${validator.pubkey.substring(0, 20)}...`);
                } else {
                    console.log(`   Pubkey: Not available`);
                }
            }
            
            console.log("\nPress Enter to continue to allocation settings.");
            await this.uiHandler.pause();
        }
        
        // If no validators were selected, return
        if (selectedValidators.length === 0) {
            console.log("\nNo validators selected. Operation cancelled.");
            await this.uiHandler.pause();
            return;
        }
        
        // Filter out validators without pubkeys first
        const validatorsWithPubkeys = selectedValidators.filter(validator => validator.pubkey);
        
        if (validatorsWithPubkeys.length === 0) {
            console.log("\nError: None of the selected validators have pubkeys. Cannot proceed with allocation.");
            await this.uiHandler.pause();
            return;
        }
        
        // Create default allocations
        const defaultAllocation = Math.floor(100 / validatorsWithPubkeys.length);
        const remainder = 100 - (defaultAllocation * validatorsWithPubkeys.length);
        
        const allocations = {};
        validatorsWithPubkeys.forEach((validator, index) => {
            // Add the remainder to the first validator
            const allocation = index === 0 ? defaultAllocation + remainder : defaultAllocation;
            allocations[validator.pubkey] = allocation;
        });
        
        // Save preferences to boost_allocation.json
        await this.redelegationManager.setUserPreferences(walletAddress, selectedValidators, allocations);
        
        console.log(`\nSelected ${selectedValidators.length} validators with default allocations.`);
        console.log('You can adjust allocations using the "Set Allocation Percentages" option.');
        await this.uiHandler.pause();
    }
    
    /**
     * Flow for setting allocation percentages
     * @param {string} walletAddress - User's wallet address
     */
    async setAllocationsFlow(walletAddress) {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("SET ALLOCATION PERCENTAGES");
        
        // Get user preferences
        const userPrefs = this.redelegationManager.getUserPreferences(walletAddress);
        
        if (!userPrefs.validators || userPrefs.validators.length === 0) {
            console.log("\nNo validators selected. Please select validators first.");
            await this.uiHandler.pause();
            return;
        }
        
        if (userPrefs.validators.length === 1) {
            console.log("\nOnly one validator selected. Allocation is automatically 100%.");
            await this.uiHandler.pause();
            return;
        }
        
        const validators = userPrefs.validators;
        const allocations = {...userPrefs.allocations} || {};
        
        // Offer preset allocation options
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("SET ALLOCATION PERCENTAGES");
        
        console.log("\nYou have selected " + validators.length + " validators to delegate to.");
        console.log("\nChoose an allocation strategy:");
        
        const strategyOptions = this.uiHandler.createMenuOptions([
            { key: '1', label: 'Equal allocation to all validators', value: 'equal' },
            { key: '2', label: 'Manual allocation (set percentages yourself)', value: 'manual' }
        ], true, false);
        
        this.uiHandler.displayMenu(strategyOptions);
        const strategy = await this.uiHandler.getSelection(strategyOptions);
        
        if (strategy === 'back' || strategy === 'quit') {
            return;
        }
        
        // Apply the chosen allocation strategy
        if (strategy === 'equal') {
            // Equal allocation (with rounding adjustments)
            const equalAllocation = Math.floor(100 / validators.length);
            const remainder = 100 - (equalAllocation * validators.length);
            
            validators.forEach((validator, index) => {
                // Add the remainder to the first validator
                if (validator.pubkey) {
                    allocations[validator.pubkey] = index === 0 
                        ? equalAllocation + remainder 
                        : equalAllocation;
                } else {
                    console.log(`Warning: Validator "${validator.name}" has no pubkey and will be skipped.`);
                }
            });
            
            await showAllocationSummary(validators, allocations);
        }
        else if (strategy === 'manual') {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("MANUAL ALLOCATION");
            
            console.log("\nSet percentage allocation for each validator (must add up to 100%):");
            console.log("NOTE: The last validator's allocation will be calculated automatically.\n");
            
            // Sort validators alphabetically
            const sortedValidators = [...validators].sort((a, b) => {
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });
            
            // Process all validators except the last one
            let totalAllocated = 0;
            const questions = [];
            
            for (let i = 0; i < sortedValidators.length - 1; i++) {
                const validator = sortedValidators[i];
                const currentAllocation = allocations[validator.pubkey] || 0;
                
                // Skip validators without pubkeys
                if (!validator.pubkey) {
                    console.log(`Warning: Validator "${validator.name}" has no pubkey and will be skipped.`);
                    continue;
                }
                
                questions.push({
                    type: 'number',
                    name: validator.pubkey,
                    message: `Allocation for ${validator.name} (${validator.pubkey.substring(0, 10)}...):`,
                    default: currentAllocation,
                    validate: input => {
                        const value = parseFloat(input);
                        const currentTotal = Object.values(allocations)
                            .reduce((sum, a) => sum + a, 0) - (allocations[validator.pubkey] || 0);
                        
                        if (isNaN(value)) {
                            return 'Please enter a valid number';
                        }
                        
                        if (value < 0 || value > 100) {
                            return 'Allocation must be between 0 and 100';
                        }
                        
                        if (value + currentTotal > 100) {
                            return `Total allocation cannot exceed 100%. Current total: ${currentTotal}%`;
                        }
                        
                        return true;
                    }
                });
            }
            
            // Use inquirer to gather all allocations
            const answers = await inquirer.prompt(questions);
            
            // Update allocations and calculate total
            totalAllocated = 0;
            for (const pubkey in answers) {
                allocations[pubkey] = parseFloat(answers[pubkey]);
                totalAllocated += allocations[pubkey];
            }
            
            // Calculate the allocation for the last validator
            const lastValidator = sortedValidators[sortedValidators.length - 1];
            if (lastValidator && lastValidator.pubkey) {
                const lastAllocation = Math.max(0, 100 - totalAllocated).toFixed(2);
                allocations[lastValidator.pubkey] = parseFloat(lastAllocation);
                console.log(`\nAutomatic allocation for ${lastValidator.name}: ${lastAllocation}%`);
            } else if (lastValidator) {
                console.log(`\nWarning: Last validator "${lastValidator.name}" has no pubkey and will be skipped.`);
            }
            
            await showAllocationSummary(validators, allocations);
        }
        
        // Save preferences
        await this.redelegationManager.setUserPreferences(walletAddress, validators, allocations);
        console.log(`\nValidator selection and allocation preferences saved successfully.`);
        await this.uiHandler.pause();
        
        // Helper function to show allocation summary and get confirmation
        async function showAllocationSummary(validators, allocations) {
            console.log("\nAllocation Summary:");
            console.log("═════════════════════════════════════════");
            
            // Display in a table
            console.log(` VALIDATOR                      | ALLOCATION | PUBKEY`);
            console.log(`────────────────────────────────┼───────────┼───────────`);
            
            // Sort validators alphabetically
            const sortedValidators = [...validators].sort((a, b) => {
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });
            
            let totalAllocation = 0;
            for (const validator of sortedValidators) {
                // Skip validators without pubkeys
                if (!validator.pubkey) {
                    continue;
                }
                
                const allocation = allocations[validator.pubkey] || 0;
                totalAllocation += allocation;
                
                // Format validator name to fit
                let name = validator.name;
                if (name.length > 30) {
                    name = name.substring(0, 27) + '...';
                } else {
                    name = name.padEnd(30, ' ');
                }
                
                const pubkeyDisplay = validator.pubkey ? validator.pubkey.substring(0, 6) + '...' : 'No pubkey';
                console.log(`${name} | ${allocation.toString().padStart(3)}% | ${pubkeyDisplay}`);
            }
            
            console.log(`────────────────────────────────┼───────────┼───────────`);
            console.log(`TOTAL                           | ${totalAllocation}% |`);
            
            return true;
        }
    }
    
    /**
     * Flow for updating validators list from validator file
     */
    async updateValidatorsFlow() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("UPDATE VALIDATORS");
        
        console.log(`\nUpdating validator list...`);
        
        this.uiHandler.startProgress(100, "Updating validator list...");
        
        // Use the RedelegationManager's updateValidatorsFromNetwork method
        const result = await this.redelegationManager.updateValidatorsFromNetwork();
        this.uiHandler.stopProgress();
        
        if (result.success) {
            console.log(`\nValidator list processed successfully. Found ${result.count} validators.`);
        } else {
            console.log(`\nFailed to process validators: ${result.message}`);
            console.log(`\nTo update validators from GitHub, use the main menu's "Check Rewards" option,`);
            console.log(`then select "Update Metadata from GitHub".`);
        }
        
        await this.uiHandler.pause();
    }
}

module.exports = MenuManager;