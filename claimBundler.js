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

            // Process each vault with rewards
            for (const vault of rewardInfo) {
                if (parseFloat(vault.earned) > 0) {
                    // Create interface for the getReward function
                    const iface = new ethers.utils.Interface([
                        "function getReward(address account, address recipient) external returns (uint256)"
                    ]);

                    // Encode function call
                    const data = iface.encodeFunctionData("getReward", [
                        userAddress,
                        recipientAddress
                    ]);

                    const payload = {
                        to: vault.vaultAddress,
                        data: data,
                        value: "0x0",
                        metadata: {
                            vaultAddress: vault.vaultAddress,
                            stakingToken: vault.stakeToken,
                            rewardToken: vault.rewardToken,
                            rewardAmount: vault.earned
                        }
                    };

                    claimPayloads.push(payload);
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
                    return payloadsWithGas.map(payload => ({
                        to: payload.to,
                        from: fromAddress,
                        data: payload.data,
                        value: payload.value || "0x0",
                        gasLimit: payload.gasLimit,
                        maxFeePerGas: config.gas.maxFeePerGas,
                        maxPriorityFeePerGas: config.gas.maxPriorityFeePerGas,
                        type: "0x2", // EIP-1559 transaction
                        chainId
                    }));

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
                            name: `Claim rewards from ${payloads.length} vaults for ${name}`,
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
            const filename = `claims_${name.toLowerCase()}_${format}_${Date.now()}.json`;
            const filepath = path.join(config.paths.outputDir, filename);

            await fs.writeFile(filepath, JSON.stringify(bundle, null, 2));
            console.log(`Bundle saved to ${filepath}`);

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
     * @returns {Promise<Object>} Bundle information
     */
    async generateClaimBundle(rewardInfo, userAddress, recipientAddress, format, name) {
        try {
            // Create basic claim payloads
            const payloads = this.createClaimPayloads(rewardInfo, userAddress, recipientAddress);

            if (payloads.length === 0) {
                return {
                    success: false,
                    message: "No rewards to claim"
                };
            }

            // Format transactions based on the selected format
            const formattedBundle = await this.formatTransactions(
                payloads,
                format,
                    userAddress,
                    name
            );

            // Save the bundle to a file
            const filepath = await this.saveBundle(formattedBundle, name, format);

            // Calculate total rewards
            let totalRewards = 0;
            for (const payload of payloads) {
                totalRewards += parseFloat(payload.metadata.rewardAmount);
            }

            return {
                success: true,
                filepath,
                bundleData: formattedBundle,
                summary: {
                    vaultCount: payloads.length,
                    totalRewards: totalRewards.toFixed(4),
                    format
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
