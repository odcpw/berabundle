# Safe SDK Integration Solution

## Problem Summary
We attempted to use the Safe API Kit to interact with the Safe Transaction Service, but encountered consistent "Not Found" errors with all configurations. Direct API calls to the same endpoints worked fine.

## Investigation & Testing
1. We tried multiple SDK configurations:
   - Different URL formats (with and without `/api/v1`)
   - Various initialization parameters (`txServiceUrl`, `chainId`)
   - Different ethers adapter approaches

2. We created test scripts:
   - `test-safe-sdk.js` - Testing the SafeService integration
   - `test-direct-vs-sdk.js` - Directly comparing SDK vs API calls

3. Key finding: While direct API calls to endpoints like `/safes/{address}/` and `/owners/{address}/safes/` work fine, all Safe API Kit methods fail with "Not Found" errors.

## Solution Implemented
We created a hybrid approach:
- Use the Safe Protocol Kit for transaction preparation, signing, and hash calculation (SDK)
- Use direct API calls with axios for interacting with the Safe Transaction Service (non-SDK)

### Key Implementation Details:
1. **SafeService Class**:
   - Uses Protocol Kit for on-chain operations: creating transactions, signing, calculating hashes
   - Uses direct axios calls for transaction service API operations

2. **Main Methods**:
   - `getNextNonce`: Uses direct API call to fetch Safe nonce
   - `getSafesByOwner`: Uses direct API call to find Safes for an owner
   - `proposeSafeTransaction`: Uses Protocol Kit to prepare and sign transactions, direct API call to propose
   - `confirmSafeTransaction`: Uses Protocol Kit to sign transaction hash, direct API call to submit confirmation

3. **Transaction Flow**:
   ```
   1. Initialize Protocol Kit with signer & Safe address
   2. Prepare transaction data with Protocol Kit
   3. Sign transaction with Protocol Kit
   4. Calculate transaction hash with Protocol Kit
   5. Submit proposal to Safe Transaction Service via direct API call
   ```

## Advantages of This Approach
1. Combines the best of both worlds:
   - Safe Protocol Kit for cryptographic operations (signatures, hashes)
   - Direct API calls for reliable communication with the Transaction Service

2. Uses the Safe SDK for critical operations:
   - Transaction creation follows the correct EIP-712 format
   - Signatures are properly formatted using the SDK
   - Transaction hashes are calculated correctly

3. Maintains compatibility with the Safe ecosystem while working around SDK issues

## Next Steps
If Safe API Kit support improves for Berachain in the future, we can easily switch back to using the API Kit by:
1. Updating the SafeService constructor to initialize the API Kit
2. Replacing the direct API calls with API Kit method calls
3. Keeping the Protocol Kit integration as is