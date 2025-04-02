# BeraBundle Bundle Architecture

This document describes the transaction bundle architecture used in BeraBundle.

## What are Bundles?

Bundles are collections of blockchain transactions that are grouped together for a specific purpose. BeraBundle supports several types of bundles:

1. **Claim Bundles**: Transactions to claim rewards from various protocols
2. **Boost Bundles**: Transactions to boost validators with BGT tokens
3. **Swap Bundles**: Transactions to swap tokens via DEXes
4. **Compound Bundles**: Combined claim and boost operations

## Bundle Formats

Bundles can be formatted for different execution environments:

- **EOA**: Standard Ethereum transaction format for externally owned accounts
- **Safe UI**: Format compatible with Safe Transaction Builder
- **Safe CLI**: Format for use with Safe CLI tools

## Bundle Creation

The `BundleCreator` class orchestrates bundle creation:

```javascript
const { BundleCreator, BundleType, OutputFormat } = require('./bundles/bundleCreator');

// Create a claim bundle
const bundle = await bundleCreator.createBundle(
    BundleType.CLAIM, 
    {
        rewardInfo: rewards,
        userAddress: address,
        recipientAddress: recipient,
        format: OutputFormat.EOA,
        name: 'mywallet'
    }
);
```

## Bundle Execution

Bundles can be executed in various ways:

1. **JSON Only**: Generate bundle JSON without execution
2. **Execute**: Execute directly with an EOA wallet
3. **Propose**: Propose to a Safe multisig

The execution process uses different executors:

```javascript
// For EOA execution
await eoaExecutor.execute(bundle);

// For Safe proposal
await safeExecutor.propose(bundle, safeAddress);
```

## Bundle Storage

Bundles are stored in the output directory and can be listed and loaded later:

```javascript
// List all claim bundles
const bundles = await bundleRepository.listBundles({ type: 'claim' });

// Load a specific bundle
const bundle = await bundleRepository.loadBundle(filename);
```

## Creating Custom Bundles

You can create custom bundles by combining existing bundle types:

```javascript
// Create a claim + boost compound bundle
const bundle = await bundleCreator.createBundle(
    BundleType.COMPOUND,
    {
        rewardInfo: rewards,
        userAddress: address,
        bgtAmount: "10.0",
        format: OutputFormat.EOA,
        name: 'mywallet'
    }
);
```

## Bundle Contents

Each bundle contains:

- **bundleData**: The actual transaction data
- **summary**: Information about the bundle contents
- **filepath**: Where the bundle is saved
- **metadata**: Additional information for UI display

## Best Practices

1. Always verify bundle contents before execution
2. Use the appropriate format for your wallet type
3. Consider gas costs when creating large bundles
4. Test compound bundles carefully before execution