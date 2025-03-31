/**
 * MetadataFetcher - Centralized utility for fetching and updating metadata
 * 
 * This utility provides functions for fetching metadata from different sources:
 * - GitHub repositories (vaults, validators, tokens)
 * - OogaBooga API (token pricing and swap details)
 * 
 * Each data source is clearly separated into its own handler to improve
 * organization and make future updates easier.
 */

const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const config = require('../config');
const { ErrorHandler } = require('./errorHandler');
const FSHelpers = require('./fsHelpers');

class MetadataFetcher {
    constructor() {
        // GitHub metadata settings
        this.githubBaseUrls = [
            'https://raw.githubusercontent.com/berachain/metadata/refs/heads/main/src',
            'https://raw.githubusercontent.com/berachain/metadata/main/src',
            'https://raw.githubusercontent.com/berachain/metadata/master/src'
        ];
        
        // OogaBooga API settings
        this.oogaboogaBaseUrl = 'https://mainnet.api.oogabooga.io';
        
        // Cache settings
        this.fetchTimeout = 15000; // 15 seconds for fetch operations
        
        // API key fallback (in case apiKeyManager isn't available)
        this.tempApiKey = null;
    }
    
    /**
     * Fallback method to get or set an API key when apiKeyManager isn't available
     * @param {string} key - API key to set (optional)
     * @returns {string|null} - Current API key or null if not set
     */
    getOrSetApiKey(key = null) {
        if (key !== null) {
            this.tempApiKey = key;
        }
        
        // Return current key or environment variable as fallback
        return this.tempApiKey || process.env.OOGABOOGA_API_KEY;
    }

    /**
     * Ensures the metadata directory exists
     * @returns {Promise<boolean>} Success status
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
     * Fetch data from a URL using HTTPS with timeout
     * @param {string} url - The URL to fetch
     * @returns {Promise<string>} Response data as string
     */
    fetchUrl(url) {
        // Extract filename for cleaner logs
        const filename = url.split('/').pop();
        console.log(`Fetching ${filename}...`);
        
        return new Promise((resolve, reject) => {
            const req = https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    const errorMsg = `Request failed with status code ${response.statusCode} (${response.statusMessage})`;
                    console.error(`Error fetching ${filename}: ${errorMsg}`);
                    reject(new Error(errorMsg));
                    return;
                }

                // Simple status confirmation 
                console.log(`Connected to ${filename} successfully`);
                
                let data = '';
                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    console.log(`Downloaded ${(data.length/1024).toFixed(1)} KB of data`);
                    try {
                        // Try to parse as JSON to validate it early
                        JSON.parse(data);
                        resolve(data);
                    } catch (e) {
                        console.error(`Error: Downloaded data is not valid JSON`);
                        reject(new Error(`Downloaded data is not valid JSON: ${e.message}`));
                    }
                });
            }).on('error', (error) => {
                console.error(`Network error fetching ${filename}: ${error.message}`);
                reject(error);
            });

            // Set a timeout
            req.setTimeout(this.fetchTimeout, () => {
                req.destroy();
                console.error(`Request timed out for ${filename}`);
                reject(new Error(`Request timed out after ${this.fetchTimeout/1000} seconds`));
            });
        });
    }

    /**
     * Makes an authenticated API call to the OogaBooga API
     * @param {string} endpoint - API endpoint path
     * @param {Object} params - Query parameters
     * @param {string} apiKey - OogaBooga API key
     * @returns {Promise<Object>} API response
     */
    async oogaboogaApiCall(endpoint, params = {}, apiKey) {
        if (!apiKey) {
            throw new Error("OogaBooga API key is required");
        }
        
        const url = endpoint.startsWith('http') ? endpoint : `${this.oogaboogaBaseUrl}${endpoint}`;
        
        try {
            const response = await axios.get(url, {
                params,
                headers: { 'Authorization': `Bearer ${apiKey}` },
                timeout: this.fetchTimeout
            });
            
            if (response.status === 200) {
                return response;
            } else {
                throw new Error(`Received status ${response.status} from ${url}`);
            }
        } catch (error) {
            throw error;
        }
    }

    /**
     * Update validator metadata from GitHub
     * @param {boolean} forceRefresh - Force refresh from remote source
     * @returns {Promise<Object>} Result containing validator data
     */
    async fetchGithubValidators(forceRefresh = false) {
        try {
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            // Check if the file exists and we're not forcing refresh
            if (!forceRefresh) {
                try {
                    const filePath = config.paths.validatorsFile;
                    const fileExists = await FSHelpers.fileExists(filePath);
                    
                    if (fileExists) {
                        const data = await fs.readFile(filePath, 'utf8');
                        const validators = JSON.parse(data);
                        return {
                            success: true,
                            message: "Loaded validators from local cache",
                            data: validators, 
                            count: validators.length,
                            source: "local"
                        };
                    }
                } catch (error) {
                    console.warn(`Warning: Could not load validators from cache: ${error.message}`);
                }
            }
            
            // Try multiple GitHub URLs in sequence
            let errors = [];
            for (const baseUrl of this.githubBaseUrls) {
                try {
                    const url = `${baseUrl}/validators/mainnet.json`;
                    console.log(`Trying to fetch validators from: ${url}`);
                    
                    const data = await this.fetchUrl(url);
                    const parsed = JSON.parse(data);
                    
                    // Verify format
                    if (!parsed || !parsed.validators || !Array.isArray(parsed.validators)) {
                        throw new Error('Invalid validator data format');
                    }
                    
                    // Extract validator data
                    const validators = parsed.validators.map(validator => ({
                        id: validator.id,
                        name: validator.name,
                        pubkey: validator.pubkey || validator.id // For compatibility
                    }));
                    
                    // Save to file
                    await fs.writeFile(config.paths.validatorsFile, JSON.stringify(validators, null, 2));
                    
                    return {
                        success: true,
                        message: `Successfully fetched ${validators.length} validators from GitHub`,
                        data: validators,
                        count: validators.length,
                        source: "github"
                    };
                } catch (error) {
                    errors.push(`${baseUrl}: ${error.message}`);
                    // Continue to next URL
                }
            }
            
            // If we get here, all URLs failed
            throw new Error(`Failed to fetch validators from all URLs: ${errors.join('; ')}`);
            
        } catch (error) {
            return {
                success: false,
                message: error.message,
                data: [],
                count: 0
            };
        }
    }

    /**
     * Update vaults metadata from GitHub
     * @param {boolean} forceRefresh - Force refresh from remote source
     * @returns {Promise<Object>} Result containing vault data
     */
    async fetchGithubVaults(forceRefresh = false) {
        try {
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            // Check if the file exists and we're not forcing refresh
            if (!forceRefresh) {
                try {
                    const filePath = config.paths.vaultsFile;
                    const fileExists = await FSHelpers.fileExists(filePath);
                    
                    if (fileExists) {
                        const data = await fs.readFile(filePath, 'utf8');
                        const vaults = JSON.parse(data);
                        return {
                            success: true,
                            message: "Loaded vaults from local cache",
                            data: vaults, 
                            count: vaults.length,
                            source: "local"
                        };
                    }
                } catch (error) {
                    console.warn(`Warning: Could not load vaults from cache: ${error.message}`);
                }
            }
            
            // Try multiple GitHub URLs in sequence
            let errors = [];
            for (const baseUrl of this.githubBaseUrls) {
                try {
                    const url = `${baseUrl}/vaults/mainnet.json`;
                    console.log(`Trying to fetch vaults from: ${url}`);
                    
                    const data = await this.fetchUrl(url);
                    const parsed = JSON.parse(data);
                    
                    // Verify format
                    if (!parsed || !parsed.vaults || !Array.isArray(parsed.vaults)) {
                        throw new Error('Invalid vault data format');
                    }
                    
                    // First, save the original data to a backup file for debugging
                    try {
                        const backupPath = path.join(config.paths.metadataDir, 'vaults_original.json');
                        await fs.writeFile(backupPath, data);
                        console.log(`Saved original vault data to ${backupPath}`);
                    } catch (backupError) {
                        console.warn(`Could not save backup: ${backupError.message}`);
                    }
                    
                    // Extract vault array
                    const vaults = parsed.vaults;
                    
                    // Ensure compatibility by having both address and vaultAddress fields
                    const processedVaults = vaults.map(vault => {
                        const result = { ...vault };
                        if (!result.address && result.vaultAddress) {
                            result.address = result.vaultAddress;
                        }
                        if (!result.vaultAddress && result.address) {
                            result.vaultAddress = result.address;
                        }
                        return result;
                    });
                    
                    // Count valid vaults (with proper addresses)
                    const validVaults = processedVaults.filter(vault => {
                        const address = vault.address || vault.vaultAddress;
                        return address && typeof address === 'string' && address.startsWith('0x');
                    });
                    
                    // Save to file
                    await fs.writeFile(config.paths.vaultsFile, JSON.stringify(processedVaults, null, 2));
                    
                    return {
                        success: true,
                        message: `Successfully fetched ${processedVaults.length} vaults from GitHub (${validVaults.length} valid)`,
                        data: processedVaults,
                        count: processedVaults.length,
                        validCount: validVaults.length,
                        source: "github"
                    };
                } catch (error) {
                    errors.push(`${baseUrl}: ${error.message}`);
                    // Continue to next URL
                }
            }
            
            // If we get here, all URLs failed
            throw new Error(`Failed to fetch vaults from all URLs: ${errors.join('; ')}`);
            
        } catch (error) {
            return {
                success: false,
                message: error.message,
                data: [],
                count: 0
            };
        }
    }

    /**
     * Update token metadata from GitHub
     * @param {boolean} forceRefresh - Force refresh from remote source
     * @returns {Promise<Object>} Result containing token data
     */
    async fetchGithubTokens(forceRefresh = false) {
        try {
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            // Check if the file exists and we're not forcing refresh
            if (!forceRefresh) {
                try {
                    const filePath = config.paths.tokensFile;
                    const fileExists = await FSHelpers.fileExists(filePath);
                    
                    if (fileExists) {
                        const data = await fs.readFile(filePath, 'utf8');
                        const tokens = JSON.parse(data);
                        return {
                            success: true,
                            message: "Loaded tokens from local cache",
                            data: tokens, 
                            count: Object.keys(tokens).length,
                            source: "local"
                        };
                    }
                } catch (error) {
                    console.warn(`Warning: Could not load tokens from cache: ${error.message}`);
                }
            }
            
            // Try multiple GitHub URLs in sequence
            let errors = [];
            for (const baseUrl of this.githubBaseUrls) {
                try {
                    const url = `${baseUrl}/tokens/mainnet.json`;
                    console.log(`Trying to fetch tokens from: ${url}`);
                    
                    const data = await this.fetchUrl(url);
                    const parsed = JSON.parse(data);
                    
                    // Verify format
                    if (!parsed || !parsed.tokens || !Array.isArray(parsed.tokens)) {
                        throw new Error('Invalid token data format');
                    }
                    
                    // Transform to our format (address-keyed object)
                    const tokenMap = {};
                    let invalidCount = 0;
                    
                    parsed.tokens.forEach(token => {
                        if (token.address && typeof token.address === 'string' && token.address.startsWith('0x')) {
                            tokenMap[token.address.toLowerCase()] = {
                                address: token.address,
                                symbol: token.symbol || "UNKNOWN",
                                name: token.name || "Unknown Token",
                                decimals: token.decimals || 18,
                                logoURI: token.logoURI || ""
                            };
                        } else {
                            invalidCount++;
                        }
                    });
                    
                    // Add BERA native token if not included
                    if (!tokenMap["0x0000000000000000000000000000000000000000"]) {
                        tokenMap["0x0000000000000000000000000000000000000000"] = {
                            address: "0x0000000000000000000000000000000000000000",
                            symbol: "BERA",
                            name: "Berachain Token",
                            decimals: 18,
                            logoURI: "https://berachain.com/logo.png"
                        };
                    }
                    
                    // Save to file
                    await fs.writeFile(config.paths.tokensFile, JSON.stringify(tokenMap, null, 2));
                    
                    // Save timestamp for cache management
                    const timestampPath = `${config.paths.metadataDir}/tokens_updated.json`;
                    await fs.writeFile(timestampPath, JSON.stringify({ 
                        timestamp: Date.now(),
                        count: Object.keys(tokenMap).length,
                        source: "github"
                    }));
                    
                    return {
                        success: true,
                        message: `Successfully fetched ${Object.keys(tokenMap).length} tokens from GitHub`,
                        data: tokenMap,
                        count: Object.keys(tokenMap).length,
                        invalidCount,
                        source: "github"
                    };
                } catch (error) {
                    errors.push(`${baseUrl}: ${error.message}`);
                    // Continue to next URL
                }
            }
            
            // If we get here, all URLs failed
            throw new Error(`Failed to fetch tokens from all URLs: ${errors.join('; ')}`);
            
        } catch (error) {
            return {
                success: false,
                message: error.message,
                data: {},
                count: 0
            };
        }
    }

    /**
     * Update token metadata from OogaBooga API
     * @param {string} apiKey - OogaBooga API key
     * @returns {Promise<Object>} Result containing token data
     */
    async fetchOogaboogaTokens(apiKey) {
        try {
            if (!apiKey) {
                throw new Error("OogaBooga API key not provided");
            }
            
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            // Fetch tokens from API
            const response = await this.oogaboogaApiCall('/v1/tokens', {}, apiKey);
            
            // Verify we have an array
            if (!response.data || !Array.isArray(response.data)) {
                throw new Error("Unexpected API response format");
            }
            
            // Transform the data into our preferred format (address-keyed object)
            const tokenMap = {};
            let invalidCount = 0;
            
            response.data.forEach(token => {
                if (token.address && typeof token.address === 'string' && token.address.startsWith('0x')) {
                    tokenMap[token.address.toLowerCase()] = {
                        address: token.address,
                        symbol: token.symbol || "UNKNOWN",
                        name: token.name || "Unknown Token",
                        decimals: token.decimals || 18,
                        logoURI: token.logoURI || ""
                    };
                } else {
                    invalidCount++;
                }
            });
            
            // Add BERA native token if not included
            if (!tokenMap["0x0000000000000000000000000000000000000000"]) {
                tokenMap["0x0000000000000000000000000000000000000000"] = {
                    address: "0x0000000000000000000000000000000000000000",
                    symbol: "BERA",
                    name: "Berachain Token",
                    decimals: 18,
                    logoURI: "https://res.cloudinary.com/duv0g402y/raw/upload/v1717773645/src/assets/bera.png"
                };
            }
            
            // Save to metadata file
            await fs.writeFile(config.paths.tokensFile, JSON.stringify(tokenMap, null, 2));
            
            // Save timestamp for cache management
            const timestampPath = `${config.paths.metadataDir}/tokens_updated.json`;
            await fs.writeFile(timestampPath, JSON.stringify({ 
                timestamp: Date.now(),
                count: Object.keys(tokenMap).length,
                source: "oogabooga"
            }));
            
            return {
                success: true,
                message: `Successfully fetched ${Object.keys(tokenMap).length} tokens from OogaBooga API`,
                data: tokenMap,
                count: Object.keys(tokenMap).length,
                invalidCount,
                source: "oogabooga"
            };
            
        } catch (error) {
            console.error("OogaBooga token fetch error:", error.message);
            return {
                success: false,
                message: error.message,
                data: {},
                count: 0
            };
        }
    }

    /**
     * Update all metadata from GitHub in a single operation
     * @param {boolean} forceRefresh - Force refresh from remote
     * @returns {Promise<Object>} Result containing all metadata
     */
    async fetchAllGithubMetadata(forceRefresh = false) {
        console.log("Fetching all GitHub metadata in parallel...");
        
        try {
            // Run all fetches in parallel for better performance
            const [validatorsResult, vaultsResult, tokensResult] = await Promise.all([
                this.fetchGithubValidators(forceRefresh),
                this.fetchGithubVaults(forceRefresh),
                this.fetchGithubTokens(forceRefresh)
            ]);
            
            // Return combined results
            return {
                success: validatorsResult.success && vaultsResult.success && tokensResult.success,
                validators: validatorsResult,
                vaults: vaultsResult,
                tokens: tokensResult,
                message: "GitHub metadata fetch complete"
            };
        } catch (error) {
            ErrorHandler.handle(error, 'MetadataFetcher.fetchAllGithubMetadata');
            return {
                success: false,
                message: error.message,
                validators: { success: false, data: [], count: 0 },
                vaults: { success: false, data: [], count: 0 },
                tokens: { success: false, data: {}, count: 0 }
            };
        }
    }
}

module.exports = MetadataFetcher;