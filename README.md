# BeraBundle

A command-line tool for managing and claiming rewards on Berachain. It helps you check and bundle reward claims from multiple vaults into a single transaction.

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

The application will present an interactive menu where you can:
- Manage your wallets
- Check available rewards
- Claim rewards in bundled transactions

## Features

- Wallet management (add, remove, list wallets)
- Reward checking for multiple vaults
- Bundled claim transactions
- Interactive command-line interface
- Support for both EOA wallets and Safe multisig wallets
- Direct integration with Safe Transaction Service for multisig transactions

### Safe Multisig Support

BeraBundle can now directly propose transactions to your Safe multisig wallet! When sending a bundle:

1. Select the "Send Bundle" option
2. Choose a Safe format bundle (with _safe_ui suffix)
3. Sign with an owner wallet that has permission to propose transactions
4. Select from associated Safe addresses or enter a custom Safe address
5. The transaction will be proposed directly to the Safe Transaction Service
6. The transaction will appear in your Safe UI ready for confirmation by other owners

This eliminates the need to manually import transaction batches into the Safe UI.

#### Important Notes:
- You must sign with a wallet that is an owner of the Safe
- The transaction appears in the queue for all owners to review and sign
- If direct proposal fails, you can still manually import the bundle in the Safe UI Transaction Builder

