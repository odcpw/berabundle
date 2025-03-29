// redelegationManager.js - Manages validator redelegation preferences
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const { ethers } = require('ethers');
const { ErrorHandler } = require('./errorHandler');

/**
 * Service for managing validator redelegation preferences
 */
class RedelegationManager {
    constructor(provider) {
        this.provider = provider || new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
        this.validatorsFile = config.paths.validatorsFile;
        this.preferencesFile = config.paths.boostAllocationFile;
        this.validators = [];
        this.preferences = {};
    }
    
    /**
     * Ensure metadata directory exists
     */
    async ensureMetadataDirExists() {
        try {
            await fs.mkdir(config.paths.metadataDir, { recursive: true });
            return true;
        } catch (error) {
            console.warn(`Warning: Could not create metadata directory: ${error.message}`);
            return false;
        }
    }

    /**
     * Initialize the redelegation manager
     */
    async initialize() {
        try {
            // Ensure metadata directory exists first
            await this.ensureMetadataDirExists();
            
            // Load validators and preferences
            await this.loadValidators();
            await this.loadPreferences();
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'RedelegationManager.initialize');
            return false;
        }
    }

    /**
     * Load validators from file or fetch if not present
     */
    async loadValidators() {
        try {
            const exists = await this.fileExists(this.validatorsFile);
            if (exists) {
                const data = await fs.readFile(this.validatorsFile, 'utf8');
                this.validators = JSON.parse(data);
                console.log(`Loaded ${this.validators.length} validators from file`);
            } else {
                // Create an empty validator file if it doesn't exist
                this.validators = [];
                await fs.writeFile(this.validatorsFile, JSON.stringify([], null, 2));
                console.log('Created new validators file');
            }
        } catch (error) {
            throw ErrorHandler.createValidationError(`Failed to load validators: ${error.message}`);
        }
    }

    /**
     * Load user delegation preferences
     */
    async loadPreferences() {
        try {
            const exists = await this.fileExists(this.preferencesFile);
            if (exists) {
                const data = await fs.readFile(this.preferencesFile, 'utf8');
                this.preferences = JSON.parse(data);
                console.log(`Loaded delegation preferences for ${Object.keys(this.preferences).length} users`);
            } else {
                this.preferences = {};
                await fs.writeFile(this.preferencesFile, JSON.stringify({}, null, 2));
                console.log('Created new preferences file');
            }
        } catch (error) {
            throw ErrorHandler.createValidationError(`Failed to load preferences: ${error.message}`);
        }
    }

    /**
     * Save user delegation preferences
     */
    async savePreferences() {
        try {
            await fs.writeFile(this.preferencesFile, JSON.stringify(this.preferences, null, 2));
            console.log('Delegation preferences saved successfully');
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'RedelegationManager.savePreferences');
            return false;
        }
    }

    /**
     * Check if a file exists
     */
    async fileExists(file) {
        try {
            await fs.access(file);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get all validators
     */
    getValidators() {
        return [...this.validators];
    }

    /**
     * Save validators data to file
     */
    async saveValidators(validators) {
        try {
            this.validators = validators;
            await fs.writeFile(this.validatorsFile, JSON.stringify(validators, null, 2));
            console.log(`Saved ${validators.length} validators to file`);
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'RedelegationManager.saveValidators');
            return false;
        }
    }

    /**
     * Get user's delegation preferences
     */
    getUserPreferences(userAddress) {
        return this.preferences[userAddress.toLowerCase()] || { validators: [] };
    }

    /**
     * Set user's delegation preferences
     */
    async setUserPreferences(userAddress, selectedValidators, allocations) {
        if (!userAddress || !ethers.utils.isAddress(userAddress)) {
            throw ErrorHandler.createValidationError('Invalid user address');
        }

        // Verify validators exist
        for (const validator of selectedValidators) {
            if (!this.validators.find(v => v.pubkey === validator.pubkey)) {
                throw ErrorHandler.createValidationError(`Validator ${validator.name || validator.pubkey} not found`);
            }
        }

        // Verify allocations add up to 100%
        const totalAllocation = Object.values(allocations).reduce((sum, value) => sum + value, 0);
        if (Math.abs(totalAllocation - 100) > 0.01) { // Allow for minor floating point errors
            throw ErrorHandler.createValidationError(`Allocations must add up to 100%, got ${totalAllocation}%`);
        }

        // Save preferences
        this.preferences[userAddress.toLowerCase()] = {
            validators: selectedValidators,
            allocations: allocations,
            lastUpdated: new Date().toISOString()
        };

        await this.savePreferences();
        return true;
    }

    /**
     * Validate if a validator pubkey is properly formatted
     * @param {string} pubkey - The validator pubkey to validate
     * @returns {boolean} - Whether the pubkey is valid
     */
    isValidValidatorPubkey(pubkey) {
        // Basic validation - should be a hex string without 0x prefix
        // That properly represents a BLS pubkey for the validator
        return (
            typeof pubkey === 'string' &&
            pubkey.length > 0 &&
            // Allow both with and without 0x prefix for compatibility
            /^(0x)?[0-9a-fA-F]+$/.test(pubkey)
        );
    }

    /**
     * Format validator pubkey to ensure it's properly encoded for contract calls
     * @param {string} pubkey - The validator pubkey to format
     * @returns {string} - The formatted pubkey
     */
    formatValidatorPubkey(pubkey) {
        // Ensure the pubkey has a 0x prefix for the contract call
        if (!pubkey.startsWith('0x')) {
            return '0x' + pubkey;
        }
        return pubkey;
    }

    /**
     * Create redelegation transactions
     */
    createRedelegationTransactions(userAddress, totalBGTAmount) {
        try {
            const userPrefs = this.getUserPreferences(userAddress);
            
            if (!userPrefs.validators || userPrefs.validators.length === 0) {
                return { transactions: [], success: false, message: "No delegation preferences found" };
            }

            const transactions = [];
            // Parse the amount and ensure it's a valid number
            const validAmount = parseFloat(totalBGTAmount) || 0;
            if (validAmount <= 0) {
                return { transactions: [], success: false, message: "Invalid BGT amount for redelegation" };
            }
            
            const bgAmount = ethers.utils.parseUnits(validAmount.toString(), 18);
            
            // Create a transaction for each validator based on allocation percentage
            for (const validator of userPrefs.validators) {
                const allocation = userPrefs.allocations[validator.pubkey];
                if (!allocation || allocation <= 0) continue;
                
                // Verify validator pubkey is valid
                if (!this.isValidValidatorPubkey(validator.pubkey)) {
                    console.warn(`Warning: Invalid validator pubkey format for ${validator.name || 'Unknown'}: ${validator.pubkey}`);
                    continue;
                }
                
                // Calculate amount based on allocation percentage (fix rounding issues)
                const amount = bgAmount.mul(Math.floor(allocation * 100)).div(10000);
                
                // Skip if amount is 0
                if (amount.isZero()) {
                    console.warn(`Warning: Allocation results in zero amount for validator ${validator.name || 'Unknown'}`);
                    continue;
                }
                
                // Ensure the pubkey is properly formatted with 0x prefix
                const formattedPubkey = this.formatValidatorPubkey(validator.pubkey);
                
                // Create the transaction payload
                const iface = new ethers.utils.Interface([
                    "function queueBoost(bytes pubkey, uint128 amount) external"
                ]);
                
                // Encode function call for validator boosting
                const data = iface.encodeFunctionData("queueBoost", [
                    formattedPubkey,
                    amount
                ]);
                
                const payload = {
                    to: config.networks.berachain.validatorBoostAddress,
                    data: data,
                    value: "0x0",
                    // Set a manual gasLimit to avoid estimation issues
                    gasLimit: "0x100000", // 1,048,576 gas, higher than default
                    metadata: {
                        type: 'validatorBoost',
                        validatorPubkey: formattedPubkey,
                        validatorName: validator.name || 'Unknown',
                        allocation: allocation,
                        amount: ethers.utils.formatUnits(amount, 18)
                    }
                };
                
                transactions.push(payload);
            }
            
            // Provide warning if we created no transactions
            if (transactions.length === 0) {
                return { 
                    transactions: [], 
                    success: false, 
                    message: "No valid redelegation transactions could be created" 
                };
            }
            
            return { 
                transactions, 
                success: true,
                summary: {
                    totalValidators: transactions.length,
                    totalAmount: totalBGTAmount
                }
            };
        } catch (error) {
            ErrorHandler.handle(error, 'RedelegationManager.createRedelegationTransactions');
            return { 
                transactions: [], 
                success: false, 
                message: `Failed to create redelegation transactions: ${error.message}` 
            };
        }
    }

    /**
     * Update validators from a network or external source
     * This is a placeholder for an actual implementation that would fetch validators
     */
    async updateValidatorsFromNetwork() {
        try {
            // The validators should already be in validators.json downloaded from github
            // We'll just make sure they're loaded
            await this.loadValidators();
            
            // If no validators are found, we could provide some default ones
            if (this.validators.length === 0) {
                console.log("No validators found in validators.json. Please update the validator list.");
                return {
                    success: false,
                    message: "No validators found in validators.json"
                };
            }
            
            // Format validators to ensure they have the expected structure
            const formattedValidators = this.validators.map(validator => {
                // The validators.json file has "id" instead of "pubkey", so we'll handle both
                return {
                    name: validator.name,
                    pubkey: validator.pubkey || validator.id || "",
                    // Keep the original id as well for backward compatibility
                    id: validator.id || validator.pubkey || ""
                };
            });
            
            await this.saveValidators(formattedValidators);
            return {
                success: true,
                count: formattedValidators.length
            };
        } catch (error) {
            ErrorHandler.handle(error, 'RedelegationManager.updateValidatorsFromNetwork');
            return {
                success: false,
                message: `Failed to update validators: ${error.message}`
            };
        }
    }
}

module.exports = RedelegationManager;