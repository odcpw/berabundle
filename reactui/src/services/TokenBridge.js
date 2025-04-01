/**
 * TokenBridge.js - Bridge between React UI and the core TokenService
 * 
 * This adapter allows the React UI to communicate with the TokenService
 * from the BeraBundle core codebase using browser-compatible methods.
 * It includes minimal implementations needed for the UI.
 */

import { ethers } from 'ethers';

/**
 * Service for fetching token balances and prices in the React UI
 */
class TokenBridge {
  constructor() {
    this.provider = null;
    this.priceCache = {};
    this.priceExpiry = 5 * 60 * 1000; // 5 minutes
    this.apiKey = null; // Will need to be set by the user
    this.apiBaseUrl = 'https://mainnet.api.oogabooga.io';
  }
  
  /**
   * Initialize the bridge with a provider
   * @param {ethers.providers.Web3Provider} provider - Ethers provider
   * @param {string} apiKey - OogaBooga API key
   */
  initialize(provider, apiKey) {
    this.provider = provider;
    this.apiKey = apiKey;
    return Boolean(provider && apiKey);
  }
  
  /**
   * Check if the bridge is initialized
   */
  isInitialized() {
    return Boolean(this.provider && this.apiKey);
  }
  
  /**
   * Makes an authenticated API call to the OogaBooga API
   * 
   * @param {string} endpoint - API endpoint path
   * @param {Object} params - Query parameters to include in the request
   * @returns {Promise<Object>} API response data
   * @throws {Error} If API key is missing or API call fails
   */
  async apiCallWithAuth(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error("OogaBooga API key not set. Please set it in settings.");
    }
    
    const url = endpoint.startsWith('http') ? endpoint : `${this.apiBaseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${this.apiKey.trim()}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        return await response.json();
      } else {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Retrieves the current USD price for a token with caching
   * 
   * @param {string} tokenAddress - Token contract address or 'BERA'/'native' for native token
   * @returns {Promise<number|null>} Current price in USD or null if unavailable
   */
  async getTokenPrice(tokenAddress) {
    try {
      // Check cache first
      if (this.priceCache[tokenAddress] && 
          Date.now() - this.priceCache[tokenAddress].timestamp < this.priceExpiry) {
        return this.priceCache[tokenAddress].price;
      }
      
      // Format token address correctly
      const tokenParam = tokenAddress === 'BERA' || tokenAddress === 'native' 
        ? '0x0000000000000000000000000000000000000000' 
        : tokenAddress;
          
      // Fetch prices from API
      const response = await this.apiCallWithAuth('/v1/prices?currency=USD');
      
      // Response is an array of {address, price} objects
      if (response && Array.isArray(response)) {
        // Find the token in the price list
        const tokenPrice = response.find(item => 
          item.address.toLowerCase() === tokenParam.toLowerCase()
        );
        
        if (tokenPrice && tokenPrice.price) {
          const price = parseFloat(tokenPrice.price);
          
          // Update cache
          this.priceCache[tokenAddress] = {
            price,
            timestamp: Date.now()
          };
          
          return price;
        }
      }
      
      // If we reach here, price wasn't found
      return null;
      
    } catch (error) {
      console.error("Error fetching token price:", error);
      return null;
    }
  }
  
  /**
   * Gets native BERA balance for an address
   * 
   * @param {string} address - Wallet address
   * @returns {Promise<Object>} Balance information
   */
  async getNativeBalance(address) {
    try {
      if (!this.provider) throw new Error("Provider not initialized");
      
      const beraBalance = await this.provider.getBalance(address);
      const formattedBeraBalance = ethers.utils.formatEther(beraBalance);
      
      // Get BERA price
      let beraPrice = null;
      try {
        beraPrice = await this.getTokenPrice('BERA');
      } catch (err) {
        console.error("Error fetching BERA price:", err);
      }
      
      const beraValueUsd = beraPrice ? parseFloat(formattedBeraBalance) * beraPrice : 0;
      
      return {
        name: 'BERA',
        symbol: 'BERA',
        address: 'native',
        decimals: 18,
        balance: formattedBeraBalance,
        formattedBalance: parseFloat(formattedBeraBalance).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 6
        }),
        priceUsd: beraPrice,
        valueUsd: beraValueUsd,
        formattedValueUsd: beraValueUsd.toLocaleString(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }),
        isNative: true
      };
    } catch (error) {
      console.error("Error fetching native balance:", error);
      return null;
    }
  }
  
  /**
   * Gets token balances for a specific ERC20 token
   * 
   * @param {string} address - Wallet address
   * @param {Object} token - Token data (address, symbol, name, decimals)
   * @returns {Promise<Object|null>} Token with balance data or null if error/zero balance
   */
  async getTokenBalance(address, token) {
    try {
      if (!this.provider) throw new Error("Provider not initialized");
      
      // Skip tokens without an address
      if (!token.address || token.address === 'native') return null;
      
      const tokenContract = new ethers.Contract(
        token.address,
        ["function balanceOf(address) view returns (uint256)"],
        this.provider
      );
      
      const rawBalance = await tokenContract.balanceOf(address);
      const balance = ethers.utils.formatUnits(rawBalance, token.decimals || 18);
      
      // Skip tokens with zero balance
      if (parseFloat(balance) <= 0) return null;
      
      // Get token price
      let tokenPrice = null;
      try {
        tokenPrice = await this.getTokenPrice(token.address);
      } catch (err) {
        console.error(`Error fetching price for ${token.symbol}:`, err);
      }
      
      const valueUsd = tokenPrice ? parseFloat(balance) * tokenPrice : 0;
      
      return {
        ...token,
        balance,
        formattedBalance: parseFloat(balance).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 6
        }),
        priceUsd: tokenPrice,
        valueUsd: valueUsd,
        formattedValueUsd: valueUsd.toLocaleString(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      };
    } catch (error) {
      console.error(`Error fetching balance for ${token.symbol}:`, error);
      return null;
    }
  }
  
  /**
   * Fetches common token list for Berachain
   * 
   * @returns {Promise<Array>} Array of token objects
   */
  async getCommonTokens() {
    return [
      {
        address: "0x5806E416dA447b267cEA759358cF22Cc41FAE80F",
        symbol: "WBERA",
        name: "Wrapped BERA",
        decimals: 18,
      },
      {
        address: "0x28e774dD5050a7e13756EcD50AF1251849A90A9F",
        symbol: "BGT",
        name: "Berachain Governance Token",
        decimals: 18,
      },
      {
        address: "0x6581e59A1C8dA66a7B9878E23cCBAD5D42650787",
        symbol: "HONEY",
        name: "HONEY",
        decimals: 18,
      },
      {
        address: "0x3452e23F9c4cC62c70B7ADAd699B2AF6a2d9D218",
        symbol: "STGUSDC",
        name: "Stargate USDC",
        decimals: 6,
      }
    ];
  }
}

// Export singleton instance
const tokenBridge = new TokenBridge();
export default tokenBridge;