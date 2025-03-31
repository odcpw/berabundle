/**
 * Token Service - Manages token balances, prices, and swap operations
 * 
 * This service provides functionality to:
 * - Query token balances from the blockchain
 * - Fetch and cache token prices from OogaBooga API
 * - Generate token swap transactions
 * - Format transactions for different wallet types
 * - Save transaction bundles for execution
 */

const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../config');
const { ErrorHandler } = require('../utils/errorHandler');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Constants for gas estimation based on transaction type
const GAS_LIMITS = {
    APPROVAL: 500000,   // 500K gas for ERC20 approval transactions
    SWAP: 1000000       // 1M gas for swap transactions (higher due to complexity)
};

/**
 * Output formats for transaction bundles
 */
const OutputFormat = {
    EOA: 'eoa',           // Regular transactions for EOA wallets with private keys
    SAFE_UI: 'safe_ui',   // Safe multisig format for web interface (TxBuilder)
};

/**
 * Service for managing token balances, prices, and swap operations
 */
class TokenService {
    /**
     * Creates a new TokenService instance
     * 
     * @param {ethers.providers.Provider} provider - Ethereum provider for blockchain interactions
     */
    constructor(provider) {
        this.provider = provider;
        this.apiKey = process.env.OOGABOOGA_API_KEY;
        this.apiBaseUrl = 'https://mainnet.api.oogabooga.io';
        
        // Cache settings
        this.priceCache = {};                      // In-memory cache for token prices
        this.priceExpiry = 5 * 60 * 1000;          // Price cache expiry: 5 minutes
        this.tokenListExpiry = 24 * 60 * 60 * 1000; // Token list expiry: 24 hours
        
        // Export OutputFormat enum for external use
        this.OutputFormat = OutputFormat;
    }
    
    /**
     * Makes an authenticated API call to the OogaBooga API
     * 
     * @param {string} endpoint - API endpoint path (with or without base URL)
     * @param {Object} params - Query parameters to include in the request
     * @returns {Promise<Object>} API response data
     * @throws {Error} If API key is missing or API call fails
     */
    async apiCallWithAuth(endpoint, params = {}) {
        const cleanApiKey = this.apiKey ? this.apiKey.trim() : null;
        if (!cleanApiKey) {
            throw new Error("API key not found in environment");
        }
        
        const url = endpoint.startsWith('http') ? endpoint : `${this.apiBaseUrl}${endpoint}`;
        
        try {
            const response = await axios.get(url, {
                params,
                headers: { 'Authorization': `Bearer ${cleanApiKey}` },
                timeout: 10000
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
     * Updates the token metadata list from the OogaBooga API
     * 
     * Fetches all available tokens from the API, formats them consistently,
     * adds the BERA native token if needed, and saves the data to the local
     * token metadata file. Also updates a timestamp file to track freshness.
     * 
     * @returns {Promise<boolean>} True if successful, false if there was an error
     */
    async updateTokenList() {
        try {
            let tokensData = null;
            
            // Use the v1/tokens endpoint
            const response = await this.apiCallWithAuth('/v1/tokens');
            
            // The API returns an array of tokens
            if (response.data && Array.isArray(response.data)) {
                tokensData = response.data;
            } else {
                throw new Error("Unexpected API response format");
            }
            
            // Transform the data into our preferred format
            const tokenMap = {};
            
            tokensData.forEach(token => {
                tokenMap[token.address] = {
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
            
            // Save to metadata file
            const filePath = config.paths.tokensFile;
            
            // Ensure metadata directory exists
            await fs.mkdir(config.paths.metadataDir, { recursive: true });
            
            // Write to file
            await fs.writeFile(filePath, JSON.stringify(tokenMap, null, 2));
            
            // Save last updated timestamp
            const timestampPath = `${config.paths.metadataDir}/tokens_updated.json`;
            await fs.writeFile(timestampPath, JSON.stringify({ 
                timestamp: Date.now(),
                count: Object.keys(tokenMap).length
            }));
            
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Retrieves all token balances and values for a wallet address
     * 
     * This comprehensive method:
     * 1. Checks if token metadata needs updating
     * 2. Fetches BERA native token balance
     * 3. Queries all ERC20 token balances in batches
     * 4. Fetches current price for each token with non-zero balance
     * 5. Calculates USD value for each token and the total portfolio
     * 
     * @param {string} address - The wallet address to check balances for
     * @returns {Promise<Object>} Object containing:
     *   - tokens: Array of token objects with balance and price info
     *   - totalValueUsd: Total portfolio value in USD
     *   - formattedTotalValueUsd: Formatted USD string
     *   - totalValueBera: Total portfolio value in BERA
     *   - formattedTotalValueBera: Formatted BERA string
     *   - error: Error message (if any)
     */
    async getTokenBalances(address) {
        try {
            // Check if we need to update the token list
            let needsUpdate = true;
            const FSHelpers = require('../utils/fsHelpers');
            
            try {
                // Check if tokens_updated.json exists and is recent
                const timestampPath = `${config.paths.metadataDir}/tokens_updated.json`;
                const timestampExists = await FSHelpers.fileExists(timestampPath);
                
                if (timestampExists) {
                    const timestampData = await fs.readFile(timestampPath, 'utf8');
                    const { timestamp } = JSON.parse(timestampData);
                    
                    // Only update if the list is older than tokenListExpiry
                    needsUpdate = (Date.now() - timestamp) > this.tokenListExpiry;
                }
            } catch (error) {
                needsUpdate = true;
            }
            
            // Update token list if needed
            if (needsUpdate) {
                await this.updateTokenList();
            }
            
            // Get native BERA balance
            const beraBalance = await this.provider.getBalance(address);
            const formattedBeraBalance = ethers.utils.formatEther(beraBalance);
            
            // Load tokens from metadata file
            let tokensMap = {};
            try {
                const tokensData = await fs.readFile(config.paths.tokensFile, 'utf8');
                tokensMap = JSON.parse(tokensData);
            } catch (error) {
                // If we can't load the file, try to update it once more
                if (!needsUpdate) {
                    await this.updateTokenList();
                    try {
                        const tokensData = await fs.readFile(config.paths.tokensFile, 'utf8');
                        tokensMap = JSON.parse(tokensData);
                    } catch (secondError) {
                        tokensMap = {};
                    }
                }
            }
            
            // Convert to array and filter out native tokens (we'll add them separately)
            const tokensList = Object.values(tokensMap).filter(token => 
                token.address !== "0x0000000000000000000000000000000000000000" && 
                token.symbol !== "BERA"
            );
            
            // Process tokens in batches
            const batch = 20;
            const tokens = [];
            
            for (let i = 0; i < tokensList.length; i += batch) {
                const batchTokens = tokensList.slice(i, i + batch);
                const batchResults = await Promise.all(batchTokens.map(async token => {
                    try {
                        const tokenContract = new ethers.Contract(
                            token.address,
                            ["function balanceOf(address) view returns (uint256)"],
                            this.provider
                        );
                        
                        const rawBalance = await tokenContract.balanceOf(address);
                        const balance = ethers.utils.formatUnits(rawBalance, token.decimals);
                        
                        // Only return tokens with non-zero balance
                        if (parseFloat(balance) > 0) {
                            return {
                                ...token,
                                balance,
                                formattedBalance: parseFloat(balance).toLocaleString(undefined, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 6
                                }),
                                priceUsd: null,
                                valueUsd: 0,
                                formattedValueUsd: "$0.00"
                            };
                        }
                        return null;
                    } catch (error) {
                        return null;
                    }
                }));
                
                // Filter out null values (tokens with zero balance)
                tokens.push(...batchResults.filter(t => t !== null));
            }
            
            // Now fetch prices only for tokens with balance
            for (const token of tokens) {
                try {
                    const price = await this.getTokenPrice(token.address);
                    if (price !== null) {
                        token.priceUsd = price;
                        token.valueUsd = parseFloat(token.balance) * price;
                        token.formattedValueUsd = token.valueUsd.toLocaleString(undefined, {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                        });
                    }
                } catch (priceError) {
                    // Silently continue
                }
            }
            
            // Get BERA price
            let beraPrice = null;
            try {
                beraPrice = await this.getTokenPrice('BERA');
            } catch (priceError) {
                beraPrice = null;
            }
            
            const beraValueUsd = beraPrice ? parseFloat(formattedBeraBalance) * beraPrice : 0;

            // Add BERA to token list
            tokens.unshift({
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
            });

            // Calculate total value in USD and BERA
            const totalValueUsd = tokens.reduce((sum, token) => sum + token.valueUsd, 0);
            const totalValueBera = beraPrice ? totalValueUsd / beraPrice : 0;

            return {
                tokens,
                totalValueUsd,
                formattedTotalValueUsd: totalValueUsd.toLocaleString(undefined, {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }),
                totalValueBera,
                formattedTotalValueBera: totalValueBera.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6
                }) + ' BERA'
            };
        } catch (error) {
            ErrorHandler.handle(error, 'TokenService.getTokenBalances');
            return {
                tokens: [],
                totalValueUsd: 0,
                formattedTotalValueUsd: '$0.00',
                totalValueBera: 0,
                formattedTotalValueBera: '0 BERA',
                error: error.message
            };
        }
    }


    /**
     * Retrieves the current USD price for a token with caching
     * 
     * Checks the in-memory cache first, then queries the OogaBooga price API.
     * Prices are cached for the duration specified by this.priceExpiry (5 minutes).
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
            // For native token, use BERA address, otherwise use the address as is
            const tokenParam = tokenAddress === 'BERA' || tokenAddress === 'native' 
                ? '0x0000000000000000000000000000000000000000' 
                : tokenAddress;
                
            // Using the working endpoint format: /v1/prices?currency=USD
            const response = await this.apiCallWithAuth('/v1/prices?currency=USD');
            
            // Response is an array of {address, price} objects
            if (response.data && Array.isArray(response.data)) {
                // Find the token in the price list
                const tokenPrice = response.data.find(item => 
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
            return null;
        }
    }

    /**
     * Creates transaction data for swapping multiple tokens to BERA
     * 
     * For each token, gets a swap quote from the OogaBooga API and creates
     * the transaction data needed to execute the swap. Skips native BERA tokens.
     * Calculates the total expected BERA output from all swaps.
     * 
     * @param {string} fromAddress - Wallet address initiating the swaps
     * @param {Array<Object>} tokensToSwap - Array of token objects with amount to swap
     * @returns {Promise<Object>} Bundle containing:
     *   - fromAddress: Sending wallet address
     *   - transactions: Array of swap transaction objects
     *   - totalExpectedBera: Total expected BERA output
     *   - formattedTotalExpectedBera: Formatted BERA amount string
     *   - error: Error message (if any)
     */
    async createSwapBundle(fromAddress, tokensToSwap) {
        try {
            const swapTransactions = [];
            
            for (const token of tokensToSwap) {
                // Skip if token is BERA
                if (token.address === 'native' || token.symbol === 'BERA') {
                    continue;
                }

                const amountIn = ethers.utils.parseUnits(
                    token.amount.toString(), 
                    token.decimals || 18
                );

                // Get swap quote from API using the v1/swap endpoint
                const endpoint = `/v1/swap?tokenIn=${token.address}&tokenOut=0x0000000000000000000000000000000000000000&amount=${amountIn.toString()}&slippage=0.01&to=${fromAddress}`;
                const quoteResponse = await this.apiCallWithAuth(endpoint);
                
                if (!quoteResponse.data || !quoteResponse.data.tx) {
                    throw new Error(`Swap response doesn't contain transaction data`);
                }
                
                // Extract transaction details
                const { tx } = quoteResponse.data;
                
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
                        // Use assumedAmountOut if available, otherwise fall back to expectedAmountOut for compatibility
                        expectedAmountOut: quoteResponse.data.assumedAmountOut || quoteResponse.data.expectedAmountOut,
                        formattedAmountOut: ethers.utils.formatEther(quoteResponse.data.assumedAmountOut || quoteResponse.data.expectedAmountOut || '0'),
                        minAmountOut: quoteResponse.data.routerParams?.swapTokenInfo?.outputMin || quoteResponse.data.minAmountOut,
                        priceImpact: quoteResponse.data.priceImpact
                    }
                });
            }

            // Calculate total expected BERA output
            const totalExpectedBera = swapTransactions.reduce(
                (sum, tx) => sum + parseFloat(tx.quote.formattedAmountOut || '0'), 
                0
            );

            return {
                fromAddress,
                transactions: swapTransactions,
                totalExpectedBera,
                formattedTotalExpectedBera: totalExpectedBera.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6
                }) + ' BERA'
            };
        } catch (error) {
            ErrorHandler.handle(error, 'TokenService.createSwapBundle');
            return {
                error: error.message,
                fromAddress,
                transactions: []
            };
        }
    }

    /**
     * Generates ERC20 approval transactions for tokens that need them
     * 
     * Checks the current allowance for each token against the router address.
     * If a token's allowance is less than the swap amount, creates an approval
     * transaction for unlimited spending (MaxUint256).
     * 
     * @param {string} fromAddress - Wallet address that owns the tokens
     * @param {Array<Object>} tokensToSwap - Array of token objects to check for approvals
     * @returns {Promise<Array>} Array of approval transaction objects (empty if none needed)
     */
    async getTokenApprovals(fromAddress, tokensToSwap) {
        try {
            const approvalTransactions = [];
            
            for (const token of tokensToSwap) {
                // Skip if token is BERA (native token doesn't need approval)
                if (token.address === 'native' || token.symbol === 'BERA') {
                    continue;
                }

                // Check if approval is needed
                const tokenContract = new ethers.Contract(
                    token.address,
                    [
                        'function allowance(address owner, address spender) view returns (uint256)',
                        'function approve(address spender, uint256 amount) returns (bool)'
                    ],
                    this.provider
                );

                // First get the router address by making a test swap request
                let routerAddress = '0x4f35A37AcD338EC15F7AD3AB01CC4C2Ce7Fe44Ee'; // Default router address
                
                try {
                    // Make a minimal swap request to get the current router address
                    const minAmount = ethers.utils.parseUnits('0.0001', token.decimals || 18);
                    const testEndpoint = `/v1/swap?tokenIn=${token.address}&tokenOut=0x0000000000000000000000000000000000000000&amount=${minAmount.toString()}&slippage=0.01&to=${fromAddress}`;
                    const testResponse = await this.apiCallWithAuth(testEndpoint);
                    
                    if (testResponse.data && testResponse.data.routerAddr) {
                        routerAddress = testResponse.data.routerAddr;
                    }
                } catch (error) {
                    // If this fails, we'll use the default router address
                    console.log(`Warning: Could not fetch router address, using default: ${routerAddress}`);
                }
                
                const allowance = await tokenContract.allowance(fromAddress, routerAddress);
                const amountIn = ethers.utils.parseUnits(
                    token.amount.toString(), 
                    token.decimals || 18
                );

                // If allowance is less than the amount, create approval transaction
                if (allowance.lt(amountIn)) {
                    const approvalData = tokenContract.interface.encodeFunctionData(
                        'approve',
                        [routerAddress, ethers.constants.MaxUint256]
                    );

                    approvalTransactions.push({
                        to: token.address,
                        data: approvalData,
                        value: '0x0',
                        gasLimit: '0x30000',
                        token: {
                            symbol: token.symbol,
                            address: token.address
                        },
                        type: 'approval'
                    });
                }
            }

            return approvalTransactions;
        } catch (error) {
            ErrorHandler.handle(error, 'TokenService.getTokenApprovals');
            return [];
        }
    }

    /**
     * Formats transaction data for the specified wallet type
     * 
     * Converts raw transaction data into the correct format for either:
     * - EOA wallets: Standard Ethereum transaction format with gas parameters
     * - Safe multisig: Specialized format for Safe Transaction Builder with 
     *   custom gas estimates based on transaction type
     * 
     * @param {Array<Object>} transactions - Array of raw transaction objects
     * @param {string} format - Output format from OutputFormat enum
     * @param {string} fromAddress - Sender's wallet address
     * @param {string} walletName - Human-readable wallet name
     * @returns {Promise<Object>} Formatted transaction bundle ready for wallet consumption
     * @throws {Error} If format is unsupported or formatting fails
     */
    async formatSwapBundle(transactions, format, fromAddress, walletName) {
        try {
            // Get common transaction information
            const timestamp = new Date().toISOString();
            const network = await this.provider.getNetwork();
            const chainId = '0x' + network.chainId.toString(16);
            
            // Calculate transaction counts
            const approvalTxs = transactions.filter(tx => tx.type === 'approval');
            const swapTxs = transactions.filter(tx => !tx.type);
            
            switch (format) {
                case OutputFormat.EOA:
                    // For EOA, format as regular Ethereum transactions
                    const formattedTxs = transactions.map(tx => ({
                        to: tx.to,
                        from: fromAddress,
                        data: tx.data,
                        value: tx.value || "0x0",
                        gasLimit: tx.gasLimit || "0x55555",
                        maxFeePerGas: config.gas.maxFeePerGas,
                        maxPriorityFeePerGas: config.gas.maxPriorityFeePerGas,
                        type: "0x2", // EIP-1559 transaction
                        chainId
                    }));
                    
                    return {
                        transactions: formattedTxs,
                        format: 'eoa',
                        fromAddress,
                        walletName,
                        totalTransactions: transactions.length,
                        approvalCount: approvalTxs.length,
                        swapCount: swapTxs.length,
                        timestamp
                    };
                
                case OutputFormat.SAFE_UI:
                    // Generate description with transaction details
                    const description = this.generateSafeDescription(
                        walletName, 
                        approvalTxs.length, 
                        swapTxs.length, 
                        swapTxs
                    );
                    
                    // Map each transaction to Safe format with proper gas estimation
                    const safeTransactions = transactions.map(tx => {
                        const isApproval = tx.type === 'approval';
                        const gasEstimate = isApproval ? GAS_LIMITS.APPROVAL : GAS_LIMITS.SWAP;
                        const tokenSymbol = tx.token?.symbol || 'token';
                        
                        return {
                            to: tx.to,
                            value: "0",
                            data: tx.data,
                            safeTxGas: gasEstimate.toString(),
                            // Clean metadata for UI display
                            contractMethod: { 
                                name: isApproval ? "approve" : "swap" 
                            },
                            contractInputsValues: {
                                token: tokenSymbol
                            }
                        };
                    });
                    
                    return {
                        version: '1.0',
                        chainId: parseInt(network.chainId),
                        createdAt: timestamp,
                        meta: {
                            name: `Swap Tokens to BERA - ${walletName}`,
                            description,
                            txBuilderVersion: '1.16.1',
                            createdFromSafeAddress: fromAddress,
                            createdFromOwnerAddress: '',
                            checksum: ''
                        },
                        transactions: safeTransactions
                    };
                
                default:
                    throw new Error(`Unsupported output format: ${format}`);
            }
        } catch (error) {
            ErrorHandler.handle(error, 'TokenService.formatSwapBundle');
            throw error;
        }
    }
    
    /**
     * Generates a detailed description for Safe multisig UI
     * 
     * Creates a comprehensive description including:
     * - Transaction summary (counts and types)
     * - Details about each swap (token, amount, expected output)
     * - Instructions for Safe UI users on execution
     * - Important information about individual transaction behavior
     * 
     * @param {string} walletName - Human-readable wallet name
     * @param {number} approvalCount - Number of ERC20 approval transactions
     * @param {number} swapCount - Number of swap transactions
     * @param {Array<Object>} swapTxs - Swap transaction objects with token details
     * @returns {string} Formatted description for Safe UI display
     */
    generateSafeDescription(walletName, approvalCount, swapCount, swapTxs) {
        let description = `Generated by BeraBundle on ${new Date().toISOString()}`;
        description += `\n\nWallet: ${walletName}`;
        description += `\n\nTransaction summary:`;
        
        if (approvalCount > 0) {
            description += `\n- ${approvalCount} token approval${approvalCount > 1 ? 's' : ''}`;
        }
        
        if (swapCount > 0) {
            description += `\n- ${swapCount} token swap${swapCount > 1 ? 's' : ''}`;
            
            // Add details about each swap
            description += `\n\nSwap Details:`;
            swapTxs.forEach(tx => {
                if (tx.token) {
                    description += `\n- Swap ${tx.token.amount} ${tx.token.symbol} for ~${tx.quote?.formattedAmountOut || '?'} BERA`;
                }
            });
        }
        
        // Add information about individual transactions
        description += `\n\nTransaction Information:`;
        description += `\n- Contains ${approvalCount + swapCount} separate transactions (${approvalCount} approvals, ${swapCount} swaps)`;
        description += `\n- Each transaction has its own gas estimation: Approvals = 500K gas, Swaps = 1M gas`;
        description += `\n- Individual transactions allow for independent success/failure`;
        
        description += `\n\nEXECUTION INSTRUCTIONS:`;
        description += `\n1. When importing in Safe UI, select "Use custom data" and "Execute all in batch"`;
        description += `\n2. Each transaction has its own gas estimation automatically set`;
        description += `\n3. You can choose to execute all transactions as a batch or one by one`;
        
        description += `\n\nFAILURE BEHAVIOR:`;
        description += `\n- With this format, individual transactions can succeed or fail independently`;
        description += `\n- If one swap fails (e.g., due to slippage), others may still succeed`;
        description += `\n- When executing as batch, you'll need to confirm each transaction separately`;
        description += `\n- This approach provides more flexibility and better gas estimation`;
        
        return description;
    }
    
    /**
     * Saves a transaction bundle to a JSON file
     * 
     * Creates a timestamped JSON file in the output directory containing
     * the formatted transaction bundle. The filename includes the wallet name,
     * timestamp, and format type for easy identification.
     * 
     * @param {Object} bundle - Formatted transaction bundle
     * @param {string} walletName - Human-readable wallet name
     * @param {string} format - Output format from OutputFormat enum
     * @returns {Promise<Object>} Result object containing:
     *   - success: Boolean indicating success
     *   - filepath: Path to the saved file
     *   - format: Format used for the bundle
     *   - summary: Object with transaction counts and details
     *   - error: Error message if save failed
     */
    async saveSwapBundle(bundle, walletName, format) {
        try {
            // Ensure output directory exists
            await fs.mkdir(config.paths.outputDir, { recursive: true });
            
            // Create a timestamp for file names
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
            
            // Standard bundle saving (single file)
            const bundleFileName = `swap_bundle_${walletName}_${timestamp}_${format}.json`;
            const bundlePath = `${config.paths.outputDir}/${bundleFileName}`;
            
            // Write bundle to file
            await fs.writeFile(bundlePath, JSON.stringify(bundle, null, 2));
            
            return {
                success: true,
                filepath: bundlePath,
                format,
                summary: {
                    format,
                    approvalCount: bundle.approvalCount || 0,
                    swapCount: bundle.swapCount || 0,
                    totalTransactions: bundle.totalTransactions || bundle.transactions.length || 0
                }
            };
        } catch (error) {
            ErrorHandler.handle(error, 'TokenService.saveSwapBundle');
            return {
                success: false,
                error: error.message
            };
        }
    }
    
}

module.exports = TokenService;