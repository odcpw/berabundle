// RewardChecker.js - Enhanced reward checking with caching and optimizations
const { ethers } = require('ethers');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
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
        this.validatorBoost = new ethers.Contract(
            config.networks.berachain.validatorBoostAddress,
            config.abis.validatorBoost,
            this.provider
        );

        // Caching
        this.tokenInfoCache = new Map();
        this.vaultCache = new Map();
        this.validatorCache = new Map();
        this.lastVaultScan = 0;
        this.lastValidatorScan = 0;
        this.vaultScanTTL = 5 * 60 * 1000; // 5 minutes in milliseconds
        this.validatorScanTTL = 15 * 60 * 1000; // 15 minutes in milliseconds

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
        // Validate the token address first
        if (!tokenAddress || typeof tokenAddress !== 'string' || !tokenAddress.startsWith('0x')) {
            console.warn(`Warning: Invalid token address: ${tokenAddress}`);
            return { symbol: "UNKNOWN", decimals: 18 };
        }
        
        // Check in-memory cache first
        if (this.tokenInfoCache.has(tokenAddress)) {
            return this.tokenInfoCache.get(tokenAddress);
        }

        try {
            // Try to load from cached tokens file first
            try {
                const cachedTokens = await this.loadTokensMetadata();
                const normalizedAddress = tokenAddress.toLowerCase();
                
                if (cachedTokens && cachedTokens[normalizedAddress]) {
                    const tokenInfo = {
                        symbol: cachedTokens[normalizedAddress].symbol || "UNKNOWN",
                        decimals: cachedTokens[normalizedAddress].decimals || 18
                    };
                    
                    // Update in-memory cache
                    this.tokenInfoCache.set(tokenAddress, tokenInfo);
                    return tokenInfo;
                }
            } catch (error) {
                console.warn(`Could not load token info from cache for ${tokenAddress}:`, error.message);
            }

            // If not in cache, query on-chain
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
            // Try to load vaults from the cached file first
            try {
                const cachedVaults = await this.loadVaultsMetadata();
                if (cachedVaults && cachedVaults.length > 0) {
                    console.log('Using cached vault information from file...');
                    
                    // Update cache with vaults from the file
                    // Filter out any vaults with missing or invalid addresses
                    const validVaults = cachedVaults.filter(vault => 
                        vault.address && typeof vault.address === 'string' && vault.address.startsWith('0x')
                    );
                    
                    validVaults.forEach(vault => {
                        if (!this.vaultCache.has(vault.address)) {
                            this.vaultCache.set(vault.address, { 
                                lastCheck: 0,
                                stakeTokenAddress: vault.stakeTokenAddress,
                                rewardTokenAddress: vault.rewardTokenAddress,
                                name: vault.name 
                            });
                        }
                    });
                    
                    this.lastVaultScan = Date.now();
                    console.log(`Found ${validVaults.length} valid vaults in cache`);
                    return validVaults.map(vault => vault.address);
                }
            } catch (error) {
                console.warn('Could not load cached vaults, falling back to on-chain query:', error.message);
            }

            // If no cached vaults or cache is invalid, query on-chain
            console.log('Scanning for vault contracts on-chain...');
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
            console.log(`Found ${vaults.length} vaults on-chain`);
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
        // Validate addresses before proceeding
        if (!vaultAddress || typeof vaultAddress !== 'string' || !vaultAddress.startsWith('0x')) {
            console.warn(`Warning: Invalid vault address: ${vaultAddress}`);
            return null;
        }
        
        if (!userAddress || typeof userAddress !== 'string' || !userAddress.startsWith('0x')) {
            console.warn(`Warning: Invalid user address: ${userAddress}`);
            return null;
        }
        
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
     * Check BGT Staker for rewards
     * @param {string} userAddress - User wallet address
     * @returns {Promise<Object|null>} BGT Staker reward information
     */
    async checkBGTStakerDetailed(userAddress) {
        try {
            const earned = await this.retry(() => this.bgtStaker.earned(userAddress));
            
            if (earned.eq(0)) {
                return null;
            }
            
            // Get HONEY token info (assuming it's the reward token)
            const honeyTokenInfo = { 
                symbol: "HONEY", 
                address: config.networks.berachain.honeyTokenAddress,
                decimals: 18 
            };
            
            return {
                type: 'bgtStaker',
                contractAddress: config.networks.berachain.bgtStakerAddress,
                rewardToken: honeyTokenInfo,
                earned: ethers.utils.formatUnits(earned, honeyTokenInfo.decimals),
                rawEarned: earned
            };
        } catch (error) {
            console.warn(`Warning: Could not check BGT Staker rewards for ${userAddress}:`, error.message);
            return null;
        }
    }

    /**
     * Check all rewards for a user
     * @param {string} userAddress - User wallet address
     * @param {boolean} includeIncentives - Whether to include incentive details
     * @param {boolean} rawData - Whether to return raw data
     * @param {Function} progressCallback - Optional callback for progress updates
     * @param {boolean} includeValidatorBoosts - Whether to include validator boosts
     * @returns {Promise<Array|string>} Reward information
     */
    async checkAllRewards(userAddress, includeIncentives = false, rawData = false, progressCallback = null, includeValidatorBoosts = true) {
        try {
            console.log("Finding vaults with active stakes...");

            // Get all vaults
            const vaults = await this.getRewardVaults();
            console.log(`Found ${vaults.length} total vaults to check...`);

            if (progressCallback) {
                progressCallback(0, vaults.length, "Finding active stakes...");
            }

            // Process vaults in batches
            const vaultsWithStakes = [];
            
            // Filter out any invalid vault addresses before processing
            const validVaults = vaults.filter(address => 
                address && typeof address === 'string' && address.startsWith('0x')
            );
            
            if (validVaults.length !== vaults.length) {
                console.warn(`Filtered out ${vaults.length - validVaults.length} invalid vault addresses`);
            }
            
            const batches = this.chunkArray(validVaults, this.batchSize);
            console.log(`Processing ${validVaults.length} valid vaults in ${batches.length} batches...`);

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                const batchPromises = batch.map(vaultAddress =>
                this.checkVault(vaultAddress, userAddress, includeIncentives)
                );

                const batchResults = await Promise.all(batchPromises);
                const validResults = batchResults.filter(vault => vault !== null);
                
                // Track new stakes found in this batch
                const newStakesCount = validResults.length;
                
                // Add to total stakes
                vaultsWithStakes.push(...validResults);

                // Log progress at regular intervals or when something interesting happens
                const shouldLog = 
                    i % 5 === 0 || // Every 5 batches
                    i === batches.length - 1 || // Last batch
                    newStakesCount > 0; // When new stakes are found
                    
                if (shouldLog) {
                    const processed = Math.min((i + 1) * this.batchSize, validVaults.length);
                    const percent = Math.round((processed / validVaults.length) * 100);
                    
                    // More detailed log with percentage
                    console.log(`Processed ${processed}/${validVaults.length} vaults (${percent}%), found ${vaultsWithStakes.length} active stakes` + 
                        (newStakesCount > 0 ? ` (+${newStakesCount} new)` : ''));
                    
                    // If we found new stakes, log some info about them
                    if (newStakesCount > 0) {
                        validResults.forEach(stake => {
                            console.log(`  - Found stake in ${stake.stakeToken.symbol}: ${parseFloat(stake.userStake).toFixed(2)}, earned: ${parseFloat(stake.earned).toFixed(4)} ${stake.rewardToken.symbol}`);
                        });
                    }
                }

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

            // Stop the progress bar before checking BGT Staker
            if (progressCallback) {
                progressCallback(vaults.length, vaults.length, "Vault checking complete");
            }
            console.log(`Vault checking complete. Found ${vaultsWithStakes.length} vaults with active stakes.`);
            
            // Check BGT Staker rewards
            console.log(`Checking BGT Staker rewards for ${userAddress}...`);
            if (progressCallback) {
                progressCallback(0, 100, "Checking BGT Staker rewards...");
            }
            
            const bgtStakerRewards = await this.checkBGTStakerDetailed(userAddress);
            let allRewards = [...vaultsWithStakes];
            
            if (bgtStakerRewards) {
                allRewards.push(bgtStakerRewards);
                console.log(`Found BGT Staker rewards: ${bgtStakerRewards.earned} HONEY`);
                if (progressCallback) {
                    progressCallback(100, 100, "BGT Staker checking complete");
                }
            } else {
                console.log("No BGT Staker rewards found.");
            }
            
            // Check validator boosts if requested
            let validatorBoosts = { activeBoosts: [], queuedBoosts: [] };
            if (includeValidatorBoosts) {
                console.log("Checking validator boosts...");
                if (progressCallback) {
                    progressCallback(0, 100, "Checking validator boosts...");
                }
                
                validatorBoosts = await this.checkValidatorBoosts(userAddress, true, progressCallback);
                
                if (validatorBoosts.activeBoosts && validatorBoosts.activeBoosts.length > 0) {
                    console.log(`Found ${validatorBoosts.activeBoosts.length} active validator boosts`);
                }
                
                if (validatorBoosts.queuedBoosts && validatorBoosts.queuedBoosts.length > 0) {
                    console.log(`Found ${validatorBoosts.queuedBoosts.length} queued validator boosts`);
                }
            }

            if (allRewards.length === 0 && 
                validatorBoosts.activeBoosts.length === 0 && 
                validatorBoosts.queuedBoosts.length === 0) {
                return rawData ? { rewards: [], validatorBoosts: { activeBoosts: [], queuedBoosts: [] } } : 
                    "No active stakes found in any vault, BGT Staker, or validator boosts.";
            }

            // If raw data is requested, return the data directly
            if (rawData) {
                return {
                    rewards: allRewards,
                    validatorBoosts: validatorBoosts
                };
            }

            // Format output for display
            let output = "Active Stakes and Rewards:\n\n";
            
            // Add BGT Staker rewards if any
            if (bgtStakerRewards) {
                output += `BGT Staker:\n`;
                output += `  Pending HONEY: ${parseFloat(bgtStakerRewards.earned).toFixed(2)}\n`;
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
            
            // Add validator boosts if any
            if (validatorBoosts.activeBoosts && validatorBoosts.activeBoosts.length > 0) {
                output += "\nActive Validator Boosts:\n\n";
                
                for (const validator of validatorBoosts.activeBoosts) {
                    output += `Validator: ${validator.name} (${validator.pubkey.substring(0, 10)}...)\n`;
                    output += `  Description: ${validator.description}\n`;
                    output += `  Your Boost: ${parseFloat(validator.userBoostAmount).toFixed(2)} BGT\n`;
                    output += `  Total Boost: ${parseFloat(validator.totalBoost).toFixed(2)} BGT\n`;
                    output += `  Your Share: ${validator.share}%\n`;
                    output += "──────────────────────────────────────────────────\n";
                }
            }
            
            // Add queued validator boosts if any
            if (validatorBoosts.queuedBoosts && validatorBoosts.queuedBoosts.length > 0) {
                output += "\nQueued Validator Boosts (pending activation):\n\n";
                
                for (const validator of validatorBoosts.queuedBoosts) {
                    output += `Validator: ${validator.name} (${validator.pubkey.substring(0, 10)}...)\n`;
                    output += `  Description: ${validator.description}\n`;
                    output += `  Queued Boost: ${parseFloat(validator.queuedBoostAmount).toFixed(2)} BGT\n`;
                    output += `  Status: Queued - needs activation\n`;
                    output += "──────────────────────────────────────────────────\n";
                }
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
        const result = await this.checkAllRewards(userAddress, false, true);
        
        // Handle the new format where we have rewards and validatorBoosts
        const rewards = result.rewards || result;
        const validatorBoosts = result.validatorBoosts || [];

        if ((!rewards || rewards.length === 0) && (!validatorBoosts || validatorBoosts.length === 0)) {
            return {
                totalRewards: 0,
                vaultCount: 0,
                hasBGTStakerRewards: false,
                validatorBoostCount: 0,
                totalBoostedBGT: 0,
                rewardsByToken: {}
            };
        }

        // Calculate totals for rewards
        let totalRewards = ethers.BigNumber.from(0);
        const rewardsByToken = {};
        let hasBGTStakerRewards = false;
        let vaultCount = 0;

        for (const item of rewards) {
            const tokenSymbol = item.rewardToken.symbol;
            const rawAmount = item.rawEarned;

            if (!rewardsByToken[tokenSymbol]) {
                rewardsByToken[tokenSymbol] = {
                    amount: 0,
                    formatted: "0",
                    token: item.rewardToken
                };
            }

            if (item.type === 'bgtStaker') {
                hasBGTStakerRewards = true;
            } else {
                vaultCount++;
            }

            if (tokenSymbol === "BGT") {
                totalRewards = totalRewards.add(rawAmount);
            }

            // Add to token-specific total
            rewardsByToken[tokenSymbol].amount += parseFloat(item.earned);
            rewardsByToken[tokenSymbol].formatted = rewardsByToken[tokenSymbol].amount.toFixed(4);
        }
        
        // Calculate validator boost totals
        let totalActiveBoostedBGT = 0;
        let totalQueuedBoostedBGT = 0;
        
        if (validatorBoosts.activeBoosts) {
            for (const validator of validatorBoosts.activeBoosts) {
                totalActiveBoostedBGT += parseFloat(validator.userBoostAmount);
            }
        }
        
        if (validatorBoosts.queuedBoosts) {
            for (const validator of validatorBoosts.queuedBoosts) {
                totalQueuedBoostedBGT += parseFloat(validator.queuedBoostAmount);
            }
        }

        return {
            totalRewards: parseFloat(ethers.utils.formatEther(totalRewards)),
            vaultCount,
            hasBGTStakerRewards,
            activeValidatorBoostCount: validatorBoosts.activeBoosts ? validatorBoosts.activeBoosts.length : 0,
            queuedValidatorBoostCount: validatorBoosts.queuedBoosts ? validatorBoosts.queuedBoosts.length : 0,
            totalActiveBoostedBGT: totalActiveBoostedBGT.toFixed(2),
            totalQueuedBoostedBGT: totalQueuedBoostedBGT.toFixed(2),
            rewardsByToken,
            validatorBoosts
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
    
    /**
     * Update validators list from GitHub
     * @returns {Promise<boolean>} Success status
     */
    async updateValidators() {
        try {
            console.log("Updating validators list from GitHub...");
            await this.loadValidatorMetadata(true);
            console.log("Validators list updated successfully.");
            return true;
        } catch (error) {
            console.error(`Error updating validators: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Update vaults and tokens from GitHub
     * @returns {Promise<boolean>} Success status
     */
    async updateVaultsAndTokens() {
        try {
            console.log("Updating vaults and tokens from GitHub...");
            await Promise.all([
                this.loadVaultsMetadata(true),
                this.loadTokensMetadata(true)
            ]);
            console.log("Vaults and tokens updated successfully.");
            return true;
        } catch (error) {
            console.error(`Error updating vaults and tokens: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Update all metadata from GitHub (validators, vaults, tokens)
     * @returns {Promise<boolean>} Success status
     */
    async updateAllMetadata() {
        try {
            console.log("Updating all metadata from GitHub...");
            await Promise.all([
                this.loadValidatorMetadata(true),
                this.loadVaultsMetadata(true),
                this.loadTokensMetadata(true)
            ]);
            console.log("All metadata updated successfully.");
            return true;
        } catch (error) {
            console.error(`Error updating metadata: ${error.message}`);
            return false;
        }
    }

    /**
     * Fetch data from a URL using HTTPS
     * @param {string} url - URL to fetch
     * @returns {Promise<string>} Response data
     */
    fetchUrl(url) {
        return new Promise((resolve, reject) => {
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Request failed with status code ${response.statusCode}`));
                    return;
                }

                let data = '';
                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    resolve(data);
                });
            }).on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Fetch validator metadata from GitHub
     * @returns {Promise<Array<Object>>} Array of validator information
     */
    async fetchValidatorsFromGitHub() {
        try {
            const url = 'https://raw.githubusercontent.com/berachain/metadata/main/src/validators/mainnet.json';
            const data = await this.fetchUrl(url);
            const parsed = JSON.parse(data);

            // Transform the data to our simplified format (just id and name)
            if (parsed && parsed.validators && Array.isArray(parsed.validators)) {
                return parsed.validators.map(validator => ({
                    id: validator.id,
                    name: validator.name
                }));
            }
            
            throw new Error('Invalid validator data format');
        } catch (error) {
            console.warn(`Warning: Could not fetch validators from GitHub: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Fetch vaults metadata from GitHub
     * @returns {Promise<Array<Object>>} Array of vault information
     */
    async fetchVaultsFromGitHub() {
        try {
            const url = 'https://raw.githubusercontent.com/berachain/metadata/main/src/vaults/mainnet.json';
            const data = await this.fetchUrl(url);
            const parsed = JSON.parse(data);

            // Transform the data to our simplified format
            if (parsed && parsed.vaults && Array.isArray(parsed.vaults)) {
                const allVaults = parsed.vaults;
                const validVaults = allVaults
                    .filter(vault => 
                        vault && 
                        vault.address && 
                        typeof vault.address === 'string' && 
                        vault.address.startsWith('0x'))
                    .map(vault => ({
                        address: vault.address,
                        stakeTokenAddress: (vault.stakeTokenAddress && typeof vault.stakeTokenAddress === 'string' && vault.stakeTokenAddress.startsWith('0x')) 
                            ? vault.stakeTokenAddress 
                            : "",
                        rewardTokenAddress: (vault.rewardTokenAddress && typeof vault.rewardTokenAddress === 'string' && vault.rewardTokenAddress.startsWith('0x')) 
                            ? vault.rewardTokenAddress 
                            : "",
                        name: vault.name || "Unknown Vault"
                    }));
                
                if (validVaults.length !== allVaults.length) {
                    console.warn(`Filtered out ${allVaults.length - validVaults.length} invalid vault addresses from GitHub data`);
                }
                
                return validVaults;
            }
            
            throw new Error('Invalid vaults data format');
        } catch (error) {
            console.warn(`Warning: Could not fetch vaults from GitHub: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Fetch tokens metadata from GitHub
     * @returns {Promise<Object>} Token information by address
     */
    async fetchTokensFromGitHub() {
        try {
            const url = 'https://raw.githubusercontent.com/berachain/metadata/main/src/tokens/mainnet.json';
            const data = await this.fetchUrl(url);
            const parsed = JSON.parse(data);

            // Transform the data to our simplified format
            if (parsed && parsed.tokens && Array.isArray(parsed.tokens)) {
                // Create a map of address to token info
                const tokenMap = {};
                let invalidCount = 0;
                
                parsed.tokens.forEach(token => {
                    // Validate token address
                    if (token.address && typeof token.address === 'string' && token.address.startsWith('0x')) {
                        tokenMap[token.address.toLowerCase()] = {
                            address: token.address,
                            symbol: token.symbol || "UNKNOWN",
                            name: token.name || "Unknown Token",
                            decimals: token.decimals || 18,
                            logoURI: token.logoURI || ""
                        };
                    } else {
                        invalidCount++;
                    }
                });
                
                if (invalidCount > 0) {
                    console.warn(`Filtered out ${invalidCount} invalid token addresses from GitHub data`);
                }
                
                return tokenMap;
            }
            
            throw new Error('Invalid tokens data format');
        } catch (error) {
            console.warn(`Warning: Could not fetch tokens from GitHub: ${error.message}`);
            return {};
        }
    }

    /**
     * Update local validator metadata file
     * @param {Array<Object>} validators - Array of validator information
     * @returns {Promise<boolean>} Success status
     */
    async updateValidatorMetadataFile(validators) {
        try {
            const validatorsFilePath = path.join(__dirname, 'validators.json');
            await fs.writeFile(validatorsFilePath, JSON.stringify(validators, null, 2));
            console.log('Validator metadata updated successfully');
            return true;
        } catch (error) {
            console.warn(`Warning: Could not update validator metadata file: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Update local vaults metadata file
     * @param {Array<Object>} vaults - Array of vault information
     * @returns {Promise<boolean>} Success status
     */
    async updateVaultsMetadataFile(vaults) {
        try {
            const vaultsFilePath = path.join(__dirname, 'vaults.json');
            await fs.writeFile(vaultsFilePath, JSON.stringify(vaults, null, 2));
            console.log('Vaults metadata updated successfully');
            return true;
        } catch (error) {
            console.warn(`Warning: Could not update vaults metadata file: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Update local tokens metadata file
     * @param {Object} tokens - Token information by address
     * @returns {Promise<boolean>} Success status
     */
    async updateTokensMetadataFile(tokens) {
        try {
            const tokensFilePath = path.join(__dirname, 'tokens.json');
            await fs.writeFile(tokensFilePath, JSON.stringify(tokens, null, 2));
            console.log('Tokens metadata updated successfully');
            return true;
        } catch (error) {
            console.warn(`Warning: Could not update tokens metadata file: ${error.message}`);
            return false;
        }
    }

    /**
     * Load validator metadata, fetch from GitHub if needed
     * @param {boolean} forceUpdate - Whether to force an update from GitHub
     * @returns {Promise<Array<Object>>} Array of validator information
     */
    async loadValidatorMetadata(forceUpdate = false) {
        try {
            const validatorsFilePath = path.join(__dirname, 'validators.json');
            
            // Check if the file exists
            let fileExists = false;
            try {
                await fs.access(validatorsFilePath);
                fileExists = true;
            } catch (error) {
                fileExists = false;
            }
            
            // Fetch from GitHub if file doesn't exist or update is forced
            if (!fileExists || forceUpdate) {
                console.log('Fetching validators from GitHub...');
                const validators = await this.fetchValidatorsFromGitHub();
                if (validators.length > 0) {
                    await this.updateValidatorMetadataFile(validators);
                    return validators;
                }
                
                // If fetch fails and no local file exists, return empty array
                if (!fileExists) {
                    return [];
                }
            }
            
            // Read from local file
            const data = await fs.readFile(validatorsFilePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.warn(`Warning: Could not load validator metadata: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Load vaults metadata, fetch from GitHub if needed
     * @param {boolean} forceUpdate - Whether to force an update from GitHub
     * @returns {Promise<Array<Object>>} Array of vault information
     */
    async loadVaultsMetadata(forceUpdate = false) {
        try {
            const vaultsFilePath = path.join(__dirname, 'vaults.json');
            
            // Check if the file exists
            let fileExists = false;
            try {
                await fs.access(vaultsFilePath);
                fileExists = true;
            } catch (error) {
                fileExists = false;
            }
            
            // Fetch from GitHub if file doesn't exist or update is forced
            if (!fileExists || forceUpdate) {
                console.log('Fetching vaults from GitHub...');
                const vaults = await this.fetchVaultsFromGitHub();
                if (vaults.length > 0) {
                    await this.updateVaultsMetadataFile(vaults);
                    return vaults;
                }
                
                // If fetch fails and no local file exists, return empty array
                if (!fileExists) {
                    return [];
                }
            }
            
            // Read from local file
            const data = await fs.readFile(vaultsFilePath, 'utf8');
            const vaults = JSON.parse(data);
            
            // Validate vault addresses before returning
            const validVaults = vaults.filter(vault => 
                vault && 
                vault.address && 
                typeof vault.address === 'string' && 
                vault.address.startsWith('0x')
            );
            
            if (validVaults.length !== vaults.length) {
                console.warn(`Filtered out ${vaults.length - validVaults.length} invalid vault addresses from local cache`);
            }
            
            return validVaults;
        } catch (error) {
            console.warn(`Warning: Could not load vaults metadata: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Load tokens metadata, fetch from GitHub if needed
     * @param {boolean} forceUpdate - Whether to force an update from GitHub
     * @returns {Promise<Object>} Token information by address
     */
    async loadTokensMetadata(forceUpdate = false) {
        try {
            const tokensFilePath = path.join(__dirname, 'tokens.json');
            
            // Check if the file exists
            let fileExists = false;
            try {
                await fs.access(tokensFilePath);
                fileExists = true;
            } catch (error) {
                fileExists = false;
            }
            
            // Fetch from GitHub if file doesn't exist or update is forced
            if (!fileExists || forceUpdate) {
                console.log('Fetching tokens from GitHub...');
                const tokens = await this.fetchTokensFromGitHub();
                if (Object.keys(tokens).length > 0) {
                    await this.updateTokensMetadataFile(tokens);
                    return tokens;
                }
                
                // If fetch fails and no local file exists, return empty object
                if (!fileExists) {
                    return {};
                }
            }
            
            // Read from local file
            const data = await fs.readFile(tokensFilePath, 'utf8');
            const tokens = JSON.parse(data);
            
            // Filter out any invalid token addresses
            const validTokens = {};
            let invalidCount = 0;
            
            for (const address in tokens) {
                if (address && typeof address === 'string' && address.startsWith('0x')) {
                    validTokens[address] = tokens[address];
                } else {
                    invalidCount++;
                }
            }
            
            if (invalidCount > 0) {
                console.warn(`Filtered out ${invalidCount} invalid token addresses from local cache`);
            }
            
            return validTokens;
        } catch (error) {
            console.warn(`Warning: Could not load tokens metadata: ${error.message}`);
            return {};
        }
    }

    /**
     * Find validator info by public key
     * @param {string} pubkey - Validator's public key
     * @param {Array<Object>} validators - Array of validator metadata
     * @returns {Object} Validator information
     */
    findValidatorByPubkey(pubkey, validators) {
        const validator = validators.find(v => v.id.toLowerCase() === pubkey.toLowerCase());
        
        if (validator) {
            return validator;
        }

        // If not found, return a generic validator object
        return {
            id: pubkey,
            name: "Unknown Validator"
        };
    }

    /**
     * Get all active validator boosts for a user
     * @param {string} userAddress - User wallet address
     * @param {boolean} forceRefresh - Force refresh the cache
     * @returns {Promise<Array<Object>>} Array of validator boost information
     */
    async getUserActiveBoosts(userAddress, forceRefresh = false) {
        try {
            // Get metadata for all validators, potentially fetch from GitHub if needed
            const validatorMetadata = await this.loadValidatorMetadata(forceRefresh);
            
            // We need to check each validator to see if the user has boosted it
            // This is inefficient but necessary since the contract doesn't provide a getUserBoosts function
            const results = [];
            
            // Get the total user boosts amount
            const totalBoosts = await this.retry(() => this.validatorBoost.boosts(userAddress));
            
            // If user has no boosts, return empty array
            if (totalBoosts.eq(0)) {
                return [];
            }
            
            // Otherwise, check each validator in our metadata
            for (const validator of validatorMetadata) {
                try {
                    // Check if user has boosted this validator
                    const boostAmount = await this.retry(() => 
                        this.validatorBoost.boosted(userAddress, validator.id)
                    );
                    
                    // If boost amount is greater than 0, add to results
                    if (!boostAmount.eq(0)) {
                        const totalValidatorBoost = await this.retry(() => 
                            this.validatorBoost.boostees(validator.id)
                        );
                        
                        results.push({
                            pubkey: validator.id,
                            name: validator.name,
                            userBoostAmount: ethers.utils.formatEther(boostAmount),
                            totalBoost: ethers.utils.formatEther(totalValidatorBoost),
                            share: totalValidatorBoost.gt(0) 
                                ? (parseFloat(ethers.utils.formatEther(boostAmount)) / 
                                   parseFloat(ethers.utils.formatEther(totalValidatorBoost)) * 100).toFixed(2) 
                                : "0",
                            status: "active"
                        });
                    }
                } catch (error) {
                    console.warn(`Warning: Could not check boost amount for validator ${validator.id}: ${error.message}`);
                }
            }
            
            return results;
        } catch (error) {
            ErrorHandler.handle(error, 'RewardChecker.getUserActiveBoosts');
            return [];
        }
    }
    
    /**
     * Get all queued validator boosts for a user
     * @param {string} userAddress - User wallet address
     * @param {boolean} forceRefresh - Force refresh the cache
     * @returns {Promise<Array<Object>>} Array of queued validator boost information
     */
    async getUserQueuedBoosts(userAddress, forceRefresh = false) {
        try {
            // Get metadata for all validators, potentially fetch from GitHub if needed
            const validatorMetadata = await this.loadValidatorMetadata(forceRefresh);
            
            // We need to check each validator to see if the user has queued boosts for it
            const results = [];
            
            // Get the total queued boosts amount
            const totalQueuedBoost = await this.retry(() => this.validatorBoost.queuedBoost(userAddress));
            
            // If user has no queued boosts, return empty array
            if (totalQueuedBoost.eq(0)) {
                return [];
            }
            
            // Otherwise, check each validator in our metadata
            for (const validator of validatorMetadata) {
                try {
                    // Check if user has queued boost for this validator
                    const queuedAmount = await this.retry(() => 
                        this.validatorBoost.boostedQueue(userAddress, validator.id)
                    );
                    
                    // If queued amount is greater than 0, add to results
                    if (!queuedAmount.eq(0)) {
                        results.push({
                            pubkey: validator.id,
                            name: validator.name,
                            queuedBoostAmount: ethers.utils.formatEther(queuedAmount),
                            status: "queued"
                        });
                    }
                } catch (error) {
                    console.warn(`Warning: Could not check queued boost for validator ${validator.id}: ${error.message}`);
                }
            }
            
            return results;
        } catch (error) {
            ErrorHandler.handle(error, 'RewardChecker.getUserQueuedBoosts');
            return [];
        }
    }

    /**
     * Check which validators an address is boosting
     * @param {string} userAddress - User wallet address
     * @param {boolean} rawData - Whether to return raw data
     * @param {Function} progressCallback - Optional callback for progress updates
     * @param {boolean} refreshValidators - Whether to refresh validator metadata from GitHub
     * @returns {Promise<Array|string>} Boosted validators information
     */
    async checkValidatorBoosts(userAddress, rawData = false, progressCallback = null, refreshValidators = false) {
        try {
            console.log("Checking validator boosts...");
            
            // If refreshing validators is requested, do that first
            if (refreshValidators) {
                console.log("Updating validator list from GitHub...");
                if (progressCallback) {
                    progressCallback(0, 100, "Updating validator list from GitHub...");
                }
                await this.updateValidators();
            }
            
            console.log("Fetching active validator boosts...");
            if (progressCallback) {
                progressCallback(refreshValidators ? 25 : 0, 100, "Fetching active validator boosts...");
            }

            // Get user's active boosts
            const activeBoosts = await this.getUserActiveBoosts(userAddress, refreshValidators);
            console.log(`Found ${activeBoosts.length} active validator boosts`);
            
            console.log("Fetching queued validator boosts...");
            if (progressCallback) {
                progressCallback(refreshValidators ? 60 : 50, 100, "Fetching queued validator boosts...");
            }
            
            // Get user's queued boosts
            const queuedBoosts = await this.getUserQueuedBoosts(userAddress, refreshValidators);
            console.log(`Found ${queuedBoosts.length} queued validator boosts`);
            
            console.log("Processing boost data...");
            if (progressCallback) {
                progressCallback(refreshValidators ? 85 : 75, 100, "Processing boost data...");
            }
            
            // Combine active and queued boosts
            const allBoosts = [...activeBoosts, ...queuedBoosts];

            if (allBoosts.length === 0) {
                console.log("No validator boosts found");
                if (progressCallback) {
                    progressCallback(100, 100, "No validator boosts found");
                }
                return rawData ? { activeBoosts: [], queuedBoosts: [] } : "No active or queued validator boosts found.";
            }

            console.log(`Validator boost check complete. Found ${activeBoosts.length} active and ${queuedBoosts.length} queued boosts.`);
            if (progressCallback) {
                progressCallback(100, 100, "Validator boost check complete");
            }

            // If raw data is requested, return the boost data directly
            if (rawData) {
                return { activeBoosts, queuedBoosts };
            }

            // Format output for display
            let output = "";
            
            // Display active boosts
            if (activeBoosts.length > 0) {
                output += "Active Validator Boosts:\n\n";
                
                for (const validator of activeBoosts) {
                    output += `Validator: ${validator.name} (${validator.pubkey.substring(0, 10)}...)\n`;
                    output += `  Your Boost: ${parseFloat(validator.userBoostAmount).toFixed(2)} BGT\n`;
                    output += `  Total Validator Boost: ${parseFloat(validator.totalBoost).toFixed(2)} BGT\n`;
                    output += `  Your Share: ${validator.share}%\n`;
                    output += "──────────────────────────────────────────────────\n";
                }
            }
            
            // Display queued boosts
            if (queuedBoosts.length > 0) {
                if (output) output += "\n";
                output += "Queued Validator Boosts (pending activation):\n\n";
                
                for (const validator of queuedBoosts) {
                    output += `Validator: ${validator.name} (${validator.pubkey.substring(0, 10)}...)\n`;
                    output += `  Queued Boost: ${parseFloat(validator.queuedBoostAmount).toFixed(2)} BGT\n`;
                    output += `  Status: Queued - needs activation\n`;
                    output += "──────────────────────────────────────────────────\n";
                }
            }
            
            if (!output) {
                output = "No active or queued validator boosts found.";
            }

            return output;
        } catch (error) {
            ErrorHandler.handle(error, 'RewardChecker.checkValidatorBoosts');
            return rawData ? { activeBoosts: [], queuedBoosts: [] } : "Error checking validator boosts. Please try again.";
        }
    }
}

// Export the RewardChecker class
module.exports = RewardChecker;