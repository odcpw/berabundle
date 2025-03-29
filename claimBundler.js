// ClaimBundler.js - Enhanced claim bundling with gas estimation
const { ethers } = require('ethers');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const { ErrorHandler } = require('./errorHandler');

/**
 * Output formats for claim bundles
 */
const OutputFormat = {
    EOA: 'eoa',           // Standard EOA transaction
    SAFE_SDK: 'safe_sdk', // Safe transaction SDK format
    SAFE_UI: 'safe_ui'    // Safe UI (TxBuilder) format
};

/**
 * Enhanced service for bundling claim transactions
 */
class ClaimBundler {
    constructor(provider) {
        this.provider = provider || new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);

        // Create output directory if it doesn't exist
        this.ensureOutputDirExists();
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

            // Process each reward source (vaults and BGT Staker)
            for (const item of rewardInfo) {
                if (parseFloat(item.earned) > 0) {
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
            try {
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
            } catch (error) {
                console.warn(`Warning: Could not estimate gas for transaction to ${payload.to}: ${error.message}`);

                // Use default gas limit if estimation fails
                payloadsWithGas.push({
                    ...payload,
                    gasLimit: config.gas.defaultGasLimit
                });
            }
        }

        return payloadsWithGas;
    }

    /**
     * Format transactions based on the selected output format
     * @param {Array} payloads - Claim payloads
     * @param {string} format - Output format (EOA, SAFE_SDK, SAFE_UI)
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

                case OutputFormat.SAFE_SDK:
                    // Format for Safe SDK
                    return payloads.map(payload => ({
                        to: payload.to,
                        value: payload.value || "0x0",
                        data: payload.data,
                        operation: 0 // Call operation
                    }));

                case OutputFormat.SAFE_UI:
                    // Format for Safe UI (TxBuilder)
                    return {
                        version: "1.0",
                        chainId: config.networks.berachain.chainId,
                        createdAt: Date.now(),
                        meta: {
                            name: `Claim rewards from ${payloads.length} sources for ${name}`,
                            description: `Generated by BeraBundle on ${new Date().toISOString()}`
                        },
                        transactions: payloads.map(payload => ({
                            to: payload.to,
                            value: payload.value || "0x0",
                            data: payload.data,
                            operation: 0 // Call operation
                        }))
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
     * Save bundle to a file
     * @param {Object|Array} bundle - Transaction bundle
     * @param {string} name - Name identifier for the file
     * @param {string} format - Output format
     * @returns {Promise<string>} Path to the saved file
     */
    async saveBundle(bundle, name, format) {
        try {
            // Create a human-readable timestamp
            const now = new Date();
            const dateStr = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19); // Format: YYYY-MM-DD_HH-MM-SS
            
            // Create filename with human-readable date first, followed by Unix timestamp for uniqueness
            const filename = `claims_${dateStr}_${name.toLowerCase()}_${format}.json`;
            const filepath = path.join(config.paths.outputDir, filename);

            await fs.writeFile(filepath, JSON.stringify(bundle, null, 2));
            // We don't log here because berabundle.js will display a message

            return filepath;
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
                // Import RedelegationManager only when needed to avoid circular dependencies
                const RedelegationManager = require('./redelegationManager');
                const redelegationManager = new RedelegationManager(this.provider);
                await redelegationManager.initialize();
                
                // Create redelegation transactions
                const redelegationResult = redelegationManager.createRedelegationTransactions(
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

            // Save the bundle to a file
            const filepath = await this.saveBundle(formattedBundle, name, format);

            // Format rewards by type for summary
            const rewardSummary = Object.entries(rewardsByType)
                .map(([symbol, amount]) => `${amount.toFixed(2)} ${symbol}`)
                .join(", ");

            return {
                success: true,
                filepath,
                bundleData: formattedBundle,
                summary: {
                    vaultCount,
                    hasBGTStaker,
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