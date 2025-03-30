// safeService.js - Safe Transaction Service API integration
const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../config');
const { ErrorHandler } = require('../utils/errorHandler');

/**
 * Safe Transaction Service integration using Safe SDK
 */
class SafeService {
    constructor(provider) {
        this.provider = provider || new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
        this.serviceUrl = config.networks.berachain.safe.serviceUrl;
    }
    
    /**
     * Get Safe transaction URL for the web app
     * @param {string} safeAddress - Safe address
     * @param {string} safeTxHash - Safe transaction hash
     * @returns {string} Safe transaction URL
     */
    getSafeTransactionUrl(safeAddress, safeTxHash) {
        // Format according to Safe URL structure
        return `${config.networks.berachain.safe.appUrl}/transactions/queue?safe=ber:${safeAddress.toLowerCase()}`;
    }
    
    /**
     * Get the next nonce for a Safe
     * @param {string} safeAddress - Safe address
     * @returns {Promise<Object>} Next nonce
     */
    async getNextNonce(safeAddress) {
        try {
            const normalizedAddress = ethers.utils.getAddress(safeAddress);
            
            // Call the Safe Transaction Service API directly
            console.log(`Getting nonce directly from API for Safe: ${normalizedAddress}`);
            
            const response = await axios.get(
                `${config.networks.berachain.safe.serviceUrl}/safes/${normalizedAddress}`
            );
            
            if (response.status === 200 && response.data && response.data.nonce !== undefined) {
                console.log(`Nonce retrieved: ${response.data.nonce}`);
                return {
                    success: true,
                    nonce: response.data.nonce
                };
            } else {
                return {
                    success: false,
                    message: `Failed to get nonce: Unexpected response format`
                };
            }
        } catch (error) {
            console.log(`Error getting nonce: ${error.message}`);
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
            
            console.log(`Querying Safe Transaction Service for Safes owned by ${normalizedAddress}...`);
            
            // Try standard format first
            try {
                const response = await axios.get(`${config.networks.berachain.safe.serviceUrl}/owners/${normalizedAddress}/safes/`);
                if (response.status === 200 && response.data && response.data.safes) {
                    if (response.data.safes.length > 0) {
                        console.log(`Found ${response.data.safes.length} Safes for this owner`);
                        return {
                            success: true,
                            safes: response.data.safes
                        };
                    } else {
                        console.log('No Safes found for this owner');
                        return {
                            success: true,
                            safes: []
                        };
                    }
                }
            } catch (firstError) {
                console.log(`First endpoint format failed: ${firstError.message}`);
                
                // Try alternative format (some implementations have different endpoints)
                try {
                    console.log('Trying alternative endpoint format...');
                    const response = await axios.get(`${config.networks.berachain.safe.serviceUrl}/owners/${normalizedAddress}`);
                    if (response.status === 200 && response.data && response.data.safes) {
                        if (response.data.safes.length > 0) {
                            console.log(`Found ${response.data.safes.length} Safes for this owner`);
                            return {
                                success: true,
                                safes: response.data.safes
                            };
                        } else {
                            console.log('No Safes found for this owner');
                            return {
                                success: true,
                                safes: []
                            };
                        }
                    }
                } catch (secondError) {
                    console.log(`Second endpoint format also failed: ${secondError.message}`);
                    
                    // Manual verification - check if signer is owner of the specified Safe
                    try {
                        console.log(`Checking if ${normalizedAddress} is explicitly an owner of the target Safe...`);
                        const safeInfoResponse = await axios.get(`${config.networks.berachain.safe.serviceUrl}/safes/${config.safeAddress || safeAddress}`);
                        
                        if (safeInfoResponse.status === 200 && safeInfoResponse.data && safeInfoResponse.data.owners) {
                            const isOwner = safeInfoResponse.data.owners.some(
                                owner => owner.toLowerCase() === normalizedAddress.toLowerCase()
                            );
                            
                            if (isOwner) {
                                console.log(`Confirmed ${normalizedAddress} is an owner of the Safe!`);
                                return {
                                    success: true,
                                    safes: [config.safeAddress || safeAddress]
                                };
                            } else {
                                console.log(`${normalizedAddress} is NOT an owner of the Safe`);
                                return {
                                    success: true,
                                    safes: []
                                };
                            }
                        }
                    } catch (checkError) {
                        console.log(`Failed to check Safe ownership directly: ${checkError.message}`);
                    }
                    
                    // Return empty result
                    return {
                        success: false,
                        safes: [],
                        message: `Could not verify Safe ownership: API endpoints failed`
                    };
                }
            }
            
            // Default return if we get here
            console.log('No Safes found for this owner');
            return {
                success: true,
                safes: []
            };
        } catch (error) {
            console.log(`Warning: Failed to get Safes for owner ${ownerAddress}: ${error.message}`);
            
            return {
                success: false,
                safes: [],
                message: `Failed to get Safes for owner: ${error.message}`
            };
        }
    }

    /**
     * Propose a Safe transaction using the Safe Transaction Service API directly
     * This will make the transaction appear in the Safe UI for all owners
     * @param {string} safeAddress - Safe address
     * @param {Object} bundle - Bundle containing transaction data
     * @param {Object} signer - Ethers signer for signing the transaction
     * @returns {Promise<Object>} Proposal result
     */
    async proposeSafeTransactionWithSdk(safeAddress, bundle, signer) {
        try {
            console.log("Proposing Safe transaction to appear in the Safe UI for all owners...");
            console.log(`Target Safe address: ${safeAddress}`);
            const signerAddress = await signer.getAddress();
            console.log(`Proposer address: ${signerAddress}`);
            
            // Format transactions based on bundle format
            let transactions = [];
            
            if (bundle.bundleData.transactions) {
                // For SAFE_UI or SAFE_CLI formats
                transactions = bundle.bundleData.transactions.map(tx => ({
                    to: tx.to,
                    value: tx.value || '0',
                    data: tx.data,
                    operation: 0 // CALL operation, not DELEGATE_CALL
                }));
            } else if (Array.isArray(bundle.bundleData)) {
                // For EOA format converted to Safe format
                transactions = bundle.bundleData.map(tx => ({
                    to: tx.to,
                    value: tx.value || '0',
                    data: tx.data,
                    operation: 0 // CALL operation, not DELEGATE_CALL
                }));
            } else {
                return {
                    success: false,
                    message: "Unsupported bundle format for Safe transaction"
                };
            }
            
            console.log(`Processing ${transactions.length} transactions`);
            
            // Get Safe nonce
            console.log("Getting Safe nonce...");
            const safeInfoResult = await this.getNextNonce(safeAddress);
            if (!safeInfoResult.success) {
                throw new Error(`Failed to get Safe nonce: ${safeInfoResult.message}`);
            }
            const nonce = safeInfoResult.nonce;
            console.log(`Using nonce: ${nonce}`);
            
            // Process transaction data for Safe Transaction Service
            let txData;
            if (transactions.length === 1) {
                // Single transaction
                const tx = transactions[0];
                
                // Prepare the transaction data in the format expected by the API
                txData = {
                    to: tx.to,
                    value: tx.value,
                    data: tx.data,
                    operation: 0,
                    safeTxGas: "0",
                    baseGas: "0",
                    gasPrice: "0",
                    gasToken: "0x0000000000000000000000000000000000000000",
                    refundReceiver: "0x0000000000000000000000000000000000000000",
                    nonce: nonce
                };
            } else {
                // Multiple transactions - prepare a MultiSend transaction
                console.log("Creating MultiSend transaction for multiple transactions...");
                
                // Encode transactions for MultiSend
                let encodedTransactions = '0x';
                for (const tx of transactions) {
                    // Operation (1 byte) - always 0 for CALL
                    const operation = '00';
                    
                    // To address (20 bytes)
                    const to = tx.to.toLowerCase().replace('0x', '').padStart(40, '0');
                    
                    // Value (32 bytes)
                    const value = ethers.BigNumber.from(tx.value || '0').toHexString().replace('0x', '').padStart(64, '0');
                    
                    // Data length (32 bytes)
                    const data = tx.data.replace('0x', '');
                    const dataLength = (data.length / 2).toString(16).padStart(64, '0');
                    
                    // Combine all parts
                    encodedTransactions += operation + to + value + dataLength + data;
                }
                
                // MultiSend contract address
                const multiSendAddress = config.networks.berachain.safe.multiSendAddress;
                
                // MultiSend method ID for multiSend function
                const multiSendMethodId = '0x8d80ff0a';
                
                // Encode the function call to multiSend
                const data = multiSendMethodId + 
                    // Offset to data parameter (32 bytes) - always 32 for a single parameter
                    '0000000000000000000000000000000000000000000000000000000000000020' + 
                    // Length of the bytes parameter (32 bytes)
                    (encodedTransactions.length / 2 - 1).toString(16).padStart(64, '0') + 
                    // The actual encoded transactions
                    encodedTransactions.slice(2);
                
                // Prepare the transaction for the API
                txData = {
                    to: multiSendAddress,
                    value: "0",
                    data: data,
                    operation: 0, // CALL
                    safeTxGas: "0",
                    baseGas: "0",
                    gasPrice: "0",
                    gasToken: "0x0000000000000000000000000000000000000000",
                    refundReceiver: "0x0000000000000000000000000000000000000000",
                    nonce: nonce
                };
            }
            
            // Calculate the hash
            console.log("Calculating transaction hash...");
            
            // Convert Safe address to checksum format
            const checksummedSafeAddress = ethers.utils.getAddress(safeAddress);
            
            // Get chain ID (decimal)
            const chainId = parseInt(config.networks.berachain.chainId, 16);
            console.log(`Using chain ID: ${chainId} (from hex ${config.networks.berachain.chainId})`);
            
            // Calculate transaction hash according to EIP-712
            // 1. Domain separator
            const domainSeparatorTypehash = ethers.utils.keccak256(
                ethers.utils.toUtf8Bytes('EIP712Domain(uint256 chainId,address verifyingContract)')
            );
            
            const domainSeparator = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ['bytes32', 'uint256', 'address'],
                    [domainSeparatorTypehash, chainId, checksummedSafeAddress]
                )
            );
            
            // 2. Transaction type hash
            const safeTxTypehash = ethers.utils.keccak256(
                ethers.utils.toUtf8Bytes('SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)')
            );
            
            // 3. Transaction hash
            const encodedData = ethers.utils.defaultAbiCoder.encode(
                ['bytes32', 'address', 'uint256', 'bytes32', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'],
                [
                    safeTxTypehash,
                    txData.to,
                    txData.value,
                    ethers.utils.keccak256(txData.data || '0x'),
                    txData.operation,
                    txData.safeTxGas,
                    txData.baseGas,
                    txData.gasPrice,
                    txData.gasToken,
                    txData.refundReceiver,
                    txData.nonce
                ]
            );
            
            const safeTxHash = ethers.utils.keccak256(
                ethers.utils.solidityPack(
                    ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
                    ['0x19', '0x01', domainSeparator, ethers.utils.keccak256(encodedData)]
                )
            );
            
            console.log(`Transaction hash: ${safeTxHash}`);
            
            // Sign the transaction hash
            console.log("Signing transaction hash...");
            const messageToSign = ethers.utils.arrayify(safeTxHash);
            const signature = await signer.signMessage(messageToSign);
            
            // Format the signature
            console.log("Formatting signature...");
            const sigData = ethers.utils.splitSignature(signature);
            
            // Format signature for Safe Transaction Service
            // 65 bytes: r (32 bytes) + s (32 bytes) + v (1 byte) 
            const formattedSignature = ethers.utils.hexlify(
                ethers.utils.concat([
                    ethers.utils.zeroPad(sigData.r, 32),
                    ethers.utils.zeroPad(sigData.s, 32),
                    ethers.utils.arrayify(sigData.v)
                ])
            );
            
            console.log(`Formatted signature: ${formattedSignature}`);
            
            // Prepare the API payload
            const payload = {
                ...txData,
                contractTransactionHash: safeTxHash,
                sender: signerAddress,
                signature: formattedSignature,
                origin: "BeraBundle"
            };
            
            // Submit to Safe Transaction Service
            console.log("Submitting to Safe Transaction Service...");
            console.log(`POST ${config.networks.berachain.safe.serviceUrl}/safes/${safeAddress}/multisig-transactions/`);
            
            const response = await axios.post(
                `${config.networks.berachain.safe.serviceUrl}/safes/${safeAddress}/multisig-transactions/`,
                payload
            );
            
            console.log(`Response status: ${response.status}`);
            console.log("✅ Transaction proposed successfully!");
            console.log("Transaction will appear in the Safe UI for all owners");
            
            return {
                success: true,
                safeTxHash,
                safeAddress,
                transactionUrl: this.getSafeTransactionUrl(safeAddress, safeTxHash),
                message: "Transaction proposed successfully"
            };
        } catch (error) {
            console.log(`❌ Error proposing Safe transaction: ${error.message}`);
            
            if (error.response) {
                console.log(`Response error: ${JSON.stringify(error.response.data)}`);
            }
            
            return {
                success: false,
                message: `Failed to propose Safe transaction: ${error.message}`,
                error: error
            };
        }
    }
}

module.exports = SafeService;