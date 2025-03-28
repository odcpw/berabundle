// BeraBundle.js -  main application
const { ethers } = require('ethers');
const config = require('./config');
const WalletService = require('./walletService');
const UIHandler = require('./uiHandler');
const RewardChecker = require('./rewardChecker');
const { ClaimBundler, OutputFormat } = require('./claimBundler');
const { ErrorHandler } = require('./errorHandler');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Main BeraBundle application class
 */
class BeraBundle {
    constructor() {
        // Initialize provider
        this.provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);

        // Initialize services
        this.walletService = new WalletService(this.provider);
        this.uiHandler = new UIHandler();
        this.rewardChecker = new RewardChecker(this.provider);
        this.claimBundler = new ClaimBundler(this.provider);
    }

    /**
     * Initialize the application
     */
    async initialize() {
        try {
            // Initialize wallet service
            await this.walletService.initialize();
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'BeraBundle.initialize', true);
            return false;
        }
    }

    /**
     * Main application loop
     */
    async main() {
        // Initialize first
        await this.initialize();

        while (true) {
            this.uiHandler.clearScreen();
            this.uiHandler.displayHeader("BERACHAIN BUNDLE");

            const options = [
                { key: '1', label: 'Wallets', value: 'wallets' },
                { key: '2', label: 'Check Rewards', value: 'check' },
                { key: '3', label: 'Claim All Rewards', value: 'claim' },
                { key: '4', label: 'Exit', value: 'exit' }
            ];

            this.uiHandler.displayMenu(options);
            this.uiHandler.displayFooter();

            const choice = await this.uiHandler.getSelection(options);

            switch (choice) {
                case 'wallets':
                    await this.walletMenu();
                    break;
                case 'check':
                    await this.checkRewardsMenu();
                    break;
                case 'claim':
                    await this.claimRewardsMenu();
                    break;
                case 'exit':
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
            const options = [
                { key: '1', label: 'Add Wallet', value: 'add' },
                { key: '2', label: 'Remove Wallet', value: 'remove' },
                { key: '3', label: 'Back to Main Menu', value: 'back' }
            ];

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
            input => WalletService.isValidAddress(input),
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
     * Check rewards menu
     */
    async checkRewardsMenu() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("CHECK REWARDS");

        // Display wallets
        const wallets = this.walletService.getWallets();
        const walletEntries = this.uiHandler.displayWallets(wallets);

        if (walletEntries.length === 0) {
            console.log("No wallets found. Please add a wallet first.");
            await this.uiHandler.pause();
            return;
        }

        // Get wallet selection
        const options = [
            ...walletEntries.map(([name, address], index) => ({
                key: (index + 1).toString(),
                                                                  label: `${name} (${address})`,
                                                                  value: { name, address }
            })),
            { key: 'a', label: 'All Wallets', value: 'all' },
            { key: 'b', label: 'Back to Main Menu', value: 'back' }
        ];

        this.uiHandler.displayMenu(options);
        this.uiHandler.displayFooter();

        const choice = await this.uiHandler.getSelection(options);

        if (choice === 'back') {
            return;
        }

        if (choice === 'all') {
            // Check all wallets
            this.uiHandler.clearScreen();
            console.log("Checking rewards for all wallets...\n");

            for (const [name, address] of walletEntries) {
                console.log(`\nWallet: ${name} (${address})`);
                console.log("───────────────────────────────────────");

                this.uiHandler.startProgress(100, `Checking rewards for ${name}...`);

                const result = await this.rewardChecker.checkAllRewards(
                    address, true, false,
                    (current, total, status) => {
                        const percentage = Math.floor((current / total) * 100);
                        this.uiHandler.updateProgress(percentage, status);
                    }
                );

                this.uiHandler.stopProgress();
                console.log(result);
            }
        } else {
            // Check specific wallet
            const { name, address } = choice;

            this.uiHandler.clearScreen();
            console.log(`Checking rewards for ${name} (${address})...\n`);

            this.uiHandler.startProgress(100, "Scanning vaults...");

            const result = await this.rewardChecker.checkAllRewards(
                address, true, false,
                (current, total, status) => {
                    const percentage = Math.floor((current / total) * 100);
                    this.uiHandler.updateProgress(percentage, status);
                }
            );

            this.uiHandler.stopProgress();
            console.log(result);
        }

        await this.uiHandler.pause();
    }

    /**
     * Claim rewards menu
     */
    async claimRewardsMenu() {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("CLAIM REWARDS");

        // Display wallets
        const wallets = this.walletService.getWallets();
        const walletEntries = this.uiHandler.displayWallets(wallets);

        if (walletEntries.length === 0) {
            console.log("No wallets found. Please add a wallet first.");
            await this.uiHandler.pause();
            return;
        }

        // Get wallet selection
        const options = [
            ...walletEntries.map(([name, address], index) => ({
                key: (index + 1).toString(),
                                                                  label: `${name} (${address})`,
                                                                  value: { name, address }
            })),
            { key: 'a', label: 'All Wallets', value: 'all' },
            { key: 'b', label: 'Back to Main Menu', value: 'back' }
        ];

        this.uiHandler.displayMenu(options);
        this.uiHandler.displayFooter();

        const choice = await this.uiHandler.getSelection(options);

        if (choice === 'back') {
            return;
        }

        if (choice === 'all') {
            // Process all wallets
            for (const [name, address] of walletEntries) {
                await this.processClaimForWallet(name, address);
            }
        } else {
            // Process specific wallet
            const { name, address } = choice;
            await this.processClaimForWallet(name, address);
        }
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
            }
        );

        this.uiHandler.stopProgress();

        // Filter rewards that are claimable
        const claimableRewards = rewardInfo.filter(vault =>
        vault.earned && parseFloat(vault.earned) > 0
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
        const recipientOptions = [
            { key: '1', label: 'Same wallet (default)', value: address },
            { key: '2', label: 'Custom address', value: 'custom' }
        ];

        this.uiHandler.displayMenu(recipientOptions);
        const recipientChoice = await this.uiHandler.getSelection(recipientOptions);

        let recipient;
        if (recipientChoice === 'custom') {
            recipient = await this.uiHandler.getUserInput(
                "Enter recipient address:",
                input => WalletService.isValidAddress(input),
                                                                  "Invalid Ethereum address format"
            );
        } else {
            recipient = recipientChoice;
        }

        // Step 3: Select transaction format
        console.log("\nSelect transaction format:");
        const formatOptions = [
            { key: '1', label: 'EOA (Web3 Wallet / CLI)', value: OutputFormat.EOA },
            { key: '2', label: 'Safe SDK / CLI', value: OutputFormat.SAFE_SDK },
            { key: '3', label: 'Safe UI (Tx-Builder)', value: OutputFormat.SAFE_UI }
        ];

        this.uiHandler.displayMenu(formatOptions);
        const formatChoice = await this.uiHandler.getSelection(formatOptions);

        // Step 4: Select output method
        console.log("\nSelect output method:");
        const outputOptions = [
            { key: '1', label: 'Save to file', value: 'file' },
            { key: '2', label: 'Copy to clipboard', value: 'clipboard' },
            { key: '3', label: 'Display in console', value: 'console' },
            { key: '4', label: 'All of the above', value: 'all' }
        ];

        this.uiHandler.displayMenu(outputOptions);
        const outputChoice = await this.uiHandler.getSelection(outputOptions);

        // Generate the claim bundle
        console.log("\nGenerating claim bundle...");
        const bundle = await this.claimBundler.generateClaimBundle(
            claimableRewards,
            address,
            recipient,
            formatChoice,
                name
        );

        if (!bundle.success) {
            console.log(`Error: ${bundle.message}`);
            await this.uiHandler.pause();
            return;
        }

        // Handle output based on user choice
        if (outputChoice === 'file' || outputChoice === 'all') {
            console.log(`\nClaim bundle saved to ${bundle.filepath}`);
        }

        if (outputChoice === 'clipboard' || outputChoice === 'all') {
            try {
                const bundleString = JSON.stringify(bundle.bundleData, null, 2);
                await execPromise(`echo '${bundleString}' | xclip -selection clipboard`);
                console.log("Bundle data copied to clipboard!");
            } catch (error) {
                console.log("Could not copy to clipboard. Please install xclip or use another output method.");
            }
        }

        if (outputChoice === 'console' || outputChoice === 'all') {
            console.log("\nBundle Data:");
            console.log(JSON.stringify(bundle.bundleData, null, 2));
        }

        console.log("\nClaim bundle generated successfully!");
        console.log(`Summary: ${bundle.summary.vaultCount} vaults, ${bundle.summary.totalRewards} total rewards`);

        await this.uiHandler.pause();
    }
}

// Export the BeraBundle class
module.exports = BeraBundle;

// Start the application if run directly
if (require.main === module) {
    const app = new BeraBundle();
    app.main().catch(error => {
        ErrorHandler.handle(error, 'Main application', true);
    });
}
