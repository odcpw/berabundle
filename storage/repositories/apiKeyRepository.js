// apiKeyManager.js - Service for managing API keys
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');
const { ErrorHandler } = require('../../utils/errorHandler');

/**
 * Manages API keys for various services
 */
class ApiKeyManager {
    constructor() {
        this.apiKeys = {};
        this.apiKeysFile = config.paths.apiKeysFile;
    }

    /**
     * Initialize the API key manager
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        try {
            // Ensure the userprefs directory exists
            const userprefsDir = path.dirname(this.apiKeysFile);
            await fs.mkdir(userprefsDir, { recursive: true });
            
            // Try to load existing API keys
            await this.loadApiKeys();
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'ApiKeyManager.initialize');
            return false;
        }
    }

    /**
     * Load API keys from file
     * @returns {Promise<Object>} API keys
     */
    async loadApiKeys() {
        try {
            try {
                const data = await fs.readFile(this.apiKeysFile, 'utf8');
                this.apiKeys = JSON.parse(data);
                console.log('Loaded API keys from file');
            } catch (error) {
                if (error.code === 'ENOENT') {
                    // Create empty file if it doesn't exist
                    this.apiKeys = {};
                    await this.saveApiKeys();
                    console.log('Created new API keys file');
                } else {
                    throw error;
                }
            }
            return this.apiKeys;
        } catch (error) {
            ErrorHandler.handle(error, 'ApiKeyManager.loadApiKeys');
            return {};
        }
    }

    /**
     * Save API keys to file
     * @returns {Promise<boolean>} Success status
     */
    async saveApiKeys() {
        try {
            await fs.writeFile(this.apiKeysFile, JSON.stringify(this.apiKeys, null, 2));
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'ApiKeyManager.saveApiKeys');
            return false;
        }
    }

    /**
     * Get API key by service name
     * @param {string} service - Service name
     * @returns {string|null} API key or null if not found
     */
    getApiKey(service) {
        return this.apiKeys[service] || null;
    }

    /**
     * Set API key for a service
     * @param {string} service - Service name
     * @param {string} apiKey - API key
     * @returns {Promise<boolean>} Success status
     */
    async setApiKey(service, apiKey) {
        try {
            this.apiKeys[service] = apiKey;
            await this.saveApiKeys();
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'ApiKeyManager.setApiKey');
            return false;
        }
    }

    /**
     * Remove API key for a service
     * @param {string} service - Service name
     * @returns {Promise<boolean>} Success status
     */
    async removeApiKey(service) {
        try {
            if (this.apiKeys[service]) {
                delete this.apiKeys[service];
                await this.saveApiKeys();
                return true;
            }
            return false;
        } catch (error) {
            ErrorHandler.handle(error, 'ApiKeyManager.removeApiKey');
            return false;
        }
    }
}

module.exports = ApiKeyManager;