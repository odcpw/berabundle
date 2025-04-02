/**
 * test-safe-proposal.js - Direct Safe Transaction Service API approach
 * 
 * This script focuses on directly interacting with the Safe Transaction Service API
 * to propose a transaction from a bundle.
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const SecureStorage = require('./storage/engines/secureStorage');

// Configuration
const CONFIG = {
    safeAddress: '0x561EF9Fdf5341EF3815E69E1010067b7EF179dad',
    rpcUrl: 'https://rpc.berachain.com',
    password: '68ouimoi', // Password for decryption
    signerAddress: '0x6c6eEbcBd13e2BBeC88e44f298B17Dea0d2ce46F', // The signer address from wallets.json
    txServiceUrl: 'https://safe-transaction-berachain.safe.global/api',
    chainId: 80094 // Berachain
};

/**
 * Decrypt the private key using the secure storage
 * @param {string} address - Wallet address 
 * @param {string} password - Password for decryption
 * @returns {Promise<string>} Decrypted private key
 */
async function getDecryptedPrivateKey(address, password) {
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
 * Load a bundle file from output directory
 * @param {string} fileName - Bundle file name
 * @returns {Object} Loaded bundle
 */
function loadBundle(fileName) {
    const filePath = path.join(__dirname, 'output', fileName);
    console.log(`Loading bundle from ${filePath}`);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Get the next nonce for a Safe from the Transaction Service API
 * @param {string} safeAddress - Safe address
 * @returns {Promise<number>} Next nonce to use
 */
async function getNextNonce(safeAddress) {
    try {
        const response = await axios.get(`${CONFIG.txServiceUrl}/v1/safes/${safeAddress}/`);
        return parseInt(response.data.nonce);
    } catch (error) {
        console.error(`Error getting Safe nonce: ${error.message}`);
        if (error.response) {
            console.error('API response:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

/**
 * Calculate EIP-712 hash for a Safe transaction
 * @param {string} safeAddress - Safe address
 * @param {Object} tx - Transaction data
 * @param {number} chainId - Chain ID
 * @returns {string} Transaction hash
 */
function calculateSafeTxHash(safeAddress, tx, chainId) {
    // This is a simplified calculation for demonstration
    // In production, use the actual EIP-712 Safe transaction hash calculation
    
    // Generate a domain separator for the Safe contract
    const DOMAIN_SEPARATOR_TYPEHASH = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes('EIP712Domain(uint256 chainId,address verifyingContract)')
    );
    
    const domainSeparator = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ['bytes32', 'uint256', 'address'],
            [DOMAIN_SEPARATOR_TYPEHASH, chainId, safeAddress]
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
async function signTransactionHash(signer, hash) {
    try {
        console.log(`Signing hash: ${hash}`);
        
        // Sign the hash directly using the private key
        // This produces an EIP-712 compliant signature
        const flatSig = await signer.signMessage(ethers.utils.arrayify(hash));
        console.log(`Generated raw signature: ${flatSig}`);
        
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
 * Propose a transaction to the Safe Transaction Service
 * @param {Object} safeService - Safe API client
 * @param {Object} tx - Transaction data
 * @param {string} signature - Transaction signature
 * @param {string} senderAddress - Address of sender
 * @returns {Promise<Object>} API response
 */
async function proposeTransaction(tx, safeTxHash, signature, senderAddress) {
    try {
        console.log('Proposing transaction to Safe Transaction Service...');
        
        // Ensure addresses are checksummed
        const payload = {
            safeAddress: ethers.utils.getAddress(CONFIG.safeAddress),
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
            contractTransactionHash: safeTxHash, // Adding this field as required by the API
            sender: ethers.utils.getAddress(senderAddress),
            signature: signature,
            origin: 'BeraBundle'
        };
        
        console.log('Request payload:', JSON.stringify(payload, null, 2));
        
        // Submit the transaction proposal to the API
        const response = await axios.post(
            `${CONFIG.txServiceUrl}/v1/safes/${CONFIG.safeAddress}/multisig-transactions/`,
            payload
        );
        
        console.log('✅ Transaction successfully proposed!');
        console.log('API response:', JSON.stringify(response.data, null, 2));
        
        return response.data;
    } catch (error) {
        console.error('Error proposing transaction:', error.message);
        if (error.response && error.response.data) {
            console.error('API response:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

/**
 * Run the transaction proposal process
 */
async function proposeSafeTransaction() {
    try {
        console.log('='.repeat(50));
        console.log('🔐 SAFE TRANSACTION PROPOSAL');
        console.log('='.repeat(50));
        
        // Step 1: Decrypt the private key
        const privateKey = await getDecryptedPrivateKey(CONFIG.signerAddress, CONFIG.password);
        
        // Step 2: Set up provider and signer
        console.log(`\nConnecting to ${CONFIG.rpcUrl}...`);
        const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
        const signer = new ethers.Wallet(privateKey, provider);
        const signerAddress = await signer.getAddress();
        console.log(`Connected with signer address: ${signerAddress}`);
        
        // Step 3: Find and load the most recent bundle
        console.log('\nLooking for Safe UI bundles...');
        const outputDir = path.join(__dirname, 'output');
        const files = fs.readdirSync(outputDir);
        const bundleFiles = files.filter(f => f.endsWith('_safe_ui.json'));
        
        if (bundleFiles.length === 0) {
            throw new Error('No Safe UI bundles found in output directory');
        }
        
        // Sort by date (newest first)
        bundleFiles.sort((a, b) => {
            return fs.statSync(path.join(outputDir, b)).mtime.getTime() - 
                  fs.statSync(path.join(outputDir, a)).mtime.getTime();
        });
        
        const newestBundle = bundleFiles[0];
        console.log(`Using most recent bundle: ${newestBundle}`);
        const bundle = loadBundle(newestBundle);
        
        // Step 4: Verify the bundle has transactions
        if (!bundle.transactions || bundle.transactions.length === 0) {
            throw new Error('Bundle has no transactions');
        }
        
        console.log(`Found ${bundle.transactions.length} transactions in bundle`);
        
        // For simplicity, use only the first transaction
        const transaction = bundle.transactions[0];
        console.log('\nUsing the first transaction:');
        console.log(`To: ${transaction.to}`);
        console.log(`Value: ${transaction.value || '0'}`);
        console.log(`Data: ${transaction.data.substring(0, 50)}...`);
        
        // Step 5: Get the next nonce for the Safe
        console.log('\nGetting next nonce from Safe Transaction Service...');
        const nonce = await getNextNonce(CONFIG.safeAddress);
        console.log(`Next nonce: ${nonce}`);
        
        // Step 6: Create transaction data for the Safe Transaction Service
        const tx = {
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
        
        console.log('\nPrepared transaction data for Safe Transaction Service');
        
        // Step 7: Calculate the Safe transaction hash
        console.log('\nCalculating EIP-712 transaction hash...');
        const safeTxHash = calculateSafeTxHash(CONFIG.safeAddress, tx, CONFIG.chainId);
        console.log(`Transaction hash: ${safeTxHash}`);
        
        // Step 8: Sign the transaction hash
        console.log('\nSigning transaction hash...');
        const signature = await signTransactionHash(signer, safeTxHash);
        console.log(`Signature: ${signature}`);
        
        // Step 9: Propose the transaction to the Safe Transaction Service
        const proposalResult = await proposeTransaction(tx, safeTxHash, signature, signerAddress);
        
        // Step 10: Confirm the transaction with the same signature
        console.log('\nConfirming transaction...');
        try {
            await axios.post(
                `${CONFIG.txServiceUrl}/v1/signatures/`,
                {
                    signature: signature,
                    safeTxHash: safeTxHash
                }
            );
            console.log('✅ Transaction confirmed successfully!');
        } catch (confirmError) {
            console.log('Note: Confirmation may have already been included in the proposal.');
            console.log(`Confirmation error: ${confirmError.message}`);
        }
        
        // Step 11: Return the result
        return {
            success: true,
            message: 'Transaction successfully proposed to Safe Transaction Service',
            transactionUrl: `https://app.safe.global/transactions/queue?safe=ber:${CONFIG.safeAddress.toLowerCase()}`,
            safeTxHash: safeTxHash
        };
    } catch (error) {
        console.error(`\n❌ ERROR: ${error.message}`);
        if (error.stack) console.error(error.stack);
        
        return {
            success: false,
            message: error.message
        };
    }
}

// Execute the transaction proposal
proposeSafeTransaction().then(result => {
    console.log('\n='.repeat(50));
    console.log('📋 RESULT:');
    console.log('='.repeat(50));
    console.log(JSON.stringify(result, null, 2));
    
    if (result.success) {
        console.log('\n✅ Success!');
        console.log(`You can view your transaction at: ${result.transactionUrl}`);
    } else {
        console.log('\n❌ Failed to propose transaction');
    }
});