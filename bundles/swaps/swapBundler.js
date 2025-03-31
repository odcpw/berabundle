/**
 * Swap Bundle Manager - Creates and manages token swap bundles
 * 
 * This module contains:
 * 1. SwapBundler - High-level component initialized with provider
 * 2. TokenSwapper - UI component for displaying balances and swapping
 * 
 * This design bridges between the BundleCreator's initialization pattern
 * (which passes a provider) and the TokenSwapper UI component.
 */

const inquirer = require('inquirer');
const config = require('../../config');
const UIHandler = require('../../ui/common/uiHandler');
const TokenService = require('./tokenChecker');
const { ErrorHandler } = require('../../utils/errorHandler');

/**
 * Swap Bundler - Creates swap bundles and manages the token swap UI
 * 
 * This is a wrapper around TokenSwapper that handles the initialization
 * of all required dependencies from just a provider.
 */
class SwapBundler {
    /**
     * Creates a new SwapBundler instance
     * 
     * @param {ethers.providers.Provider} provider - Ethereum provider for blockchain interactions
     * @param {Object} app - Optional main app instance for access to other services
     */
    constructor(provider, app = null) {
        // Initialize dependencies
        this.provider = provider;
        this.app = app;
        
        // Create TokenService
        this.tokenService = new TokenService(provider, app);
        
        // Ensure the app reference is also available to tokenService
        this.tokenService.app = app;
        
        // Create UI Handler
        this.uiHandler = new UIHandler();
        
        // Get WalletService from app if available
        this.walletService = app && app.walletRepository ? app.walletRepository : null;
        
        // Create TokenSwapper instance with all required dependencies
        this.tokenSwapper = new TokenSwapper(this.uiHandler, this.tokenService, this.walletService);
    }
    
    /**
     * Provides access to the TokenService instance
     * @returns {TokenService} The token service instance
     */
    get tokenService() {
        return this._tokenService;
    }
    
    /**
     * Sets the TokenService instance
     * @param {TokenService} service - The token service to set
     */
    set tokenService(service) {
        this._tokenService = service;
    }
    
    /**
     * Delegates method calls to the underlying TokenSwapper
     * @param {string} method - Method name to call
     * @param {Array} args - Arguments to pass to the method
     * @returns {Promise<any>} Result of the method call
     */
    async _delegateToTokenSwapper(method, ...args) {
        if (!this.tokenSwapper[method]) {
            throw new Error(`Method ${method} not found in TokenSwapper`);
        }
        return this.tokenSwapper[method](...args);
    }
    
    /**
     * Displays token balances and swap UI
     * 
     * @param {string} walletAddress - Wallet address to check
     * @param {string} walletName - Human-readable wallet name
     * @returns {Promise<void>}
     */
    async displayTokenBalances(walletAddress, walletName) {
        return this._delegateToTokenSwapper('displayTokenBalances', walletAddress, walletName);
    }
    
    /**
     * Manages the swap tokens flow - delegate to TokenSwapper
     * 
     * @param {string} walletAddress - Wallet address initiating swap
     * @param {string} walletName - Human-readable wallet name
     * @param {Array<Object>} tokens - Array of token objects
     * @returns {Promise<void>}
     */
    async swapTokensFlow(walletAddress, walletName, tokens) {
        return this._delegateToTokenSwapper('swapTokensFlow', walletAddress, walletName, tokens);
    }
}

/**
 * UI component for managing token balances and swap operations
 */
class TokenSwapper {
    /**
     * Creates a new TokenSwapper instance
     * 
     * @param {UIHandler} uiHandler - UI utilities for display and interaction
     * @param {TokenService} tokenService - Service for token operations
     * @param {WalletService} walletService - Service for wallet management
     */
    constructor(uiHandler, tokenService, walletService) {
        this.uiHandler = uiHandler;
        this.tokenService = tokenService;
        this.walletService = walletService;
    }

    /**
     * Displays all token balances and provides a menu for swapping
     * 
     * Shows a formatted table of token balances including:
     * - Token symbols
     * - Balances with proper formatting
     * - Current prices in USD
     * - Total value in USD
     * 
     * Tokens are sorted by value (highest to lowest) for better UX.
     * After displaying balances, offers an option to swap tokens to BERA.
     * 
     * @param {string} walletAddress - Blockchain address to check for tokens
     * @param {string} walletName - Human-readable wallet name for display
     */
    async displayTokenBalances(walletAddress, walletName) {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader(`TOKEN BALANCES - ${walletName}`);
        
        console.log(`\nFetching token balances for ${walletAddress}...`);
        this.uiHandler.startProgress(100, "Fetching token data...");
        
        // Get token balances
        const balanceData = await this.tokenService.getTokenBalances(walletAddress);
        this.uiHandler.stopProgress();
        
        if (balanceData.error) {
            console.log(`\n❌ Error: ${balanceData.error}`);
            await this.uiHandler.pause();
            return;
        }
        
        const { tokens, formattedTotalValueUsd, formattedTotalValueBera } = balanceData;
        
        if (tokens.length === 0) {
            console.log("\nNo tokens found for this wallet.");
            await this.uiHandler.pause();
            return;
        }
        
        // Display token balances
        console.log("\nToken Balances:");
        console.log("══════════════════════════════════════════════════════════════════════════════");
        console.log(" TOKEN              BALANCE              PRICE (USD)         VALUE (USD)");
        console.log("──────────────────────────────────────────────────────────────────────────────");
        
        // Sort tokens by value (highest to lowest)
        const sortedTokens = [...tokens].sort((a, b) => {
            // Default to 0 if valueUsd is not defined
            const valueA = a.valueUsd || 0;
            const valueB = b.valueUsd || 0;
            return valueB - valueA; // Sort in descending order
        });
        
        sortedTokens.forEach(token => {
            const symbol = token.symbol.padEnd(18, ' ');
            const balance = token.formattedBalance.padEnd(20, ' ');
            
            // Check if price is from a fallback/placeholder
            const isFallbackPrice = token.priceUsd && token.isPlaceholder;
            
            const price = token.priceUsd 
                ? `$${token.priceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}${isFallbackPrice ? ' (est.)' : ''}`
                : 'N/A';
            
            console.log(` ${symbol}${balance}${price.padEnd(25, ' ')}${token.formattedValueUsd}`);
        });
        
        console.log("──────────────────────────────────────────────────────────────────────────────");
        console.log(`Total Value: ${formattedTotalValueUsd} (${formattedTotalValueBera})`);
        console.log("══════════════════════════════════════════════════════════════════════════════");
        
        const options = this.uiHandler.createMenuOptions([
            { key: '1', label: 'Swap Tokens to BERA', value: 'swap' }
        ], true, false);
        
        this.uiHandler.displayMenu(options);
        const choice = await this.uiHandler.getSelection(options);
        
        if (choice === 'swap') {
            await this.swapTokensFlow(walletAddress, walletName, sortedTokens);
        }
    }
    
    /**
     * Manages the complete token swap workflow
     * 
     * This comprehensive method handles the entire swap process:
     * 1. Filters tokens to show only relevant, non-dust tokens
     * 2. Allows users to select which tokens to swap
     * 3. Prompts for swap amounts (with validation)
     * 4. Displays summary information for confirmation
     * 5. Creates approval and swap transactions
     * 6. Saves the transaction bundle in the selected format
     * 
     * Includes dust token filtering (< $1.00) to avoid failed transactions 
     * and warnings for large transaction bundles that might cause issues.
     * 
     * @param {string} walletAddress - Wallet address initiating the swap
     * @param {string} walletName - Human-readable wallet name
     * @param {Array<Object>} tokens - Array of token objects with balance and price info
     */
    async swapTokensFlow(walletAddress, walletName, tokens) {
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader(`SWAP TOKENS - ${walletName}`);
        
        // Filter out tokens with zero/low balance, dust amounts (< $1.00), and BERA
        const MIN_VALUE_USD = 1.00; // Minimum USD value to consider for swapping
        
        const swappableTokens = tokens.filter(token => {
            // Must have positive balance and not be BERA
            const hasBalance = parseFloat(token.balance) > 0;
            const isNotBera = token.address !== 'native' && token.symbol !== 'BERA';
            
            // Skip dust amounts (token value less than $1)
            const hasMinimumValue = token.valueUsd && token.valueUsd >= MIN_VALUE_USD;
            
            return hasBalance && isNotBera && hasMinimumValue;
        });
        
        if (swappableTokens.length === 0) {
            console.log("\nNo tokens available for swapping.");
            await this.uiHandler.pause();
            return;
        }
        
        // Check if we filtered out any tokens due to low value
        const filteredDueToLowValue = tokens.filter(token => 
            parseFloat(token.balance) > 0 && 
            token.address !== 'native' && 
            token.symbol !== 'BERA' && 
            (!token.valueUsd || token.valueUsd < MIN_VALUE_USD)
        );
        
        if (filteredDueToLowValue.length > 0) {
            console.log(`\nNote: ${filteredDueToLowValue.length} token(s) with value less than $${MIN_VALUE_USD.toFixed(2)} were excluded.`);
        }
        
        // Sort swappable tokens by value (highest to lowest)
        const sortedSwappableTokens = [...swappableTokens].sort((a, b) => {
            const valueA = a.valueUsd || 0;
            const valueB = b.valueUsd || 0;
            return valueB - valueA; // Sort in descending order
        });
        
        // Display swappable tokens
        console.log("\nSelect tokens to swap to BERA:");
        
        const tokenChoices = sortedSwappableTokens.map(token => ({
            name: `${token.symbol} - Balance: ${token.formattedBalance} (${token.formattedValueUsd})`,
            value: token,
            short: token.symbol
        }));
        
        const { selectedTokens } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selectedTokens',
                message: 'Select tokens to swap (use spacebar to select, enter to confirm):',
                choices: tokenChoices,
                pageSize: 15
            }
        ]);
        
        if (selectedTokens.length === 0) {
            console.log("\nNo tokens selected. Operation cancelled.");
            await this.uiHandler.pause();
            return;
        }
        
        // Get swap amounts for each token - default to max amount
        const tokensWithAmounts = [];
        
        console.log("\nPress Enter to use the maximum balance or input a specific amount for each token:");
        
        for (const token of selectedTokens) {
            // Calculate max amount with slight buffer for gas if it's a native token
            const maxAmount = parseFloat(token.balance);
            
            const { amount } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'amount',
                    message: `${token.symbol} - Amount to swap (max: ${token.formattedBalance}):`,
                    default: maxAmount, // Default to max amount for easy selection
                    validate: input => {
                        const amount = parseFloat(input);
                        if (isNaN(amount) || amount <= 0) {
                            return 'Please enter a valid number greater than 0';
                        }
                        if (amount > parseFloat(token.balance)) {
                            return `Amount exceeds balance of ${token.formattedBalance}`;
                        }
                        return true;
                    },
                    filter: input => {
                        const amount = parseFloat(input);
                        return isNaN(amount) ? '' : amount;
                    }
                }
            ]);
            
            tokensWithAmounts.push({
                ...token,
                amount
            });
        }
        
        // Display selected tokens and amounts for confirmation
        this.uiHandler.clearScreen();
        this.uiHandler.displayHeader("REVIEW SWAP");
        
        console.log("\nToken Swaps to Execute:");
        console.log("══════════════════════════════════════════════════════════════════════════════");
        console.log(" TOKEN              AMOUNT              VALUE (USD)");
        console.log("──────────────────────────────────────────────────────────────────────────────");
        
        tokensWithAmounts.forEach(token => {
            const symbol = token.symbol.padEnd(18, ' ');
            const amount = token.amount.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 6
            }).padEnd(20, ' ');
            
            const valueUsd = token.priceUsd 
                ? (token.amount * token.priceUsd).toLocaleString(undefined, {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                })
                : 'N/A';
            
            console.log(` ${symbol}${amount}${valueUsd}`);
        });
        
        const totalValueUsd = tokensWithAmounts.reduce(
            (sum, token) => sum + (token.priceUsd ? token.amount * token.priceUsd : 0), 
            0
        );
        
        console.log("──────────────────────────────────────────────────────────────────────────────");
        console.log(` TOTAL                                 ${totalValueUsd.toLocaleString(undefined, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`);
        console.log("══════════════════════════════════════════════════════════════════════════════");
        
        // Get confirmation
        const confirmed = await this.uiHandler.confirm(
            `\nDo you want to proceed with swapping these tokens to BERA?`
        );
        
        if (!confirmed) {
            return;
        }
        
        // Create swap bundle
        console.log("\nPreparing swap transactions...");
        this.uiHandler.startProgress(100, "Getting swap quotes...");
        
        const swapBundle = await this.tokenService.createSwapBundle(walletAddress, tokensWithAmounts);
        this.uiHandler.stopProgress();
        
        if (swapBundle.error) {
            console.log(`\n❌ Error: ${swapBundle.error}`);
            await this.uiHandler.pause();
            return;
        }
        
        // Get token approvals if needed
        console.log("\nChecking if token approvals are needed...");
        const approvalTxs = await this.tokenService.getTokenApprovals(walletAddress, tokensWithAmounts);
        
        // Combine approval and swap transactions
        const allTransactions = [...approvalTxs, ...swapBundle.transactions];
        
        // Display transaction summary
        console.log("\nSwap Bundle Summary:");
        console.log("══════════════════════════════════════════════════════════════════════════════");
        
        if (approvalTxs.length > 0) {
            console.log(`\nApproval Transactions: ${approvalTxs.length}`);
            approvalTxs.forEach(tx => {
                console.log(` - Approve ${tx.token.symbol} for unlimited spending`);
            });
        }
        
        console.log(`\nSwap Transactions: ${swapBundle.transactions.length}`);
        swapBundle.transactions.forEach(tx => {
            console.log(` - Swap ${tx.token.amount} ${tx.token.symbol} for ~${tx.quote.formattedAmountOut} BERA`);
        });
        
        console.log(`\nExpected Output: ${swapBundle.formattedTotalExpectedBera}`);
        console.log("══════════════════════════════════════════════════════════════════════════════");
        
        // Offer options to save or execute
        // Warn user if there are many transactions for a Safe multisig
        if (allTransactions.length > 3) {
            console.log(`\n⚠️  WARNING: This bundle contains ${allTransactions.length} transactions.`);
            console.log("Safe multisig may have issues with large bundles due to gas estimation.");
            console.log("Consider reducing the number of tokens to swap in a single bundle.\n");
        }
        
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do with this swap bundle?',
                choices: [
                    { name: 'EOA Wallet (JSON only)', value: 'save_eoa' },
                    { name: 'EOA Wallet (JSON + Execute)', value: 'execute_eoa' },
                    { name: 'Safe Multisig (JSON only)', value: 'save_safe' },
                    { name: 'Safe Multisig (JSON + Propose & Sign)', value: 'execute_safe' },
                    { name: 'Cancel', value: 'cancel' }
                ]
            }
        ]);
        
        if (action === 'cancel') {
            return;
        }
        
        // Determine format and execution option based on action
        let format;
        let shouldExecute = false;
        
        switch (action) {
            case 'save_eoa':
                format = this.tokenService.OutputFormat.EOA;
                shouldExecute = false;
                break;
            case 'execute_eoa':
                format = this.tokenService.OutputFormat.EOA;
                shouldExecute = true;
                break;
            case 'save_safe':
                format = this.tokenService.OutputFormat.SAFE_UI;
                shouldExecute = false;
                break;
            case 'execute_safe':
                format = this.tokenService.OutputFormat.SAFE_UI;
                shouldExecute = true;
                break;
        }
        
        // Format transactions for the selected output format
        const formattedBundle = await this.tokenService.formatSwapBundle(
            allTransactions,
            format,
            walletAddress,
            walletName
        );
        
        // Add additional swap information to the bundle with our standardized format
        // We store this in top-level properties for easy access
        formattedBundle.totalExpectedBera = swapBundle.totalExpectedBera;
        formattedBundle.formattedTotalExpectedBera = swapBundle.formattedTotalExpectedBera;
        formattedBundle.tokenSwaps = tokensWithAmounts.map(token => ({
            symbol: token.symbol,
            address: token.address,
            amount: token.amount,
            valueUsd: token.priceUsd ? token.amount * token.priceUsd : null
        }));
        
        try {
            // Save the bundle to a file and generate Transaction Builder URL if applicable
            const bundleResult = await this.tokenService.saveSwapBundle(
                formattedBundle,
                walletName,
                format,
                walletAddress // Pass wallet address for Transaction Builder URL generation
            );
            
            if (!bundleResult.success) {
                console.log(`\n❌ Error saving bundle: ${bundleResult.error}`);
                await this.uiHandler.pause();
                return;
            }
            
            console.log(`\nSwap bundle saved to ${bundleResult.filepath}`);
            
            // Handle based on format and execution options
            if (shouldExecute) {
                // With our standardized format, formattedBundle already has the correct structure
                // Just add the filepath from the save result
                formattedBundle.filepath = bundleResult.filepath;
                
                // Use the formattedBundle directly instead of wrapping it again
                const bundle = formattedBundle;
                
                try {
                    // Verify transaction service is available
                    if (!this.tokenService.app) {
                        throw new Error("App reference is not available");
                    }
                    
                    if (!this.tokenService.app.transactionService) {
                        // Try to find transactionService in global.app if available
                        if (global && global.app && global.app.transactionService) {
                            console.log("Using global.app.transactionService for execution");
                            await global.app.transactionService.signAndSendBundleFlow(bundle);
                            return; // Early return after successful execution
                        } else {
                            throw new Error("Transaction service is not available");
                        }
                    }
                    
                    if (format === this.tokenService.OutputFormat.EOA) {
                        // For EOA wallets - execute immediately
                        console.log("\nExecuting transactions with your private key...");
                        await this.tokenService.app.transactionService.signAndSendBundleFlow(bundle);
                    } else {
                        // For Safe wallets - propose and sign
                        console.log("\nProposing and signing transactions for Safe...");
                        await this.tokenService.app.transactionService.signAndSendBundleFlow(bundle);
                    }
                } catch (error) {
                    ErrorHandler.handle(error, 'TokenSwapper.swapTokensFlow - execute');
                    console.log("\n❌ Error executing transactions: " + error.message);
                    console.log("Bundle has been saved but could not be executed at this time.");
                    await this.uiHandler.pause();
                }
            } else {
                // JSON only option - just provide instructions
                if (format === this.tokenService.OutputFormat.EOA) {
                    // For EOA wallets
                    console.log("\nThe swap bundle has been saved as JSON only. You can:");
                    console.log("1. Use this file later with the 'Send Bundle' option from the main menu");
                    console.log("2. Import it into your wallet of choice that supports batch transactions");
                } else {
                    // For Safe wallets - show Safe Transaction Builder instructions
                    if (bundleResult.safeInstructions) {
                        console.log("\n📋 Instructions to import transactions into Safe:");
                        bundleResult.safeInstructions.instructions.forEach(instruction => {
                            console.log(instruction);
                        });
                        console.log(`5. Select the saved file at:\n   ${bundleResult.filepath}`);
                    }
                }
            }
            
            await this.uiHandler.pause();
        } catch (error) {
            console.log(`\n❌ Error saving bundle: ${error.message}`);
            await this.uiHandler.pause();
        }
    }
}

// Export the SwapBundler as the main component
module.exports = SwapBundler;

// Also expose TokenSwapper for direct use if needed
module.exports.TokenSwapper = TokenSwapper;