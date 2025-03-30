// BeraBundle.js - main application
const { ethers } = require('ethers');
const config = require('./config');
const WalletService = require('./walletService');
const UIHandler = require('./uiHandler');
const RewardChecker = require('./rewardChecker');
const { ClaimBundler } = require('./claimBundler');
const { ErrorHandler } = require('./errorHandler');
const RedelegationManager = require('./redelegationManager');
const SafeCliService = require('./safeCliService');
const MenuManager = require('./menuManager');
const TransactionService = require('./transactionService');
const FSHelpers = require('./fsHelpers');

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
        this.redelegationManager = new RedelegationManager(this.provider);
        this.safeCliService = new SafeCliService(this.provider);
        
        // Initialize menu and transaction managers
        this.menuManager = new MenuManager(this);
        this.transactionService = new TransactionService(this);
    }

    /**
     * Initialize the application
     */
    async initialize() {
        try {
            // Ensure all directories exist
            await FSHelpers.ensureDirectoriesExist();
            
            // Initialize services
            await this.walletService.initialize();
            await this.redelegationManager.initialize();
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'BeraBundle.initialize', true);
            return false;
        }
    }
    
    /**
     * Clear the clipboard for security
     * @returns {Promise<boolean>}
     */
    clearClipboard() {
        return FSHelpers.clearClipboard();
    }

    /**
     * Ensure all required directories exist
     */
    ensureDirectoriesExist() {
        return FSHelpers.ensureDirectoriesExist();
    }

    /**
     * Main application loop
     */
    async main() {
        // Initialize first
        await this.initialize();
        
        // Start the menu manager
        await this.menuManager.mainMenu();
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