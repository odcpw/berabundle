/**
 * secureStorage.js - Secure storage engine for sensitive information
 * 
 * Provides encryption and secure storage for sensitive information like private keys.
 * Uses AES-256-GCM with proper key derivation for maximum security.
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');
const { ErrorHandler } = require('../../utils/errorHandler');

/**
 * SecureStorage class for handling encrypted storage of sensitive information
 */
class SecureStorage {
    /**
     * Create a new SecureStorage instance
     */
    constructor() {
        this.ENCRYPTION_KEY_SIZE = 32; // 256 bits
        this.ALGORITHM = 'aes-256-gcm';
        this.IV_LENGTH = 16; // 128 bits
        this.AUTH_TAG_LENGTH = 16; // 128 bits
        this.SALT_LENGTH = 64; // For password derivation
        this.keysFile = config.paths.encryptedKeysFile;
    }

    /**
     * Ensure the user preferences directory exists
     * @returns {Promise<boolean>} True if the directory exists or was created
     */
    async ensureUserPrefsDirExists() {
        try {
            // Make sure the path exists
            if (!config.paths.userprefsDir) {
                throw new Error('userprefsDir path not defined in config');
            }
            
            await fs.mkdir(config.paths.userprefsDir, { recursive: true });
            
            // Verify the directory exists
            try {
                await fs.access(config.paths.userprefsDir);
                return true;
            } catch (accessError) {
                return false;
            }
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if an encrypted keys file exists
     * @returns {Promise<boolean>} True if the file exists
     */
    async hasEncryptedKeys() {
        try {
            await fs.access(this.keysFile);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Derive encryption key from password
     * @param {string} password - User's password
     * @param {Buffer} salt - Salt for key derivation
     * @returns {Buffer} Derived key
     */
    deriveKey(password, salt) {
        // Set scrypt parameters for a more reasonable speed/security tradeoff
        const options = {
            N: 16384,  // Lower CPU/memory cost factor (was default 1048576)
            r: 8,      // blocksize
            p: 1       // parallelization
        };
        
        return crypto.scryptSync(password, salt, this.ENCRYPTION_KEY_SIZE, options);
    }

    /**
     * Encrypt a private key
     * @param {string} privateKey - The private key to encrypt
     * @param {string} password - Password for encryption
     * @returns {Object} Encrypted data structure with all necessary components
     */
    encrypt(privateKey, password) {
        try {
            // Generate a random salt
            const salt = crypto.randomBytes(this.SALT_LENGTH);
            
            // Derive encryption key from password and salt
            const key = this.deriveKey(password, salt);
            
            // Generate a random initialization vector
            const iv = crypto.randomBytes(this.IV_LENGTH);
            
            // Create cipher
            const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
            
            // Encrypt the private key
            const encrypted = Buffer.concat([
                cipher.update(privateKey, 'utf8'),
                cipher.final()
            ]);
            
            // Get the authentication tag
            const authTag = cipher.getAuthTag();
            
            // Return encrypted data with all components needed for decryption
            return {
                salt: salt.toString('hex'),
                iv: iv.toString('hex'),
                encrypted: encrypted.toString('hex'),
                authTag: authTag.toString('hex')
            };
        } catch (error) {
            throw ErrorHandler.createValidationError(`Encryption failed: ${error.message}`);
        }
    }

    /**
     * Decrypt an encrypted private key
     * @param {Object} encryptedData - The encrypted data structure
     * @param {string} password - Password for decryption
     * @returns {string} Decrypted private key
     */
    decrypt(encryptedData, password) {
        try {
            // Convert hex strings back to Buffers
            const salt = Buffer.from(encryptedData.salt, 'hex');
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const encrypted = Buffer.from(encryptedData.encrypted, 'hex');
            const authTag = Buffer.from(encryptedData.authTag, 'hex');
            
            // Derive the same key using the stored salt
            const key = this.deriveKey(password, salt);
            
            // Create decipher
            const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
            
            // Set auth tag
            decipher.setAuthTag(authTag);
            
            // Decrypt
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
            
            return decrypted.toString('utf8');
        } catch (error) {
            throw ErrorHandler.createValidationError('Incorrect password or corrupted data');
        }
    }

    /**
     * Load encrypted keys from file
     * @returns {Promise<Object>} The encrypted keys data
     */
    async loadEncryptedKeys() {
        try {
            // Check if file exists
            const exists = await this.hasEncryptedKeys();
            if (!exists) {
                return {};
            }
            
            // Read and parse file
            const data = await fs.readFile(this.keysFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.warn(`Warning: Could not load encrypted keys: ${error.message}`);
            return {};
        }
    }

    /**
     * Save encrypted keys to file
     * @param {Object} encryptedKeys - The encrypted keys data
     * @returns {Promise<boolean>} Success status
     */
    async saveEncryptedKeys(encryptedKeys) {
        try {
            // Ensure directory exists
            const dirExists = await this.ensureUserPrefsDirExists();
            if (!dirExists) {
                throw new Error('Failed to create userprefs directory');
            }
            
            // Write the file
            const serializedData = JSON.stringify(encryptedKeys, null, 2);
            await fs.writeFile(this.keysFile, serializedData, 'utf8');
            
            // Verify the file exists
            try {
                await fs.access(this.keysFile);
                return true;
            } catch (accessError) {
                throw new Error(`Failed to verify encrypted keys file: ${accessError.message}`);
            }
        } catch (error) {
            ErrorHandler.handle(error, 'SecureStorage.saveEncryptedKeys');
            return false;
        }
    }

    /**
     * Store an encrypted private key for a wallet
     * @param {string} address - Wallet address (used as identifier)
     * @param {string} privateKey - Private key to encrypt and store
     * @param {string} password - Password for encryption
     * @returns {Promise<boolean>} Success status
     */
    async storePrivateKey(address, privateKey, password) {
        try {
            // Normalize address
            const normalizedAddress = address.toLowerCase();
            
            // Encrypt the private key
            const encryptedData = this.encrypt(privateKey, password);
            
            // Load existing encrypted keys
            const encryptedKeys = await this.loadEncryptedKeys();
            
            // Add or update the encrypted key for this address
            encryptedKeys[normalizedAddress] = encryptedData;
            
            // Make sure the userprefs directory exists
            await this.ensureUserPrefsDirExists();
            
            // Save back to file
            const saveResult = await this.saveEncryptedKeys(encryptedKeys);
            
            // Verify the key was stored
            const keys = await this.loadEncryptedKeys();
            const keyVerified = !!keys[normalizedAddress];
            
            return saveResult && keyVerified;
        } catch (error) {
            ErrorHandler.handle(error, 'SecureStorage.storePrivateKey');
            return false;
        }
    }

    /**
     * Check if a private key exists for an address
     * @param {string} address - Wallet address
     * @returns {Promise<boolean>} True if a private key exists
     */
    async hasPrivateKey(address) {
        try {
            // Normalize address
            const normalizedAddress = address.toLowerCase();
            
            // Load encrypted keys
            const encryptedKeys = await this.loadEncryptedKeys();
            
            // Check if this address has a stored key
            return !!encryptedKeys[normalizedAddress];
        } catch (error) {
            ErrorHandler.handle(error, 'SecureStorage.hasPrivateKey');
            return false;
        }
    }

    /**
     * Retrieve and decrypt a private key
     * @param {string} address - Wallet address
     * @param {string} password - Password for decryption
     * @returns {Promise<string|null>} Decrypted private key or null if failed
     */
    async getPrivateKey(address, password) {
        try {
            // Normalize address
            const normalizedAddress = address.toLowerCase();
            
            // Load encrypted keys
            const encryptedKeys = await this.loadEncryptedKeys();
            
            // Check if we have a key for this address
            if (!encryptedKeys[normalizedAddress]) {
                throw ErrorHandler.createValidationError(`No private key found for address ${address}`);
            }
            
            // Decrypt the private key
            return this.decrypt(encryptedKeys[normalizedAddress], password);
        } catch (error) {
            ErrorHandler.handle(error, 'SecureStorage.getPrivateKey');
            return null;
        }
    }

    /**
     * Remove a stored private key
     * @param {string} address - Wallet address
     * @returns {Promise<boolean>} Success status
     */
    async removePrivateKey(address) {
        try {
            // Normalize address
            const normalizedAddress = address.toLowerCase();
            
            // Load encrypted keys
            const encryptedKeys = await this.loadEncryptedKeys();
            
            // Check if we have a key for this address
            if (!encryptedKeys[normalizedAddress]) {
                return true; // Already doesn't exist
            }
            
            // Remove the key
            delete encryptedKeys[normalizedAddress];
            
            // Save back to file
            return await this.saveEncryptedKeys(encryptedKeys);
        } catch (error) {
            ErrorHandler.handle(error, 'SecureStorage.removePrivateKey');
            return false;
        }
    }
}

module.exports = SecureStorage;