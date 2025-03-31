/**
 * safeAdapter.js - Adapter for Safe Transaction Service
 * 
 * This module provides an adapter for interacting with the Safe Transaction Service API
 * for proposing transactions to a Safe multisig wallet. It uses the working direct API
 * implementation from test-safe-proposal.js.
 */

const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../../config');
const SecureStorage = require('../../storage/engines/secureStorage');

/**
 * Safe adapter for transaction service interactions
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
        this.serviceUrl = config.networks.berachain.safe.serviceUrl;
        this.appUrl = config.networks.berachain.safe.appUrl;
        
        console.log(`Safe Adapter initialized with chain ID: ${this.chainId}`);
        console.log(`Safe Transaction Service URL: ${this.serviceUrl}`);
    }
    
    /**
     * Get Safe transaction URL for the web app
     * @param {string} safeAddress - Safe address
     * @param {string} safeTxHash - Safe transaction hash (optional)
     * @returns {string} Safe transaction URL
     */
    getSafeTransactionUrl(safeAddress, safeTxHash) {
        const normalizedAddress = ethers.utils.getAddress(safeAddress).toLowerCase();
        
        // Return URL to Safe web app
        return `${this.appUrl}/transactions/queue?safe=ber:${normalizedAddress}`;
    }
    
    /**
     * Get the next nonce for a Safe
     * @param {string} safeAddress - Safe address
     * @returns {Promise<Object>} Next nonce with success status
     */
    async getNextNonce(safeAddress) {
        try {
            // API URL for Safe info
            const apiUrl = `${this.serviceUrl}/v1/safes/${safeAddress}/`;
            
            // Get Safe info from API
            const response = await axios.get(apiUrl);
            
            if (response.data && response.data.nonce !== undefined) {
                return {
                    success: true,
                    nonce: response.data.nonce,
                    message: `Nonce retrieved: ${response.data.nonce}`
                };
            } else {
                return {
                    success: false,
                    message: "Unexpected response format from Safe service"
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
            // API URL for owner Safes
            const apiUrl = `${this.serviceUrl}/v1/owners/${ownerAddress}/safes/`;
            
            // Get Safes for owner from API
            const response = await axios.get(apiUrl);
            
            if (response.data && response.data.safes) {
                return {
                    success: true,
                    safes: response.data.safes,
                    message: `Found ${response.data.safes.length} Safe(s) for this owner`
                };
            } else {
                return {
                    success: true,
                    safes: [],
                    message: "No Safes found for this owner"
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Error in Safe Service: ${error.message}`,
                safes: []
            };
        }
    }
    
    /**
     * Format transactions for Safe format
     * @param {Object} bundle - Bundle with transaction data
     * @returns {Array} Formatted transactions
     */
    formatTransactionsForSafe(bundle) {
        if (!bundle) {
            throw new Error("Bundle is required");
        }
        
        let transactions = [];
        
        if (bundle.bundleData && bundle.bundleData.transactions) {
            // For SAFE_UI format with bundleData
            transactions = bundle.bundleData.transactions.map(tx => ({
                to: tx.to,
                value: tx.value || '0',
                data: tx.data || '0x',
                operation: 0 // CALL operation
            }));
        } else if (bundle.bundleData && Array.isArray(bundle.bundleData)) {
            // For EOA format converted to Safe format
            transactions = bundle.bundleData.map(tx => ({
                to: tx.to,
                value: tx.value || '0',
                data: tx.data || '0x',
                operation: 0 // CALL operation
            }));
        } else if (bundle.transactions) {
            // Direct transactions array
            transactions = bundle.transactions.map(tx => ({
                to: tx.to,
                value: tx.value || '0',
                data: tx.data || '0x',
                operation: 0 // CALL operation
            }));
        } else {
            throw new Error("Unsupported bundle format for Safe transaction");
        }
        
        return transactions;
    }
    
    /**
     * Encode multiple transactions for the MultiSend contract
     * @param {Array} transactions - Array of transactions to encode
     * @returns {string} Encoded transactions for MultiSend
     */
    encodeMultiSendTransactions(transactions) {
        // Get an instance of the ethers.js utils for encoding
        const { defaultAbiCoder, hexlify, hexZeroPad, concat } = ethers.utils;
        
        // Each transaction to be encoded as:
        // operation (uint8) + to (address) + value (uint256) + dataLength (uint256) + data (bytes)
        const encodedTransactions = transactions.map(tx => {
            // Operation is always 0 for CALL
            const operation = '00'; // No 0x prefix
            
            // Address is padded to 20 bytes, without 0x prefix
            const to = hexZeroPad(tx.to.toLowerCase(), 20).slice(2);
            
            // Value is a uint256 (32 bytes), without 0x prefix
            const value = hexZeroPad(
                hexlify(tx.value === '0x0' || tx.value === '0' ? 0 : tx.value), 
                32
            ).slice(2);
            
            // Remove 0x prefix for data
            const data = tx.data.startsWith('0x') ? tx.data.slice(2) : tx.data;
            
            // Data length is a uint256 (32 bytes), without 0x prefix
            const dataLength = hexZeroPad(hexlify(data.length / 2), 32).slice(2);
            
            // Combine all parts (without any 0x prefixes)
            return operation + to + value + dataLength + data;
        });
        
        // Join all encoded transactions (no 0x prefixes)
        const encodedData = encodedTransactions.join('');
        
        // MultiSend function selector (multiSend)
        const multiSendFunction = '8d80ff0a'; // No 0x prefix
        
        // Offset is always 32 for a single parameter (pointer to the data)
        const offset = hexZeroPad(hexlify(32), 32).slice(2);
        
        // Length of the data in bytes
        const length = hexZeroPad(hexlify(encodedData.length / 2), 32).slice(2);
        
        // Calculate padding needed to make data length a multiple of 32 bytes
        const dataLengthInBytes = encodedData.length / 2;
        const padding = dataLengthInBytes % 32 === 0 ? 
                        '' : 
                        '0'.repeat(64 - (dataLengthInBytes % 32) * 2);
        
        // Combine all parts (adding back the 0x prefix at the beginning only)
        return '0x' + multiSendFunction + offset + length + encodedData + padding;
    }

    /**
     * Calculate EIP-712 hash for a Safe transaction
     * @param {string} safeAddress - Safe address
     * @param {Object} tx - Transaction data
     * @returns {string} Transaction hash
     */
    calculateSafeTxHash(safeAddress, tx) {
        // Generate a domain separator for the Safe contract
        const DOMAIN_SEPARATOR_TYPEHASH = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes('EIP712Domain(uint256 chainId,address verifyingContract)')
        );
        
        const domainSeparator = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['bytes32', 'uint256', 'address'],
                [DOMAIN_SEPARATOR_TYPEHASH, this.chainId, safeAddress]
            )
        );
        
        // Encode the transaction details
        const SAFE_TX_TYPEHASH = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(
                'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)'
            )
        );
        
        const safeTxHash = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ['bytes32', 'address', 'uint256', 'bytes32', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'],
                [
                    SAFE_TX_TYPEHASH,
                    tx.to,
                    tx.value,
                    ethers.utils.keccak256(tx.data),
                    tx.operation,
                    tx.safeTxGas,
                    tx.baseGas,
                    tx.gasPrice,
                    tx.gasToken,
                    tx.refundReceiver,
                    tx.nonce
                ]
            )
        );
        
        // Combine domain separator and encoded tx
        return ethers.utils.keccak256(
            ethers.utils.solidityPack(
                ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
                ['0x19', '0x01', domainSeparator, safeTxHash]
            )
        );
    }

    /**
     * Sign a transaction hash using the signer's private key
     * @param {Object} signer - Ethers Wallet
     * @param {string} hash - Transaction hash
     * @returns {Promise<string>} Signature in Safe format
     */
    async signTransactionHash(signer, hash) {
        try {
            console.log(`Signing hash: ${hash}`);
            
            // For Safe Transaction Service, we need to use a regular signature without the EIP-712 prefix
            const signature = await signer._signingKey().signDigest(ethers.utils.arrayify(hash));
            
            // Format the signature as a hex string
            const formattedSignature = ethers.utils.joinSignature(signature);
            
            return formattedSignature;
        } catch (error) {
            console.error(`Error signing transaction: ${error.message}`);
            throw error;
        }
    }

    /**
     * Decrypt the private key using the secure storage
     * @param {string} address - Wallet address 
     * @param {string} password - Password for decryption
     * @returns {Promise<string>} Decrypted private key
     */
    async getDecryptedPrivateKey(address, password) {
        console.log(`Decrypting private key for ${address}...`);
        const secureStorage = new SecureStorage();
        
        // Check if we have a key for this address
        const hasKey = await secureStorage.hasPrivateKey(address);
        if (!hasKey) {
            throw new Error(`No private key found for address ${address}`);
        }
        
        // Decrypt the key
        const privateKey = await secureStorage.getPrivateKey(address, password);
        if (!privateKey) {
            throw new Error('Failed to decrypt private key. Incorrect password or corrupted data.');
        }
        
        console.log('Private key decrypted successfully');
        return privateKey;
    }
    
    /**
     * Propose a transaction to the Safe Transaction Service
     * @param {string} safeAddress - Safe address 
     * @param {Object} tx - Transaction data
     * @param {string} safeTxHash - Safe transaction hash
     * @param {string} signature - Transaction signature
     * @param {string} senderAddress - Address of sender
     * @returns {Promise<Object>} API response
     */
    async proposeTransactionToService(safeAddress, tx, safeTxHash, signature, senderAddress) {
        try {
            console.log('Proposing transaction to Safe Transaction Service...');
            
            // Ensure addresses are checksummed
            const payload = {
                safeAddress: ethers.utils.getAddress(safeAddress),
                to: ethers.utils.getAddress(tx.to),
                value: tx.value,
                data: tx.data,
                operation: tx.operation,
                safeTxGas: tx.safeTxGas,
                baseGas: tx.baseGas,
                gasPrice: tx.gasPrice,
                gasToken: ethers.utils.getAddress(tx.gasToken),
                refundReceiver: ethers.utils.getAddress(tx.refundReceiver),
                nonce: tx.nonce,
                safeTxHash: safeTxHash,
                contractTransactionHash: safeTxHash, // Required field
                sender: ethers.utils.getAddress(senderAddress),
                signature: signature,
                origin: 'BeraBundle'
            };
            
            console.log('Sending proposal payload...');
            
            // Submit the transaction proposal to the API
            const response = await axios.post(
                `${this.serviceUrl}/v1/safes/${safeAddress}/multisig-transactions/`,
                payload
            );
            
            console.log('✅ Transaction successfully proposed!');
            return response.data;
        } catch (error) {
            console.error('Error proposing transaction:', error.message);
            if (error.response && error.response.data) {
                console.error('API response:', JSON.stringify(error.response.data, null, 2));
                
                // Handle hash mismatch errors by checking if the API provides the correct hash
                if (error.response.data.nonFieldErrors && 
                    error.response.data.nonFieldErrors[0] &&
                    error.response.data.nonFieldErrors[0].includes("Contract-transaction-hash=")) {
                    
                    // Try to extract the expected hash from the error message
                    const match = error.response.data.nonFieldErrors[0].match(/Contract-transaction-hash=([0-9a-fx]+)/);
                    if (match && match[1]) {
                        const correctHash = match[1];
                        throw new Error(`Hash mismatch - correct hash: ${correctHash}`);
                    }
                }
            }
            throw error;
        }
    }
    
    /**
     * Confirm a transaction with a signature
     * @param {string} safeTxHash - Safe transaction hash
     * @param {string} signature - Transaction signature
     * @returns {Promise<Object>} API response
     */
    async confirmTransaction(safeTxHash, signature) {
        try {
            console.log('Confirming transaction...');
            
            const response = await axios.post(
                `${this.serviceUrl}/v1/signatures/`,
                {
                    signature: signature,
                    safeTxHash: safeTxHash
                }
            );
            
            console.log('✅ Transaction confirmed successfully!');
            return response.data;
        } catch (error) {
            console.log('Note: Confirmation may have already been included in the proposal.');
            console.log(`Confirmation error: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Propose a Safe transaction via Safe Transaction Service API
     * Using the implementation that works from test-safe-proposal.js
     * @param {string} safeAddress - Safe address
     * @param {Object} bundle - Bundle containing transaction data
     * @param {string} signerAddress - Address of the signer
     * @param {string} password - Password to decrypt the private key
     * @returns {Promise<Object>} Proposal result with success status
     */
    async proposeSafeTransaction(safeAddress, bundle, signerAddress, password) {
        try {
            console.log(`Proposing Safe transaction for ${safeAddress}...`);
            console.log(`Using signer: ${signerAddress}`);
            
            // Step 1: Decrypt the private key
            const privateKey = await this.getDecryptedPrivateKey(signerAddress, password);
            
            // Step 2: Create the signer
            const signer = new ethers.Wallet(privateKey, this.provider);
            
            // Step 3: Format transactions from the bundle
            const transactions = this.formatTransactionsForSafe(bundle);
            console.log(`Formatted ${transactions.length} transactions`);
            
            // Step 4: Get the next nonce from Safe
            const nonceResult = await this.getNextNonce(safeAddress);
            if (!nonceResult.success) {
                throw new Error(`Failed to get nonce: ${nonceResult.message}`);
            }
            const nonce = nonceResult.nonce;
            console.log(`Using nonce: ${nonce}`);
            
            // Check if we have any transactions
            if (transactions.length === 0) {
                throw new Error("No transactions in bundle");
            }
            
            // Step 5: Handle transactions - use MultiSend contract if multiple transactions
            let tx;
            
            if (transactions.length === 1) {
                // Single transaction - use it directly
                const transaction = transactions[0];
                console.log(`Using single transaction: To=${transaction.to}, Value=${transaction.value}, Data=${transaction.data.substring(0, 50)}...`);
                
                // Create transaction data for the Safe Transaction Service
                tx = {
                    to: transaction.to,
                    value: transaction.value === '0x0' ? '0' : transaction.value,
                    data: transaction.data,
                    operation: 0, // Call
                    safeTxGas: 0,
                    baseGas: 0,
                    gasPrice: 0,
                    gasToken: '0x0000000000000000000000000000000000000000',
                    refundReceiver: '0x0000000000000000000000000000000000000000',
                    nonce: nonce
                };
            } else {
                // Multiple transactions - use MultiSend contract
                console.log(`Bundling ${transactions.length} transactions using MultiSend contract`);
                
                // Get MultiSendCallOnly contract address from config (uses regular CALL operation)
                const multiSendAddress = config.networks.berachain.safe.multiSendCallsOnlyAddress;
                console.log(`Using MultiSendCallsOnly contract: ${multiSendAddress}`);
                
                // Encode transactions for MultiSend
                const encodedTransactions = this.encodeMultiSendTransactions(transactions);
                
                // Create transaction for MultiSend - using CALL operation (0) instead of DELEGATE_CALL (1)
                tx = {
                    to: multiSendAddress,
                    value: '0', // MultiSend doesn't accept ETH directly
                    data: encodedTransactions,
                    operation: 0, // Regular CALL operation (not DELEGATE_CALL)
                    safeTxGas: 0,
                    baseGas: 0,
                    gasPrice: 0,
                    gasToken: '0x0000000000000000000000000000000000000000',
                    refundReceiver: '0x0000000000000000000000000000000000000000',
                    nonce: nonce
                };
            }
            
            console.log('Prepared transaction data for Safe Transaction Service');
            
            // Step 7: Calculate the Safe transaction hash
            console.log('Calculating transaction hash...');
            const safeTxHash = this.calculateSafeTxHash(safeAddress, tx);
            console.log(`Calculated transaction hash: ${safeTxHash}`);
            
            // Step 8: Sign the transaction hash
            console.log('Signing transaction hash...');
            const signature = await this.signTransactionHash(signer, safeTxHash);
            console.log(`Signature: ${signature}`);
            
            // Step 9: Propose the transaction to the Safe Transaction Service
            let proposalResult;
            let finalHash = safeTxHash;
            
            try {
                // First try with our calculated hash
                proposalResult = await this.proposeTransactionToService(safeAddress, tx, safeTxHash, signature, signerAddress);
            } catch (error) {
                // If there's a hash mismatch error
                if (error.message && error.message.includes('Hash mismatch - correct hash:')) {
                    // Extract the correct hash from the error message
                    const correctHash = error.message.split('Hash mismatch - correct hash: ')[1];
                    console.log(`Using correct hash from API error: ${correctHash}`);
                    
                    // Sign with the correct hash
                    const correctSignature = await this.signTransactionHash(signer, correctHash);
                    proposalResult = await this.proposeTransactionToService(safeAddress, tx, correctHash, correctSignature, signerAddress);
                    finalHash = correctHash;
                } else {
                    throw error;
                }
            }
            
            // Step 10: Confirm the transaction with the same signature
            console.log('\nConfirming transaction...');
            try {
                await this.confirmTransaction(finalHash, signature);
            } catch (confirmError) {
                console.log('Note: Confirmation may have already been included in the proposal.');
                console.log(`Confirmation error: ${confirmError.message}`);
            }
            
            // Get the transaction URL and return success
            const transactionUrl = this.getSafeTransactionUrl(safeAddress);
            
            return {
                success: true,
                message: 'Transaction successfully proposed to Safe Transaction Service',
                transactionUrl,
                safeTxHash: finalHash
            };
        } catch (error) {
            console.error(`Error proposing transaction: ${error.message}`);
            if (error.stack) {
                console.error(error.stack);
            }
            
            return {
                success: false,
                message: `Failed to propose Safe transaction: ${error.message}`
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