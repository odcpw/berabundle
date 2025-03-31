/**
 * BeraBundle - Berachain reward bundling tool
 * 
 * This is the main entry point for the BeraBundle application, which allows users to:
 * - Bundle and claim rewards from various DeFi protocols
 * - Create validator boost bundles for delegating BGT
 * - Create token swap bundles
 * - Execute bundles directly or through Safe multisig
 */

const { ethers } = require('ethers');
const config = require('./config');
const { ErrorHandler } = require('./utils/errorHandler');

// Data storage
const WalletRepository = require('./storage/repositories/walletRepository');
const ApiKeyRepository = require('./storage/repositories/apiKeyRepository');
const PreferencesRepository = require('./storage/repositories/preferencesRepository');
const BundleRepository = require('./storage/repositories/bundleRepository');

// Core functionality
const ProviderAdapter = require('./execution/adapters/providerAdapter');
const { BundleCreator } = require('./bundles/bundleCreator');
const EoaExecutor = require('./execution/executors/eoaExecutor');
const SafeExecutor = require('./execution/executors/safeExecutor');

// UI components
const UiHandler = require('./ui/common/uiHandler');
const ProgressTracker = require('./ui/common/progressTracker');
const MainMenu = require('./ui/flows/mainMenu');

/**
 * Main BeraBundle application class
 */
class BeraBundle {
    /**
     * Create a new BeraBundle instance
     */
    constructor() {
        // Initialize blockchain provider adapter
        this.providerAdapter = new ProviderAdapter();
        
        // Initialize repositories
        this.walletRepository = new WalletRepository();
        this.apiKeyRepository = new ApiKeyRepository();
        this.preferencesRepository = new PreferencesRepository();
        this.bundleRepository = new BundleRepository();
        
        // Core components will be initialized later when provider is ready
        this.bundleCreator = null;
        this.eoaExecutor = null;
        this.safeExecutor = null;
        
        // Initialize UI components
        this.uiHandler = new UiHandler();
        this.progressTracker = new ProgressTracker();
        this.mainMenu = new MainMenu(this);
    }

    /**
     * Initialize the application
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        try {
            // Initialize provider adapter
            await this.providerAdapter.initialize();
            const provider = this.providerAdapter.getProvider();
            
            // Initialize repositories
            await this.walletRepository.initialize();
            // Update wallet repository provider AFTER provider is initialized
            this.walletRepository.provider = provider;
            
            await this.apiKeyRepository.initialize();
            await this.preferencesRepository.initialize();
            await this.bundleRepository.initialize();
            
            // Store app reference to make it available to other components
            global.app = this;
            
            // Initialize core components with provider
            this.bundleCreator = new BundleCreator(provider);
            // Pass app reference to make it available during initialization
            this.bundleCreator.app = this;
            
            await this.bundleCreator.initialize();
            
            // Initialize adapters
            const SafeAdapter = require('./execution/adapters/safeAdapter');
            this.safeAdapter = new SafeAdapter(provider);
            
            // Initialize executors with proper adapter references
            this.eoaExecutor = new EoaExecutor(provider);
            this.safeExecutor = new SafeExecutor(provider);
            
            // Provide a reference to the safeAdapter in the safeExecutor for compatibility
            this.safeExecutor.adapter = this.safeAdapter;
            
            // Initialize the transaction service
            const TransactionService = require('./execution/executors/eoaExecutor');
            this.transactionService = new TransactionService(this);
            
            // Make sure TransactionService has all required references
            this.transactionService.provider = provider;
            this.transactionService.walletService = this.walletRepository;
            this.transactionService.uiHandler = this.uiHandler;
            this.transactionService.claimBundler = this.bundleCreator.getClaimBundler();
            
            // Set backward compatibility properties
            try {
                // Get RewardChecker from the ClaimBundler
                this.rewardChecker = this.bundleCreator.getClaimBundler().rewardChecker;
                console.log("Successfully initialized rewardChecker from ClaimBundler");
            } catch (error) {
                // If that fails, create a new RewardChecker directly
                const RewardChecker = require('./bundles/claims/rewardChecker');
                this.rewardChecker = new RewardChecker(provider);
                console.log("Created new RewardChecker instance directly");
            }
            
            // Set redelegationManager from BoostBundler
            this.redelegationManager = this.bundleCreator.getBoostBundler();
            
            // Get SwapBundler and make sure it has a reference to the app
            const swapBundler = this.bundleCreator.getSwapBundler();
            if (swapBundler.app !== this) {
                swapBundler.app = this;
                // Make sure the tokenService also has the app reference
                if (swapBundler.tokenService) {
                    swapBundler.tokenService.app = this;
                }
            }
            
            this.tokenService = swapBundler.tokenService;
            this.tokenSwapper = swapBundler;
            
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'BeraBundle.initialize', true);
            return false;
        }
    }
    
    /**
     * Get the ethers provider
     * @returns {ethers.providers.Provider} The provider
     */
    getProvider() {
        return this.providerAdapter.getProvider();
    }
    
    /**
     * Update all metadata (vaults, validators, tokens)
     * @returns {Promise<boolean>} Success status
     */
    async updateAllMetadata() {
        return this.bundleCreator.updateAllMetadata();
    }

    /**
     * Main application loop
     */
    async main() {
        // Initialize first
        await this.initialize();
        
        // Start the menu manager
        await this.mainMenu.mainMenu();
    }
}

// Process command line arguments
function handleCommandLineArgs() {
    const args = process.argv.slice(2);
    
    // Handle special flags
    if (args.includes('--help') || args.includes('-h')) {
        console.log('BeraBundle - Berachain Bundle Creator');
        console.log('\nUsage:');
        console.log('  node berabundle.js [options]');
        console.log('\nOptions:');
        console.log('  --help, -h       Show this help');
        console.log('  --version, -v    Show version');
        return true;
    }
    
    if (args.includes('--version') || args.includes('-v')) {
        const packageJson = require('./package.json');
        console.log(`BeraBundle v${packageJson.version}`);
        return true;
    }
    
    return false; // No special flags, proceed with normal startup
}

// Export the BeraBundle class and utilities
module.exports = BeraBundle;
module.exports.handleCommandLineArgs = handleCommandLineArgs;

// Start the application if run directly
if (require.main === module) {
    // Check for command line args first
    const handled = handleCommandLineArgs();
    if (!handled) {
        // Normal startup
        const app = new BeraBundle();
        app.main().catch(error => {
            console.error(`Error in Main application: ${error.message}`);
            if (error.stack) {
                console.error(error.stack);
            }
        });
    }
}