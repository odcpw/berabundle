// config.js - Centralized configuration for BeraBundle
const path = require('path');

// Network configuration
const networks = {
    berachain: {
        name: 'Berachain',
        chainId: '0x1385e', // 80094 in decimal
        rpcUrl: process.env.RPC_URL || 'https://rpc.berachain.com',
        blockExplorer: 'https://explorer.berachain.com',
        factoryAddress: '0x94Ad6Ac84f6C6FbA8b8CCbD71d9f4f101def52a8',
        bgtStakerAddress: '0x44F07Ce5AfeCbCC406e6beFD40cc2998eEb8c7C6',
    }
};

// Performance settings
const performance = {
    batchSize: 10,
    delayBetweenBatches: 50, // ms
    maxRetries: 3,
    backoffMultiplier: 2,
};

// File paths
const paths = {
    walletsFile: path.join(__dirname, 'wallets.json'),
    outputDir: path.join(__dirname, 'output'),
};

// Gas settings
const gas = {
    maxFeePerGas: '0x3b9aca00', // 1 Gwei
    maxPriorityFeePerGas: '0x3b9aca00', // 1 Gwei
    estimateGasLimit: true,
    defaultGasLimit: '0x500000',
};

// ABIs
const abis = {
    rewardVaultFactory: [
        "function allVaultsLength() view returns (uint256)",
        "function allVaults(uint256) view returns (address)"
    ],

    rewardVault: [
        "function balanceOf(address account) view returns (uint256)",
        "function earned(address account) view returns (uint256)",
        "function totalSupply() view returns (uint256)",
        "function rewardRate() view returns (uint256)",
        "function periodFinish() view returns (uint256)",
        "function getRewardForDuration() view returns (uint256)",
        "function getReward(address account, address recipient) external returns (uint256)",
        "function stakeToken() view returns (address)",
        "function rewardToken() view returns (address)",
        "function getWhitelistedTokens() view returns (address[])",
        "function incentives(address token) view returns (uint256,uint256,uint256,address)"
    ],

    bgtStaker: [
        "function getReward() external view returns (uint256)",
        "function earned(address account) external view returns (uint256)"
    ],

    erc20: [
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)"
    ]
};

module.exports = {
    networks,
    performance,
    paths,
    gas,
    abis,
    currentNetwork: networks.berachain // Default network
};
