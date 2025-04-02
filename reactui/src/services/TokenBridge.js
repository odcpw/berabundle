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
    this.bundlerContract = berabundlerService.contractAddress;
  }
  
  /**
   * Initialize the bridge with a provider and signer
   * @param {ethers.providers.Web3Provider} provider - Ethers provider
   * @param {string} apiKey - OogaBooga API key
   * @param {ethers.Signer} signer - Ethers signer
   */
  initialize(provider, apiKey, signer) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.signer = signer;
    
    // Initialize the BerabundlerService
    if (provider && signer) {
      berabundlerService.initialize(provider, signer);
    }
    
    return Boolean(provider && apiKey && signer);
  }
  
  /**
   * Check if the bridge is initialized
   */
  isInitialized() {
    return Boolean(this.provider && this.apiKey && this.signer);
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
    console.log("[DEBUG] Making API request to:", url);
    
    try {
      // Log API request
      const requestConfig = {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${this.apiKey.trim()}`,
          'Accept': 'application/json'
        }
      };
      
      // Don't log the actual API key in production
      console.log('[DEBUG] API request config:', {
        ...requestConfig,
        headers: {
          ...requestConfig.headers,
          'Authorization': `Bearer ${this.apiKey.substring(0, 3)}...${this.apiKey.substring(this.apiKey.length - 3)}`
        }
      });
      
      const response = await fetch(url, requestConfig);
      
      // Log response status
      console.log(`[DEBUG] API response status: ${response.status} ${response.statusText}`);
      console.log('[DEBUG] API response headers:', Object.fromEntries([...response.headers.entries()]));
      
      if (response.ok) {
        const responseData = await response.json();
        return responseData;
      } else {
        // For error responses, try to extract any available error details
        let errorDetails = '';
        try {
          const errorResponse = await response.text();
          console.log('[DEBUG] API error response:', errorResponse);
          errorDetails = errorResponse;
        } catch (e) {
          console.log('[DEBUG] Could not parse error response:', e);
        }
        
        throw new Error(`API error: ${response.status} ${response.statusText}${errorDetails ? ` - ${errorDetails}` : ''}`);
      }
    } catch (error) {
      console.error('[DEBUG] API call failed:', error);
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
   * @param {Object} options - Additional options for bundle creation
   * @param {Object} options.targetToken - The token to swap to (defaults to BERA)
   * @returns {Promise<Object>} Bundle containing transaction data and expected output
   */
  async createSwapBundle(fromAddress, tokensToSwap, options = {}) {
    try {
      const targetToken = options.targetToken || { address: '0x0000000000000000000000000000000000000000', symbol: 'BERA', decimals: 18 };
      console.log(`Creating swap bundle for ${fromAddress} with ${tokensToSwap.length} tokens, target: ${targetToken.symbol}`);
      console.log("Token data:", tokensToSwap);
      console.log("Target token:", targetToken);
      
      const swapTransactions = [];
      const routerApprovalTxs = []; // Approvals for routers
      const bundlerApprovalTxs = []; // Approvals for the bundler contract
      
      for (const token of tokensToSwap) {
        // Skip if token is BERA
        if (token.address === 'native' || token.symbol === 'BERA') {
          continue;
        }
        
        // Make sure we have the token address
        if (!token.address) {
          console.error("Token address is missing", token);
          continue;
        }
        
        console.log(`Processing token ${token.symbol} (${token.address})`);
        
        // Convert the token amount to wei
        const amountIn = ethers.utils.parseUnits(
          token.amount.toString(),
          token.decimals || 18
        );
        
        console.log(`Amount: ${token.amount}, Decimals: ${token.decimals}, Parsed: ${amountIn.toString()}`);
        
        // Get swap quote from API using the v1/swap endpoint with the custom target token
        const targetTokenAddress = targetToken.address;
        const endpoint = `/v1/swap?tokenIn=${token.address}&tokenOut=${targetTokenAddress}&amount=${amountIn.toString()}&slippage=0.01&to=${fromAddress}`;
        console.log("[DEBUG] API endpoint:", endpoint);
        console.log("[DEBUG] API request URL:", `${this.apiBaseUrl}${endpoint}`);
        
        // Log the request details
        console.log("[DEBUG] API request details:", {
          method: 'GET',
          url: `${this.apiBaseUrl}${endpoint}`,
          headers: { 
            'Authorization': `Bearer ${this.apiKey.substring(0, 3)}...${this.apiKey.substring(this.apiKey.length - 3)}`, // Log partial API key for security
            'Accept': 'application/json'
          }
        });
        
        const startTime = performance.now();
        const quoteResponse = await this.apiCallWithAuth(endpoint);
        const endTime = performance.now();
        
        console.log(`[DEBUG] API response received in ${(endTime - startTime).toFixed(2)}ms`);
        console.log("[DEBUG] API response:", JSON.stringify(quoteResponse, null, 2));
        
        if (!quoteResponse || !quoteResponse.tx) {
          throw new Error(`Swap response doesn't contain transaction data for ${token.symbol}`);
        }
        
        // Extract transaction details
        const { tx } = quoteResponse;
        
        // Ensure the router address is valid
        if (!tx.to) {
          throw new Error(`Invalid router address in swap response for ${token.symbol}`);
        }
        
        // IMPORTANT: For Berabundler to work with the router, we need to make sure:
        // 1. The value field is correctly formatted as a string if hex, or converted to hex if number
        // 2. The data field is properly formatted as a hex string
        
        // Normalize value to ensure it's a valid hex string
        let valueHex = tx.value || '0x0';
        if (typeof valueHex === 'number') {
          valueHex = '0x' + valueHex.toString(16);
        } else if (typeof valueHex === 'string' && !valueHex.startsWith('0x')) {
          valueHex = '0x' + parseInt(valueHex).toString(16);
        }
        
        // Check that we have a valid router address
        if (!tx.to) {
          throw new Error(`Invalid router address in swap response for ${token.symbol}`);
        }
        
        // Build a swapParams object to organize parameters for direct swap execution
        const swapParams = {
          router: tx.to,
          inputToken: token.address,
          inputAmount: amountIn.toString(),
          outputToken: quoteResponse.routerParams?.swapTokenInfo?.tokenOut || "0x0000000000000000000000000000000000000000",
          outputQuote: quoteResponse.assumedAmountOut || quoteResponse.expectedAmountOut,
          minOutput: quoteResponse.routerParams?.swapTokenInfo?.outputMin || quoteResponse.minAmountOut,
          pathDefinition: quoteResponse.routerParams?.path || "0x",
          executor: quoteResponse.routerParams?.executor, // if provided
          referralCode: quoteResponse.referralCode || 0
        };
        
        // Use the already normalized valueHex from earlier
        
        swapTransactions.push({
          swapParams, // include our structured swap parameters
          to: tx.to,
          data: tx.data,
          value: valueHex,
          gasLimit: tx.gasLimit || '0x55555',
          token: {
            symbol: token.symbol,
            address: token.address,
            amount: token.amount,
            amountIn: amountIn.toString(),
            decimals: token.decimals || 18
          },
          quote: {
            expectedAmountOut: swapParams.outputQuote,
            formattedAmountOut: ethers.utils.formatEther(swapParams.outputQuote),
            minAmountOut: swapParams.minOutput,
            priceImpact: quoteResponse.priceImpact
          }
        });
        
        // Check if approval is needed for the BUNDLER
        if (this.provider) {
          try {
            // Check if token is approved for bundler
            const isBundlerApproved = await this.checkBundlerApproval(
              token.address, 
              fromAddress, 
              amountIn
            );
            
            if (!isBundlerApproved) {
              console.log(`Need approval for ${token.symbol} to bundler ${this.bundlerContract}`);
              
              // Add bundler approval transaction
              bundlerApprovalTxs.push({
                token: {
                  symbol: token.symbol,
                  address: token.address,
                  amount: token.amount,
                  amountIn: amountIn.toString()
                },
                type: 'bundlerApproval'
              });
            } else {
              console.log(`Token ${token.symbol} already approved for bundler`);
            }
            
            // We no longer need router approvals when using the bundler contract
            // But keep the code to check router approvals for comparison
            const tokenContract = new ethers.Contract(
              token.address,
              ["function allowance(address owner, address spender) view returns (uint256)"],
              this.provider
            );
            
            const routerAddress = tx.to;
            const allowance = await tokenContract.allowance(fromAddress, routerAddress);
            
            if (allowance.lt(amountIn)) {
              console.log(`[INFO] Router approval needed for ${token.symbol} to router ${routerAddress}, but we're using bundler instead`);
              // Note: We're not adding router approvals anymore - bundler will handle it
            } else {
              console.log(`[INFO] Token ${token.symbol} already has sufficient allowance to router ${routerAddress}`);
            }
          } catch (error) {
            console.error(`Failed to check allowances for ${token.symbol}:`, error);
            // Assume bundler approval is needed if checking fails
            bundlerApprovalTxs.push({
              token: {
                symbol: token.symbol,
                address: token.address,
                amount: token.amount,
                amountIn: amountIn.toString()
              },
              type: 'bundlerApproval'
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
        approvalTxs: routerApprovalTxs, // Keep for compatibility
        bundlerApprovalTxs, // New field for bundler approvals
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
        approvalTxs: [],
        bundlerApprovalTxs: []
      };
    }
  }
  
  /**
   * Check if a token is approved for the bundler contract
   * @param {string} tokenAddress - The token contract address
   * @param {string} ownerAddress - The token owner address
   * @param {string|number} amount - The amount to check approval for
   * @returns {Promise<boolean>} Whether the token is approved
   */
  async checkBundlerApproval(tokenAddress, ownerAddress, amount) {
    if (!this.provider) {
      throw new Error("Provider not initialized");
    }
    
    try {
      // Create a contract instance for the token
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function allowance(address owner, address spender) view returns (uint256)"],
        this.provider
      );
      
      // Convert amount to BigNumber if it's not already
      const amountBN = ethers.BigNumber.isBigNumber(amount) 
        ? amount 
        : ethers.utils.parseUnits(amount.toString(), 18);
      
      // Check allowance for the bundler contract
      const allowance = await tokenContract.allowance(ownerAddress, this.bundlerContract);
      console.log(`Token ${tokenAddress} allowance to bundler: ${allowance.toString()}`);
      
      // Check if allowance is greater than or equal to amount
      return allowance.gte(amountBN);
    } catch (error) {
      console.error(`Error checking bundler approval for ${tokenAddress}:`, error);
      return false;
    }
  }

  /**
   * Approve a token for the bundler contract
   * @param {string} tokenAddress - The token contract address
   * @param {string} amount - The amount to approve (use ethers.constants.MaxUint256 for unlimited)
   * @returns {Promise<Object>} Transaction result
   */
  async approveTokenToBundler(tokenAddress, amount = ethers.constants.MaxUint256) {
    if (!this.provider || !this.signer) {
      throw new Error("Provider or signer not initialized");
    }
    
    try {
      console.log(`Directly approving ${tokenAddress} to bundler ${this.bundlerContract}`);
      
      // Create a contract instance for the token
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function approve(address spender, uint256 amount) returns (bool)"],
        this.signer
      );
      
      // Send the approval transaction
      const tx = await tokenContract.approve(this.bundlerContract, amount);
      console.log(`Approval transaction sent: ${tx.hash}`);
      
      // Wait for the approval to be confirmed
      const receipt = await tx.wait();
      console.log(`Approval confirmed in block ${receipt.blockNumber}`);
      
      return {
        success: true,
        hash: tx.hash,
        receipt: receipt
      };
    } catch (error) {
      console.error(`Error approving token to bundler:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Directly approve tokens to the router
   * @param {string} tokenAddress - The token contract address
   * @param {string} routerAddress - The router address to approve
   * @param {string} amount - The amount to approve (use ethers.constants.MaxUint256 for unlimited)
   * @returns {Promise<Object>} Transaction result
   */
  async approveTokenToRouter(tokenAddress, routerAddress, amount = ethers.constants.MaxUint256) {
    if (!this.provider || !this.signer) {
      throw new Error("Provider or signer not initialized");
    }
    
    try {
      console.log(`Directly approving ${tokenAddress} to router ${routerAddress}`);
      
      // Create a contract instance for the token
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function approve(address spender, uint256 amount) returns (bool)"],
        this.signer
      );
      
      // Send the approval transaction
      const tx = await tokenContract.approve(routerAddress, amount);
      console.log(`Approval transaction sent: ${tx.hash}`);
      
      // Wait for the approval to be confirmed
      const receipt = await tx.wait();
      console.log(`Approval confirmed in block ${receipt.blockNumber}`);
      
      return {
        success: true,
        hash: tx.hash,
        receipt: receipt
      };
    } catch (error) {
      console.error("Error approving token:", error);
      return {
        success: false,
        error: error.message
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
    
    try {
      // Handle bundler approvals first
      if (bundle.bundlerApprovalTxs && bundle.bundlerApprovalTxs.length > 0) {
        console.log(`Handling ${bundle.bundlerApprovalTxs.length} bundler approvals before swap...`);
        
        for (const approvalTx of bundle.bundlerApprovalTxs) {
          console.log(`Approving ${approvalTx.token.symbol} to bundler contract ${this.bundlerContract}`);
          
          // Send approval transaction
          const approvalResult = await this.approveTokenToBundler(
            approvalTx.token.address
          );
          
          if (!approvalResult.success) {
            throw new Error(`Failed to approve ${approvalTx.token.symbol} to bundler: ${approvalResult.error}`);
          }
          
          console.log(`${approvalTx.token.symbol} approved successfully to bundler`);
        }
      }
      
      // Handle router approvals if needed (for compatibility)
      if (bundle.approvalTxs && bundle.approvalTxs.length > 0) {
        console.log(`Handling ${bundle.approvalTxs.length} router approvals before swap...`);
        
        for (const approvalTx of bundle.approvalTxs) {
          console.log(`Directly approving ${approvalTx.token.symbol} to router ${approvalTx.to}`);
          
          // Send direct approval transaction
          const approvalResult = await this.approveTokenToRouter(
            approvalTx.token.address, 
            approvalTx.to
          );
          
          if (!approvalResult.success) {
            throw new Error(`Failed to approve ${approvalTx.token.symbol} to router: ${approvalResult.error}`);
          }
          
          console.log(`${approvalTx.token.symbol} approved successfully to router`);
        }
      }
      
      // Check if we're dealing with a single swap transaction
      if (bundle.swapTxs.length === 1) {
        // Try using the direct swap method for a single swap
        console.log("Using direct swap method for a single swap transaction...");
        return await berabundlerService.executeDirectSwap(bundle.swapTxs[0]);
      } else {
        // Use the executeBundle method for multiple operations
        console.log("Using executeBundle method for multiple operations...");
        return await berabundlerService.executeBundle(bundle);
      }
    } catch (error) {
      console.error("Error in executeSwapBundle:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
const tokenBridge = new TokenBridge();
export default tokenBridge;