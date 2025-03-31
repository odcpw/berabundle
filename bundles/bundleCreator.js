/**
 * bundleCreator.js - Central bundle creation orchestrator
 * 
 * This module serves as the main entry point for creating transaction bundles of different types:
 * - Claim bundles (for claiming rewards)
 * - Boost bundles (for validator boosting operations)
 * - Swap bundles (for token swaps)
 * 
 * It coordinates between the specialized bundlers for each operation type.
 */

// Import specialized bundlers
const { ClaimBundler } = require('./claims/claimBundler');
const BoostBundler = require('./boosts/boostBundler'); // RedelegationManager is exported directly
const SwapBundler = require('./swaps/swapBundler'); // TokenSwapper is exported directly

/**
 * Bundle types
 */
const BundleType = {
    CLAIM: 'claim',
    BOOST: 'boost',
    SWAP: 'swap',
    COMPOUND: 'compound' // Combined claim+boost
};

/**
 * Output formats
 */
const OutputFormat = {
    EOA: 'eoa',            // Standard EOA transaction for wallets with private keys
    SAFE_UI: 'safe_ui',    // Safe UI (TxBuilder) format for web interface
    SAFE_CLI: 'safe_cli'   // Safe CLI format for command line usage
};

/**
 * Execution modes
 */
const ExecutionMode = {
    JSON_ONLY: 'json_only',   // Create JSON only, no execution
    EXECUTE: 'execute',       // Create and execute (for EOA)
    PROPOSE: 'propose'        // Create and propose (for Safe)
};

/**
 * Manages the creation of different types of transaction bundles
 */
class BundleCreator {
    /**
     * Initialize the BundleCreator
     * @param {Object} provider - Ethereum provider
     */
    constructor(provider) {
        this.provider = provider;
        this.claimBundler = null;
        this.boostBundler = null;
        this.swapBundler = null;
        
        // Direct access to the RewardChecker
        const RewardChecker = require('./claims/rewardChecker');
        this.rewardChecker = new RewardChecker(this.provider);
    }

    /**
     * Initialize bundlers as needed
     */
    async initialize() {
        // Initialize core bundlers directly to ensure compatibility
        this.claimBundler = new ClaimBundler(this.provider);
        
        // Note: These are compatibility accessors for the migration period
        if (!this.claimBundler.rewardChecker) {
            this.claimBundler.rewardChecker = this.rewardChecker;
        }
        
        // Initialize other bundlers as needed
        this.getBoostBundler();
        this.getSwapBundler();
    }
    
    /**
     * Update all metadata (vaults, validators, tokens)
     * Convenience method for direct access to updateAllMetadata
     */
    async updateAllMetadata() {
        return this.rewardChecker.updateAllMetadata();
    }

    /**
     * Get or create the claim bundler
     * @returns {ClaimBundler} Initialized claim bundler
     */
    getClaimBundler() {
        if (!this.claimBundler) {
            this.claimBundler = new ClaimBundler(this.provider);
            
            // For backward compatibility during migration
            const RewardChecker = require('./claims/rewardChecker');
            this.claimBundler.rewardChecker = new RewardChecker(this.provider);
        }
        return this.claimBundler;
    }

    /**
     * Get or create the boost bundler
     * @returns {BoostBundler} Initialized boost bundler
     */
    getBoostBundler() {
        if (!this.boostBundler) {
            this.boostBundler = new BoostBundler(this.provider);
        }
        return this.boostBundler;
    }

    /**
     * Get or create the swap bundler
     * @returns {SwapBundler} Initialized swap bundler
     */
    getSwapBundler() {
        if (!this.swapBundler) {
            // Pass the provider and app reference to SwapBundler
            // The app parameter is used to access transactionService, walletService, etc.
            const app = this._getAppReference();
            this.swapBundler = new SwapBundler(this.provider, app);
        }
        return this.swapBundler;
    }
    
    /**
     * Helper method to get a reference to the app object
     * Attempts to find the app by checking common parent-child relationships
     * @returns {Object|null} App reference or null if not found
     * @private
     */
    _getAppReference() {
        // Try to find the app reference
        // The app might be accessible via various parent references
        
        // Check if we're a property of some object
        if (global && global.app) {
            return global.app;
        }
        
        // Check if we have creator.app
        if (this.creator && this.creator.app) {
            return this.creator.app;
        }
        
        // Check for a parent reference 
        if (this.parent) {
            return this.parent;
        }
        
        // Return a minimal app reference with walletRepository and transactionService
        // This creates a basic app stub with the necessary services
        if (this.rewardChecker) {
            return {
                rewardChecker: this.rewardChecker,
                walletRepository: null, // Will be handled with null checks in TokenSwapper
                transactionService: null // Will be handled with null checks in TokenSwapper
            };
        }
        
        return null;
    }

    /**
     * Create a bundle of transactions
     * @param {BundleType} bundleType - Type of bundle to create
     * @param {Object} options - Bundle creation options
     * @returns {Promise<Object>} Created bundle
     */
    async createBundle(bundleType, options) {
        switch (bundleType) {
            case BundleType.CLAIM:
                return this.createClaimBundle(options);
            case BundleType.BOOST:
                return this.createBoostBundle(options);
            case BundleType.SWAP:
                return this.createSwapBundle(options);
            case BundleType.COMPOUND:
                return this.createCompoundBundle(options);
            default:
                throw new Error(`Unknown bundle type: ${bundleType}`);
        }
    }

    /**
     * Create a bundle for claiming rewards
     * @param {Object} options - Claim options
     * @returns {Promise<Object>} Claim bundle
     */
    async createClaimBundle(options) {
        const claimBundler = this.getClaimBundler();
        return claimBundler.generateClaimBundle(
            options.rewardInfo,
            options.userAddress,
            options.recipientAddress,
            options.format,
            options.name,
            { 
                redelegate: options.redelegate
            }
        );
    }

    /**
     * Create a bundle for validator boosting
     * @param {Object} options - Boost options
     * @returns {Promise<Object>} Boost bundle
     */
    async createBoostBundle(options) {
        const boostBundler = this.getBoostBundler();
        return boostBundler.createRedelegationTransactions(
            options.userAddress,
            options.bgtAmount,
            options.format
        );
    }

    /**
     * Create a bundle for token swaps
     * @param {Object} options - Swap options
     * @returns {Promise<Object>} Swap bundle
     */
    async createSwapBundle(options) {
        const swapBundler = this.getSwapBundler();
        return swapBundler.createSwapBundle(
            options.walletAddress,
            options.tokens,
            options.format
        );
    }

    /**
     * Create a compound bundle for claiming rewards and boosting validators
     * @param {Object} options - Compound options
     * @returns {Promise<Object>} Compound bundle
     */
    async createCompoundBundle(options) {
        // First create a claim bundle
        const claimBundle = await this.createClaimBundle({
            rewardInfo: options.rewardInfo,
            userAddress: options.userAddress,
            recipientAddress: options.userAddress, // Send to self for compounding
            format: options.format,
            name: options.name,
            redelegate: false // We'll handle redelegation separately
        });

        // Then create a boost bundle
        const boostBundle = await this.createBoostBundle({
            userAddress: options.userAddress,
            bgtAmount: options.bgtAmount,
            format: options.format
        });

        // Combine the transactions
        if (options.format === OutputFormat.EOA) {
            return {
                ...claimBundle,
                bundleData: [...claimBundle.bundleData, ...boostBundle.transactions],
                summary: {
                    ...claimBundle.summary,
                    redelegationCount: boostBundle.transactions.length,
                    totalTransactions: claimBundle.bundleData.length + boostBundle.transactions.length,
                    includesRedelegation: true
                }
            };
        } else if (options.format === OutputFormat.SAFE_UI) {
            return {
                ...claimBundle,
                bundleData: {
                    ...claimBundle.bundleData,
                    transactions: [...claimBundle.bundleData.transactions, ...boostBundle.transactions]
                },
                summary: {
                    ...claimBundle.summary,
                    redelegationCount: boostBundle.transactions.length,
                    totalTransactions: claimBundle.bundleData.transactions.length + boostBundle.transactions.length,
                    includesRedelegation: true
                }
            };
        } else {
            throw new Error(`Unsupported format for compound bundle: ${options.format}`);
        }
    }
}

module.exports = {
    BundleCreator,
    BundleType,
    OutputFormat,
    ExecutionMode
};