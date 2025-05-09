// ClaimBundler.js - Enhanced claim bundling with gas estimation
// Note: This file includes fixes for the GS013 error that can occur in Safe transactions.
// The GS013 error typically happens when there's an issue with the nonce or safeTxGas parameter.
// The solution implemented here sets safeTxGas to 0, which is a recommended workaround for this error.
const { ethers } = require('ethers');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');
const { ErrorHandler } = require('../../utils/errorHandler');

/**
 * Output formats for claim bundles
 */
const OutputFormat = {
    EOA: 'eoa',           // Standard EOA transaction for wallets with private keys
    SAFE_UI: 'safe_ui',   // Safe UI (TxBuilder) format for web interface
    SAFE_CLI: 'safe_cli'  // Safe CLI format for command line usage
};

/**
 * Enhanced service for bundling claim transactions
 */
class ClaimBundler {
    constructor(provider) {
        this.provider = provider || new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);

        // Create output directory if it doesn't exist
        this.ensureOutputDirExists();
        
        // Flag to indicate if we should set safeTxGas to 0 to avoid GS013 errors
        this.useSafeTxGasWorkaround = true;
    }

    /**
     * Ensure the output directory exists
     */
    async ensureOutputDirExists() {
        try {
            await fs.mkdir(config.paths.outputDir, { recursive: true });
        } catch (error) {
            console.warn(`Warning: Could not create output directory: ${error.message}`);
        }
    }

    /**
     * Create claim payloads from reward information
     * @param {Array} rewardInfo - Reward information from RewardChecker
     * @param {string} userAddress - User address
     * @param {string} recipientAddress - Recipient address for rewards
     * @returns {Array} Claim payloads
     */
    createClaimPayloads(rewardInfo, userAddress, recipientAddress) {
        try {
            const claimPayloads = [];

            // Process each reward source (vaults, BGT Staker, Delegation Rewards)
            for (const item of rewardInfo) {
                // For delegation rewards, include regardless of earned amount since we can't check it
                if (parseFloat(item.earned) > 0 || item.alwaysAttemptClaim) {
                    if (item.type === 'bgtStaker') {
                        // Handle BGT Staker claim
                        const iface = new ethers.utils.Interface([
                            "function getReward() external returns (uint256)"
                        ]);

                        // Encode function call for BGT Staker (no parameters)
                        const data = iface.encodeFunctionData("getReward", []);

                        const payload = {
                            to: item.contractAddress,
                            data: data,
                            value: "0x0",
                            metadata: {
                                type: 'bgtStaker',
                                name: item.name || 'Honey Pool',
                                contractAddress: item.contractAddress,
                                rewardToken: item.rewardToken,
                                rewardAmount: item.earned
                            }
                        };

                        claimPayloads.push(payload);
                    } else if (item.type === 'delegationRewards') {
                        // Handle Delegation Rewards claim
                        const iface = new ethers.utils.Interface([
                            "function claim() external returns (uint256)"
                        ]);

                        // Encode function call for Delegation Rewards (no parameters)
                        const data = iface.encodeFunctionData("claim", []);

                        const payload = {
                            to: item.contractAddress,
                            data: data,
                            value: "0x0",
                            metadata: {
                                type: 'delegationRewards',
                                name: item.name || 'Bera Chain Validators',
                                contractAddress: item.contractAddress,
                                rewardToken: item.rewardToken,
                                rewardAmount: item.earned
                            }
                        };

                        claimPayloads.push(payload);
                    } else {
                        // Handle vault claim
                        const iface = new ethers.utils.Interface([
                            "function getReward(address account, address recipient) external returns (uint256)"
                        ]);

                        // Encode function call for vault
                        const data = iface.encodeFunctionData("getReward", [
                            userAddress,
                            recipientAddress
                        ]);

                        // Get the vault address, supporting both field names
                        const vaultAddress = item.vaultAddress || item.address;
                        
                        if (!vaultAddress) {
                            console.warn(`Warning: Missing vault address in reward item:`, item);
                            continue; // Skip this item
                        }
                        
                        const payload = {
                            to: vaultAddress,
                            data: data,
                            value: "0x0",
                            metadata: {
                                type: 'vault',
                                vaultAddress: vaultAddress,
                                stakingToken: item.stakeToken,
                                rewardToken: item.rewardToken,
                                rewardAmount: item.earned
                            }
                        };

                        claimPayloads.push(payload);
                    }
                }
            }

            return claimPayloads;
        } catch (error) {
            ErrorHandler.handle(error, 'ClaimBundler.createClaimPayloads');
            return [];
        }
    }

    /**
     * Estimate gas for each transaction in the bundle
     * @param {Array} payloads - Claim payloads
     * @param {string} fromAddress - Sender address
     * @returns {Promise<Array>} Payloads with gas estimates
     */
    async estimateGasForPayloads(payloads, fromAddress) {
        const payloadsWithGas = [];

        for (const payload of payloads) {
            // If gasLimit is already set in the payload, use it directly
            if (payload.gasLimit) {
                payloadsWithGas.push({
                    ...payload
                });
                continue;
            }
            
            try {
                // Check if this is a validator boost transaction
                const isValidatorBoost = payload.metadata && payload.metadata.type === 'validatorBoost';
                
                if (isValidatorBoost) {
                    // For validator boost transactions, use a higher fixed gas limit to avoid estimation issues
                    console.log(`Using fixed gas limit for validator boost transaction for ${payload.metadata.validatorName}`);
                    
                    payloadsWithGas.push({
                        ...payload,
                        gasLimit: "0x100000" // 1,048,576 gas, higher than default
                    });
                } else {
                    // Estimate gas for this transaction
                    const gasEstimate = await this.provider.estimateGas({
                        from: fromAddress,
                        to: payload.to,
                        data: payload.data,
                        value: payload.value || '0x0'
                    });

                    // Add 20% buffer to the gas estimate
                    const gasLimit = gasEstimate.mul(12).div(10);

                    payloadsWithGas.push({
                        ...payload,
                        gasLimit: gasLimit.toHexString()
                    });
                }
            } catch (error) {
                let errorMsg = error.message;
                // Check if it's a contract error with data
                if (error.data) {
                    errorMsg += ` (error code: ${error.data})`;
                }
                
                console.warn(`Warning: Could not estimate gas for transaction to ${payload.to}: ${errorMsg}`);

                // Use higher gas limit for validator boost transactions
                const gasLimit = payload.metadata?.type === 'validatorBoost' 
                    ? "0x100000"  // 1,048,576 gas for validator boosts
                    : config.gas.defaultGasLimit;
                
                payloadsWithGas.push({
                    ...payload,
                    gasLimit: gasLimit
                });
            }
        }

        return payloadsWithGas;
    }

    /**
     * Format transactions based on the selected output format
     * @param {Array} payloads - Claim payloads
     * @param {string} format - Output format (EOA, SAFE_SDK, SAFE_UI, SAFE_CLI)
     * @param {string} fromAddress - Sender address
     * @param {string} name - Name for the bundle (used in SAFE_UI format)
     * @returns {Promise<Object|Array>} Formatted transactions
     */
    async formatTransactions(payloads, format, fromAddress, name) {
        try {
            switch (format) {
                case OutputFormat.EOA:
                    // For EOA, we need gas estimates
                    const payloadsWithGas = await this.estimateGasForPayloads(payloads, fromAddress);

                    // Get the current chain ID from the provider
                    const network = await this.provider.getNetwork();
                    const chainId = '0x' + network.chainId.toString(16);

                    // Format as EOA transactions
                    return payloadsWithGas.map(payload => {
                        if (!payload.to) {
                            console.error("Error: Missing 'to' address in payload", payload);
                        }
                        return {
                            to: payload.to,
                            from: fromAddress,
                            data: payload.data,
                            value: payload.value || "0x0",
                            gasLimit: payload.gasLimit,
                            maxFeePerGas: config.gas.maxFeePerGas,
                            maxPriorityFeePerGas: config.gas.maxPriorityFeePerGas,
                            type: "0x2", // EIP-1559 transaction
                            chainId
                        };
                    });

                // SAFE_SDK format removed as requested

                case OutputFormat.SAFE_UI:
                    // Format for Safe UI (TxBuilder)
                    // Create a more detailed description for Safe UI
                    let description = `Generated by BeraBundle on ${new Date().toISOString()}`;
                    
                    // Count different transaction types for description
                    let vaultCount = 0;
                    let bgtStakerCount = 0;
                    let validatorBoosts = [];
                    
                    for (const payload of payloads) {
                        if (payload.metadata) {
                            if (payload.metadata.type === 'vault') {
                                vaultCount++;
                            } else if (payload.metadata.type === 'bgtStaker') {
                                bgtStakerCount++;
                            } else if (payload.metadata.type === 'validatorBoost') {
                                validatorBoosts.push({
                                    name: payload.metadata.validatorName,
                                    amount: payload.metadata.amount,
                                    allocation: payload.metadata.allocation
                                });
                            }
                        }
                    }
                    
                    // Add transaction counts to description
                    description += `\n\nTransaction summary:`;
                    if (vaultCount > 0) {
                        description += `\n- ${vaultCount} vault claim(s)`;
                    }
                    if (bgtStakerCount > 0) {
                        // Get the name from metadata
                        let bgtStakerName = "Honey Pool";
                        for (const payload of payloads) {
                            if (payload.metadata && payload.metadata.type === 'bgtStaker' && payload.metadata.name) {
                                bgtStakerName = payload.metadata.name;
                                break;
                            }
                        }
                        description += `\n- ${bgtStakerCount} BGT Staker claim(s) from ${bgtStakerName}`;
                    }
                    
                    let delegationRewardsCount = 0;
                    let delegationRewardsName = "Bera Chain Validators";
                    for (const payload of payloads) {
                        if (payload.metadata && payload.metadata.type === 'delegationRewards') {
                            delegationRewardsCount++;
                            if (payload.metadata.name) {
                                delegationRewardsName = payload.metadata.name;
                            }
                        }
                    }
                    if (delegationRewardsCount > 0) {
                        description += `\n- ${delegationRewardsCount} Delegation Rewards claim(s) from ${delegationRewardsName}`;
                    }
                    
                    // Add validator boost details if present
                    if (validatorBoosts.length > 0) {
                        description += `\n- ${validatorBoosts.length} validator boost(s):`;
                        validatorBoosts.forEach(boost => {
                            description += `\n  • ${boost.name}: ${boost.amount} BGT (${boost.allocation}%)`;
                        });
                    }
                    
                    // Add information about direct on-chain transaction support and troubleshooting tips
                    description += `\n\nThis transaction can be sent directly to the Safe contract using BeraBundle's "Send directly to Safe contract (on-chain)" option. This ensures the transaction appears in the Safe UI without manual importing.`;
                    description += `\n\nTROUBLESHOOTING:`;
                    description += `\n- If you see 'GS013' error, try setting a nonce manually in the Safe UI when importing this transaction`;
                    description += `\n- Try setting 'safeTxGas' to 0 (this helps avoid GS013 errors in some cases)`;
                    
                    // Get gas estimates for all payloads to include in UI data
                    const uiPayloadsWithGas = await this.estimateGasForPayloads(payloads, fromAddress);
                    
                    return {
                        version: "1.0",
                        chainId: config.networks.berachain.chainId,
                        createdAt: Date.now(),
                        meta: {
                            name: `Claim rewards from ${vaultCount + bgtStakerCount} sources ${validatorBoosts.length > 0 ? '+ delegate to ' + validatorBoosts.length + ' validators' : ''} for ${name}`,
                            description: `Berabundle: ${description}`
                        },
                        transactions: uiPayloadsWithGas.map(payload => ({
                            to: payload.to,
                            value: payload.value || "0x0",
                            data: payload.data,
                            operation: 0, // Call operation
                            // Set safeTxGas to 0 to avoid GS013 errors
                            safeTxGas: "0x0",
                            // Include gasLimit as custom metadata (used for our direct sending but not used by Safe UI)
                            custom: {
                                gasLimit: payload.gasLimit || config.gas.defaultGasLimit
                            }
                        }))
                    };
                    
                case OutputFormat.SAFE_CLI:
                    // Format for Safe CLI - similar to SAFE_SDK but with additional metadata
                    const cliPayloadsWithGas = await this.estimateGasForPayloads(payloads, fromAddress);
                    
                    // Count different transaction types for metadata
                    let cliVaultCount = 0;
                    let cliBgtStakerCount = 0;
                    let cliDelegationRewardsCount = 0;
                    let cliValidatorBoosts = [];
                    
                    for (const payload of payloads) {
                        if (payload.metadata) {
                            if (payload.metadata.type === 'vault') {
                                cliVaultCount++;
                            } else if (payload.metadata.type === 'bgtStaker') {
                                cliBgtStakerCount++;
                            } else if (payload.metadata.type === 'delegationRewards') {
                                cliDelegationRewardsCount++;
                            } else if (payload.metadata.type === 'validatorBoost') {
                                cliValidatorBoosts.push({
                                    name: payload.metadata.validatorName,
                                    amount: payload.metadata.amount,
                                    allocation: payload.metadata.allocation
                                });
                            }
                        }
                    }
                    
                    // Get the current chain ID
                    const cliNetwork = await this.provider.getNetwork();
                    
                    return {
                        // Transactions in the format expected by Safe CLI
                        transactions: cliPayloadsWithGas.map(payload => ({
                            to: payload.to,
                            value: payload.value || "0x0",
                            data: payload.data,
                            operation: 0, // Call operation (0 = Call, 1 = DelegateCall)
                            // Set safeTxGas to 0 to avoid GS013 errors
                            safeTxGas: "0x0",
                            // Store original gas limit in a custom field for reference if needed
                            customGasLimit: payload.gasLimit || config.gas.defaultGasLimit
                        })),
                        // Add metadata useful for the CLI processing
                        meta: {
                            name: `Claim rewards for ${name}`,
                            description: `Berabundle: Claim transactions for ${name}`,
                            fromAddress: fromAddress,
                            chainId: cliNetwork.chainId,
                            vaultCount: cliVaultCount,
                            bgtStakerCount: cliBgtStakerCount,
                            delegationRewardsCount: cliDelegationRewardsCount,
                            validatorBoostCount: cliValidatorBoosts.length,
                            totalTransactions: cliPayloadsWithGas.length,
                            createdAt: Date.now()
                        }
                    };

                default:
                    throw new Error(`Unknown output format: ${format}`);
            }
        } catch (error) {
            ErrorHandler.handle(error, 'ClaimBundler.formatTransactions');
            throw error;
        }
    }

    /**
     * Generates instructions for directly opening transactions in the Safe Transaction Builder
     * 
     * Instead of generating a potentially very long URL that could exceed browser limits,
     * this method provides clear instructions on how to use the Safe UI's batch import feature.
     * 
     * @param {Object} bundle - Formatted transaction bundle in SAFE_UI format
     * @param {string} safeAddress - Safe wallet address
     * @returns {Object} Object containing instruction text and URLs
     */
    generateTransactionBuilderInstructions(bundle, safeAddress) {
        try {
            const chainPrefix = 'ber'; // Chain prefix for Berachain
            const baseUrl = config.networks.berachain.safe.appUrl;
            
            // Create a proper Safe URL
            const safeUrl = `${baseUrl}/home?safe=${chainPrefix}:${safeAddress}`;
            
            return {
                safeUrl: safeUrl,
                instructions: [
                    `1. Go to ${safeUrl}`,
                    `2. Click "New Transaction" > "Transaction Builder"`,
                    `3. Click "Load" in the top right corner`,
                    `4. Select the saved file to import all transactions at once`
                ]
            };
        } catch (error) {
            ErrorHandler.handle(error, 'ClaimBundler.generateTransactionBuilderInstructions');
            return null;
        }
    }

    /**
     * Save bundle to a file and generate Safe instructions if appropriate
     * @param {Object|Array} bundle - Transaction bundle
     * @param {string} name - Name identifier for the file
     * @param {string} format - Output format
     * @param {string} safeAddress - Optional Safe address for instructions generation
     * @returns {Promise<Object>} Result with filepath and additional information
     */
    async saveBundle(bundle, name, format, safeAddress = null) {
        try {
            // Create a human-readable timestamp
            const now = new Date();
            const dateStr = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19); // Format: YYYY-MM-DD_HH-MM-SS
            
            // Create filename with human-readable date first, followed by format
            // Ensure format string matches exactly what we expect in the sendBundleMenu detection
            const formatString = format === OutputFormat.EOA ? 'eoa' : 
                               format === OutputFormat.SAFE_UI ? 'safe_ui' : 'safe_cli';
            
            const filename = `claims_${dateStr}_${name.toLowerCase()}_${formatString}.json`;
            const filepath = path.join(config.paths.outputDir, filename);

            await fs.writeFile(filepath, JSON.stringify(bundle, null, 2));
            
            // Create result object
            const result = {
                filepath,
                format: formatString
            };
            
            // Generate Safe instructions if format is Safe UI and safeAddress is provided
            if (format === OutputFormat.SAFE_UI && safeAddress) {
                const safeInstructions = this.generateTransactionBuilderInstructions(bundle, safeAddress);
                if (safeInstructions) {
                    result.safeInstructions = safeInstructions;
                }
            }
            
            return result;
        } catch (error) {
            ErrorHandler.handle(error, 'ClaimBundler.saveBundle');
            throw error;
        }
    }

    /**
     * Generate a full claim bundle
     * @param {Array} rewardInfo - Reward information from RewardChecker
     * @param {string} userAddress - User address
     * @param {string} recipientAddress - Recipient address for rewards
     * @param {string} format - Output format
     * @param {string} name - Name identifier for the bundle
     * @param {Object} options - Additional options for claim bundle
     * @returns {Promise<Object>} Bundle information
     */
    async generateClaimBundle(rewardInfo, userAddress, recipientAddress, format, name, options = {}) {
        try {
            // Create basic claim payloads
            const payloads = this.createClaimPayloads(rewardInfo, userAddress, recipientAddress);

            if (payloads.length === 0) {
                return {
                    success: false,
                    message: "No rewards to claim"
                };
            }

            // Calculate stats for summary
            let vaultCount = 0;
            let hasBGTStaker = false;
            let hasDelegationRewards = false;
            let totalBGT = 0;
            let totalHONEY = 0;
            let rewardsByType = {}; // Track rewards by token symbol
            
            for (const payload of payloads) {
                if (payload.metadata.type === 'bgtStaker') {
                    hasBGTStaker = true;
                    const symbol = payload.metadata.rewardToken.symbol;
                    if (!rewardsByType[symbol]) {
                        rewardsByType[symbol] = 0;
                    }
                    rewardsByType[symbol] += parseFloat(payload.metadata.rewardAmount);
                    if (symbol === "HONEY") {
                        totalHONEY += parseFloat(payload.metadata.rewardAmount);
                    }
                } else if (payload.metadata.type === 'delegationRewards') {
                    hasDelegationRewards = true;
                    const symbol = payload.metadata.rewardToken.symbol;
                    if (!rewardsByType[symbol]) {
                        rewardsByType[symbol] = 0;
                    }
                    rewardsByType[symbol] += parseFloat(payload.metadata.rewardAmount);
                    if (symbol === "HONEY") {
                        totalHONEY += parseFloat(payload.metadata.rewardAmount);
                    }
                } else {
                    vaultCount++;
                    const symbol = payload.metadata.rewardToken.symbol;
                    if (!rewardsByType[symbol]) {
                        rewardsByType[symbol] = 0;
                    }
                    rewardsByType[symbol] += parseFloat(payload.metadata.rewardAmount);
                    if (symbol === "BGT") {
                        totalBGT += parseFloat(payload.metadata.rewardAmount);
                    }
                }
            }

            // Check if redelegation is requested
            let redelegationPayloads = [];
            if (options.redelegate && totalBGT > 0) {
                // Import BoostBundler (which is the RedelegationManager) from the correct path
                // and use the right variable name for clarity
                const BoostBundler = require('../boosts/boostBundler');
                const boostBundler = new BoostBundler(this.provider);
                await boostBundler.initialize();
                
                // Create redelegation transactions
                const redelegationResult = boostBundler.createRedelegationTransactions(
                    userAddress, 
                    totalBGT
                );
                
                if (redelegationResult.success && redelegationResult.transactions.length > 0) {
                    redelegationPayloads = redelegationResult.transactions;
                    // More concise log message
                    console.log(`Added ${redelegationPayloads.length} redelegation transaction(s)`);
                }
            }

            // Combine claim and redelegation payloads
            const allPayloads = [...payloads, ...redelegationPayloads];

            // Format transactions based on the selected format
            const formattedBundle = await this.formatTransactions(
                allPayloads,
                format,
                userAddress,
                name
            );

            // For SAFE_UI format, add our rewardSummary to the description for easier parsing later
            if (format === OutputFormat.SAFE_UI) {
                formattedBundle.meta.description += `\n\nRewards: ${Object.entries(rewardsByType)
                    .map(([symbol, amount]) => `${amount.toFixed(2)} ${symbol}`)
                    .join(", ")}`;
            }
            
            // Save the bundle to a file and generate Transaction Builder URL if appropriate
            const bundleResult = await this.saveBundle(
                formattedBundle, 
                name, 
                format,
                format === OutputFormat.SAFE_UI ? recipientAddress : null // Pass recipientAddress as safeAddress for Safe UI format
            );

            // Format rewards by type for summary
            const rewardSummary = Object.entries(rewardsByType)
                .map(([symbol, amount]) => `${amount.toFixed(2)} ${symbol}`)
                .join(", ");

            return {
                success: true,
                filepath: bundleResult.filepath,
                safeInstructions: bundleResult.safeInstructions,
                bundleData: formattedBundle,
                summary: {
                    vaultCount,
                    hasBGTStaker,
                    hasDelegationRewards,
                    totalBGT: totalBGT.toFixed(2),
                    totalHONEY: totalHONEY.toFixed(2),
                    rewardsByType,
                    rewardSummary,
                    totalSources: payloads.length,
                    redelegationCount: redelegationPayloads.length,
                    totalTransactions: allPayloads.length,
                    format,
                    includesRedelegation: redelegationPayloads.length > 0
                }
            };
        } catch (error) {
            ErrorHandler.handle(error, 'ClaimBundler.generateClaimBundle');
            return {
                success: false,
                message: `Failed to generate claim bundle: ${error.message}`
            };
        }
    }
}

module.exports = {
    ClaimBundler,
    OutputFormat
};