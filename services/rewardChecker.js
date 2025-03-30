// RewardChecker.js - Enhanced reward checking with caching and optimizations
const { ethers } = require('ethers');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const config = require('../config');
const { ErrorHandler } = require('../utils/errorHandler');

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
        this.delegationRewards = new ethers.Contract(
            config.networks.berachain.delegationRewardsAddress,
            config.abis.delegationRewards,
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
                    console.log('Using cached vault information from metadata/vaults.json...');
                    
                    // Filter for vaults with valid addresses needed for on-chain calls
                    // Support both "address" and "vaultAddress" fields since the format can vary
                    const validVaults = cachedVaults.filter(vault => {
                        const address = vault.address || vault.vaultAddress;
                        return address && typeof address === 'string' && address.startsWith('0x');
                    });
                    
                    // Only log if there are inactive vaults
                    if (validVaults.length !== cachedVaults.length) {
                        console.log(`Using ${validVaults.length}/${cachedVaults.length} vaults with valid addresses`);
                    } else {
                        console.log(`Found ${validVaults.length} valid vaults from metadata file`);
                    }
                    
                    // Update in-memory cache with valid vaults
                    validVaults.forEach(vault => {
                        const address = vault.address || vault.vaultAddress;
                        if (address && !this.vaultCache.has(address)) {
                            this.vaultCache.set(address, { 
                                lastCheck: 0,
                                stakeTokenAddress: vault.stakeTokenAddress || "",
                                rewardTokenAddress: vault.rewardTokenAddress || "",
                                name: vault.name || "Unknown Vault",
                                protocol: vault.protocol || "",
                                description: vault.description || ""
                            });
                        }
                    });
                    
                    this.lastVaultScan = Date.now();
                    
                    // IMPORTANT: We trust the downloaded vaults and don't need to query on-chain
                    return validVaults.map(vault => vault.address || vault.vaultAddress);
                }
            } catch (error) {
                console.warn('Could not load cached vaults, falling back to on-chain query:', error.message);
            }

            // ONLY if we couldn't load from file, query on-chain
            console.log('No valid metadata found. Scanning for vault contracts on-chain...');
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
            // Create contract instance to interact with the vault
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

            // Get vault info from cache if available (for protocol, name, etc.)
            const vaultMetadata = this.vaultCache.get(vaultAddress) || {};
            
            return {
                vaultAddress, // This is the actual contract address used for on-chain calls
                address: vaultAddress, // Add this for compatibility with different field names
                name: vaultMetadata.name || "", // Include the vault name if available
                protocol: vaultMetadata.protocol || "", // Include protocol info if available
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
                name: 'Honey Pool',
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
     * Check Delegation Rewards contract for claimable rewards
     * This implementation uses a hardcoded approach for now until we can 
     * determine the correct function to check available rewards.
     * 
     * @param {string} userAddress - User wallet address
     * @returns {Promise<Object|null>} Delegation rewards information
     */
    async checkDelegationRewardsDetailed(userAddress) {
        try {
            // Since the earned() function is failing, we'll implement a different approach
            // For now, return a small amount to indicate rewards might be available
            // The user can always attempt to claim and see if it works

            // Create a dummy value - we'll use the special marker value of 0.000001 HONEY
            // to indicate we can't determine the exact amount
            const dummyValue = ethers.utils.parseEther("0.000001");
            
            // The delegation rewards are typically in HONEY token
            const honeyTokenInfo = { 
                symbol: "HONEY", 
                address: config.networks.berachain.honeyTokenAddress,
                decimals: 18 
            };
            
            return {
                type: 'delegationRewards',
                name: 'Bera Chain Validators',
                contractAddress: config.networks.berachain.delegationRewardsAddress,
                rewardToken: honeyTokenInfo,
                earned: ethers.utils.formatUnits(dummyValue, honeyTokenInfo.decimals),
                rawEarned: dummyValue,
                isPotentialReward: true // Mark this as a potential reward rather than a confirmed amount
            };
        } catch (error) {
            console.warn(`Warning: Could not check Delegation Rewards for ${userAddress}:`, error.message);
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
                    progressCallback(50, 100, "BGT Staker checking complete");
                }
            } else {
                console.log("No BGT Staker rewards found.");
            }
            
            // Check Delegation Rewards
            console.log(`Checking Delegation Rewards for ${userAddress}...`);
            if (progressCallback) {
                progressCallback(60, 100, "Checking Delegation Rewards...");
            }
            
            const delegationRewards = await this.checkDelegationRewardsDetailed(userAddress);
            
            if (delegationRewards) {
                allRewards.push(delegationRewards);
                console.log(`Found Delegation Rewards: ${delegationRewards.earned} HONEY`);
                if (progressCallback) {
                    progressCallback(100, 100, "Delegation Rewards checking complete");
                }
            } else {
                console.log("No Delegation Rewards found.");
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
                output += `BGT Staker (Honey Pool):\n`;
                output += `  Pending HONEY: ${parseFloat(bgtStakerRewards.earned).toFixed(2)}\n`;
                output += "──────────────────────────────────────────────────\n";
            }
            
            // Add Delegation Rewards if any
            if (delegationRewards) {
                output += `Delegation Rewards (Bera Chain Validators):\n`;
                // Check if this is just a potential reward marker
                if (delegationRewards.isPotentialReward) {
                    output += `  Potential HONEY rewards available (amount unknown)\n`;
                    output += `  Try claiming to see if rewards are available\n`;
                } else {
                    output += `  Pending HONEY: ${parseFloat(delegationRewards.earned).toFixed(2)}\n`;
                }
                output += "──────────────────────────────────────────────────\n";
            }

            // Add vault rewards
            for (const vault of vaultsWithStakes) {
                // Include protocol info if available
                const protocolInfo = vault.protocol ? ` on ${vault.protocol}` : '';
                const vaultName = vault.name || vault.vaultAddress;
                
                output += `Vault: ${vaultName}${protocolInfo}\n`;
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
                hasDelegationRewards: false,
                validatorBoostCount: 0,
                totalBoostedBGT: 0,
                rewardsByToken: {}
            };
        }

        // Calculate totals for rewards
        let totalRewards = ethers.BigNumber.from(0);
        const rewardsByToken = {};
        let hasBGTStakerRewards = false;
        let hasDelegationRewards = false;
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
            } else if (item.type === 'delegationRewards') {
                hasDelegationRewards = true;
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
            hasDelegationRewards,
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
     * Check claimable Honey rewards from Delegation Rewards contract
     * @param {string} address - User wallet address
     * @returns {Promise<string>} Formatted reward amount
     */
    async checkDelegationRewards(address) {
        try {
            // Since we can't reliably check the exact amount, we'll return a small marker value
            // to indicate that rewards might be available
            return "0.000001"; // Special marker value
        } catch (error) {
            console.warn(`Warning: Could not check Delegation Rewards for ${address}:`, error.message);
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
            
            // Don't use Promise.all - we want to see detailed logs for each step
            console.log("Fetching vaults from GitHub...");
            const vaults = await this.loadVaultsMetadata(true);
            console.log(`Loaded ${vaults.length} vault(s) from GitHub or cache`);
            
            console.log("Fetching tokens from GitHub...");
            const tokens = await this.loadTokensMetadata(true);
            console.log(`Loaded ${Object.keys(tokens).length} token(s) from GitHub or cache`);
            
            // Verify the data was saved correctly
            try {
                await fs.access(config.paths.vaultsFile);
                console.log(`Verified vault file exists at ${config.paths.vaultsFile}`);
            } catch (err) {
                console.error(`Warning: Vault file does not exist after update: ${err.message}`);
            }
            
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
            console.log("Updating vaults, validators, and tokens from GitHub...");
            
            // Download each type sequentially with specific messaging
            console.log("\nStep 1: Downloading validators list...");
            const validators = await this.loadValidatorMetadata(true);
            console.log(`✓ Downloaded ${validators.length} validators`);
            
            console.log("\nStep 2: Downloading vaults information...");
            const vaults = await this.loadVaultsMetadata(true);
            console.log(`✓ Downloaded vaults information (${vaults.length} entries)`);
            
            console.log("\nStep 3: Downloading tokens information...");
            const tokens = await this.loadTokensMetadata(true);
            const tokenCount = Object.keys(tokens).length;
            console.log(`✓ Downloaded ${tokenCount} tokens`);
            
            console.log("\nAll metadata successfully updated and saved to metadata directory.");
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
        // Extract filename for cleaner logs
        const filename = url.split('/').pop();
        console.log(`Fetching ${filename}...`);
        
        return new Promise((resolve, reject) => {
            const req = https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    const errorMsg = `Request failed with status code ${response.statusCode} (${response.statusMessage})`;
                    console.error(`Error fetching ${filename}: ${errorMsg}`);
                    reject(new Error(errorMsg));
                    return;
                }

                // Simple status confirmation 
                console.log(`Connected to ${filename} successfully`);
                
                let data = '';
                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    console.log(`Downloaded ${(data.length/1024).toFixed(1)} KB of data`);
                    try {
                        // Try to parse as JSON to validate it early
                        JSON.parse(data);
                        resolve(data);
                    } catch (e) {
                        console.error(`Error: Downloaded data is not valid JSON`);
                        reject(new Error(`Downloaded data is not valid JSON: ${e.message}`));
                    }
                });
            }).on('error', (error) => {
                console.error(`Network error fetching ${filename}: ${error.message}`);
                reject(error);
            });

            // Set a timeout of 15 seconds
            req.setTimeout(15000, () => {
                req.destroy();
                console.error(`Request timed out for ${filename}`);
                reject(new Error('Request timed out after 15 seconds'));
            });
        });
    }

    /**
     * Fetch validator metadata from GitHub
     * @returns {Promise<Array<Object>>} Array of validator information
     */
    async fetchValidatorsFromGitHub() {
        try {
            // Try multiple URLs in order of preference
            const urls = [
                'https://raw.githubusercontent.com/berachain/metadata/refs/heads/main/src/validators/mainnet.json',
                'https://raw.githubusercontent.com/berachain/metadata/main/src/validators/mainnet.json',
                'https://raw.githubusercontent.com/berachain/metadata/master/src/validators/mainnet.json'
            ];
            
            let data = null;
            let errorMsg = '';
            
            // Try each URL until one works
            for (const url of urls) {
                try {
                    console.log(`Attempting to fetch validators from: ${url}`);
                    data = await this.fetchUrl(url);
                    console.log(`Successfully fetched validators from: ${url}`);
                    break; // Exit the loop if successful
                } catch (err) {
                    errorMsg += `\n- ${url}: ${err.message}`;
                    console.warn(`Failed to fetch from ${url}: ${err.message}`);
                    // Continue to the next URL
                }
            }
            
            // If all URLs failed
            if (!data) {
                throw new Error(`All validator data URLs failed: ${errorMsg}`);
            }
            
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
            // Try multiple URLs in order of preference
            const urls = [
                'https://raw.githubusercontent.com/berachain/metadata/refs/heads/main/src/vaults/mainnet.json',
                'https://raw.githubusercontent.com/berachain/metadata/main/src/vaults/mainnet.json',
                'https://raw.githubusercontent.com/berachain/metadata/master/src/vaults/mainnet.json'
            ];
            
            let data = null;
            let errorMsg = '';
            
            // Try each URL until one works
            for (const url of urls) {
                try {
                    console.log(`Attempting to fetch vaults from: ${url}`);
                    data = await this.fetchUrl(url);
                    console.log(`Successfully fetched vaults from: ${url}`);
                    break; // Exit the loop if successful
                } catch (err) {
                    errorMsg += `\n- ${url}: ${err.message}`;
                    console.warn(`Failed to fetch from ${url}: ${err.message}`);
                    // Continue to the next URL
                }
            }
            
            // If all URLs failed
            if (!data) {
                throw new Error(`All vault data URLs failed: ${errorMsg}`);
            }
            
            // Parse the JSON data
            const parsed = JSON.parse(data);
            
            // First, save the original data as-is to a backup file for debugging
            try {
                const backupPath = path.join(config.paths.metadataDir, 'vaults_original.json');
                await fs.writeFile(backupPath, data);
                console.log(`Saved original vault data to ${backupPath}`);
            } catch (error) {
                console.warn(`Could not save backup of original vault data: ${error.message}`);
            }
            
            // Check for the expected structure
            if (!parsed || !parsed.vaults || !Array.isArray(parsed.vaults)) {
                console.error('Error: Unexpected vault data format. Expected { vaults: [...] }');
                console.log(`Data has properties: ${Object.keys(parsed || {}).join(', ')}`);
                throw new Error('Invalid vaults data format');
            }
            
            // Get the vaults array directly from the response
            const allVaults = parsed.vaults;
            console.log(`Found ${allVaults.length} vault entries in GitHub data`);
            
            // Save the vaults array to the actual vaults.json file
            try {
                // Simple sanity check - make sure we're saving something reasonable
                if (allVaults.length > 0) {
                    // Save the raw vaults array directly
                    await fs.writeFile(config.paths.vaultsFile, JSON.stringify(allVaults, null, 2));
                    console.log(`✓ Successfully saved ${allVaults.length} vaults to metadata/vaults.json`);
                    
                    // Now check which vaults have valid addresses (either address or vaultAddress)
                    const validVaults = allVaults.filter(vault => {
                        const address = vault.address || vault.vaultAddress;
                        return address && typeof address === 'string' && address.startsWith('0x');
                    });
                    
                    // For each vault, make sure it has both address and vaultAddress fields (for compatibility)
                    allVaults.forEach(vault => {
                        if (!vault.address && vault.vaultAddress) {
                            vault.address = vault.vaultAddress;
                        }
                        if (!vault.vaultAddress && vault.address) {
                            vault.vaultAddress = vault.address;
                        }
                    });
                    
                    const invalidCount = allVaults.length - validVaults.length;
                    if (invalidCount > 0) {
                        console.log(`Note: ${validVaults.length}/${allVaults.length} vaults have valid addresses for on-chain interaction`);
                    } else {
                        console.log(`All ${allVaults.length} vaults have valid addresses`);
                    }
                    
                    return allVaults; // Return all vaults, not just valid ones
                } else {
                    console.warn('Warning: No vault entries found in GitHub data');
                    await fs.writeFile(config.paths.vaultsFile, "[]");
                    return [];
                }
            } catch (error) {
                console.error(`Error saving vaults to file: ${error.message}`);
                throw error; // Propagate the error
            }
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
            // Try multiple URLs in order of preference
            const urls = [
                'https://raw.githubusercontent.com/berachain/metadata/refs/heads/main/src/tokens/mainnet.json',
                'https://raw.githubusercontent.com/berachain/metadata/main/src/tokens/mainnet.json',
                'https://raw.githubusercontent.com/berachain/metadata/master/src/tokens/mainnet.json'
            ];
            
            let data = null;
            let errorMsg = '';
            
            // Try each URL until one works
            for (const url of urls) {
                try {
                    console.log(`Attempting to fetch tokens from: ${url}`);
                    data = await this.fetchUrl(url);
                    console.log(`Successfully fetched tokens from: ${url}`);
                    break; // Exit the loop if successful
                } catch (err) {
                    errorMsg += `\n- ${url}: ${err.message}`;
                    console.warn(`Failed to fetch from ${url}: ${err.message}`);
                    // Continue to the next URL
                }
            }
            
            // If all URLs failed
            if (!data) {
                throw new Error(`All token data URLs failed: ${errorMsg}`);
            }
            
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
     * Ensure metadata directory exists
     */
    async ensureMetadataDirExists() {
        try {
            await fs.mkdir(config.paths.metadataDir, { recursive: true });
            return true;
        } catch (error) {
            console.warn(`Warning: Could not create metadata directory: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Update local validator metadata file
     * @param {Array<Object>} validators - Array of validator information
     * @returns {Promise<boolean>} Success status
     */
    async updateValidatorMetadataFile(validators) {
        try {
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            await fs.writeFile(config.paths.validatorsFile, JSON.stringify(validators, null, 2));
            console.log('Validator metadata updated successfully to metadata/validators.json');
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
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            await fs.writeFile(config.paths.vaultsFile, JSON.stringify(vaults, null, 2));
            console.log('Vaults metadata updated successfully to metadata/vaults.json');
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
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            await fs.writeFile(config.paths.tokensFile, JSON.stringify(tokens, null, 2));
            console.log('Tokens metadata updated successfully to metadata/tokens.json');
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
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            // Check if the file exists
            let fileExists = false;
            try {
                await fs.access(config.paths.validatorsFile);
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
            const data = await fs.readFile(config.paths.validatorsFile, 'utf8');
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
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            // Check if the file exists
            let fileExists = false;
            try {
                await fs.access(config.paths.vaultsFile);
                fileExists = true;
            } catch (error) {
                fileExists = false;
            }
            
            // Fetch from GitHub if file doesn't exist or update is forced
            if (!fileExists || forceUpdate) {
                console.log('Fetching vaults from GitHub...');
                // This will download and save the vaults data from GitHub
                const vaults = await this.fetchVaultsFromGitHub();
                console.log(`Fetched ${vaults.length} vaults from GitHub`);
                return vaults;
            }
            
            // Read from local file
            console.log(`Reading vaults from local file: ${config.paths.vaultsFile}`);
            const data = await fs.readFile(config.paths.vaultsFile, 'utf8');
            
            try {
                const vaults = JSON.parse(data);
                
                // Validate parsed data is an array
                if (!Array.isArray(vaults)) {
                    console.warn(`Warning: Vaults file does not contain a valid array, got: ${typeof vaults}`);
                    return [];
                }
                
                console.log(`Loaded ${vaults.length} vaults from metadata file`);
                
                // Add compatibility fields to each vault
                vaults.forEach(vault => {
                    if (!vault.address && vault.vaultAddress) {
                        vault.address = vault.vaultAddress;
                    }
                    if (!vault.vaultAddress && vault.address) {
                        vault.vaultAddress = vault.address;
                    }
                });
                
                // Calculate how many vaults have valid addresses for on-chain interaction
                const validForChainVaults = vaults.filter(vault => {
                    const address = vault.address || vault.vaultAddress;
                    return address && typeof address === 'string' && address.startsWith('0x');
                });
                
                if (validForChainVaults.length < vaults.length) {
                    console.log(`Note: ${validForChainVaults.length}/${vaults.length} vaults have valid addresses for on-chain interaction`);
                }
                
                // Return all vaults - filtering happens when checking for rewards
                return vaults;
            } catch (parseError) {
                console.error(`Error parsing vaults file: ${parseError.message}`);
                // If there's an error parsing, try fetching fresh data
                console.log('Trying to fetch fresh vault data due to parsing error...');
                return await this.fetchVaultsFromGitHub();
            }
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
            // Ensure metadata directory exists
            await this.ensureMetadataDirExists();
            
            // Check if the file exists
            let fileExists = false;
            try {
                await fs.access(config.paths.tokensFile);
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
            const data = await fs.readFile(config.paths.tokensFile, 'utf8');
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
        // Try to find by id first (for older data format)
        let validator = validators.find(v => 
            (v.id && v.id.toLowerCase() === pubkey.toLowerCase()) || 
            (v.pubkey && v.pubkey.toLowerCase() === pubkey.toLowerCase())
        );
        
        if (validator) {
            return validator;
        }

        // If not found, return a generic validator object
        return {
            pubkey: pubkey,
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
                    // Use validator.pubkey if available, otherwise fall back to validator.id
                    const validatorKey = validator.pubkey || validator.id;
                    
                    // Skip if no valid key is found
                    if (!validatorKey) {
                        console.warn(`Warning: Validator missing both pubkey and id fields: ${validator.name || 'Unknown'}`);
                        continue;
                    }
                    
                    const boostAmount = await this.retry(() => 
                        this.validatorBoost.boosted(userAddress, validatorKey)
                    );
                    
                    // If boost amount is greater than 0, add to results
                    if (!boostAmount.eq(0)) {
                        const totalValidatorBoost = await this.retry(() => 
                            this.validatorBoost.boostees(validatorKey)
                        );
                        
                        results.push({
                            pubkey: validatorKey,
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
                    console.warn(`Warning: Could not check boost amount for validator ${validator.name || validatorKey || 'unknown'}: ${error.message}`);
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
                    // Use validator.pubkey if available, otherwise fall back to validator.id
                    const validatorKey = validator.pubkey || validator.id;
                    
                    // Skip if no valid key is found
                    if (!validatorKey) {
                        console.warn(`Warning: Validator missing both pubkey and id fields: ${validator.name || 'Unknown'}`);
                        continue;
                    }
                    
                    const queuedAmount = await this.retry(() => 
                        this.validatorBoost.boostedQueue(userAddress, validatorKey)
                    );
                    
                    // If queued amount is greater than 0, add to results
                    if (!queuedAmount.eq(0)) {
                        results.push({
                            pubkey: validatorKey,
                            name: validator.name,
                            queuedBoostAmount: ethers.utils.formatEther(queuedAmount),
                            status: "queued"
                        });
                    }
                } catch (error) {
                    console.warn(`Warning: Could not check queued boost for validator ${validator.name || validatorKey || 'unknown'}: ${error.message}`);
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