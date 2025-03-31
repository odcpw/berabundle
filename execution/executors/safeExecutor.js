// safeService.js - Safe Transaction Service integration
// Uses the SafeAdapter for interacting with the Safe Transaction Service
const { ethers } = require('ethers');
const config = require('../../config');
const { ErrorHandler } = require('../../utils/errorHandler');
const SafeAdapter = require('../adapters/safeAdapter');

/**
 * Safe Service integration for Berachain
 * This is a wrapper around the SafeAdapter for backward compatibility
 */
class SafeService {
    constructor(provider) {
        this.provider = provider || new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
        
        // Initialize the SafeAdapter or use an injected one
        this.adapter = null;
        
        console.log(`Safe Service initialized with Berachain`);
    }
    
    /**
     * Ensure adapter is initialized
     * @private
     */
    _ensureAdapter() {
        if (!this.adapter) {
            // Create a new adapter if not injected
            this.adapter = new SafeAdapter(this.provider);
        }
        return this.adapter;
    }
    
    /**
     * Get Safe transaction URL for the web app
     * @param {string} safeAddress - Safe address
     * @param {string} safeTxHash - Safe transaction hash
     * @returns {string} Safe transaction URL
     */
    getSafeTransactionUrl(safeAddress, safeTxHash) {
        const adapter = this._ensureAdapter();
        return adapter.getSafeTransactionUrl(safeAddress, safeTxHash);
    }
    
    /**
     * Get the next nonce for a Safe
     * @param {string} safeAddress - Safe address
     * @returns {Promise<number>} Next nonce
     */
    async getNextNonce(safeAddress) {
        const adapter = this._ensureAdapter();
        const result = await adapter.getNextNonce(safeAddress);
        
        if (!result.success) {
            throw new Error(`Failed to get next nonce: ${result.message}`);
        }
        
        return result.nonce;
    }
    
    /**
     * Find Safes where an address is an owner
     * @param {string} ownerAddress - Owner address to check
     * @returns {Promise<Object>} List of Safes where the address is an owner
     */
    async getSafesByOwner(ownerAddress) {
        const adapter = this._ensureAdapter();
        return await adapter.getSafesByOwner(ownerAddress);
    }
    
    /**
     * Format transactions from bundle for Protocol Kit
     * @param {Object} bundle - Bundle containing transaction data
     * @returns {Array} Formatted meta transactions for Protocol Kit
     */
    formatTransactionsForProtocolKit(bundle) {
        const adapter = this._ensureAdapter();
        return adapter.formatTransactionsForProtocolKit(bundle);
    }
    
    /**
     * Propose a Safe transaction using Protocol Kit and direct API calls
     * This will make the transaction appear in the Safe UI for all owners
     * @param {string} safeAddress - Safe address
     * @param {Object} bundle - Bundle containing transaction data
     * @param {Object} signer - Ethers signer for signing the transaction
     * @returns {Promise<Object>} Proposal result
     */
    async proposeSafeTransaction(safeAddress, bundle, signer) {
        const adapter = this._ensureAdapter();
        return await adapter.proposeSafeTransaction(safeAddress, bundle, signer);
    }
    
    /**
     * Alias for proposeSafeTransaction for backward compatibility
     */
    async proposeSafeTransactionWithSdk(safeAddress, bundle, signer) {
        return this.proposeSafeTransaction(safeAddress, bundle, signer);
    }
    
    /**
     * Confirm an existing Safe transaction
     * @param {string} safeAddress - Safe address
     * @param {string} safeTxHash - Transaction hash to confirm
     * @param {Object} signer - Ethers signer for signing
     * @returns {Promise<Object>} Confirmation result
     */
    async confirmSafeTransaction(safeAddress, safeTxHash, signer) {
        const adapter = this._ensureAdapter();
        const result = await adapter.confirmSafeTransaction(safeAddress, safeTxHash, signer);
        
        if (!result.success) {
            throw new Error(`Failed to confirm Safe transaction: ${result.message}`);
        }
        
        return result;
    }
}

module.exports = SafeService;