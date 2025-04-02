/**
 * TokenBridge.js - Bridge between React UI and the core TokenService
 * 
 * This adapter allows the React UI to communicate with the TokenService
 * from the BeraBundle core codebase using browser-compatible methods.
 * It includes minimal implementations needed for the UI.
 */

import { ethers } from 'ethers';
import berabundlerService from './BerabundlerService';

/**
 * Service for fetching token balances and prices in the React UI
 */
class TokenBridge {
  constructor() {
    this.provider = null;
    this.signer = null;
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
    
    if (provider) {
      this.signer = provider.getSigner();
      // Initialize the BerabundlerService
      berabundlerService.initialize(provider, this.signer);
    }
    
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
      const balanceFloat = parseFloat(ethers.utils.formatEther(beraBalance));
      // Round to 2 decimal places
      const formattedBeraBalance = balanceFloat.toFixed(2);
      
      // Get BERA price
      let beraPrice = null;
      try {
        beraPrice = await this.getTokenPrice('BERA');
      } catch (err) {
        console.error("Error fetching BERA price:", err);
      }
      
      // Calculate value and round to 2 decimal places
      const valueUsd = beraPrice ? balanceFloat * beraPrice : 0;
      const roundedValueUsd = parseFloat(valueUsd.toFixed(2));
      
      return {
        name: 'BERA', // No symbol in name
        symbol: 'BERA', // Keep symbol separate
        address: 'native',
        decimals: 18,
        balance: formattedBeraBalance, // Already rounded to 2 decimals
        formattedBalance: formattedBeraBalance, // 2 decimal places, no symbol
        priceUsd: beraPrice,
        valueUsd: roundedValueUsd, // Rounded to 2 decimal places
        formattedValueUsd: roundedValueUsd.toLocaleString(undefined, {
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
      const balanceFloat = parseFloat(ethers.utils.formatUnits(rawBalance, token.decimals || 18));
      
      // Skip tokens with zero balance
      if (balanceFloat <= 0) return null;
      
      // Round to 2 decimal places
      const formattedBalance = balanceFloat.toFixed(2);
      
      // Get token price
      let tokenPrice = null;
      try {
        tokenPrice = await this.getTokenPrice(token.address);
      } catch (err) {
        console.error(`Error fetching price for ${token.symbol}:`, err);
      }
      
      // Calculate value and round to 2 decimal places
      const valueUsd = tokenPrice ? balanceFloat * tokenPrice : 0;
      const roundedValueUsd = parseFloat(valueUsd.toFixed(2));
      
      return {
        ...token, // Keep original token data (symbol, address, etc.)
        name: token.name, // No symbol in name
        symbol: token.symbol, // Keep symbol separate
        balance: formattedBalance, // Already rounded to 2 decimal places
        formattedBalance: formattedBalance, // 2 decimal places, no symbol
        priceUsd: tokenPrice,
        valueUsd: roundedValueUsd, // Rounded to 2 decimal places
        formattedValueUsd: roundedValueUsd.toLocaleString(undefined, {
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
        name: "Wrapped BERA", // No symbol in name
        decimals: 18,
      },
      {
        // BGT token address from config
        address: "0x656b95E550C07a9ffe548bd4085c72418Ceb1dba",
        symbol: "BGT",
        name: "Berachain Governance Token", // No symbol in name
        decimals: 18,
      },
      {
        // HONEY token address from config
        address: "0x7EeCA4205fF31f947EdBd49195a7A88E6A91161B",
        symbol: "HONEY",
        name: "Honey", // No symbol in name
        decimals: 18,
      },
      {
        address: "0x3452e23F9c4cC62c70B7ADAd699B2AF6a2d9D218",
        symbol: "STGUSDC",
        name: "Stargate USDC", // No symbol in name
        decimals: 6,
      },
      {
        // BGT Staker address from config
        address: "0x44F07Ce5AfeCbCC406e6beFD40cc2998eEb8c7C6",
        symbol: "BGT Staker",
        name: "BGT Staker", // No symbol in name
        decimals: 18,
      }
    ];
  }

  /**
   * Creates a swap bundle for the Berabundler contract
   * @param {string} fromAddress - Wallet address initiating the swaps
   * @param {Array<Object>} tokensToSwap - Array of token objects with amount to swap
   * @returns {Promise<Object>} Bundle containing transaction data and expected output
   */
  async createSwapBundle(fromAddress, tokensToSwap) {
    try {
      console.log(`Creating swap bundle for ${fromAddress} with ${tokensToSwap.length} tokens`);
      
      const swapTransactions = [];
      const approvalTransactions = [];
      
      for (const token of tokensToSwap) {
        // Skip if token is BERA
        if (token.address === 'native' || token.symbol === 'BERA') {
          continue;
        }
        
        // Convert the token amount to wei
        const amountIn = ethers.utils.parseUnits(
          token.amount.toString(),
          token.decimals || 18
        );
        
        // Get swap quote from API using the v1/swap endpoint
        const endpoint = `/v1/swap?tokenIn=${token.address}&tokenOut=0x0000000000000000000000000000000000000000&amount=${amountIn.toString()}&slippage=0.01&to=${fromAddress}`;
        const quoteResponse = await this.apiCallWithAuth(endpoint);
        
        if (!quoteResponse || !quoteResponse.tx) {
          throw new Error(`Swap response doesn't contain transaction data for ${token.symbol}`);
        }
        
        // Extract transaction details
        const { tx } = quoteResponse;
        
        // Add to swap transactions
        swapTransactions.push({
          to: tx.to,
          data: tx.data,
          value: tx.value || '0x0',
          gasLimit: tx.gasLimit || '0x55555',
          token: {
            symbol: token.symbol,
            address: token.address,
            amount: token.amount,
            amountIn: amountIn.toString()
          },
          quote: {
            expectedAmountOut: quoteResponse.assumedAmountOut || quoteResponse.expectedAmountOut,
            formattedAmountOut: ethers.utils.formatEther(quoteResponse.assumedAmountOut || quoteResponse.expectedAmountOut || '0'),
            minAmountOut: quoteResponse.routerParams?.swapTokenInfo?.outputMin || quoteResponse.minAmountOut,
            priceImpact: quoteResponse.priceImpact
          }
        });
        
        // Check if approval is needed
        if (this.provider) {
          try {
            const tokenContract = new ethers.Contract(
              token.address,
              ["function allowance(address owner, address spender) view returns (uint256)"],
              this.provider
            );
            
            const routerAddress = tx.to;
            const allowance = await tokenContract.allowance(fromAddress, routerAddress);
            
            if (allowance.lt(amountIn)) {
              console.log(`Need approval for ${token.symbol} to router ${routerAddress}`);
              // Add approval transaction
              approvalTransactions.push({
                to: routerAddress,
                token: {
                  symbol: token.symbol,
                  address: token.address
                },
                type: 'approval'
              });
            } else {
              console.log(`Token ${token.symbol} already has sufficient allowance`);
            }
          } catch (error) {
            console.error(`Failed to check allowance for ${token.symbol}:`, error);
            // Assume approval is needed if checking fails
            approvalTransactions.push({
              to: tx.to,
              token: {
                symbol: token.symbol,
                address: token.address
              },
              type: 'approval'
            });
          }
        }
      }
      
      // Calculate total expected BERA output
      const totalExpectedBera = swapTransactions.reduce(
        (sum, tx) => sum + parseFloat(tx.quote.formattedAmountOut || '0'),
        0
      );
      
      return {
        fromAddress,
        swapTxs: swapTransactions,
        approvalTxs: approvalTransactions,
        totalExpectedBera,
        formattedTotalExpectedBera: totalExpectedBera.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6
        }) + ' BERA'
      };
    } catch (error) {
      console.error("Error creating swap bundle:", error);
      return {
        error: error.message,
        fromAddress,
        swapTxs: [],
        approvalTxs: []
      };
    }
  }
  
  /**
   * Execute a swap bundle through the Berabundler contract
   * @param {Object} bundle - Bundle containing approval and swap transactions
   * @returns {Promise<Object>} Execution result
   */
  async executeSwapBundle(bundle) {
    if (!this.provider || !this.signer) {
      throw new Error("Provider or signer not initialized");
    }
    
    // Use the BerabundlerService to execute the bundle
    return await berabundlerService.executeBundle(bundle);
  }
}

// Export singleton instance
const tokenBridge = new TokenBridge();
export default tokenBridge;