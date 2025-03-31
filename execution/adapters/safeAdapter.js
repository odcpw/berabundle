/**
 * safeAdapter.js - Comprehensive adapter for Safe Transaction Service
 * 
 * This module provides a complete adapter for interacting with the Safe Transaction Service API,
 * Protocol Kit, and related Safe components. It handles URL formatting, error handling, and 
 * provides a consistent interface for Safe operations.
 */

const { ethers } = require('ethers');
const SafeApiKit = require('@safe-global/api-kit').default;
const Safe = require('@safe-global/protocol-kit').default;
const { OperationType } = require('@safe-global/types-kit');
const axios = require('axios');
const config = require('../../config');

/**
 * Comprehensive adapter for Safe Transaction Service interactions
 */
class SafeAdapter {
    /**
     * Create a new SafeAdapter
     * @param {ethers.providers.Provider} provider - Ethers provider
     */
    constructor(provider) {
        this.provider = provider || new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
        this.chainId = parseInt(config.networks.berachain.chainId, 16); // Convert hex chainId to number
        
        // Set up the API URLs with proper formatting
        this.setupApiUrls();
        
        // Create axios instance for direct API calls
        this.api = axios.create({
            baseURL: this.serviceApiUrl,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        
        // Create Safe API Kit instance
        this.apiKit = this.createSafeApiKit();
        
        console.log(`Safe Adapter initialized with Berachain - API URL: ${this.serviceApiUrl}`);
    }
    
    /**
     * Set up API URLs with proper formatting
     */
    setupApiUrls() {
        // For direct axios calls, use serviceApiUrl with /api/v1
        this.serviceApiUrl = config.networks.berachain.safe.serviceApiUrl;
        
        // Ensure we have a properly formatted URL with /api/v1
        if (!this.serviceApiUrl) {
            // Fallback to serviceUrl and append /api/v1 if needed
            this.serviceApiUrl = config.networks.berachain.safe.serviceUrl;
            if (!this.serviceApiUrl.includes('/api/v1')) {
                this.serviceApiUrl = `${this.serviceApiUrl}/api/v1`;
            }
        }
        
        // For API Kit, use serviceUrl with /api but not /v1
        this.serviceUrl = config.networks.berachain.safe.serviceUrl;
        
        // For Safe web app URL
        this.appUrl = config.networks.berachain.safe.appUrl;
    }
    
    /**
     * Create a properly configured Safe API Kit instance
     * @returns {SafeApiKit} Initialized Safe API Kit
     */
    createSafeApiKit() {
        // Convert hex chainId to decimal BigInt
        const chainId = BigInt(this.chainId);
        
        // Initialize with proper URL format (ending with /api)
        return new SafeApiKit({
            chainId: chainId,
            txServiceUrl: this.serviceUrl
        });
    }
    
    /**
     * Get Safe transaction URL for the web app
     * @param {string} safeAddress - Safe address
     * @param {string} safeTxHash - Safe transaction hash
     * @returns {string} Safe transaction URL
     */
    getSafeTransactionUrl(safeAddress, safeTxHash) {
        const normalizedAddress = ethers.utils.getAddress(safeAddress).toLowerCase();
        // Format according to Safe URL structure
        return `${this.appUrl}/transactions/queue?safe=ber:${normalizedAddress}`;
    }
    
    /**
     * Get the next nonce for a Safe
     * @param {string} safeAddress - Safe address
     * @returns {Promise<Object>} Next nonce with success status
     */
    async getNextNonce(safeAddress) {
        try {
            const normalizedAddress = ethers.utils.getAddress(safeAddress);
            
            // Make a direct API call to get Safe info
            const response = await this.api.get(`/safes/${normalizedAddress}/`);
            
            if (response.status === 200 && response.data && response.data.nonce !== undefined) {
                const nonce = parseInt(response.data.nonce);
                return {
                    success: true,
                    nonce: nonce,
                    message: `Nonce retrieved: ${nonce}`
                };
            } else {
                return {
                    success: false,
                    message: `Unexpected response format from Safe service`
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Failed to get next nonce: ${error.message}`
            };
        }
    }
    
    /**
     * Find Safes where an address is an owner
     * @param {string} ownerAddress - Owner address to check
     * @returns {Promise<Object>} List of Safes where the address is an owner
     */
    async getSafesByOwner(ownerAddress) {
        try {
            const normalizedAddress = ethers.utils.getAddress(ownerAddress);
            
            // First, try to find any existing Safes for this owner
            let ownerSafes = [];
            
            try {
                // Try with direct API call first (most reliable)
                const response = await this.api.get(`/owners/${normalizedAddress}/safes/`);
                
                if (response.status === 200 && response.data && response.data.safes) {
                    if (response.data.safes.length > 0) {
                        ownerSafes = response.data.safes;
                    }
                }
            } catch (apiError) {
                // The 404 error is expected for new owners (not found in the service)
                if (apiError.response && apiError.response.status === 404) {
                    // This is normal for new owners - continue with fallbacks
                } else {
                    // For other errors, try the API Kit as fallback
                    try {
                        const safesResponse = await this.apiKit.getSafesByOwner(normalizedAddress);
                        if (safesResponse && safesResponse.safes) {
                            ownerSafes = safesResponse.safes;
                        }
                    } catch (kitError) {
                        // Both API approaches failed, continue with fallbacks
                    }
                }
            }
            
            // If we found Safes by direct lookup, return them
            if (ownerSafes.length > 0) {
                return {
                    success: true,
                    safes: ownerSafes,
                    message: `Found ${ownerSafes.length} Safe(s) for this owner`
                };
            }
            
            // Check if a specific Safe address is configured in config
            if (config.networks.berachain.safe.defaultSafeAddress) {
                try {
                    const safeAddress = config.networks.berachain.safe.defaultSafeAddress;
                    
                    // Try to get Safe details directly
                    const safeInfoResponse = await this.api.get(`/safes/${safeAddress}/`);
                    
                    if (safeInfoResponse.status === 200 && 
                        safeInfoResponse.data && 
                        safeInfoResponse.data.owners) {
                        
                        const safeInfo = safeInfoResponse.data;
                        
                        const isOwner = safeInfo.owners.some(
                            owner => owner.toLowerCase() === normalizedAddress.toLowerCase()
                        );
                        
                        if (isOwner) {
                            return { 
                                success: true, 
                                safes: [safeAddress],
                                message: "Using configured Safe address where you are an owner"
                            };
                        }
                    }
                } catch (checkError) {
                    // Failed to check the default Safe - continue with empty result
                }
            }
            
            // Return empty list with success status - will prompt for manual entry
            return { 
                success: true, 
                safes: [],
                message: "No Safes found for this owner - please enter Safe address manually" 
            };
        } catch (error) {
            return {
                success: false,
                message: `Error in Safe Service: ${error.message}`,
                safes: []
            };
        }
    }
    
    /**
     * Create ethers adapter for Protocol Kit
     * @param {Object} signer - Ethers signer
     * @returns {Object} Ethers adapter for Protocol Kit
     */
    createEthersAdapter(signer) {
        // Direct creation without EthersAdapter import
        return {
            ethers,
            signerOrProvider: signer
        };
    }
    
    /**
     * Initialize Protocol Kit with signer and safe address
     * @param {Object} signer - Ethers signer
     * @param {string} safeAddress - Safe address
     * @returns {Promise<Object>} Protocol Kit instance with success status
     */
    async initializeProtocolKit(signer, safeAddress) {
        try {
            // Create ethers adapter
            const ethersAdapter = this.createEthersAdapter(signer);
            
            // Check which initialization method is available (based on SDK version)
            if (Safe.create) {
                const safeSdk = await Safe.create({
                    ethAdapter: ethersAdapter,
                    safeAddress
                });
                
                return {
                    success: true,
                    sdk: safeSdk,
                    message: "Protocol Kit initialized successfully with create() method"
                };
            } else {
                const safeSdk = await Safe.init({
                    ethAdapter: ethersAdapter,
                    safeAddress
                });
                
                return {
                    success: true,
                    sdk: safeSdk,
                    message: "Protocol Kit initialized successfully with init() method"
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Failed to initialize Protocol Kit: ${error.message}`
            };
        }
    }
    
    /**
     * Format transactions for Protocol Kit
     * @param {Object} bundle - Bundle with transaction data
     * @returns {Array} Formatted transactions for Protocol Kit
     */
    formatTransactionsForProtocolKit(bundle) {
        if (!bundle) {
            throw new Error("Bundle is required");
        }
        
        let transactions = [];
        
        if (bundle.bundleData.transactions) {
            // For SAFE_UI or SAFE_CLI formats
            transactions = bundle.bundleData.transactions.map(tx => ({
                to: tx.to,
                value: tx.value || '0',
                data: tx.data || '0x',
                operation: OperationType.Call // CALL operation, not DELEGATE_CALL
            }));
        } else if (Array.isArray(bundle.bundleData)) {
            // For EOA format converted to Safe format
            transactions = bundle.bundleData.map(tx => ({
                to: tx.to,
                value: tx.value || '0',
                data: tx.data || '0x',
                operation: OperationType.Call // CALL operation, not DELEGATE_CALL
            }));
        } else {
            throw new Error("Unsupported bundle format for Safe transaction");
        }
        
        return transactions;
    }
    
    /**
     * Propose a Safe transaction 
     * @param {string} safeAddress - Safe address
     * @param {Object} bundle - Bundle containing transaction data
     * @param {Object} signer - Ethers signer for signing the transaction
     * @returns {Promise<Object>} Proposal result with success status
     */
    async proposeSafeTransaction(safeAddress, bundle, signer) {
        try {
            const signerAddress = await signer.getAddress();
            
            // Initialize Protocol Kit
            const protocolKitResult = await this.initializeProtocolKit(signer, safeAddress);
            
            if (!protocolKitResult.success) {
                // Protocol Kit initialization failed, use fallback
                return await this.proposeTransactionManually(safeAddress, bundle, signer);
            }
            
            const safeSdk = protocolKitResult.sdk;
            
            // Format transactions from the bundle
            const formattedTxs = this.formatTransactionsForProtocolKit(bundle);
            
            // Get next nonce
            const nonceResult = await this.getNextNonce(safeAddress);
            if (!nonceResult.success) {
                throw new Error(`Failed to get nonce: ${nonceResult.message}`);
            }
            
            // Create a Safe transaction using Protocol Kit
            const safeTransaction = await safeSdk.createTransaction({
                transactions: formattedTxs,
                options: {
                    nonce: nonceResult.nonce
                }
            });
            
            // Sign the transaction
            const { SigningMethod } = require('@safe-global/types-kit');
            const signedSafeTx = await safeSdk.signTransaction(safeTransaction, SigningMethod.ETH_SIGN);
            
            // Get transaction hash
            const safeTxHash = await safeSdk.getTransactionHash(safeTransaction);
            
            // Get the signature from the signed transaction
            const signature = signedSafeTx.signatures.get(signerAddress.toLowerCase());
            if (!signature) {
                throw new Error('Failed to generate signature');
            }
            
            // Prepare the API payload
            const checksummedSafeAddress = ethers.utils.getAddress(safeAddress);
            const checksummedSignerAddress = ethers.utils.getAddress(signerAddress);
            
            // Get properly formatted transaction data
            const txTo = ethers.utils.getAddress(safeTransaction.data.to);
            const txValue = safeTransaction.data.value.startsWith('0x') 
                ? ethers.BigNumber.from(safeTransaction.data.value).toString() 
                : safeTransaction.data.value;
            
            const proposalPayload = {
                safe: checksummedSafeAddress,
                to: txTo,
                value: txValue,
                data: safeTransaction.data.data,
                operation: safeTransaction.data.operation,
                gasToken: safeTransaction.data.gasToken || "0x0000000000000000000000000000000000000000",
                safeTxGas: safeTransaction.data.safeTxGas || "0",
                baseGas: safeTransaction.data.baseGas || "0", 
                gasPrice: safeTransaction.data.gasPrice || "0",
                refundReceiver: safeTransaction.data.refundReceiver || "0x0000000000000000000000000000000000000000",
                nonce: safeTransaction.data.nonce,
                contractTransactionHash: safeTxHash,
                sender: checksummedSignerAddress,
                signature: signature.data,
                origin: "BeraBundle"
            };
            
            // Submit the transaction to the API
            const proposalResponse = await this.api.post(`/safes/${checksummedSafeAddress}/multisig-transactions/`, proposalPayload);
            
            if (proposalResponse.status !== 201 && proposalResponse.status !== 200) {
                throw new Error(`Unexpected response status: ${proposalResponse.status}`);
            }
            
            return {
                success: true,
                safeTxHash,
                safeAddress,
                transactionUrl: this.getSafeTransactionUrl(safeAddress, safeTxHash),
                message: "Transaction proposed successfully"
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to propose Safe transaction: ${error.message}`,
                error: error
            };
        }
    }
    
    /**
     * Propose a transaction manually without Protocol Kit
     * Used as a fallback when Protocol Kit initialization fails
     * @param {string} safeAddress - Safe address
     * @param {Object} bundle - Bundle with transaction data
     * @param {Object} signer - Ethers signer for signing
     * @returns {Promise<Object>} Proposal result with success status
     */
    async proposeTransactionManually(safeAddress, bundle, signer) {
        try {
            const signerAddress = await signer.getAddress();
            
            // Format transactions for manual preparation
            let transactions = [];
            
            if (bundle.bundleData.transactions) {
                // From SAFE_UI format
                transactions = bundle.bundleData.transactions.map(tx => ({
                    to: ethers.utils.getAddress(tx.to),
                    value: tx.value || '0',
                    data: tx.data || '0x',
                    operation: 0 // Call operation (not delegatecall)
                }));
            } else if (Array.isArray(bundle.bundleData)) {
                // From EOA format
                transactions = bundle.bundleData.map(tx => ({
                    to: ethers.utils.getAddress(tx.to),
                    value: tx.value || '0',
                    data: tx.data || '0x',
                    operation: 0 // Call operation (not delegatecall)
                }));
            } else {
                throw new Error("Unsupported bundle format for Safe transaction");
            }
            
            // We can only handle a single transaction with this manual method
            if (transactions.length === 0) {
                throw new Error("No transactions found in bundle");
            } else if (transactions.length > 1) {
                console.log(`Warning: Bundle contains ${transactions.length} transactions.`);
                console.log("Only the first transaction will be processed in fallback mode.");
            }
            
            // Use only the first transaction
            const tx = transactions[0];
            
            // Get the Safe nonce
            const nonceResult = await this.getNextNonce(safeAddress);
            const nonce = nonceResult.success ? nonceResult.nonce : 0;
            
            // Create EIP-712 compatible data structure for Safe Transaction
            const typedData = {
                types: {
                    EIP712Domain: [
                        { name: 'verifyingContract', type: 'address' }
                    ],
                    SafeTx: [
                        { name: 'to', type: 'address' },
                        { name: 'value', type: 'uint256' },
                        { name: 'data', type: 'bytes' },
                        { name: 'operation', type: 'uint8' },
                        { name: 'safeTxGas', type: 'uint256' },
                        { name: 'baseGas', type: 'uint256' },
                        { name: 'gasPrice', type: 'uint256' },
                        { name: 'gasToken', type: 'address' },
                        { name: 'refundReceiver', type: 'address' },
                        { name: 'nonce', type: 'uint256' }
                    ]
                },
                domain: {
                    verifyingContract: safeAddress
                },
                primaryType: 'SafeTx',
                message: {
                    to: tx.to,
                    value: tx.value || '0',
                    data: tx.data || '0x',
                    operation: tx.operation || 0,
                    safeTxGas: '0',
                    baseGas: '0',
                    gasPrice: '0',
                    gasToken: ethers.constants.AddressZero,
                    refundReceiver: ethers.constants.AddressZero,
                    nonce: nonce.toString()
                }
            };
            
            // Calculate transaction hash manually (EIP-712 hash)
            const safeTxHash = ethers.utils._TypedDataEncoder.hash(
                typedData.domain,
                { SafeTx: typedData.types.SafeTx },
                typedData.message
            );
            
            // Sign the transaction hash
            const signature = await signer.signMessage(ethers.utils.arrayify(safeTxHash));
            
            // Format into the data structure expected by the API
            const proposalPayload = {
                safe: ethers.utils.getAddress(safeAddress),
                to: tx.to,
                value: tx.value.toString(),
                data: tx.data,
                operation: tx.operation,
                safeTxGas: "0",
                baseGas: "0",
                gasPrice: "0",
                gasToken: ethers.constants.AddressZero,
                refundReceiver: ethers.constants.AddressZero,
                nonce: nonce,
                contractTransactionHash: safeTxHash,
                sender: signerAddress,
                signature: signature,
                origin: "BeraBundle"
            };
            
            // Submit the transaction to the API
            const proposalResponse = await this.api.post(
                `/safes/${ethers.utils.getAddress(safeAddress)}/multisig-transactions/`, 
                proposalPayload
            );
            
            if (proposalResponse.status === 201 || proposalResponse.status === 200) {
                return {
                    success: true,
                    safeTxHash,
                    safeAddress,
                    transactionUrl: this.getSafeTransactionUrl(safeAddress, safeTxHash),
                    message: "Transaction proposed successfully using fallback method"
                };
            } else {
                throw new Error(`Unexpected response status: ${proposalResponse.status}`);
            }
        } catch (error) {
            return {
                success: false,
                message: `Failed to propose Safe transaction manually: ${error.message}`
            };
        }
    }
    
    /**
     * Confirm an existing Safe transaction
     * @param {string} safeAddress - Safe address
     * @param {string} safeTxHash - Transaction hash to confirm
     * @param {Object} signer - Ethers signer for signing
     * @returns {Promise<Object>} Confirmation result with success status
     */
    async confirmSafeTransaction(safeAddress, safeTxHash, signer) {
        try {
            // Initialize Protocol Kit
            const protocolKitResult = await this.initializeProtocolKit(signer, safeAddress);
            
            if (!protocolKitResult.success) {
                return {
                    success: false,
                    message: `Failed to initialize Protocol Kit: ${protocolKitResult.message}`
                };
            }
            
            const safeSdk = protocolKitResult.sdk;
            
            // Sign the transaction hash using Protocol Kit
            const { SigningMethod } = require('@safe-global/types-kit');
            const signature = await safeSdk.signTransactionHash(safeTxHash, SigningMethod.ETH_SIGN);
            
            // Submit confirmation using direct API call
            const confirmationPayload = {
                signature: signature.data
            };
            
            const confirmationResponse = await this.api.post(
                `/multisig-transactions/${safeTxHash}/confirmations/`, 
                confirmationPayload
            );
            
            if (confirmationResponse.status !== 201 && confirmationResponse.status !== 200) {
                throw new Error(`Unexpected response status: ${confirmationResponse.status}`);
            }
            
            return {
                success: true,
                safeTxHash,
                safeAddress,
                transactionUrl: this.getSafeTransactionUrl(safeAddress, safeTxHash),
                message: "Transaction confirmed successfully"
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to confirm Safe transaction: ${error.message}`
            };
        }
    }
    
    /**
     * Convert a bundle from EOA format to Safe format
     * @param {Object} bundle - Bundle in EOA format
     * @param {string} safeAddress - Safe address
     * @returns {Object} Bundle in Safe format
     */
    convertEoaToSafeFormat(bundle, safeAddress) {
        if (!bundle.bundleData || !Array.isArray(bundle.bundleData)) {
            throw new Error("Invalid bundle format: Expected array of transactions");
        }
        
        // Create transactions in Safe format
        const transactions = bundle.bundleData.map(tx => ({
            to: tx.to,
            value: tx.value || "0x0",
            data: tx.data || "0x",
            operation: 0 // CALL operation
        }));
        
        // Create Safe format bundle
        const safeBundle = {
            ...bundle,
            bundleData: {
                version: "1.0",
                chainId: config.networks.berachain.chainId,
                createdAt: new Date().toISOString(),
                meta: {
                    name: bundle.summary ? bundle.summary.name || "BeraBundle" : "BeraBundle",
                    description: bundle.summary ? bundle.summary.description || "" : ""
                },
                transactions
            },
            summary: {
                ...bundle.summary,
                format: "safe_ui"
            }
        };
        
        return safeBundle;
    }
}

module.exports = SafeAdapter;