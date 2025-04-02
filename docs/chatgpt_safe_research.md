Got it. I’ll investigate how to use the Safe SDK (formerly Gnosis Safe SDK) with Berachain mainnet to interact with safes via the API service. This includes proposing transactions with an owner, signing transactions with an owner, and combining propose and approve in one transaction, ensuring compatibility with the `/v1` API prefix and handling any discrepancies in transaction hashes. I’ll ensure everything is done using standard Safe practices—no delegate calls or workarounds.

I’ll report back with a clear summary and any necessary code or API request formats.

# Using the Safe SDK on Berachain’s Safe API (Mainnet)

## Overview of the Safe Transaction Flow (PCE)
On Berachain (chain ID **80094** ([safe-tx-hashes-util/safe_hashes.sh at main · pcaversaccio/safe-tx-hashes-util · GitHub](https://github.com/pcaversaccio/safe-tx-hashes-util/blob/main/safe_hashes.sh#:~:text=%5B))), Safe (formerly Gnosis Safe) accounts use the standard **Propose–Confirm–Execute (PCE)** workflow for multisig transactions ([Understanding Safe protocol development kit | by Rebel | Medium](https://itrebel.medium.com/understanding-safe-protocol-development-kit-67f258a1c93a#:~:text=steps%3A)). In summary:

1. **Propose:** An owner proposes a new Safe transaction via the Safe Transaction Service (Safe API) – this includes providing the transaction details and the proposer’s signature.
2. **Confirm (Sign):** Other owners sign/approve the pending transaction by submitting their signatures to the Safe API.
3. **Execute:** Once the required number of owner signatures (threshold) is collected, the transaction can be executed on-chain from the Safe contract.

All interactions (proposing and confirming) happen off-chain via the Safe API service, which for Berachain is hosted at `https://safe-transaction-berachain.safe.global/api/v1/...` ([safe-tx-hashes-util/safe_hashes.sh at main · pcaversaccio/safe-tx-hashes-util · GitHub](https://github.com/pcaversaccio/safe-tx-hashes-util/blob/main/safe_hashes.sh#:~:text=%5B%22berachain%22%5D%3D%22https%3A%2F%2Fsafe)) ([ Verify Safe transactions - HackMD](https://hackmd.io/@safe/verify-transactions#:~:text=the%20Safe%20backend%20using%20the,%3E%20%5BVerify)). This avoids direct contract calls for collecting signatures and adheres to Safe’s standard off-chain signature scheme.

## Setting Up the Safe SDK for Berachain
To ensure compatibility with Berachain’s Safe API deployment, configure the Safe SDK’s **API Kit** with the correct chain info. The Safe SDK (Safe{Core}) provides:

- **Protocol Kit** – to create transactions and generate signatures.
- **API Kit** – to interact with the Safe Transaction Service API.

When initializing the API Kit, you can either specify the chain by ID or provide the direct service URL. For Berachain, use chainId `80094` or the Berachain Safe service URL. For example:

```js
import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'

// Using chainId (if supported in this SDK version):
const apiKit = new SafeApiKit({ chainId: 80094n })

// Alternatively, specify the Berachain Safe API URL explicitly:
const apiKit = new SafeApiKit({
  chainId: 80094n,
  txServiceUrl: 'https://safe-transaction-berachain.safe.global'  // SDK will append /api/v1 internally
})
```

Ensure **not** to omit the `/api/v1` path if you end up making HTTP calls directly – the Safe API endpoints all reside under an `/api/v1` prefix ([ Verify Safe transactions - HackMD](https://hackmd.io/@safe/verify-transactions#:~:text=the%20Safe%20backend%20using%20the,%3E%20%5BVerify)). (The Safe SDK’s ApiKit will handle the correct paths for you when given the proper base URL or chainId.)

Next, initialize the Protocol Kit for a Safe account using an owner’s signer (private key or provider with key). For example, using owner #1’s credentials:

```js
const protocolKitOwner1 = await Safe.init({
  provider: '<RPC URL>',         // Berachain RPC endpoint
  signer: OWNER1_PRIVATE_KEY,    // an owner of the Safe
  safeAddress: SAFE_ADDRESS      // the Safe’s address on Berachain
})
```

Now `protocolKitOwner1` represents that Safe with owner1’s signing ability.

## Proposing a Transaction via Safe API
**Proposing** a transaction means creating a new pending multisig transaction in the Safe service that other owners can see and confirm. With the Safe SDK, the process is:

1. **Craft the transaction details:** Define the target `to` address, `value` (ETH to send, if any), `data` payload (calldata, if any), and set `operation` to **Call** (not delegatecall). For example:

```js
import { OperationType } from '@safe-global/types-kit';

const safeTxData = {
  to: '0x...TargetAddress',
  value: '0',          // sending 0 BERA (just a contract call)
  data: '0x...',       // calldata or '0x' if none
  operation: OperationType.Call   // 0 = CALL, avoid delegateCall (1) ([Programmatically sending a transaction request to Gnosis Safe wallet - Ethereum Stack Exchange](https://ethereum.stackexchange.com/questions/134718/programmatically-sending-a-transaction-request-to-gnosis-safe-wallet#:~:text=%2F%2F%20const%20safeTransactionData%3A%20SafeTransactionDataPartial%20%3D,proposeTransaction%28safeTx%2C%20safeSignature))
};
```

> **Note:** The `operation` field must be `0` for a regular call. Avoid using `OperationType.DelegateCall` (value `1`) as per your constraints, since delegate calls introduce additional complexity and are not needed here ([Programmatically sending a transaction request to Gnosis Safe wallet - Ethereum Stack Exchange](https://ethereum.stackexchange.com/questions/134718/programmatically-sending-a-transaction-request-to-gnosis-safe-wallet#:~:text=%2F%2F%20const%20safeTransactionData%3A%20SafeTransactionDataPartial%20%3D,proposeTransaction%28safeTx%2C%20safeSignature)).

2. **Create a Safe transaction object:** Use the Protocol Kit to create a transaction for your Safe. This will include all necessary fields like `nonce` and default gas parameters. For example:

```js
const safeTransaction = await protocolKitOwner1.createTransaction({ transactions: [safeTxData] });
```

3. **Compute the Safe transaction hash:** The Safe transaction hash (safeTxHash) is a unique hash of the transaction parameters, Safe address, and nonce. Use the SDK to get this deterministically instead of computing manually. For example:

```js
const safeTxHash = await protocolKitOwner1.getTransactionHash(safeTransaction);
```

This uses the Safe contract’s formula to compute the hash (including chainId and contract address) so that it will match what the service expects ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=,provide%20more%20information%20about%20the)).

4. **Sign the hash with an owner key:** The proposing owner must sign the `safeTxHash` to prove the proposal is authentic. Using the Protocol Kit with owner1’s signer:

```js
const senderSignature = await protocolKitOwner1.signHash(safeTxHash);
```

This produces an ECDSA signature (or EIP-712 signature) over the Safe’s transaction hash by owner1’s account.

5. **Submit the proposal to the Safe service:** Call the API Kit’s `proposeTransaction` method to send the transaction to the Safe Transaction Service. Include the Safe’s address, the transaction data, the hash, the proposer’s (owner’s) address, and the signature from the previous step. For example:

```js
await apiKit.proposeTransaction({
  safeAddress: SAFE_ADDRESS,
  safeTransactionData: safeTransaction.data,
  safeTxHash: safeTxHash,
  senderAddress: OWNER1_ADDRESS,
  senderSignature: senderSignature.data,
  origin: 'MyApp'  // optional, identifies the app origin of this tx
});
```

In this single call, the transaction is stored on the service **along with the proposer’s signature** ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=const%20safeTxHash%20%3D%20await%20protocolKit,data%2C%20origin)). This effectively combines the “propose” and the first “approve” into one step – owner1’s approval is included as the `senderSignature` ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=,provide%20more%20information%20about%20the)). The Safe API will verify the signature against the `safeTxHash` and the Safe’s owners. If anything is malformed (e.g. wrong hash or missing `/v1` in the URL), you might get errors like `404 Not Found` or signature validation failures. Using the SDK as above ensures the request is correctly shaped.

After a successful proposal, the Safe API (transaction service) will list the new transaction as pending for that Safe. You can fetch it by SafeTxHash or list all pending transactions via the API Kit (e.g. `apiKit.getPendingTransactions(SAFE_ADDRESS)` or `apiKit.getTransaction(safeTxHash)` as needed).

## Signing/Confirming the Transaction (Owner Approvals)
Once the transaction is proposed, other Safe owners need to **confirm** (approve) it by adding their signatures via the Safe API. Each owner will use their own Protocol Kit instance (with their signer) to sign the same `safeTxHash`:

- Initialize the Protocol Kit for another owner (e.g., owner2) similar to owner1’s setup:
  ```js
  const protocolKitOwner2 = await Safe.init({ provider: RPC_URL, signer: OWNER2_PRIVATE_KEY, safeAddress: SAFE_ADDRESS });
  ```
- Have owner2 sign the transaction hash:
  ```js
  const signature2 = await protocolKitOwner2.signHash(safeTxHash);
  ```
- Send this signature to the service using `confirmTransaction`:
  ```js
  await apiKit.confirmTransaction(safeTxHash, signature2.data);
  ```

This `confirmTransaction` call tells the Safe API to record owner2’s approval (it hits the “Confirm Multisig Transaction” endpoint under the hood). The code above corresponds to the Safe SDK usage: after retrieving the pending tx, an owner signs its `safeTxHash` and calls confirmTransaction with that hash and signature ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=%2F%2F%20transaction%3A%20SafeMultisigTransactionResponse)). The Safe API will verify that signature2 is from a valid owner of the Safe and attach it to the transaction’s record.

Repeat this for any additional owners until the required number of confirmations is reached (the Safe’s threshold). The Safe Transaction Service tracks how many confirmations are collected ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=dataDecoded%3F%3A%20string%20confirmationsRequired%3A%20number%20confirmations%3F%3A,string%20confirmationType%3F%3A%20string%20signature%3A%20string)).

## Execution (On-Chain)
*(For completeness)* Once the proposal has enough signatures, the transaction becomes executable. At this point, an on-chain transaction must be sent to the Safe contract to actually perform the operation (this step is not done via the Safe API, but rather via the Safe contract itself). You can use the Protocol Kit to execute it, for example:

```js
const safeTx = await apiKit.getTransaction(safeTxHash);    // fetch latest state with confirmations
const execResponse = await protocolKitOwner1.executeTransaction(safeTx);
await execResponse.transactionResponse.wait();  // wait for receipt
```

The Safe SDK will bundle the signatures and call the Safe’s `execTransaction(...)` function to perform the call on Berachain. Execution requires one of the owners (or a designated relayer) to pay gas.

## Key Points and Common Pitfalls

- **Safe API Endpoint Formatting:** Always include the correct base path. For Berachain’s Safe service, the base URL is `safe-transaction-berachain.safe.global`, and all endpoints are under `/api/v1/` on that host ([ Verify Safe transactions - HackMD](https://hackmd.io/@safe/verify-transactions#:~:text=the%20Safe%20backend%20using%20the,%3E%20%5BVerify)). If you use the SafeApiKit with chainId or the proper `txServiceUrl`, it will construct the correct URLs. If you manually call the API (e.g. for debugging with curl), ensure your URLs include `/api/v1`. For example, to propose a transaction:
  `POST https://safe-transaction-berachain.safe.global/api/v1/safes/<YOUR_SAFE_ADDRESS>/multisig-transactions/` (with JSON body as shown above). Missing the `/api/v1` or any path element will result in a 404 **Not Found** error.

- **Computing `safeTxHash`:** Do not manually hash transaction fields unless you are certain of the formula. The Safe SDK’s `getTransactionHash(...)` method should be used to avoid mismatches ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=,provide%20more%20information%20about%20the)). This ensures the hash includes the correct chain ID and Safe address as per the Safe contract’s domain separator. A common error is computing the hash with wrong parameters or forgetting a field, leading to a signature that the Safe service rejects (since it computes a different hash internally). Using the SDK’s provided method and signing utilities guarantees the hash and signature are correct ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=,provide%20more%20information%20about%20the)).

- **Including the Proposer’s Signature:** The `SafeApiKit.proposeTransaction()` call expects the proposing owner’s signature (`senderSignature`) along with the transaction data ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=,provide%20more%20information%20about%20the)). This means the act of proposing is also that owner’s confirmation in one step. Make sure you pass a valid signature from one of the Safe’s owners. (If you don’t want to include a signature for some reason, you’d need to register as a Safe delegate to propose without being an owner – but since the requirement is to use an owner account, include the signature.)

- **Avoiding `delegateCall`:** When preparing the transaction data, use **OperationType.Call** (0) for normal contract calls ([Programmatically sending a transaction request to Gnosis Safe wallet - Ethereum Stack Exchange](https://ethereum.stackexchange.com/questions/134718/programmatically-sending-a-transaction-request-to-gnosis-safe-wallet#:~:text=%2F%2F%20const%20safeTransactionData%3A%20SafeTransactionDataPartial%20%3D,proposeTransaction%28safeTx%2C%20safeSignature)). Do not use delegate calls (OperationType.DelegateCall) as these are explicitly to be avoided in this scenario. Delegate calls could be disabled or unsupported on the Berachain Safe service, and in general they pose additional security considerations. Sticking to standard calls ensures compatibility with the Safe API and Berachain’s Safe contracts.

- **Adhere to Safe Standards:** Use the SDK’s high-level methods (as shown above) rather than custom or “hacky” workarounds. For instance, avoid trying to manually encode confirmations or call Safe contract methods like `approveHash` directly – the off-chain signature collection via Safe API is the intended approach ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=Once%20we%20have%20the%20Safe,an%20object%20with%20the%20properties)) ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=The%20owners%20of%20the%20Safe,the%20signature%20to%20the%20service)). The Safe SDK handles all required encoding (for signatures, transaction data, etc.), so leveraging it prevents mistakes in formatting requests.

By following the above approach, you can **propose transactions, sign them with Safe owners, and even combine the proposal+first signature in one step**, all fully compatible with Berachain’s Safe deployment. The Safe API on Berachain will accept your transaction proposals and signatures as long as they are formatted as shown and derived via the Safe SDK (ensuring the `safeTxHash` and signatures match exactly) ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=,provide%20more%20information%20about%20the)) ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=%2F%2F%20transaction%3A%20SafeMultisigTransactionResponse)). This will result in correct transaction hashes, no mismatches, and successful multi-sig operations on Berachain’s mainnet Safe infrastructure.

**Sources:**

- Safe Core SDK guides on proposing and confirming transactions ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=,provide%20more%20information%20about%20the)) ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=const%20safeTxHash%20%3D%20await%20protocolKit,data%2C%20origin)) ([safe-core-sdk/guides/integrating-the-safe-core-sdk.md at main · safe-global/safe-core-sdk · GitHub](https://github.com/safe-global/safe-core-sdk/blob/main/guides/integrating-the-safe-core-sdk.md#:~:text=%2F%2F%20transaction%3A%20SafeMultisigTransactionResponse))
- Example usage of Safe SDK (Safe{Core}) for creating and signing Safe transactions ([Programmatically sending a transaction request to Gnosis Safe wallet - Ethereum Stack Exchange](https://ethereum.stackexchange.com/questions/134718/programmatically-sending-a-transaction-request-to-gnosis-safe-wallet#:~:text=%2F%2F%20const%20safeTransactionData%3A%20SafeTransactionDataPartial%20%3D,proposeTransaction%28safeTx%2C%20safeSignature)) ([Understanding Safe protocol development kit | by Rebel | Medium](https://itrebel.medium.com/understanding-safe-protocol-development-kit-67f258a1c93a#:~:text=await%20apiKit.proposeTransaction%28,data%2C))
- Berachain Safe API endpoint information (chain ID and base URL) ([safe-tx-hashes-util/safe_hashes.sh at main · pcaversaccio/safe-tx-hashes-util · GitHub](https://github.com/pcaversaccio/safe-tx-hashes-util/blob/main/safe_hashes.sh#:~:text=%5B)) ([safe-tx-hashes-util/safe_hashes.sh at main · pcaversaccio/safe-tx-hashes-util · GitHub](https://github.com/pcaversaccio/safe-tx-hashes-util/blob/main/safe_hashes.sh#:~:text=%5B%22berachain%22%5D%3D%22https%3A%2F%2Fsafe)) and Safe API usage notes ([ Verify Safe transactions - HackMD](https://hackmd.io/@safe/verify-transactions#:~:text=the%20Safe%20backend%20using%20the,%3E%20%5BVerify)).
