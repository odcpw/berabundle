# Safe Transaction Service Integration

This document explains how BeraBundle integrates with the Safe Transaction Service API to support multisig wallets.

## Overview

BeraBundle uses a direct API integration with the Safe Transaction Service to propose transactions to Safe multisig wallets. This implementation:

- Does not rely on the Safe SDK libraries which had compatibility issues
- Uses direct HTTP requests to the Safe Transaction Service API
- Properly formats and signs transactions according to the EIP-712 standard
- Handles hash calculation that is compatible with the Safe contracts

## Architecture

The Safe integration consists of two main components:

1. **SafeAdapter** (`execution/adapters/safeAdapter.js`): Handles direct interaction with the Safe Transaction Service API, including:
   - Transaction hash calculation (EIP-712)
   - Transaction signing using `signDigest` method
   - Transaction proposal via the API
   - Error handling with correct hash extraction

2. **SafeExecutor** (`execution/executors/safeExecutor.js`): Provides a high-level interface for the application, including:
   - Transaction execution (proposal)
   - Safe wallet lookup
   - Transaction confirmation

The integration is based on the successful implementation in `test-safe-proposal.js`, which was verified to work correctly with the Safe Transaction Service.

## Key Technical Details

### Transaction Hash Calculation

```javascript
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
```

### Transaction Signing

```javascript
async signTransactionHash(signer, hash) {
    // For Safe Transaction Service, we need to use a regular signature without the EIP-712 prefix
    const signature = await signer._signingKey().signDigest(ethers.utils.arrayify(hash));
    
    // Format the signature as a hex string
    const formattedSignature = ethers.utils.joinSignature(signature);
    
    return formattedSignature;
}
```

### Handling Hash Mismatches

The integration includes a mechanism to handle hash mismatches, which was a common issue when integrating with the Safe Transaction Service:

```javascript
// If there's a hash mismatch error
if (error.message && error.message.includes('Hash mismatch - correct hash:')) {
    // Extract the correct hash from the error message
    const correctHash = error.message.split('Hash mismatch - correct hash: ')[1];
    console.log(`Using correct hash from API error: ${correctHash}`);
    
    // Sign with the correct hash
    const correctSignature = await this.signTransactionHash(signer, correctHash);
    proposalResult = await this.proposeTransactionToService(safeAddress, tx, correctHash, correctSignature, signerAddress);
    finalHash = correctHash;
}
```

## Usage Example

Here's a complete example of how to use the Safe integration in BeraBundle:

```javascript
// Initialize components
const provider = new ethers.providers.JsonRpcProvider('https://rpc.berachain.com');
const safeExecutor = new SafeExecutor(provider);

// Execute a Safe transaction
const result = await safeExecutor.execute({
    safeAddress: '0x561EF9Fdf5341EF3815E69E1010067b7EF179dad', // Safe address
    bundle: bundleObject, // Bundle with transactions
    signerAddress: '0x6c6eEbcBd13e2BBeC88e44f298B17Dea0d2ce46F', // Signer address
    password: 'secure-password' // Password to decrypt private key
});

if (result.success) {
    console.log(`Transaction proposed successfully!`);
    console.log(`Transaction hash: ${result.safeTxHash}`);
    console.log(`View in Safe UI: ${result.transactionUrl}`);
} else {
    console.error(`Failed to propose transaction: ${result.message}`);
}
```

## Testing

You can test the Safe integration using the provided `test-safe-proposal.js` script, which demonstrates the working implementation:

```
node test-safe-proposal.js
```

This will:
1. Find the most recent Safe UI bundle in the output directory
2. Calculate the correct transaction hash
3. Sign the transaction with the user's private key
4. Propose the transaction to the Safe Transaction Service
5. Confirm the transaction with the same signature