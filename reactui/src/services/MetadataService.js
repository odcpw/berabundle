/**
 * MetadataService.js - Service for fetching and managing metadata for BeraBundle React UI
 * 
 * This service handles fetching metadata from external sources:
 * - GitHub tokens, vaults, and validators lists
 * - OogaBooga token list
 * 
 * It stores each dataset separately in localStorage with timestamps.
 */

import tokenBridge from './TokenBridge';
import { ethers } from 'ethers';

// GitHub repositories and files
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const METADATA_REPO = 'berachain/metadata';
const METADATA_BRANCH = 'main';

// Storage keys
const STORAGE_KEYS = {
  GITHUB_TOKENS: 'berabundle_github_tokens',
  OOGABOOGA_TOKENS: 'berabundle_oogabooga_tokens',
  VALIDATORS: 'berabundle_validators',
  VAULTS: 'berabundle_vaults',
  OOGABOOGA_API_KEY: 'oogaboogaApiKey',
  LAST_UPDATE: 'berabundle_metadata_last_update'
};

/**
 * Service for managing metadata retrieval and storage
 */
class MetadataService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the metadata service
   */
  initialize() {
    this.initialized = true;
    return this.initialized;
  }

  /**
   * Store data in local storage with timestamp
   * @param {string} key - Local storage key
   * @param {any} data - Data to store
   */
  storeData(key, data) {
    try {
      const dataWithTimestamp = {
        timestamp: Date.now(),
        data: data
      };
      localStorage.setItem(key, JSON.stringify(dataWithTimestamp));
    } catch (error) {
      console.error(`Error storing data for ${key}:`, error);
    }
  }

  /**
   * Get data from local storage
   * @param {string} key - Local storage key
   * @returns {Object|null} Object with data and timestamp, or null if not found
   */
  getData(key) {
    try {
      const storedData = localStorage.getItem(key);
      if (!storedData) return null;
      
      return JSON.parse(storedData);
    } catch (error) {
      console.error(`Error getting data for ${key}:`, error);
      return null;
    }
  }

  /**
   * Fetch content from a GitHub repository
   * @param {string} path - Path to the file in the repository
   * @returns {Promise<any>} Response data 
   */
  async fetchFromGitHub(path) {
    const url = `${GITHUB_RAW_BASE}/${METADATA_REPO}/${METADATA_BRANCH}/${path}`;
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`GitHub fetch failed: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Error fetching from GitHub (${path}):`, error);
      throw error;
    }
  }

  /**
   * Fetch GitHub tokens list
   * @returns {Promise<Object>} Result object with tokens data
   */
  async fetchGitHubTokens() {
    try {
      const tokens = await this.fetchFromGitHub('src/tokens/mainnet.json');
      
      // Create metadata object - GitHub tokens are already in array format
      const metadata = {
        data: tokens,
        count: tokens.length,
        timestamp: Date.now(),
        source: "github"
      };
      
      // Store in localStorage
      this.storeData(STORAGE_KEYS.GITHUB_TOKENS, metadata);
      
      return {
        success: true,
        tokens: metadata,
        count: metadata.count
      };
    } catch (error) {
      console.error("Error fetching tokens from GitHub:", error);
      return {
        success: false,
        error: error.message || "Failed to fetch token data from GitHub"
      };
    }
  }

  /**
   * Fetch vaults list from GitHub
   * @returns {Promise<Object>} Result object with vaults data
   */
  async fetchVaults() {
    try {
      const vaultsData = await this.fetchFromGitHub('src/vaults/mainnet.json');
      
      // Process vaults data - extract just the vaults array
      let processedVaults = [];
      
      if (vaultsData && vaultsData.vaults && Array.isArray(vaultsData.vaults)) {
        console.log(`Found ${vaultsData.vaults.length} vaults in GitHub data`);
        
        // Extract protocols for mapping
        const protocols = {};
        if (vaultsData.protocols && Array.isArray(vaultsData.protocols)) {
          vaultsData.protocols.forEach(protocol => {
            if (protocol.name) {
              protocols[protocol.name] = protocol;
            }
          });
          console.log(`Loaded ${Object.keys(protocols).length} protocols from GitHub data`);
        }
        
        // Process each vault and add protocol information
        processedVaults = vaultsData.vaults.map(vault => {
          // Get the protocol data if available
          const protocolData = vault.protocol && protocols[vault.protocol] ? protocols[vault.protocol] : null;
          
          return {
            ...vault,
            // Add protocol details if available
            protocolLogo: protocolData ? protocolData.logoURI : null,
            protocolUrl: protocolData ? protocolData.url : null,
            protocolDescription: protocolData ? protocolData.description : null
          };
        });
      } else {
        console.warn("Unexpected vaults data format from GitHub");
      }
      
      // Create metadata object with processed vaults
      const metadata = {
        data: processedVaults,
        count: processedVaults.length,
        timestamp: Date.now(),
        source: "github"
      };
      
      // Store in localStorage
      this.storeData(STORAGE_KEYS.VAULTS, metadata);
      
      return {
        success: true,
        vaults: metadata,
        count: metadata.count
      };
    } catch (error) {
      console.error("Error fetching vaults from GitHub:", error);
      return {
        success: false,
        error: error.message || "Failed to fetch vault data"
      };
    }
  }

  /**
   * Fetch validators list from GitHub or local file
   * @returns {Promise<Object>} Result object with validators data
   */
  async fetchValidators() {
    try {
      // First try GitHub
      try {
        const validators = await this.fetchFromGitHub('src/validators/mainnet.json');
        
        if (validators && Array.isArray(validators)) {
          // Create metadata object
          const metadata = {
            data: validators,
            count: validators.length,
            timestamp: Date.now(),
            source: "github"
          };
          
          // Store in localStorage
          this.storeData(STORAGE_KEYS.VALIDATORS, metadata);
          
          console.log(`Successfully fetched ${validators.length} validators from GitHub`);
          
          return {
            success: true,
            validators: metadata,
            count: metadata.count
          };
        }
      } catch (gitHubError) {
        console.warn("Could not fetch validators from GitHub:", gitHubError);
      }
      
      // If GitHub fails, try with local fallback
      console.log("Falling back to local validators.json data");
      
      try {
        // Try to fetch validators.json from the public directory
        const validatorsFileUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/validators.json` : '/validators.json';
        console.log(`Attempting to fetch validators from: ${validatorsFileUrl}`);
        const localValidatorsData = await fetch(validatorsFileUrl).catch(err => {
          console.warn(`Could not load validators.json from public folder:`, err);
          return null;
        });
        
        if (localValidatorsData) {
          const validators = await localValidatorsData.json();
          
          if (validators && Array.isArray(validators)) {
            // Create metadata object
            const metadata = {
              data: validators,
              count: validators.length,
              timestamp: Date.now(),
              source: "local"
            };
            
            // Store in localStorage
            this.storeData(STORAGE_KEYS.VALIDATORS, metadata);
            
            console.log(`Successfully fetched ${validators.length} validators from local file`);
            
            return {
              success: true,
              validators: metadata,
              count: metadata.count
            };
          }
        }
      } catch (localError) {
        console.warn("Could not fetch validators from local file:", localError);
      }
      
      // If all fetches fail, try to use hardcoded validators
      console.log("Falling back to hardcoded validators data");
      
      // Simplified hardcoded validators data
      const hardcodedValidators = [
        {
          "id": "0xa3539ca28e0fd74d2a3c4c552740be77d6914cad2d8ec16583492cc57e8cfa358c62e31cc9106b1700cc169962855a6f",
          "name": "L0vd"
        },
        {
          "id": "0x832153bf3e09b9cab14414425a0ebaeb889e21d20872ebb990ed9a6102d7dc7f3017d4689f931a8e96d918bdeb184e1b",
          "name": "BGTScan"
        },
        {
          "id": "0xa232a81b5e834b817db01d85ee13e36552b48413626287de511b6c89b7b8ff4a448e865713fd21c98f1467a58fe6efe5",
          "name": "StakeUs (lowest commission)"
        }
      ];
      
      // Create metadata object for hardcoded validators
      const hardcodedMetadata = {
        data: hardcodedValidators,
        count: hardcodedValidators.length,
        timestamp: Date.now(),
        source: "hardcoded"
      };
      
      // Store in localStorage
      this.storeData(STORAGE_KEYS.VALIDATORS, hardcodedMetadata);
      
      console.log(`Using ${hardcodedValidators.length} hardcoded validators`);
      
      return {
        success: true,
        validators: hardcodedMetadata,
        count: hardcodedMetadata.count
      };
    } catch (error) {
      console.error("Error fetching validators:", error);
      return {
        success: false,
        error: error.message || "Failed to fetch validator data"
      };
    }
  }

  /**
   * Fetch tokens from OogaBooga API
   * @returns {Promise<Object>} Result object with tokens data
   */
  async fetchOogaBoogaTokens() {
    try {
      const apiKey = localStorage.getItem(STORAGE_KEYS.OOGABOOGA_API_KEY);
      
      if (!apiKey) {
        return {
          success: false,
          error: "OogaBooga API key not set"
        };
      }
      
      // Initialize tokenBridge with the API key if we have a provider
      if (window.ethereum) {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        tokenBridge.initialize(provider, apiKey);
      }
      
      // Fetch tokens from OogaBooga API
      const response = await tokenBridge.apiCallWithAuth('/v1/tokens');
      
      if (!response || !Array.isArray(response)) {
        throw new Error("Invalid response from OogaBooga API");
      }
      
      // Transform to object with address as key
      const tokenMap = {};
      
      response.forEach(token => {
        tokenMap[token.address.toLowerCase()] = {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          logoURI: token.logoURI
        };
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
      
      // Create a metadata object similar to the local file format
      const metadata = {
        timestamp: Date.now(),
        count: response.length + 1, // +1 for BERA if we added it
        source: "oogabooga",
        data: tokenMap
      };
      
      // Store in localStorage
      this.storeData(STORAGE_KEYS.OOGABOOGA_TOKENS, metadata);
      
      return {
        success: true,
        tokens: metadata,
        count: metadata.count
      };
    } catch (error) {
      console.error("Error fetching tokens from OogaBooga:", error);
      return {
        success: false,
        error: error.message || "Failed to fetch token data from OogaBooga"
      };
    }
  }

  /**
   * Get GitHub tokens from localStorage or fetch if not available
   * @param {boolean} forceRefresh - Force refresh from GitHub
   * @returns {Promise<Object>} Result object with tokens data
   */
  async getGitHubTokens(forceRefresh = false) {
    // Try to get from localStorage first
    const storedData = this.getData(STORAGE_KEYS.GITHUB_TOKENS);
    
    if (!forceRefresh && storedData) {
      return {
        success: true,
        tokens: storedData.data,
        count: Object.keys(storedData.data).length,
        timestamp: storedData.timestamp
      };
    }
    
    // Fetch from GitHub
    return await this.fetchGitHubTokens();
  }

  /**
   * Get OogaBooga tokens from localStorage or fetch if not available
   * @param {boolean} forceRefresh - Force refresh from OogaBooga
   * @returns {Promise<Object>} Result object with tokens data
   */
  async getOogaBoogaTokens(forceRefresh = false) {
    // Try to get from localStorage first
    const storedData = this.getData(STORAGE_KEYS.OOGABOOGA_TOKENS);
    
    if (!forceRefresh && storedData) {
      return {
        success: true,
        tokens: storedData.data,
        count: Object.keys(storedData.data).length,
        timestamp: storedData.timestamp
      };
    }
    
    // Fetch from OogaBooga
    return await this.fetchOogaBoogaTokens();
  }

  /**
   * Get vaults from localStorage or fetch if not available
   * @param {boolean} forceRefresh - Force refresh from GitHub
   * @returns {Promise<Object>} Result object with vaults data
   */
  async getVaults(forceRefresh = false) {
    // Try to get from localStorage first
    const storedData = this.getData(STORAGE_KEYS.VAULTS);
    
    if (!forceRefresh && storedData) {
      return {
        success: true,
        vaults: storedData.data,
        count: storedData.data.length,
        timestamp: storedData.timestamp
      };
    }
    
    // Fetch from GitHub
    return await this.fetchVaults();
  }

  /**
   * Get validators from localStorage or fetch if not available
   * @param {boolean} forceRefresh - Force refresh from GitHub
   * @returns {Promise<Object>} Result object with validators data
   */
  async getValidators(forceRefresh = false) {
    // Try to get from localStorage first
    const storedData = this.getData(STORAGE_KEYS.VALIDATORS);
    
    if (!forceRefresh && storedData) {
      return {
        success: true,
        validators: storedData.data,
        count: storedData.data.length,
        timestamp: storedData.timestamp
      };
    }
    
    // Fetch from GitHub
    return await this.fetchValidators();
  }

  /**
   * Update all metadata from sources
   * @returns {Promise<Object>} Result object with status for all metadata types
   */
  async updateAllMetadata() {
    try {
      // Fetch all metadata types in parallel
      const [
        githubTokensResult,
        oogaBoogaTokensResult, 
        vaultsResult, 
        validatorsResult
      ] = await Promise.all([
        this.fetchGitHubTokens(),
        this.fetchOogaBoogaTokens(), 
        this.fetchVaults(), 
        this.fetchValidators()
      ]);
      
      // Store the last update timestamp
      localStorage.setItem(STORAGE_KEYS.LAST_UPDATE, Date.now().toString());
      
      return {
        success: githubTokensResult.success || oogaBoogaTokensResult.success || vaultsResult.success || validatorsResult.success,
        githubTokens: githubTokensResult,
        oogaBoogaTokens: oogaBoogaTokensResult,
        vaults: vaultsResult,
        validators: validatorsResult,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error("Error updating all metadata:", error);
      return {
        success: false,
        error: error.message || "Failed to update metadata",
        timestamp: Date.now()
      };
    }
  }

  /**
   * Get the last update timestamp
   * @returns {number} Timestamp of last metadata update
   */
  getLastUpdateTimestamp() {
    const timestamp = localStorage.getItem(STORAGE_KEYS.LAST_UPDATE);
    return timestamp ? parseInt(timestamp) : null;
  }

  /**
   * Get all metadata from localStorage (without fetching)
   * @returns {Object} All metadata status
   */
  getAllMetadataStatus() {
    return {
      githubTokens: this.getData(STORAGE_KEYS.GITHUB_TOKENS),
      oogaBoogaTokens: this.getData(STORAGE_KEYS.OOGABOOGA_TOKENS),
      vaults: this.getData(STORAGE_KEYS.VAULTS),
      validators: this.getData(STORAGE_KEYS.VALIDATORS),
      lastUpdate: this.getLastUpdateTimestamp()
    };
  }
}

// Export singleton instance
const metadataService = new MetadataService();
export default metadataService;