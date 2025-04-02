# BeraBundle Developer Documentation

## Overview

BeraBundle is an all-in-one transaction bundling contract for Berachain that enables atomic execution of multiple operations in a single transaction. The contract is designed to work with the Berachain ecosystem, including OBRouter for swaps, RewardVault and BGT Staker for reward claiming, and BGT token for boosting.

## Design Philosophy

The BeraBundle contract is built on the following principles:

1. **Atomicity**: All operations in a bundle either succeed together or fail together
2. **Flexibility**: Support for various operation types with minimal code complexity
3. **Safety**: Careful handling of approvals and user assets
4. **Gas Efficiency**: Optimized for Berachain's low gas environment
5. **Future-Proof**: Generic operation support for new protocols without contract upgrades

## Operation Types

The contract supports the following operation types:

1. **Approve** (TYPE_APPROVE = 1): Set token approvals for subsequent operations
2. **Revoke Approval** (TYPE_REVOKE_APPROVAL = 2): Revoke token approvals for security
3. **Swap** (TYPE_SWAP = 3): Execute token swaps through OBRouter
4. **Claim Rewards** (TYPE_CLAIM_REWARDS = 4): Claim rewards from RewardVault or BGT Staker
5. **Boost** (TYPE_BOOST = 5): Boost BGT tokens
6. **Disperse** (TYPE_DISPERSE = 6): Distribute tokens to multiple recipients
7. **Generic Call** (TYPE_GENERIC_CALL = 7): Execute any arbitrary call to any contract

## Security Features

- **ReentrancyGuard**: Protection against reentrancy attacks
- **Automatic Approval Management**: Options to revoke approvals after operations
- **Atomic Execution**: All operations in a bundle succeed or fail together
- **No Admin Functions**: No privileged operations or backdoors
- **Non-Upgradeable**: Contract behavior is immutable

## Core Functions

### `executeBundle`

```solidity
function executeBundle(Operation[] calldata operations) external payable nonReentrant
```

The main entry point for bundling multiple operations. Takes an array of Operation structs and executes them in sequence.

### `swap`

```solidity
function swap(
    address router,
    address inputToken,
    uint256 inputAmount,
    address outputToken,
    uint256 outputQuote,
    uint256 minOutputAmount,
    bytes calldata pathDefinition,
    address executor,
    uint32 referralCode
) external payable nonReentrant
```

Helper function to execute a single swap through OBRouter. Sets approval, executes the swap, and resets approval.

### `claimRewards`

```solidity
function claimRewards(address rewardContract) external nonReentrant
```

Helper function to claim rewards from RewardVault or BGT Staker, ensuring rewards go directly to the caller.

### `boostBGT`

```solidity
function boostBGT(address bgtToken, uint256 amount) external nonReentrant
```

Helper function to boost BGT tokens, managing the approval and boost operation.

### `disperse`

```solidity
function disperse(address token, address[] calldata recipients, uint256[] calldata amounts) external payable nonReentrant
```

Helper function to distribute tokens (ERC20 or native) to multiple recipients in a single transaction.

## Operation Struct

```solidity
struct Operation {
    uint8 operationType;
    address target;
    bytes data;
    uint256 value;
    address tokenAddress;
    uint256 tokenAmount;
    address[] recipients;
    uint256[] amounts;
}
```

This struct contains all the information needed for an operation:
- `operationType`: The type of operation to perform
- `target`: The contract address to interact with
- `data`: The calldata for the interaction
- `value`: The amount of native token to send
- Additional fields for specific operation types (tokens, amounts, recipients)

## Integration with Oogabooga API

The contract is designed to work seamlessly with the Oogabooga Swap API:

1. When the API returns swap details (router address, path definition, executor address), these can be directly used in swap operations
2. The API's allowance check can determine if approval operations are needed in the bundle
3. Bundle execution preserves the atomicity expected by the API

## Usage Patterns

### Dust Token Swaps

```javascript
// Construct a bundle with:
// 1. Approve operations for each token
// 2. Swap operations using Oogabooga API data
// 3. Revoke approval operations
const operations = [
    { operationType: TYPE_APPROVE, ... },
    { operationType: TYPE_SWAP, ... },
    { operationType: TYPE_REVOKE_APPROVAL, ... }
];
beraBundle.executeBundle(operations);
```

### Claim and Swap

```javascript
// Claim rewards and immediately swap them
const operations = [
    { operationType: TYPE_CLAIM_REWARDS, target: rewardVault, ... },
    { operationType: TYPE_CLAIM_REWARDS, target: bgtStaker, ... },
    { operationType: TYPE_SWAP, ... }
];
beraBundle.executeBundle(operations);
```

### Multi-recipient Token Distribution

```javascript
// Distribute tokens to multiple addresses
beraBundle.disperse(
    tokenAddress,
    [recipient1, recipient2, recipient3],
    [amount1, amount2, amount3]
);
```

## Gas Considerations

- The contract is optimized for Berachain's low gas environment
- Bundle size impacts gas costs linearly
- Approval and revocation operations add minimal overhead
- Consider batch size limitations when bundling many operations

## Security Best Practices

1. Always verify contract addresses before interacting with them
2. Consider revoking approvals after operations are complete
3. Set appropriate slippage parameters for swaps
4. Test bundles with small amounts before large transactions
5. Validate paths and executors from the Oogabooga API

## Events

The contract emits the following events:
- `OperationExecuted`: Emitted for each operation execution
- `SwapExecuted`: Detailed event for swap operations
- `RewardsClaimed`: Emitted when rewards are claimed
- `TokensDispersed`: Emitted for token disperse operations

These events can be used for tracking and analysis of bundled transactions.

## JSON Payload Structure

For frontend integration, the following JSON structure provides an elegant way to interact with the BeraBundle contract:

### Base Structure

All operations follow a consistent base format:

```json
{
  "type": 1,          // Operation type constant
  "target": "0x123...",  // Target contract address
  "value": "0",       // Native token value (in wei)
  "data": "0x..."     // Optional calldata (for some operation types)
}
```

### Type-Specific Payloads

#### 1. Approval (TYPE_APPROVE = 1)
```json
{
  "type": 1,
  "target": "0xRouterAddress",
  "tokenAddress": "0xTokenAddress",
  "tokenAmount": "1000000000000000000"  // 1 token with 18 decimals
}
```

#### 2. Revoke Approval (TYPE_REVOKE_APPROVAL = 2)
```json
{
  "type": 2,
  "target": "0xRouterAddress",
  "tokenAddress": "0xTokenAddress"
}
```

#### 3. Swap (TYPE_SWAP = 3)
```json
{
  "type": 3,
  "target": "0xRouterAddress",
  "value": "0",        // BERA amount if swapping native token
  "swapParams": {
    "inputToken": "0xTokenAddress",  // or "0x0" for native token
    "inputAmount": "1000000000000000000",
    "outputToken": "0xTokenAddress",
    "outputQuote": "900000000000000000",
    "minOutput": "850000000000000000",
    "pathDefinition": "0x...",
    "executor": "0xExecutorAddress",
    "referralCode": 0
  }
}
```

#### 4. Claim Rewards (TYPE_CLAIM_REWARDS = 4)
```json
{
  "type": 4,
  "target": "0xRewardVaultAddress"  // Simple and clean
}
```

#### 5. Boost (TYPE_BOOST = 5)
```json
{
  "type": 5,
  "target": "0xBGTTokenAddress",
  "tokenAmount": "5000000000000000000"  // 5 tokens
}
```

#### 6. Disperse (TYPE_DISPERSE = 6)
```json
{
  "type": 6,
  "tokenAddress": "0xTokenAddress",  // or "0x0" for native token
  "recipients": [
    "0xRecipient1",
    "0xRecipient2",
    "0xRecipient3"
  ],
  "amounts": [
    "1000000000000000000",
    "2000000000000000000",
    "3000000000000000000"
  ]
}
```

#### 7. Generic Call (TYPE_GENERIC_CALL = 7)
```json
{
  "type": 7,
  "target": "0xAnyContractAddress",
  "value": "0",
  "data": "0x..."  // Raw calldata
}
```

### Example Complete Bundle

```json
{
  "operations": [
    {
      "type": 1,
      "target": "0xRouterAddress",
      "tokenAddress": "0xTokenA",
      "tokenAmount": "1000000000000000000"
    },
    {
      "type": 4,
      "target": "0xRewardVaultAddress"
    },
    {
      "type": 3,
      "target": "0xRouterAddress",
      "swapParams": {
        "inputToken": "0xTokenA",
        "inputAmount": "1000000000000000000",
        "outputToken": "0xTokenB",
        "outputQuote": "900000000000000000",
        "minOutput": "850000000000000000",
        "pathDefinition": "0x...",
        "executor": "0xExecutorAddress",
        "referralCode": 0
      }
    },
    {
      "type": 2,
      "target": "0xRouterAddress",
      "tokenAddress": "0xTokenA"
    }
  ],
  "value": "0"  // Total BERA to send with transaction
}
```

### JSON to Contract Data Conversion

When processing this JSON structure for contract interaction:

1. Parse the operation objects into the appropriate Operation struct format
2. For each operation type, extract only the relevant fields
3. Encode complex parameters (like swap parameters) as needed
4. Calculate the total value to send with the transaction
5. Call `executeBundle()` with the constructed operations array

The frontend should handle encoding specific operation data structures into the format expected by the contract while providing a clean, intuitive interface for developers.
