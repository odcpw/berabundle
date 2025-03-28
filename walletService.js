// walletService.js - Enhanced wallet management service
const { ethers } = require('ethers');
const fs = require('fs').promises;
const crypto = require('crypto');
const config = require('./config');
const { ErrorHandler } = require('./errorHandler');

/**
 * Service for managing wallet addresses securely
 */
class WalletService {
    constructor(provider) {
        this.provider = provider;
        this.wallets = {};
        this.walletFile = config.paths.walletsFile;
        this.encryptionEnabled = false; // Set to true to enable encryption
        this.encryptionKey = process.env.WALLET_ENCRYPTION_KEY;
    }

    /**
     * Initialize the wallet service
     */
    async initialize() {
        try {
            await this.loadWallets();
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'WalletService.initialize');
            return false;
        }
    }

    /**
     * Load wallets from storage
     */
    async loadWallets() {
        try {
            const exists = await this.fileExists(this.walletFile);
            if (!exists) {
                this.wallets = {};
                return;
            }

            const data = await fs.readFile(this.walletFile, 'utf8');
            const parsed = JSON.parse(data);

            // Handle encrypted wallets if encryption is enabled
            if (this.encryptionEnabled && this.encryptionKey) {
                this.wallets = this.decryptWallets(parsed);
            } else {
                this.wallets = parsed;
            }

            console.log(`Loaded ${Object.keys(this.wallets).length} wallets from storage`);
        } catch (error) {
            throw ErrorHandler.createValidationError(`Failed to load wallets: ${error.message}`);
        }
    }

    /**
     * Save wallets to storage
     */
    async saveWallets() {
        try {
            let dataToSave = this.wallets;

            // Encrypt wallets if encryption is enabled
            if (this.encryptionEnabled && this.encryptionKey) {
                dataToSave = this.encryptWallets(this.wallets);
            }

            await fs.writeFile(this.walletFile, JSON.stringify(dataToSave, null, 2));
            console.log('Wallets saved successfully');
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'WalletService.saveWallets');
            return false;
        }
    }

    /**
     * Check if a file exists
     * @param {string} file - Path to the file
     * @returns {Promise<boolean>} Whether the file exists
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
     * Add a wallet
     * @param {string} name - Name for the wallet
     * @param {string} address - Ethereum address
     * @returns {Promise<boolean>} Success status
     */
    async addWallet(name, address) {
        try {
            // Validate inputs
            if (!name || name.trim() === '') {
                throw ErrorHandler.createValidationError('Wallet name cannot be empty');
            }

            if (this.wallets[name]) {
                throw ErrorHandler.createValidationError('A wallet with this name already exists');
            }

            if (!ethers.utils.isAddress(address)) {
                throw ErrorHandler.createValidationError('Invalid Ethereum address format');
            }

            // Check if address already exists
            const addressExists = Object.values(this.wallets).some(
                existingAddr => existingAddr.toLowerCase() === address.toLowerCase()
            );

            if (addressExists) {
                throw ErrorHandler.createValidationError('This address is already registered under a different name');
            }

            // Add the wallet
            this.wallets[name] = address;
            await this.saveWallets();
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'WalletService.addWallet');
            return false;
        }
    }

    /**
     * Remove a wallet
     * @param {string} name - Name of the wallet to remove
     * @returns {Promise<boolean>} Success status
     */
    async removeWallet(name) {
        try {
            if (!this.wallets[name]) {
                throw ErrorHandler.createValidationError('Wallet not found');
            }

            delete this.wallets[name];
            await this.saveWallets();
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'WalletService.removeWallet');
            return false;
        }
    }

    /**
     * Get all wallets
     * @returns {Object} All wallets
     */
    getWallets() {
        return { ...this.wallets };
    }

    /**
     * Get wallet by name
     * @param {string} name - Wallet name
     * @returns {string|null} Wallet address or null if not found
     */
    getWalletByName(name) {
        return this.wallets[name] || null;
    }

    /**
     * Encrypt wallet data
     * @param {Object} wallets - Wallet data to encrypt
     * @returns {Object} Encrypted wallet data
     */
    encryptWallets(wallets) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not set');
        }

        try {
            // In a real implementation, use a secure encryption algorithm
            const stringified = JSON.stringify(wallets);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey), iv);

            let encrypted = cipher.update(stringified, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            return {
                iv: iv.toString('hex'),
                data: encrypted
            };
        } catch (error) {
            console.error('Encryption error:', error);
            return wallets; // Fallback to unencrypted
        }
    }

    /**
     * Decrypt wallet data
     * @param {Object} encryptedData - Encrypted wallet data
     * @returns {Object} Decrypted wallet data
     */
    decryptWallets(encryptedData) {
        if (!this.encryptionKey || !encryptedData.iv || !encryptedData.data) {
            // If not properly encrypted, return as is
            return encryptedData;
        }

        try {
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey), iv);

            let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return JSON.parse(decrypted);
        } catch (error) {
            console.error('Decryption error:', error);
            return {}; // Return empty object on error
        }
    }

    /**
     * Validate an Ethereum address
     * @param {string} address - Address to validate
     * @returns {boolean} Whether the address is valid
     */
    static isValidAddress(address) {
        return ethers.utils.isAddress(address);
    }
}

module.exports = WalletService;
