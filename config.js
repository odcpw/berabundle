// config.js - Centralized configuration for BeraBundle
const path = require('path');

// Network configuration
const networks = {
    berachain: {
        name: 'Berachain',
        chainId: '0x1385e', // 80094 in decimal
        rpcUrl: process.env.RPC_URL || 'https://rpc.berachain.com',
        blockExplorer: 'https://berascan.com',
        factoryAddress: '0x94Ad6Ac84f6C6FbA8b8CCbD71d9f4f101def52a8',
        bgtStakerAddress: '0x44F07Ce5AfeCbCC406e6beFD40cc2998eEb8c7C6',
        honeyTokenAddress: '0x7EeCA4205fF31f947EdBd49195a7A88E6A91161B', // Added HONEY token address
        validatorBoostAddress: '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba', // BGT token contract (for validator boosts)
        delegationRewardsAddress: '0xBDDba144482049382eC79CadfA02f0fa0F462dE3', // Delegation rewards contract address
        
        // Safe configuration
        safe: {
            // Safe Transaction Service URL for Berachain
            // For API Kit: The SDK incorrectly adds '/v1/' instead of '/api/v1/'
            // So for API Kit compatibility, URL should have '/api/' but not '/v1/'
            serviceUrl: process.env.SAFE_SERVICE_URL || 'https://safe-transaction-berachain.safe.global/api', 
            // Full API URL with /api/v1 for direct axios calls
            serviceApiUrl: process.env.SAFE_SERVICE_API_URL || 'https://safe-transaction-berachain.safe.global/api/v1',
            appUrl: 'https://app.safe.global', // Safe web app URL
            
            // Default Safe address for this project (if configured)
            // This will be checked if the owner lookup fails, to see if the user is an owner
            defaultSafeAddress: process.env.DEFAULT_SAFE_ADDRESS || '',
            
            // MultiSend contract addresses
            multiSendAddress: '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526', // Standard Safe MultiSend contract (uses delegatecall)
            multiSendCallsOnlyAddress: '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D' // Safe MultiSendCallsOnly contract (uses only call)
        },
        
        // Multicall configuration
        multicall: {
            // Standard Multicall3 contract address on Berachain
            address: '0xcA11bde05977b3631167028862bE2a173976CA11'
        }
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
    // Directories
    outputDir: path.join(__dirname, 'output'),
    metadataDir: path.join(__dirname, 'metadata'),
    userprefsDir: path.join(__dirname, 'userprefs'),
    
    // Metadata files (downloaded from GitHub)
    validatorsFile: path.join(__dirname, 'metadata', 'validators.json'),
    vaultsFile: path.join(__dirname, 'metadata', 'vaults.json'),
    tokensFile: path.join(__dirname, 'metadata', 'tokens.json'),
    
    // User preference files
    walletsFile: path.join(__dirname, 'userprefs', 'wallets.json'),
    boostAllocationFile: path.join(__dirname, 'userprefs', 'boost_allocation.json'),
    encryptedKeysFile: path.join(__dirname, 'userprefs', 'encrypted_keys.json'),
    apiKeysFile: path.join(__dirname, 'userprefs', 'api_keys.json'),
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

    delegationRewards: [
        "function claim() external returns (uint256)"
        // Note: There is no reliable way to check available rewards
        // The contract likely uses a Merkle proof system that requires off-chain data
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
    ],
    
    // Multicall3 ABI - standard ABI supported on most EVM chains
    multicall3: [
        "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[])"
    ],
    
    // Safe MultiSend contract ABI
    multiSend: [
        "function multiSend(bytes memory transactions) public"
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