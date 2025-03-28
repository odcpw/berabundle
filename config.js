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
        honeyTokenAddress: '0x7EeCA4205fF31f947EdBd49195a7A88E6A91161B', // Added HONEY token address
        validatorBoostAddress: '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba', // BGT token contract (for validator boosts)
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
        "function getReward() external returns (uint256)",
        "function earned(address account) external view returns (uint256)"
    ],

    validatorBoost: [
        "function boosted(address account, bytes pubkey) external view returns (uint256)",
        "function boosts(address account) external view returns (uint256)",
        "function boostedQueue(address account, bytes pubkey) external view returns (uint256)",
        "function queuedBoost(address account) external view returns (uint256)",
        "function boostees(bytes pubkey) external view returns (uint256)",
        "function queueBoost(bytes pubkey, uint128 amount) external",
        "function cancelBoost(bytes pubkey, uint128 amount) external",
        "function activateBoost(address user, bytes pubkey) external returns (bool)",
        "function normalizedBoost(bytes pubkey) external view returns (uint256)"
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