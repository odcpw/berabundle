// menuManager.js - Manages menu navigation and user flows
const config = require('../../config');
const { ErrorHandler } = require('../../utils/errorHandler');
const fs = require('fs').promises;
const path = require('path');
const inquirer = require('inquirer');
const { OutputFormat } = require('../../bundles/claims/claimBundler');
const MetadataFetcher = require('../../utils/metadataFetcher');

/**
 * Manages all menu flows and user interactions
 */
class MainMenu {
    constructor(app) {
        this.app = app;
        this.uiHandler = app.uiHandler;
        this.progressTracker = app.progressTracker;
        
        // Repositories
        this.walletRepository = app.walletRepository;
        this.apiKeyRepository = app.apiKeyRepository;
        this.preferencesRepository = app.preferencesRepository;
        this.bundleRepository = app.bundleRepository;
        
        // Core components
        this.bundleCreator = app.bundleCreator;
        this.eoaExecutor = app.eoaExecutor;
        this.safeExecutor = app.safeExecutor;
        
        // Temporary backwards compatibility
        this.walletService = app.walletRepository;
        
        // Get services with fallbacks
        this.claimBundler = app && app.bundleCreator ? app.bundleCreator : null;
        this.redelegationManager = app && app.redelegationManager ? app.redelegationManager : null;
        
        // Initialize token services directly from bundleCreator to avoid fallbacks later
        if (app && app.bundleCreator && app.bundleCreator.getSwapBundler) {
            if (!app.tokenSwapper) {
                console.log("Initializing token services during constructor...");
                app.tokenSwapper = app.bundleCreator.getSwapBundler();
                app.tokenService = app.tokenSwapper.tokenService;
            }
            this.tokenService = app.tokenService;
            this.tokenSwapper = app.tokenSwapper;
        } else {
            this.tokenService = app && app.tokenService ? app.tokenService : null;
            this.tokenSwapper = app && app.tokenSwapper ? app.tokenSwapper : null;
        }
        
        // Flag for services that need initialization
        this.needsServiceInit = true;
        
        // Metadata fetcher utility
        this.metadataFetcher = new MetadataFetcher();
        
        // Set up rewardChecker with fallback
        if (app && app.rewardChecker) {
            this.rewardChecker = app.rewardChecker;
            console.log("Using rewardChecker from app");
        } else if (app && app.bundleCreator && app.bundleCreator.getClaimBundler) {
            try {
                // Try to get it from the ClaimBundler
                const claimBundler = app.bundleCreator.getClaimBundler();
                if (claimBundler && claimBundler.rewardChecker) {
                    this.rewardChecker = claimBundler.rewardChecker;
                    console.log("Successfully obtained rewardChecker from ClaimBundler");
                } else {
                    throw new Error("RewardChecker not available in ClaimBundler");
                }
            } catch (error) {
                // Create a fallback rewardChecker if not available
                console.log("Creating a new RewardChecker instance");
                const { ethers } = require('ethers');
                const RewardChecker = require('../../bundles/claims/rewardChecker');
                const provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
                this.rewardChecker = new RewardChecker(provider);
            }
        } else {
            // Create a new instance directly
            console.log("Creating a standalone RewardChecker instance");
            const { ethers } = require('ethers');
            const RewardChecker = require('../../bundles/claims/rewardChecker');
            const provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
            this.rewardChecker = new RewardChecker(provider);
        }
        
        // Set up redelegationManager
        if (app && app.redelegationManager) {
            this.redelegationManager = app.redelegationManager;
            console.log("Using redelegationManager from app");
        } else if (app && app.bundleCreator && app.bundleCreator.getBoostBundler) {
            try {
                // Get it from the bundleCreator
                this.redelegationManager = app.bundleCreator.getBoostBundler();
                console.log("Successfully obtained RedelegationManager from bundleCreator");
            } catch (error) {
                console.log(`⚠️ Error getting RedelegationManager from bundleCreator: ${error.message}`);
            }
        } else {
            // Try to initialize proper RedelegationManager
            try {
                const RedelegationManager = require('../../bundles/boosts/boostBundler');
                
                // Create a new instance with a new provider
                const ethers = require('ethers');
                const provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
                
                this.redelegationManager = new RedelegationManager(provider);
                this.needsRedelegationManagerInit = true;
                console.log("Created new RedelegationManager instance with explicit provider");
            } catch (error) {
                console.log(`⚠️ Could not initialize RedelegationManager: ${error.message}`);
            }
        }
    }

    /**
     * Main menu handler
     */
    async mainMenu() {
        // Initialize redelegationManager if needed
        if (this.needsRedelegationManagerInit && this.redelegationManager && this.redelegationManager.initialize) {
            try {
                console.log("Initializing RedelegationManager...");
                
                // Make sure provider is initialized if using app's provider
                if (this.app && this.app.getProvider && this.redelegationManager.provider === undefined) {
                    this.redelegationManager.provider = this.app.getProvider();
                    console.log("Updated RedelegationManager with provider from app");
                }
                
                const initResult = await this.redelegationManager.initialize();
                
                if (initResult) {
                    console.log("RedelegationManager initialized successfully");
                } else {
                    console.warn("Warning: RedelegationManager initialization returned false");
                }
            } catch (error) {
                console.warn(`Warning: RedelegationManager initialization failed: ${error.message}`);
            }
            this.needsRedelegationManagerInit = false;
        }
        
        // Try to get or create ClaimBundler if not available
        if (!this.claimBundler) {
            // First, try to get it from bundleCreator if available
            if (this.app && this.app.bundleCreator && this.app.bundleCreator.getClaimBundler) {
                try {
                    console.log("Getting ClaimBundler from bundleCreator...");
                    this.claimBundler = this.app.bundleCreator.getClaimBundler();
                    console.log("Successfully obtained ClaimBundler from bundleCreator");
                } catch (error) {
                    console.warn(`Warning: Failed to get ClaimBundler from bundleCreator: ${error.message}`);
                }
            }
            
            // If still not available, create a new instance
            if (!this.claimBundler) {
                try {
                    console.log("Creating new ClaimBundler instance...");
                    const { ClaimBundler } = require('../../bundles/claims/claimBundler');
                    
                    // Create a new provider explicitly
                    const ethers = require('ethers');
                    const provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
                    
                    this.claimBundler = new ClaimBundler(provider);
                    console.log("ClaimBundler initialized successfully with explicit provider");
                } catch (error) {
                    console.warn(`Warning: Failed to create new ClaimBundler: ${error.message}`);
                }
            }
        }
        
        while (true) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("BERABUNDLE");

            const options = this.uiHandler.createMenuOptions([
                // Function section - the most important at the top
                { key: '1', label: 'Claim Rewards', value: 'claim' },
                { key: '2', label: 'Token Balances & Swap', value: 'tokens' },
                { key: '3', label: 'Send Bundle', value: 'send' },
                
                // Spacer
                { key: '', label: '', value: 'spacer' },
                
                // Setup options (without the header that confuses users)
                { key: '4', label: 'Update Metadata', value: 'update_metadata' },
                { key: '5', label: 'Setup Wallets', value: 'wallets' },
                { key: '6', label: 'Setup Validator Boosting', value: 'validators' },
                { key: '7', label: 'Configure API Keys', value: 'api_keys' }
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
                case 'tokens':
                    await this.tokenBalancesMenu();
                    break;
                case 'send':
                    await this.sendBundleMenu();
                    break;
                case 'updateTokens':
                    await this.updateTokenListMenu();
                    break;
                case 'update_metadata':
                    await this.updateMetadataMenu();
                    break;
                case 'api_keys':
                    await this.apiKeysMenu();
                    break;
                case 'spacer':
                case 'spacer2':
                    // Do nothing for spacers
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
        
        // Try to get or create ClaimBundler if not available
        if (!this.claimBundler) {
            // First, try to get it from bundleCreator if available
            if (this.app && this.app.bundleCreator && this.app.bundleCreator.getClaimBundler) {
                try {
                    console.log("Getting ClaimBundler from bundleCreator...");
                    this.claimBundler = this.app.bundleCreator.getClaimBundler();
                    console.log("Successfully obtained ClaimBundler from bundleCreator");
                } catch (error) {
                    console.log(`❌ Error: Failed to get ClaimBundler from bundleCreator: ${error.message}`);
                }
            }
            
            // If still not available, create a new instance
            if (!this.claimBundler) {
                try {
                    console.log("Creating new ClaimBundler instance...");
                    const { ClaimBundler } = require('../../bundles/claims/claimBundler');
                    const provider = this.app && this.app.getProvider ? this.app.getProvider() : null;
                    
                    if (provider) {
                        this.claimBundler = new ClaimBundler(provider);
                        console.log("ClaimBundler initialized successfully");
                    } else {
                        console.log("❌ Error: Cannot initialize ClaimBundler - no provider available");
                        console.log("Please restart the application and try again.");
                        await this.uiHandler.pause();
                        return;
                    }
                } catch (error) {
                    console.log(`❌ Error: Failed to create new ClaimBundler: ${error.message}`);
                    console.log("Please make sure you have the latest version of the application.");
                    await this.uiHandler.pause();
                    return;
                }
            }
        }

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

        // Check if rewardChecker is available
        if (!this.rewardChecker) {
            console.log("❌ Error: Reward checker is not available.");
            await this.uiHandler.pause();
            return;
        }

        // Check rewards first
        this.uiHandler.startProgress(100, "Checking for claimable rewards...");

        let claimableRewards = [];
        
        try {
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
            claimableRewards = rewards.filter(item =>
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
        } catch (error) {
            this.uiHandler.stopProgress();
            console.log(`\n❌ Error checking rewards: ${error.message}`);
            await this.uiHandler.pause();
            return;
        }

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
        
        // Check if redelegationManager is available
        if (!this.redelegationManager) {
            console.log("\n⚠️ Redelegation manager is not available. Skipping delegation preferences.");
            // Continue without redelegation
        } else {
            try {
                // Check if wallet has delegation preferences
                const userPrefs = this.redelegationManager.getUserPreferences(address);
                const hasValidPrefs = userPrefs && userPrefs.validators && userPrefs.validators.length > 0;
                
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
                        if (updatedPrefs && updatedPrefs.validators && updatedPrefs.validators.length > 0) {
                            includeRedelegation = await this.uiHandler.confirm(
                                "\nWould you like to redelegate your BGT rewards to these validators?"
                            );
                        }
                    }
                }
            } catch (error) {
                console.log(`\n⚠️ Error accessing delegation preferences: ${error.message}`);
                console.log("Continuing without redelegation");
            }
        }

        // Step 4: Select transaction format and execution option
        // We can't reliably detect wallet type just based on private key presence
        // The user might be using a hardware wallet, watch-only EOA, or other non-Safe wallet
        console.log("\nSelect transaction format and execution option:");
        const formatOptions = this.uiHandler.createMenuOptions([
            { key: '1', label: 'EOA Wallet (JSON only)', value: { format: OutputFormat.EOA, execute: false } },
            { key: '2', label: 'EOA Wallet (JSON + Execute)', value: { format: OutputFormat.EOA, execute: true } },
            { key: '3', label: 'Safe Multisig (JSON only)', value: { format: OutputFormat.SAFE_UI, execute: false } },
            { key: '4', label: 'Safe Multisig (JSON + Propose & Sign)', value: { format: OutputFormat.SAFE_UI, execute: true } }
        ], true, false);

        this.uiHandler.displayMenu(formatOptions);
        const formatChoiceObj = await this.uiHandler.getSelection(formatOptions);
        
        // Extract format and execute flag
        const formatChoice = formatChoiceObj.format;
        const shouldExecute = formatChoiceObj.execute;

        // Check if claimBundler is available
        if (!this.claimBundler) {
            console.log("\n❌ Error: Claim bundler service is not available.");
            console.log("Please restart the application and try again.");
            await this.uiHandler.pause();
            return;
        }

        // Generate the claim bundle
        console.log("\nGenerating claim bundle...");
        let bundle;
        
        try {
            bundle = await this.claimBundler.generateClaimBundle(
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
        } catch (error) {
            console.log(`\n❌ Error generating claim bundle: ${error.message}`);
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
        
        // Display information based on wallet type and execute option
        console.log(`\nClaim bundle saved to ${bundle.filepath}`);
        
        if (shouldExecute) {
            // Check if transactionService is available
            if (!this.app || !this.app.transactionService) {
                console.log("\n❌ Error: Transaction service is not available.");
                console.log("Bundle has been saved but cannot be executed at this time.");
                await this.uiHandler.pause();
                return;
            }
            
            try {
                // User selected an execution option
                if (formatChoice === OutputFormat.EOA) {
                    // For EOA wallets - execute immediately
                    console.log("\nExecuting transactions with your private key...");
                    await this.app.transactionService.signAndSendBundleFlow(bundle);
                } else {
                    // For Safe wallets - propose and sign
                    console.log("\nProposing and signing transactions for Safe...");
                    await this.app.transactionService.signAndSendBundleFlow(bundle);
                }
            } catch (error) {
                console.log(`\n❌ Error executing transactions: ${error.message}`);
            }
        } else {
            // JSON only option - just provide instructions
            if (formatChoice === OutputFormat.EOA) {
                // For EOA wallets
                console.log("\nThe transaction bundle has been saved as JSON only. You can:");
                console.log("1. Use this file later with the 'Send Bundle' option from the main menu");
                console.log("2. Import it into your wallet of choice that supports batch transactions");
            } else {
                // For Safe wallets - show Safe Transaction Builder instructions
                if (bundle.safeInstructions) {
                    console.log(`\n📋 Instructions to import transactions into Safe:`);
                    bundle.safeInstructions.instructions.forEach(instruction => {
                        console.log(instruction);
                    });
                    console.log(`5. Select the saved file at:\n   ${bundle.filepath}`);
                } else {
                    // Fallback if safeInstructions not available
                    console.log(`\nTo use this file with Safe:
1. Go to https://app.safe.global/home?safe=ber:${recipient}
2. Click "New Transaction" > "Transaction Builder"
3. Click "Load" and select the generated file at:
   ${bundle.filepath}`);
                }
            }
        }

        await this.uiHandler.pause();
    }

    /**
     * Validator delegation menu
     * @param {string} preselectedAddress - Optional address to preselect
     */
    async validatorMenu(preselectedAddress = null) {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("VALIDATOR DELEGATION");
        
        // Try to initialize RedelegationManager if it doesn't exist
        if (!this.redelegationManager) {
            try {
                console.log("Initializing RedelegationManager...");
                const RedelegationManager = require('../../bundles/boosts/boostBundler');
                const provider = this.app && this.app.getProvider ? this.app.getProvider() : null;
                
                if (provider) {
                    this.redelegationManager = new RedelegationManager(provider);
                    this.needsRedelegationManagerInit = true;
                } else {
                    console.log("\n❌ Error: Cannot initialize RedelegationManager. No provider available.");
                    console.log("Please restart the application and try again.");
                    await this.uiHandler.pause();
                    return;
                }
            } catch (error) {
                console.log(`\n❌ Error: Cannot initialize RedelegationManager: ${error.message}`);
                console.log("Please make sure you have the latest version of the application.");
                await this.uiHandler.pause();
                return;
            }
        }
        
        // Initialize redelegationManager if needed
        if (this.needsRedelegationManagerInit && this.redelegationManager && this.redelegationManager.initialize) {
            try {
                console.log("Initializing RedelegationManager...");
                await this.redelegationManager.initialize();
                console.log("RedelegationManager initialized successfully");
                this.needsRedelegationManagerInit = false;
            } catch (error) {
                console.log(`\n❌ Error: RedelegationManager initialization failed: ${error.message}`);
                console.log("Please restart the application and try again.");
                await this.uiHandler.pause();
                return;
            }
        }
        
        // Check if redelegationManager is still not available
        if (!this.redelegationManager) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("VALIDATOR DELEGATION");
            console.log("\n❌ Error: Validator delegation service is not available.");
            console.log("This feature requires the delegation manager component to be properly initialized.");
            await this.uiHandler.pause();
            return;
        }
        
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
            
            try {
                // Get current preferences
                const userPrefs = this.redelegationManager.getUserPreferences(walletAddress);
                
                // Show current validator preferences if any exist
                if (userPrefs && userPrefs.validators && userPrefs.validators.length > 0) {
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
            } catch (error) {
                console.log(`\n❌ Error working with validator preferences: ${error.message}`);
                await this.uiHandler.pause();
                return;
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
        
        // Check if RewardChecker is available
        if (!this.rewardChecker) {
            console.log("\n❌ Error: RewardChecker service is not available.");
            console.log("This feature requires the RewardChecker component to be properly initialized.");
            await this.uiHandler.pause();
            return;
        }
        
        // Check if RedelegationManager is available
        if (!this.redelegationManager) {
            console.log("\n❌ Error: RedelegationManager service is not available.");
            console.log("This feature requires the RedelegationManager component to be properly initialized.");
            await this.uiHandler.pause();
            return;
        }
        
        console.log(`\nUpdating validator list from GitHub...`);
        this.uiHandler.startProgress(100, "Fetching validator data from GitHub...");
        
        try {
            // First step: Use RewardChecker to update validators from GitHub
            const githubSuccess = await this.rewardChecker.updateValidators();
            
            if (!githubSuccess) {
                this.uiHandler.stopProgress();
                console.log("\n❌ Error: Failed to update validators from GitHub.");
                console.log("Please check your internet connection and try again.");
                await this.uiHandler.pause();
                return;
            }
            
            // Second step: Update validators in RedelegationManager
            this.uiHandler.updateProgress(50, "Loading validators into RedelegationManager...");
            const result = await this.redelegationManager.updateValidatorsFromNetwork();
            
            this.uiHandler.stopProgress();
            
            if (result && result.success) {
                console.log(`\n✅ Validator list updated successfully. Found ${result.count} validators.`);
                
                // Show a preview of the validators
                const validators = this.redelegationManager.getValidators();
                if (validators && validators.length > 0) {
                    console.log("\nHere are some of the validators available:");
                    console.log("─────────────────────────────────────────────────");
                    
                    // Show up to 5 validators
                    const previewCount = Math.min(5, validators.length);
                    for (let i = 0; i < previewCount; i++) {
                        const validator = validators[i];
                        console.log(`${i+1}. ${validator.name} (${validator.pubkey ? validator.pubkey.substring(0, 10) + '...' : 'No pubkey'})`);
                    }
                    
                    if (validators.length > previewCount) {
                        console.log(`... and ${validators.length - previewCount} more validators`);
                    }
                }
            } else {
                console.log(`\n❌ Error: Failed to process validators: ${result ? result.message : 'Unknown error'}`);
                console.log("Please try again or check the application logs for more information.");
            }
        } catch (error) {
            this.uiHandler.stopProgress();
            console.log(`\n❌ Error updating validators: ${error.message}`);
            console.log("Please try again later or check your internet connection.");
        }
        
        await this.uiHandler.pause();
    }

    /**
     * Update token list menu
     */
    async updateTokenListMenu() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("UPDATE TOKEN LIST");
        
        console.log("\nUpdating token list from OogaBooga API...");
        
        // Check if OogaBooga API key is configured
        let oogaboogaKey = null;
        
        // Try from apiKeyRepository first
        if (this.app && this.app.apiKeyRepository) {
            oogaboogaKey = this.app.apiKeyRepository.getApiKey('oogabooga');
        }
        
        // If not found, try from our fallback mechanism
        if (!oogaboogaKey) {
            oogaboogaKey = this.metadataFetcher.getOrSetApiKey();
        }
        
        if (!oogaboogaKey) {
            console.log("\n❌ OogaBooga API key is not configured.");
            console.log("\nPlease configure your API key in the 'Configure API Keys' menu first.");
            await this.uiHandler.pause();
            return;
        }
        
        this.uiHandler.startProgress(100, "Fetching token data...");
        
        // Use our new metadata fetcher
        const result = await this.metadataFetcher.fetchOogaboogaTokens(oogaboogaKey);
        
        this.uiHandler.stopProgress();
        
        if (result.success) {
            console.log(`\n✓ Token list updated successfully! (${result.count} tokens)`);
        } else {
            console.log(`\n✗ Failed to update token list: ${result.message}`);
            console.log("\nThis could be due to API issues.");
            
            if (!oogaboogaKey) {
                console.log("Please set your API key using the 'Configure API Keys' menu option.");
            } else {
                console.log("Please verify your API key is correct in the 'Configure API Keys' menu.");
            }
        }
        
        await this.uiHandler.pause();
    }

    /**
     * Token balances menu
     */
    async tokenBalancesMenu() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("TOKEN BALANCES & SWAP");

        // Initialize tokenSwapper on first access if not already available
        if (!this.tokenSwapper && this.app && this.app.bundleCreator && this.app.bundleCreator.getSwapBundler) {
            this.tokenSwapper = this.app.bundleCreator.getSwapBundler();
        }
        
        // Check if tokenSwapper is available
        if (!this.tokenSwapper) {
            console.log("\n❌ Error: Token service is not available.");
            console.log("Please restart the application and try again.");
            await this.uiHandler.pause();
            return;
        }

        // Get wallets
        const wallets = this.walletService.getWallets();
        const walletEntries = Object.entries(wallets);

        if (walletEntries.length === 0) {
            console.log("\nNo wallets found. Please add a wallet first.");
            await this.uiHandler.pause();
            return;
        }

        // Display wallet options as part of the menu
        console.log("\nSelect Wallet:");
        
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
        
        try {
            await this.tokenSwapper.displayTokenBalances(address, name);
        } catch (error) {
            console.log(`\n❌ Error displaying token balances: ${error.message}`);
            console.log("This could be due to a service initialization issue.");
            await this.uiHandler.pause();
        }
    }

    /**
     * Update Metadata Menu
     * Provides options to update different types of metadata
     */
    async updateMetadataMenu() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("UPDATE METADATA");

        // Show metadata update options
        const options = this.uiHandler.createMenuOptions([
            { key: '1', label: 'Update All Metadata (Vaults, Validators, All Tokens)', value: 'all' },
            { key: '2', label: 'Update Token List from OogaBooga API', value: 'tokens' },
            { key: '3', label: 'Update Vaults, Validators & Tokens from GitHub', value: 'vaults_validators' }
        ], true, false);

        this.uiHandler.displayMenu(options);
        this.uiHandler.displayFooter();

        const choice = await this.uiHandler.getSelection(options);

        if (choice === 'back' || choice === 'quit') {
            return choice === 'quit' ? process.exit(0) : undefined;
        }

        switch (choice) {
            case 'all':
                // Update all metadata
                this.uiHandler.clearScreen();
                this.uiHandler.displayHeader("UPDATE ALL METADATA");
                
                console.log("\nUpdating all metadata (vaults, validators, tokens)...");
                
                // First update validators and vaults from GitHub
                this.uiHandler.startProgress(100, "Updating metadata from GitHub...");
                const githubResult = await this.metadataFetcher.fetchAllGithubMetadata(true);
                this.uiHandler.stopProgress();
                
                if (githubResult.success) {
                    console.log("\n✓ Github metadata updated successfully!");
                    console.log(`  - Validators: ${githubResult.validators.count} records`);
                    console.log(`  - Vaults: ${githubResult.vaults.count} records`);
                    console.log(`  - Token definitions: ${githubResult.tokens.count} records`);
                } else {
                    console.log("\n❌ Github metadata update failed:");
                    console.log(`  - ${githubResult.message}`);
                }
                
                // Get OogaBooga API key
                console.log("\nNow updating token list from OogaBooga API...");
                // Try to get API key from multiple sources
                let oogaboogaKey = null;
                
                // Try from apiKeyRepository first
                if (this.app && this.app.apiKeyRepository) {
                    oogaboogaKey = this.app.apiKeyRepository.getApiKey('oogabooga');
                }
                
                // If not found, try from our fallback mechanism
                if (!oogaboogaKey) {
                    oogaboogaKey = this.metadataFetcher.getOrSetApiKey();
                }
                
                if (!oogaboogaKey) {
                    console.log("\n❌ OogaBooga API key is not configured.");
                    console.log("\nSkipping token list update. Please configure your API key in the 'Configure API Keys' menu.");
                    await this.uiHandler.pause();
                    return;
                }
                
                // Update tokens from OogaBooga API
                this.uiHandler.startProgress(100, "Fetching token data from OogaBooga API...");
                const oogaboogaResult = await this.metadataFetcher.fetchOogaboogaTokens(oogaboogaKey);
                this.uiHandler.stopProgress();
                
                if (oogaboogaResult.success) {
                    console.log(`\n✓ OogaBooga token data updated successfully! (${oogaboogaResult.count} tokens)`);
                } else {
                    console.log("\n❌ OogaBooga token data update failed:");
                    console.log(`  - ${oogaboogaResult.message}`);
                    
                    if (!oogaboogaKey) {
                        console.log("  - Please set your API key using the 'Configure API Keys' menu option.");
                    } else {
                        console.log("  - Please verify your API key is correct in the 'Configure API Keys' menu.");
                    }
                }
                
                await this.uiHandler.pause();
                break;
                
            case 'tokens':
                // Just update tokens using the OogaBooga API
                this.uiHandler.clearScreen();
                this.uiHandler.displayHeader("UPDATE TOKEN DATA FROM OOGABOOGA");
                
                console.log("\nUpdating token list from OogaBooga API...");
                
                // Get OogaBooga API key
                let apiKey = null;
                
                // Try from apiKeyRepository first
                if (this.app && this.app.apiKeyRepository) {
                    apiKey = this.app.apiKeyRepository.getApiKey('oogabooga');
                }
                
                // If not found, try from our fallback mechanism
                if (!apiKey) {
                    apiKey = this.metadataFetcher.getOrSetApiKey();
                }
                
                if (!apiKey) {
                    console.log("\n❌ OogaBooga API key is not configured.");
                    console.log("\nPlease configure your API key in the 'Configure API Keys' menu first.");
                    await this.uiHandler.pause();
                    return;
                }
                
                // Update tokens from OogaBooga API
                this.uiHandler.startProgress(100, "Fetching token data...");
                const tokenResult = await this.metadataFetcher.fetchOogaboogaTokens(apiKey);
                this.uiHandler.stopProgress();
                
                if (tokenResult.success) {
                    console.log(`\n✓ Token data updated successfully! (${tokenResult.count} tokens)`);
                } else {
                    console.log(`\n❌ Token data update failed: ${tokenResult.message}`);
                    
                    if (!apiKey) {
                        console.log("Please set your API key using the 'Configure API Keys' menu option.");
                    } else {
                        console.log("Please verify your API key is correct in the 'Configure API Keys' menu.");
                    }
                }
                
                await this.uiHandler.pause();
                break;
                
            case 'vaults_validators':
                // Update vaults, validators, and GitHub token list
                this.uiHandler.clearScreen();
                this.uiHandler.displayHeader("UPDATE GITHUB METADATA");
                
                console.log("\nUpdating vaults, validators, and tokens from GitHub...");
                
                this.uiHandler.startProgress(100, "Fetching data from GitHub...");
                const result = await this.metadataFetcher.fetchAllGithubMetadata(true);
                this.uiHandler.stopProgress();
                
                if (result.success) {
                    console.log("\n✓ GitHub metadata updated successfully!");
                    console.log(`  - Downloaded ${result.validators.count} validators`);
                    console.log(`  - Downloaded ${result.vaults.count} vaults`);
                    console.log(`  - Downloaded ${result.tokens.count} token definitions`);
                } else {
                    console.log(`\n❌ GitHub metadata update failed: ${result.message}`);
                }
                
                await this.uiHandler.pause();
                break;
        }
    }
    
    /**
     * API Keys configuration menu
     */
    async apiKeysMenu() {
        while (true) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("API KEYS CONFIGURATION");
            
            // Get current API keys
            let oogaboogaKey = null;
            
            // Try from apiKeyRepository first
            if (this.app && this.app.apiKeyRepository) {
                oogaboogaKey = this.app.apiKeyRepository.getApiKey('oogabooga');
            }
            
            // If not found, try from our fallback mechanism
            if (!oogaboogaKey) {
                oogaboogaKey = this.metadataFetcher.getOrSetApiKey();
            }
            
            // Display current API keys
            console.log("\nCurrent API Keys:");
            console.log("═════════════════════════════════════════════════════════");
            
            // OogaBooga API key
            console.log(`OogaBooga API: ${oogaboogaKey ? '✅ Configured' : '❌ Not configured'}`);
            
            console.log("═════════════════════════════════════════════════════════");
            
            const options = this.uiHandler.createMenuOptions([
                { key: '1', label: 'Set OogaBooga API Key', value: 'set_oogabooga' },
                { key: '2', label: 'Remove OogaBooga API Key', value: 'remove_oogabooga' },
                // Add more API key options here as needed
            ], true, false);
            
            this.uiHandler.displayMenu(options);
            const choice = await this.uiHandler.getSelection(options);
            
            if (choice === 'back') {
                return;
            }
            
            if (choice === 'quit') {
                process.exit(0);
            }
            
            switch (choice) {
                case 'set_oogabooga':
                    await this.setOogaBoogaApiKeyFlow();
                    break;
                case 'remove_oogabooga':
                    await this.removeOogaBoogaApiKeyFlow();
                    break;
            }
        }
    }
    
    /**
     * Flow for setting the OogaBooga API key
     */
    async setOogaBoogaApiKeyFlow() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("SET OOGABOOGA API KEY");
        
        // Information about the API key
        console.log("\nℹ️  The OogaBooga API key is required for token price lookup and swap functionality.");
        console.log("Learn more at https://docs.oogabooga.io/api");
        
        // Ask for API key
        const apiKey = await this.uiHandler.getUserInput(
            "\nEnter OogaBooga API key:",
            input => input.trim().length > 0,
            "API key cannot be empty"
        );
        
        // Save the API key
        let success = false;
        
        // Try using the apiKeyManager first
        if (this.app && this.app.apiKeyRepository) {
            success = await this.app.apiKeyRepository.setApiKey('oogabooga', apiKey);
        }
        
        // If that fails, use our fallback mechanism
        if (!success) {
            console.log("\nℹ️ API key manager not available, using local storage instead.");
            this.metadataFetcher.getOrSetApiKey(apiKey);
            success = true;
        }
        
        if (success) {
            console.log("\n✅ OogaBooga API key saved successfully!");
            
            // Test the key by trying to fetch token metadata
            console.log("\nTesting API key...");
            try {
                const result = await this.metadataFetcher.fetchOogaboogaTokens(apiKey);
                if (result.success) {
                    console.log(`\n✅ API key is working! Successfully fetched ${result.count} tokens.`);
                } else {
                    console.log(`\n⚠️ Could not verify API key: ${result.message}`);
                    console.log("The key has been saved, but may not be valid or may not have the correct permissions.");
                }
            } catch (error) {
                console.log(`\n⚠️ Could not verify API key: ${error.message}`);
                console.log("The key has been saved, but may not be valid or may not have the correct permissions.");
            }
        } else {
            console.log("\n❌ Failed to save API key.");
        }
        
        await this.uiHandler.pause();
    }
    
    /**
     * Flow for removing the OogaBooga API key
     */
    async removeOogaBoogaApiKeyFlow() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("REMOVE OOGABOOGA API KEY");
        
        // Check if there's an API key to remove (from any source)
        let hasApiKey = false;
        
        // Check if we have a key in the repository
        if (this.app && this.app.apiKeyRepository) {
            hasApiKey = !!this.app.apiKeyRepository.getApiKey('oogabooga');
        }
        
        // Check if we have a key in our fallback
        if (!hasApiKey) {
            hasApiKey = !!this.metadataFetcher.getOrSetApiKey();
        }
        
        if (!hasApiKey) {
            console.log("\nNo OogaBooga API key is currently configured.");
            await this.uiHandler.pause();
            return;
        }
        
        // Confirm removal
        const confirmRemoval = await this.uiHandler.confirm(
            "\nAre you sure you want to remove the OogaBooga API key? This will disable token price lookup and swap functionality."
        );
        
        if (!confirmRemoval) {
            return;
        }
        
        // Remove the API key
        let success = false;
        
        // Try to remove from the repository first
        if (this.app && this.app.apiKeyRepository) {
            success = await this.app.apiKeyRepository.removeApiKey('oogabooga');
        }
        
        // Also clear our fallback
        this.metadataFetcher.getOrSetApiKey(''); // Set to empty string to clear
        success = true;
        
        if (success) {
            console.log("\n✅ OogaBooga API key removed successfully.");
        } else {
            console.log("\n❌ Failed to remove API key.");
        }
        
        await this.uiHandler.pause();
    }
}

module.exports = MainMenu;