/**
 * providerAdapter.js - Adapter for blockchain provider interactions
 * 
 * This module serves as an adapter for the ethers.js provider, ensuring consistent
 * access to blockchain functions across the application.
 */

const { ethers } = require('ethers');
const config = require('../../config');

/**
 * Adapter for blockchain provider interactions
 */
class ProviderAdapter {
    /**
     * Create a new ProviderAdapter
     * @param {Object} options - Provider options
     */
    constructor(options = {}) {
        this.options = options;
        this.provider = null;
    }

    /**
     * Initialize the provider
     * @returns {Promise<ethers.providers.Provider>} The initialized provider
     */
    async initialize() {
        if (!this.provider) {
            // Get network configuration
            const network = this.options.network || 'berachain';
            const networkConfig = config.networks[network];
            
            if (!networkConfig) {
                throw new Error(`Network configuration not found for: ${network}`);
            }

            // Create provider
            this.provider = new ethers.providers.JsonRpcProvider(
                networkConfig.rpcUrl
            );
            
            // Verify connection
            await this.provider.getNetwork();
        }
        
        return this.provider;
    }

    /**
     * Get the initialized provider
     * @returns {ethers.providers.Provider} The provider
     * @throws {Error} If provider is not initialized
     */
    getProvider() {
        if (!this.provider) {
            throw new Error('Provider not initialized. Call initialize() first.');
        }
        return this.provider;
    }

    /**
     * Create a contract instance
     * @param {string} address - Contract address
     * @param {Array} abi - Contract ABI
     * @returns {ethers.Contract} The contract instance
     */
    getContract(address, abi) {
        const provider = this.getProvider();
        return new ethers.Contract(address, abi, provider);
    }
    
    /**
     * Get the current gas price
     * @returns {Promise<ethers.BigNumber>} The current gas price
     */
    async getGasPrice() {
        const provider = this.getProvider();
        return provider.getGasPrice();
    }
    
    /**
     * Estimate gas for a transaction
     * @param {Object} tx - Transaction object
     * @returns {Promise<ethers.BigNumber>} Estimated gas
     */
    async estimateGas(tx) {
        const provider = this.getProvider();
        return provider.estimateGas(tx);
    }
    
    /**
     * Get the next nonce for an address
     * @param {string} address - Wallet address
     * @returns {Promise<number>} The next nonce
     */
    async getNextNonce(address) {
        const provider = this.getProvider();
        return provider.getTransactionCount(address, 'pending');
    }
}

module.exports = ProviderAdapter;