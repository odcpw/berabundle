# Safe API Kit Usage Notes

## URL Format for Safe API Kit

When using the Safe API Kit with the Transaction Service, the URL format is critical:

### Issue

The Safe API Kit internally adds `/v1/` to the URL you provide in the `txServiceUrl` parameter. However, the actual Safe Transaction Service API endpoint includes `/api/v1/`.

For example, if you initialize the API Kit with:
```javascript
const apiKit = new SafeApiKit({
  txServiceUrl: 'https://safe-transaction-berachain.safe.global'
});
```

The SDK will make requests to: 
```
https://safe-transaction-berachain.safe.global/v1/about
```

But the actual API endpoint is:
```
https://safe-transaction-berachain.safe.global/api/v1/about
```

### Solution

To make the Safe API Kit work correctly, use a URL that ends with `/api` (without the trailing slash):

```javascript
const apiKit = new SafeApiKit({
  chainId: BigInt(79966), // Berachain chainId
  txServiceUrl: 'https://safe-transaction-berachain.safe.global/api'
});
```

This way, when the SDK adds `/v1/` to the URL, it results in the correct endpoint:
```
https://safe-transaction-berachain.safe.global/api/v1/about
```

### Important Notes

1. The `chainId` parameter is required and must be provided as a BigInt.

2. For direct API calls using axios or fetch, use the full URL including `/api/v1/`:
   ```javascript
   axios.get('https://safe-transaction-berachain.safe.global/api/v1/about/');
   ```

3. The configuration in our codebase uses two different URLs for clarity:
   ```javascript
   // For Safe API Kit (no /v1/)
   serviceUrl: 'https://safe-transaction-berachain.safe.global/api',
   
   // For direct API calls (with /api/v1/)
   serviceApiUrl: 'https://safe-transaction-berachain.safe.global/api/v1',
   ```

## Usage with Propose Bundle

### Proposing and Confirming Transactions

The propose-bundle-api-kit.js script now:
1. Proposes the transaction to the Safe
2. Automatically confirms it with the signer's signature

This means that the signer's approval is already included when the transaction is proposed:

```bash
npm run propose-bundle-api-kit
```

### API Kit Code Example

If you need to implement this pattern in other scripts, here's how to do it:

```javascript
// 1. Import the Safe API Kit
const { createSafeApiKit } = require('./services/safeApiSetup');

// 2. Create an API Kit instance
const safeApiKit = createSafeApiKit();

// 3. Propose a transaction
const proposalParams = {
    safeAddress: checksummedSafeAddress,
    safeTransactionData: safeTransactionData,
    safeTxHash: safeTxHash,
    senderAddress: signerAddress,
    senderSignature: signature,
    origin: "BeraBundle"
};

await safeApiKit.proposeTransaction(proposalParams);

// 4. Add an explicit confirmation (may not be necessary as the signature is already included)
try {
    await safeApiKit.confirmTransaction(safeTxHash, signature);
    console.log("Transaction confirmed by the proposer!");
} catch (error) {
    console.log("Note: Signature might already be included in the proposal.");
}
```

## References

- Safe Transaction Service: https://github.com/safe-global/safe-transaction-service
- Safe API Kit: https://github.com/safe-global/safe-core-sdk/tree/main/packages/api-kit
- Safe API Kit confirmTransaction: https://docs.safe.global/reference-sdk-api-kit/confirmtransaction