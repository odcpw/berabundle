// RewardChecker.js - Enhanced reward checking with caching and optimizations
const { ethers } = require('ethers');
const config = require('./config');
const { ErrorHandler } = require('./errorHandler');

class RewardChecker {
    constructor(provider) {
        this.provider = provider || new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
        this.rewardVaultFactory = new ethers.Contract(
            config.networks.berachain.factoryAddress,
            config.abis.rewardVaultFactory,
            this.provider
        );
        this.bgtStaker = new ethers.Contract(
            config.networks.berachain.bgtStakerAddress,
            config.abis.bgtStaker,
            this.provider
        );

        // Caching
        this.tokenInfoCache = new Map();
        this.vaultCache = new Map();
        this.lastVaultScan = 0;
        this.vaultScanTTL = 5 * 60 * 1000; // 5 minutes in milliseconds

        // Performance settings
        this.batchSize = config.performance.batchSize;
        this.delayBetweenBatches = config.performance.delayBetweenBatches;
        this.maxRetries = config.performance.maxRetries;
    }

    /**
     * Helper function to chunk array into smaller arrays
     * @param {Array} array - Array to chunk
     * @param {number} size - Chunk size
     * @returns {Array<Array>} Chunked array
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Helper function to delay execution with exponential backoff
     * @param {number} ms - Base delay in milliseconds
     * @param {number} retryCount - Current retry count
     * @returns {Promise<void>} Promise that resolves after the delay
     */
    async delay(ms, retryCount = 0) {
        const backoffMs = ms * Math.pow(config.performance.backoffMultiplier, retryCount);
        return new Promise(resolve => setTimeout(resolve, backoffMs));
    }

    /**
     * Helper function to retry failed operations
     * @param {Function} operation - Operation to retry
     * @param {number} maxRetries - Maximum number of retries
     * @returns {Promise<any>} Result of the operation
     */
    async retry(operation, maxRetries = this.maxRetries) {
        let lastError;

        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (i === maxRetries - 1) throw error;
                await this.delay(this.delayBetweenBatches, i);
            }
        }

        throw lastError;
    }

    /**
     * Get token information
     * @param {string} tokenAddress - Token contract address
     * @returns {Promise<Object>} Token information
     */
    async getTokenInfo(tokenAddress) {
        // Check cache first
        if (this.tokenInfoCache.has(tokenAddress)) {
            return this.tokenInfoCache.get(tokenAddress);
        }

        try {
            const token = new ethers.Contract(
                tokenAddress,
                config.abis.erc20,
                this.provider
            );

            const [symbol, decimals] = await Promise.all([
                token.symbol().catch(() => "UNKNOWN"),
                token.decimals().catch(() => 18)
            ]);

            const info = { symbol, decimals };
            this.tokenInfoCache.set(tokenAddress, info);
            return info;
        } catch (error) {
            console.warn(`Warning: Could not get token info for ${tokenAddress}:`, error.message);
            return { symbol: "UNKNOWN", decimals: 18 };
        }
    }

    /**
     * Get all reward vaults
     * @param {boolean} forceRefresh - Force refresh the cache
     * @returns {Promise<Array<string>>} Array of vault addresses
     */
    async getRewardVaults(forceRefresh = false) {
        const now = Date.now();
        // Return cached vaults if available and not expired
        if (!forceRefresh && this.lastVaultScan > 0 && (now - this.lastVaultScan) < this.vaultScanTTL) {
            return Array.from(this.vaultCache.keys());
        }

        try {
            console.log('Scanning for vault contracts...');
            const count = await this.rewardVaultFactory.allVaultsLength();
            const vaults = [];

            // Process vaults in batches
            const batches = this.chunkArray(Array.from({ length: count }, (_, i) => i), this.batchSize);

            for (const batch of batches) {
                const batchPromises = batch.map(index =>
                this.retry(() => this.rewardVaultFactory.allVaults(index))
                .catch(error => {
                    console.warn(`Warning: Could not get vault at index ${index}:`, error.message);
                    return null;
                })
                );

                const batchResults = await Promise.all(batchPromises);
                const validResults = batchResults.filter(vault => vault !== null);

                // Update cache for each valid vault
                validResults.forEach(vaultAddress => {
                    if (!this.vaultCache.has(vaultAddress)) {
                        this.vaultCache.set(vaultAddress, { lastCheck: 0 });
                    }
                });

                vaults.push(...validResults);

                // Add delay between batches
                if (batches.indexOf(batch) < batches.length - 1) {
                    await this.delay(this.delayBetweenBatches);
                }
            }

            this.lastVaultScan = Date.now();
            console.log(`Found ${vaults.length} vaults`);
            return vaults;
        } catch (error) {
            const errorMsg = `Error getting reward vaults: ${error.message}`;
            ErrorHandler.handle(error, 'RewardChecker.getRewardVaults');
            throw new Error(errorMsg);
        }
    }

    /**
     * Check a specific vault for rewards
     * @param {string} vaultAddress - Vault contract address
     * @param {string} userAddress - User wallet address
     * @param {boolean} includeIncentives - Whether to include incentive details
     * @returns {Promise<Object|null>} Vault reward information
     */
    async checkVault(vaultAddress, userAddress, includeIncentives = false) {
        // Check if we have a cached instance for this vault
        let vaultInfo = this.vaultCache.get(vaultAddress);
        if (!vaultInfo) {
            vaultInfo = { lastCheck: 0 };
            this.vaultCache.set(vaultAddress, vaultInfo);
        }

        try {
            const vault = new ethers.Contract(
                vaultAddress,
                config.abis.rewardVault,
                this.provider
            );

            // First check if user has any stake - this is the fastest check
            const userBalance = await this.retry(() => vault.balanceOf(userAddress));
            if (userBalance.eq(0)) {
                return null;
            }

            // Get all other data in parallel
            const [
                stakeTokenAddress,
                rewardTokenAddress,
                totalSupply,
                earned,
                rewardRate,
                rewardForDuration
            ] = await Promise.all([
                this.retry(() => vault.stakeToken()),
                this.retry(() => vault.rewardToken()),
                this.retry(() => vault.totalSupply()),
                this.retry(() => vault.earned(userAddress)),
                this.retry(() => vault.rewardRate()),
                this.retry(() => vault.getRewardForDuration())
            ]);

            // Get token info in parallel
            const [stakeTokenInfo, rewardTokenInfo] = await Promise.all([
                this.getTokenInfo(stakeTokenAddress),
                this.getTokenInfo(rewardTokenAddress)
            ]);

            // Format values
            const userStake = ethers.utils.formatUnits(userBalance, stakeTokenInfo.decimals);
            const totalStake = ethers.utils.formatUnits(totalSupply, stakeTokenInfo.decimals);
            const earnedFormatted = ethers.utils.formatUnits(earned, rewardTokenInfo.decimals);
            const share = (parseFloat(userStake) / parseFloat(totalStake)) * 100;

            // Process incentive tokens if needed
            let incentiveTokens = [];
            if (includeIncentives) {
                try {
                    const whitelistedTokens = await this.retry(() => vault.getWhitelistedTokens());

                    if (whitelistedTokens.length > 0) {
                        const incentivePromises = whitelistedTokens.map(async tokenAddress => {
                            try {
                                const incentive = await this.retry(() => vault.incentives(tokenAddress));
                                const tokenInfo = await this.getTokenInfo(tokenAddress);
                                const amountRemaining = ethers.utils.formatUnits(incentive[2], tokenInfo.decimals);
                                const incentiveRate = ethers.utils.formatUnits(incentive[1], tokenInfo.decimals);
                                const secondsPerDay = 86400;
                                const dailyEmission = parseFloat(incentiveRate) * secondsPerDay;

                                return {
                                    symbol: tokenInfo.symbol,
                                    address: tokenAddress,
                                    amountRemaining: parseFloat(amountRemaining),
                                    incentiveRate: parseFloat(incentiveRate),
                                    dailyEmission,
                                    userDailyAmount: dailyEmission * (share / 100)
                                };
                            } catch (error) {
                                console.warn(`Warning: Could not get incentive info for token ${tokenAddress}:`, error.message);
                                return null;
                            }
                        });

                        incentiveTokens = (await Promise.all(incentivePromises)).filter(Boolean);
                    }
                } catch (error) {
                    console.warn(`Warning: Could not get incentive tokens for vault ${vaultAddress}:`, error.message);
                }
            }

            // Update cache time
            vaultInfo.lastCheck = Date.now();
            this.vaultCache.set(vaultAddress, vaultInfo);

            return {
                vaultAddress,
                stakeToken: {
                    symbol: stakeTokenInfo.symbol,
                    address: stakeTokenAddress,
                    decimals: stakeTokenInfo.decimals
                },
                rewardToken: {
                    symbol: rewardTokenInfo.symbol,
                    address: rewardTokenAddress,
                    decimals: rewardTokenInfo.decimals
                },
                userStake,
                totalStake,
                share,
                earned: earnedFormatted,
                rawEarned: earned,
                incentiveTokens,
                rewardRate: ethers.utils.formatUnits(rewardRate, rewardTokenInfo.decimals),
                rewardForDuration: ethers.utils.formatUnits(rewardForDuration, rewardTokenInfo.decimals)
            };
        } catch (error) {
            console.warn(`Warning: Could not check vault ${vaultAddress}:`, error.message);
            return null;
        }
    }

    /**
     * Check all rewards for a user
     * @param {string} userAddress - User wallet address
     * @param {boolean} includeIncentives - Whether to include incentive details
     * @param {boolean} rawData - Whether to return raw data
     * @param {Function} progressCallback - Optional callback for progress updates
     * @returns {Promise<Array|string>} Reward information
     */
    async checkAllRewards(userAddress, includeIncentives = false, rawData = false, progressCallback = null) {
        try {
            console.log("Finding vaults with active stakes...");

            // Get all vaults
            const vaults = await this.getRewardVaults();

            if (progressCallback) {
                progressCallback(0, vaults.length, "Finding active stakes...");
            }

            // Process vaults in batches
            const vaultsWithStakes = [];
            const batches = this.chunkArray(vaults, this.batchSize);

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                const batchPromises = batch.map(vaultAddress =>
                this.checkVault(vaultAddress, userAddress, includeIncentives)
                );

                const batchResults = await Promise.all(batchPromises);
                const validResults = batchResults.filter(vault => vault !== null);
                vaultsWithStakes.push(...validResults);

                // Update progress
                if (progressCallback) {
                    const processed = (i + 1) * this.batchSize;
                    progressCallback(
                        Math.min(processed, vaults.length),
                        vaults.length,
                        `Checking vaults: ${vaultsWithStakes.length} active stakes found`
                    );
                }

                // Add delay between batches
                if (i < batches.length - 1) {
                    await this.delay(this.delayBetweenBatches);
                }
            }

            // Check BGT Staker rewards
            const bgtStakerRewards = await this.checkBGTStakerRewards(userAddress);

            if (vaultsWithStakes.length === 0 && parseFloat(bgtStakerRewards) === 0) {
                return rawData ? [] : "No active stakes found in any vault or BGT Staker.";
            }

            // If raw data is requested, return the vault data directly
            if (rawData) {
                return vaultsWithStakes;
            }

            // Format output for display
            let output = "Active Stakes:\n\n";
            
            // Add BGT Staker rewards if any
            if (parseFloat(bgtStakerRewards) > 0) {
                output += `BGT Staker:\n`;
                output += `  Pending HONEY: ${parseFloat(bgtStakerRewards).toFixed(2)}\n`;
                output += "──────────────────────────────────────────────────\n";
            }

            // Add vault rewards
            for (const vault of vaultsWithStakes) {
                output += `Vault: ${vault.vaultAddress}\n`;
                output += `  Staking: ${parseFloat(vault.userStake).toFixed(2)} ${vault.stakeToken.symbol} (Pool: ${parseFloat(vault.totalStake).toFixed(2)})\n`;
                output += `  Pool Share: ${vault.share.toFixed(2)}%\n`;
                output += `  Pending ${vault.rewardToken.symbol}: ${parseFloat(vault.earned).toFixed(2)}\n`;

                if (includeIncentives && vault.incentiveTokens && vault.incentiveTokens.length > 0) {
                    output += "  Incentive Tokens:\n";
                    for (const token of vault.incentiveTokens) {
                        output += `    ${token.symbol}: ${token.userDailyAmount.toFixed(4)}/day\n`;
                    }
                }

                output += "──────────────────────────────────────────────────\n";
            }

            return output;
        } catch (error) {
            ErrorHandler.handle(error, 'RewardChecker.checkAllRewards');
            return rawData ? [] : "Error checking rewards. Please try again.";
        }
    }

    /**
     * Get a summary of all claimable rewards
     * @param {string} userAddress - User wallet address
     * @returns {Promise<Object>} Summary of claimable rewards
     */
    async getRewardsSummary(userAddress) {
        const rewards = await this.checkAllRewards(userAddress, false, true);

        if (!rewards || rewards.length === 0) {
            return {
                totalRewards: 0,
                vaultCount: 0,
                rewardsByToken: {}
            };
        }

        // Calculate totals
        let totalRewards = ethers.BigNumber.from(0);
        const rewardsByToken = {};

        for (const vault of rewards) {
            const tokenSymbol = vault.rewardToken.symbol;
            const rawAmount = vault.rawEarned;

            if (!rewardsByToken[tokenSymbol]) {
                rewardsByToken[tokenSymbol] = {
                    amount: 0,
                    formatted: "0",
                    token: vault.rewardToken
                };
            }

            if (tokenSymbol === "BGT") {
                totalRewards = totalRewards.add(rawAmount);
            }

            // Add to token-specific total
            rewardsByToken[tokenSymbol].amount += parseFloat(vault.earned);
            rewardsByToken[tokenSymbol].formatted = rewardsByToken[tokenSymbol].amount.toFixed(4);
        }

        return {
            totalRewards: parseFloat(ethers.utils.formatEther(totalRewards)),
            vaultCount: rewards.length,
            rewardsByToken
        };
    }

    /**
     * Check claimable Honey rewards from BGT Staker
     * @param {string} address - User wallet address
     * @returns {Promise<string>} Formatted reward amount
     */
    async checkBGTStakerRewards(address) {
        try {
            const earned = await this.bgtStaker.earned(address);
            return ethers.utils.formatEther(earned);
        } catch (error) {
            console.warn(`Warning: Could not check BGT Staker rewards for ${address}:`, error.message);
            return "0";
        }
    }
}

// Export the RewardChecker class
module.exports = RewardChecker;
