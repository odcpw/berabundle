# BeraBundle React UI

This is the React-based user interface for BeraBundle, a bundle creator for claims, boosts, and swaps on Berachain.

## Getting Started

First, install the dependencies:

```bash
cd reactui
npm install
```

Then, start the development server:

```bash
npm start
```

The application will be available at [http://localhost:3000](http://localhost:3000).

## Features

- Connect to Berachain using MetaMask or any EIP-1193 compatible wallet
- View your connected account and balance
- Switch to Berachain Artio network if not already connected
- Check token balances and values in USD
- Set and store your OogaBooga API key securely in local storage

## Using the Token Checker

The token balance checker requires an OogaBooga API key to fetch token prices. You can enter your API key in the provided form. The key is stored locally in your browser and is never sent to any server except the OogaBooga API itself.

1. Connect your wallet using the "Connect Wallet" button
2. Enter your OogaBooga API key in the provided field
3. Click "Check Token Balances" to see all your token balances and their values

## Development Roadmap

This is a gradual migration from the CLI interface to a React-based web interface. The plan is to:

1. Start with a simple wallet connection page ✅
2. Add token balance checking functionality ✅
3. Add wallet management functionality (next)
4. Implement claims capabilities
5. Support bundle creation and execution
6. Integrate full functionality from the CLI version

## Technical Notes

- Built with React 18 and ethers.js 5.7.2
- Uses the browser's localStorage to persist API keys
- Leverages the existing TokenService from the BeraBundle core codebase through a bridge implementation
- Compatible with MetaMask and other Ethereum wallet providers that support the EIP-1193 standard