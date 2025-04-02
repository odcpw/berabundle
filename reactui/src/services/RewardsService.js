/**
 * RewardsService.js - Service for checking and claiming rewards in the React UI
 * 
 * This adapter manages communication with the BeraBundle rewards system
 */

import { ethers } from 'ethers';
import tokenBridge from './TokenBridge';

/**
 * Service for checking and claiming rewards in the React UI
 */
class RewardsService {
  constructor() {
    this.provider = null;
    this.checkedRewards = [];
    this.initialized = false;
    this.apiKey = null;
    this.tokenInfoCache = new Map(); // Initialize token cache
    
    // Store contract addresses in one place to avoid inconsistencies
    this.contractAddresses = {
      // Always use lowercase addresses to be converted consistently - copied from config.js
      bgtStaker: '0x44f07ce5afecbcc406e6befd40cc2998eeb8c7c6',
      honeyToken: '0x7eeca4205ff31f947edbd49195a7a88e6a91161b', // HONEY token from BGT Staker rewards
      bgtToken: '0x656b95e550c07a9ffe548bd4085c72418ceb1dba', // BGT token (validatorBoostAddress in config)
      rewardVaultFactory: '0x94ad6ac84f6c6fba8b8ccbd71d9f4f101def52a8'
    };
  }
  
  /**
   * Initialize the service with a provider
   * @param {ethers.providers.Web3Provider} provider - Ethers provider
   * @param {string} apiKey - OogaBooga API key
   */
  initialize(provider, apiKey) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.initialized = Boolean(provider && apiKey);
    return this.initialized;
  }
  
  /**
   * Check if the service is initialized
   */
  isInitialized() {
    return this.initialized && Boolean(this.provider && this.apiKey);
  }
  
  /**
   * Check all rewards for a user, mirroring the CLI's checkAllRewards function
   * @param {string} address - Wallet address to check
   * @returns {Promise<Object>} Rewards information
   */
  async checkRewards(address) {
    if (!this.isInitialized()) throw new Error("RewardsService not initialized");
    
    try {
      // Validate address
      if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
        throw new Error(`Invalid address provided: ${address}`);
      }
      
      // Normalize user address - always convert to lowercase first to ensure consistency
      const normalizedAddress = ethers.utils.getAddress(address.toLowerCase());
      console.log(`Checking all rewards for ${normalizedAddress}...`);
      
      // First get all vaults with active stakes
      console.log("Finding vaults with active stakes...");
      
      // Get all vaults
      const vaultRewards = await this.checkVaultRewards(normalizedAddress);
      console.log(`Found ${vaultRewards.length} vaults with active stakes`);
      
      // Track all rewards
      const allRewards = [...vaultRewards];
      
      // Check BGT Staker rewards
      console.log(`Checking BGT Staker rewards for ${normalizedAddress}...`);
      const bgtStakerRewards = await this.checkBGTStakerRewards(normalizedAddress);
      
      if (bgtStakerRewards) {
        allRewards.push(bgtStakerRewards);
        console.log(`Found BGT Staker rewards: ${bgtStakerRewards.earned}`);
      } else {
        console.log("No BGT Staker rewards found.");
      }
      
      // Calculate summary information
      const rewardsByToken = {};
      let totalValue = 0;
      
      for (const reward of allRewards) {
        // Add to token-specific total
        const tokenSymbol = reward.rewardToken.symbol;
        
        if (!rewardsByToken[tokenSymbol]) {
          rewardsByToken[tokenSymbol] = {
            amount: 0,
            formatted: "0",
            token: reward.rewardToken
          };
        }
        
        // Add to token amount - values are already rounded to 2 decimal places 
        const amount = parseFloat(reward.earned) || 0;
        rewardsByToken[tokenSymbol].amount += amount;
        // Ensure we're consistently using 2 decimal places
        rewardsByToken[tokenSymbol].formatted = rewardsByToken[tokenSymbol].amount.toFixed(2);
        
        // Add to total value - values are already rounded
        totalValue += (reward.valueUsd || 0);
      }
      
      // Make sure total value is also rounded to 2 decimal places
      totalValue = parseFloat(totalValue.toFixed(2));
      
      // Format summary message for console
      let summaryMessage = "Rewards Summary:\n";
      
      // Add rewards by token
      for (const [symbol, info] of Object.entries(rewardsByToken)) {
        if (info.amount > 0) {
          // Display just the formatted amount without the symbol
          summaryMessage += `  - ${info.formatted}\n`;
        }
      }
      
      console.log(summaryMessage);
      
      // Save rewards for later (for claiming)
      this.checkedRewards = allRewards;
      
      return {
        success: true,
        rewards: allRewards,
        totalValue: totalValue,
        rewardsByToken: rewardsByToken
      };
    } catch (error) {
      console.error("Error checking rewards:", error);
      
      // No mock data - return the error to be handled by the UI
      return {
        success: false,
        error: error.message || "Failed to check rewards",
        rewards: []
      };
    }
  }
  
  /**
   * Check BGT Staker for rewards
   * @param {string} address - User wallet address
   * @returns {Promise<Object|null>} BGT Staker reward information
   */
  async checkBGTStakerRewards(address) {
    try {
      if (!this.provider) throw new Error("Provider not initialized");
      
      console.log("Starting BGT Staker rewards check...");
      
      // Make sure we're working with a valid address - always validate input
      if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
        console.warn(`Invalid address provided to checkBGTStakerRewards: ${address}`);
        return null;
      }
      
      // Always convert to lowercase first to ensure consistent normalization
      const normalizedAddress = ethers.utils.getAddress(address.toLowerCase());
      
      // Get contract addresses from the central store and normalize - always convert to lowercase first
      const bgtStakerAddress = ethers.utils.getAddress(this.contractAddresses.bgtStaker.toLowerCase());
      const honeyTokenAddress = ethers.utils.getAddress(this.contractAddresses.honeyToken.toLowerCase());
      
      
      // Create contract instance with more comprehensive ABI
      // This matches the ABI from the Berachain docs for BGT Staker
      const bgtStakerABI = [
        "function balanceOf(address) view returns (uint256)",
        "function earned(address) view returns (uint256)",
        "function totalSupply() view returns (uint256)",
        "function rewardRate() view returns (uint256)",
        "function getReward() external",
        "function lastTimeRewardApplicable() view returns (uint256)",
        "function rewardPerToken() view returns (uint256)"
      ];
      
      const bgtStaker = new ethers.Contract(
        bgtStakerAddress,
        bgtStakerABI,
        this.provider
      );
      
      // First check if user has any stake
      let userBalance;
      try {
        console.log(`Checking balance for ${normalizedAddress} at contract ${bgtStakerAddress}`);
        
        userBalance = await this.retryPromise(() => bgtStaker.balanceOf(normalizedAddress));
        console.log(`BGT Staker balance: ${userBalance.toString()}`);
        
        // Even if balance is zero, we continue checking earned rewards
        // as users might have earned rewards but unstaked their tokens
      } catch (err) {
        console.error(`ERROR checking BGT Staker balance:`, err);
        // Continue anyway to check earned rewards
        userBalance = ethers.BigNumber.from(0);
      }
      
      // Check earned rewards with retry - this is the key part
      let earned;
      try {
        console.log(`Checking earned rewards for ${normalizedAddress}`);
        earned = await this.retryPromise(() => bgtStaker.earned(normalizedAddress), 5);
        console.log(`BGT Staker earned: ${earned.toString()}`);
        
        if (earned.isZero() && userBalance.isZero()) {
          console.log("User has no earned rewards and no stake");
          return null;
        }
      } catch (err) {
        console.error(`ERROR checking BGT Staker earned rewards:`, err);
        return null;
      }
      
      // This is always HONEY - no need to check the contract
      const honeyTokenInfo = {
        symbol: "HONEY",
        decimals: 18
      };
      
      // Get price for HONEY
      let priceUsd = null;
      try {
        priceUsd = await tokenBridge.getTokenPrice(honeyTokenAddress);
      } catch (err) {
        console.warn("Could not get price for HONEY:", err);
      }
      
      // Format earned amount - round to 2 decimal places
      const earnedFloat = parseFloat(ethers.utils.formatUnits(earned, honeyTokenInfo.decimals));
      const balanceFloat = parseFloat(ethers.utils.formatUnits(userBalance, honeyTokenInfo.decimals));
      
      // Round to 2 decimal places
      const formattedEarned = earnedFloat.toFixed(2);
      const formattedBalance = balanceFloat.toFixed(2);
      const valueUsd = priceUsd ? earnedFloat * priceUsd : 0;
      
      console.log(`Successfully completed BGT Staker check for ${normalizedAddress}`);
      console.log(`User has ${formattedBalance} staked and ${formattedEarned} earned`);
      
      // Validator boost data will be checked separately through checkValidatorBoosts
      
      return {
        id: `bgtStaker-${bgtStakerAddress.substring(2, 10)}`,
        type: 'bgtStaker',
        name: 'BGT Staker Honey Fees', // Updated name for clarity
        symbol: honeyTokenInfo.symbol, // Keep separately for internal use
        source: 'BGT Staker',
        amount: formattedEarned,
        earned: formattedEarned, // Already rounded to 2 decimal places
        formattedAmount: formattedEarned, // No symbol, just the number
        valueUsd: parseFloat(valueUsd.toFixed(2)), // Round to 2 decimal places
        formattedValueUsd: valueUsd.toLocaleString(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }),
        rewardToken: {
          symbol: honeyTokenInfo.symbol,
          address: honeyTokenAddress,
          decimals: honeyTokenInfo.decimals
        },
        contractAddress: bgtStakerAddress,
        rawEarned: earned,
        // We still include userBalance in case other components need it, but it won't be displayed
        userBalance: formattedBalance
      };
    } catch (error) {
      console.error("Error checking BGT Staker rewards:", error);
      return null;
    }
  }
  
  
  /**
   * Check vaults for rewards
   * @param {string} address - User wallet address
   * @returns {Promise<Array<Object>>} Array of vault rewards
   */
  async checkVaultRewards(address) {
    try {
      // Validate address
      if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
        console.warn(`Warning: Invalid address provided to checkVaultRewards: ${address}`);
        return [];
      }
      
      // Normalize address for consistency - always convert to lowercase first
      const normalizedAddress = ethers.utils.getAddress(address.toLowerCase());
      
      // Get vault addresses directly from the chain
      console.log("Finding vaults with active stakes...");
      const vaultAddresses = await this.getRewardVaults();
      
      if (!vaultAddresses || vaultAddresses.length === 0) {
        console.log("No vaults found on-chain");
        return [];
      }
      
      console.log(`Found ${vaultAddresses.length} total vaults to check...`);

      // Process vaults in batches to avoid overwhelming the network
      const batchSize = 10;
      const vaultsWithStakes = [];
      
      // Create batches of vault addresses
      const batches = [];
      for (let i = 0; i < vaultAddresses.length; i += batchSize) {
        batches.push(vaultAddresses.slice(i, i + batchSize));
      }
      
      console.log(`Processing ${vaultAddresses.length} vaults in ${batches.length} batches...`);
      
      // Process each batch sequentially
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchPromises = batch.map(vaultAddress => this.checkVaultByAddress(vaultAddress, normalizedAddress));
        
        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter(Boolean);
        
        // Add to total stakes
        vaultsWithStakes.push(...validResults);
        
        // Log progress
        const processed = Math.min((i + 1) * batchSize, vaultAddresses.length);
        const percent = Math.round((processed / vaultAddresses.length) * 100);
        
        // More detailed log message for debugging
        if (validResults.length > 0 || i % 5 === 0 || i === batches.length - 1) {
          console.log(`Processed ${processed}/${vaultAddresses.length} vaults (${percent}%), found ${vaultsWithStakes.length} active stakes` + 
            (validResults.length > 0 ? ` (+${validResults.length} new)` : ''));
          
          // If we found new stakes, log some info about them
          if (validResults.length > 0) {
            validResults.forEach(stake => {
              console.log(`  - Found stake: ${stake.userStake}, earned: ${stake.earned}`);
            });
          }
        }
        
        // Add a small delay between batches to avoid rate limits
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`Vault checking complete. Found ${vaultsWithStakes.length} vaults with active stakes.`);
      return vaultsWithStakes;
    } catch (error) {
      console.warn("Error checking vault rewards:", error);
      return [];
    }
  }
  
  /**
   * Check a vault by its address for rewards
   * @param {string} vaultAddress - Vault contract address
   * @param {string} userAddress - User wallet address
   * @returns {Promise<Object|null>} Vault reward information
   */
  async checkVaultByAddress(vaultAddress, userAddress) {
    try {
      // Validate addresses
      if (!vaultAddress || typeof vaultAddress !== 'string' || !vaultAddress.startsWith('0x')) {
        console.warn(`Warning: Invalid vault address: ${vaultAddress}`);
        return null;
      }
      
      if (!userAddress || typeof userAddress !== 'string' || !userAddress.startsWith('0x')) {
        console.warn(`Warning: Invalid user address: ${userAddress}`);
        return null;
      }
      
      // Normalize addresses - always convert to lowercase first for consistency
      const normalizedVaultAddress = ethers.utils.getAddress(vaultAddress.toString().toLowerCase());
      const normalizedUserAddress = ethers.utils.getAddress(userAddress.toString().toLowerCase());
      
      
      // Create a simple vault object with just the normalized address
      const vault = { address: normalizedVaultAddress };
      
      // Use the existing checkVault method
      return await this.checkVault(vault, normalizedUserAddress);
    } catch (error) {
      console.warn(`Warning: Could not check vault ${vaultAddress}:`, error.message);
      return null;
    }
  }
  
  /**
   * Check a specific vault for rewards
   * @param {Object} vault - Vault information from metadata
   * @param {string} userAddress - User wallet address
   * @returns {Promise<Object|null>} Vault reward information
   */
  async checkVault(vault, userAddress) {
    try {
      if (!this.provider) throw new Error("Provider not initialized");
      
      // Get the vault address and validate
      let vaultAddress = vault.address || vault.vaultAddress;
      
      // Validate addresses before proceeding
      if (!vaultAddress || typeof vaultAddress !== 'string' || !vaultAddress.startsWith('0x')) {
        console.warn(`Warning: Invalid vault address: ${vaultAddress}`);
        return null;
      }
      
      if (!userAddress || typeof userAddress !== 'string' || !userAddress.startsWith('0x')) {
        console.warn(`Warning: Invalid user address: ${userAddress}`);
        return null;
      }
      
      // Normalize addresses - always convert to lowercase first for consistency
      try {
        // Always convert to lowercase first to ensure consistent normalization
        vaultAddress = ethers.utils.getAddress(vaultAddress.toString().toLowerCase());
        userAddress = ethers.utils.getAddress(userAddress.toString().toLowerCase());
      } catch (err) {
        console.warn(`Warning: Could not normalize addresses: ${err.message}`);
        return null;
      }
      
      // Create contract instance to interact with the vault
      const vaultContract = new ethers.Contract(
        vaultAddress,
        [
          "function balanceOf(address) view returns (uint256)",
          "function stakeToken() view returns (address)",
          "function rewardToken() view returns (address)",
          "function totalSupply() view returns (uint256)",
          "function earned(address) view returns (uint256)",
          "function rewardRate() view returns (uint256)",
          "function getRewardForDuration() view returns (uint256)"
        ],
        this.provider
      );
      
      // First check if user has any stake - this is the fastest check
      let userBalance;
      try {
        userBalance = await vaultContract.balanceOf(userAddress);
        if (userBalance.eq(0)) {
          return null;
        }
      } catch (err) {
        console.warn(`Warning: Could not check balance for vault ${vaultAddress}:`, err.message);
        return null;
      }
      
      // Get all other data in parallel with retry logic
      try {
        const [
          stakeTokenAddress,
          rewardTokenAddress,
          totalSupply,
          earned,
          rewardRate,
          rewardForDuration
        ] = await Promise.all([
          this.retryPromise(() => vaultContract.stakeToken()),
          this.retryPromise(() => vaultContract.rewardToken()),
          this.retryPromise(() => vaultContract.totalSupply()),
          this.retryPromise(() => vaultContract.earned(userAddress)),
          this.retryPromise(() => vaultContract.rewardRate()),
          this.retryPromise(() => vaultContract.getRewardForDuration())
        ]);
        
        // Normalize token addresses before getting info - convert to string to handle any object addresses
        const normalizedStakeTokenAddress = ethers.utils.getAddress(stakeTokenAddress.toString().toLowerCase());
        const normalizedRewardTokenAddress = ethers.utils.getAddress(rewardTokenAddress.toString().toLowerCase());
        
        console.log(`Normalized stake token address: ${normalizedStakeTokenAddress}`);
        console.log(`Normalized reward token address: ${normalizedRewardTokenAddress}`);
        
        // Get token info in parallel with normalized addresses
        const [stakeTokenInfo, rewardTokenInfo] = await Promise.all([
          this.getTokenInfo(normalizedStakeTokenAddress),
          this.getTokenInfo(normalizedRewardTokenAddress)
        ]);
        
        // Format values - parse float and round to 2 decimal places
        const userStakeFloat = parseFloat(ethers.utils.formatUnits(userBalance, stakeTokenInfo.decimals));
        const totalStakeFloat = parseFloat(ethers.utils.formatUnits(totalSupply, stakeTokenInfo.decimals));
        const earnedFloat = parseFloat(ethers.utils.formatUnits(earned, rewardTokenInfo.decimals));
        
        // Round to 2 decimal places for display
        const userStake = userStakeFloat.toFixed(2);
        const totalStake = totalStakeFloat.toFixed(2);
        const earnedFormatted = earnedFloat.toFixed(2);
        
        // Calculate percentage share - also round to 2 decimal places
        const share = totalStakeFloat > 0 
          ? ((userStakeFloat / totalStakeFloat) * 100).toFixed(2)
          : "0.00";
        
        // Get price for reward token
        let priceUsd = null;
        try {
          priceUsd = await tokenBridge.getTokenPrice(normalizedRewardTokenAddress);
        } catch (err) {
          console.warn(`Could not get price for ${rewardTokenInfo.symbol}:`, err);
        }
        
        // Calculate value in USD - round to 2 decimal places
        const valueUsd = priceUsd ? earnedFloat * priceUsd : 0;
        
        // Build metadata from vault info and chain data
        // Use name and protocol from GitHub metadata via vault cache
        // This vault object comes from the checkVaultByAddress method, which creates
        // a simple object with just the address. The real metadata is in the vaultCache.
        const vaultCacheData = this.vaultCache ? this.vaultCache.get(vaultAddress) || {} : {};
        const vaultName = vaultCacheData.name || vault.name || `Vault ${vaultAddress.substring(2, 10)}`;
        const protocolName = vaultCacheData.protocol || vault.protocol || "";
        
        
        return {
          id: `vault-${vaultAddress.substring(2, 10)}`,
          type: 'vault',
          name: vaultName, // Use name from GitHub metadata, fall back to address if not available
          protocol: protocolName, // Use protocol from GitHub metadata
          description: vaultCacheData.description || vault.description || "",
          symbol: rewardTokenInfo.symbol, // Keep separately for internal use
          source: vault.protocol ? `${vault.protocol} Vault` : "Vault Staking",
          amount: earnedFormatted,
          earned: earnedFormatted, // Already rounded to 2 decimal places
          formattedAmount: earnedFormatted, // No symbol, just the number
          valueUsd: parseFloat(valueUsd.toFixed(2)), // Round to 2 decimal places
          formattedValueUsd: valueUsd.toLocaleString(undefined, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }),
          rewardToken: {
            symbol: rewardTokenInfo.symbol,
            address: normalizedRewardTokenAddress,
            decimals: rewardTokenInfo.decimals
          },
          stakeToken: {
            symbol: stakeTokenInfo.symbol,
            address: normalizedStakeTokenAddress,
            decimals: stakeTokenInfo.decimals
          },
          vaultAddress,
          address: vaultAddress, // Add this for compatibility with different field names
          userStake,
          totalStake,
          share,
          rawEarned: earned,
          rewardRate: parseFloat(ethers.utils.formatUnits(rewardRate, rewardTokenInfo.decimals)).toFixed(2),
          rewardForDuration: parseFloat(ethers.utils.formatUnits(rewardForDuration, rewardTokenInfo.decimals)).toFixed(2),
          url: vault.url || ""
        };
      } catch (error) {
        console.warn(`Warning: Could not get data for vault ${vaultAddress}:`, error.message);
        return null;
      }
    } catch (error) {
      console.warn(`Warning: Could not check vault ${vault.address || vault.vaultAddress}:`, error.message);
      return null;
    }
  }
  
  /**
   * Helper function to retry a failed promise with exponential backoff
   * @param {Function} operation - Function that returns a promise to retry
   * @param {number} maxRetries - Maximum number of retries
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {Promise<any>} Result of the operation
   */
  async retryPromise(operation, maxRetries = 3, baseDelay = 100) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await operation();
        if (i > 0) {
          console.log(`Operation succeeded after ${i+1} attempts`);
        }
        return result;
      } catch (error) {
        lastError = error;
        
        // Log the retry attempt
        console.warn(`Retry attempt ${i+1}/${maxRetries} failed: ${error.message}`);
        
        // If this is the last attempt, throw the error
        if (i === maxRetries - 1) {
          console.error(`All ${maxRetries} retry attempts failed`);
          throw error;
        }
        
        // Calculate backoff delay with enhanced jitter to prevent all retries happening simultaneously
        // Use a wider range of jitter (0.5 to 1.5) to make sure retries aren't bunched together
        const jitter = 0.5 + Math.random(); // Random value between 0.5 and 1.5
        const delay = baseDelay * Math.pow(2, i) * jitter;
        
        console.log(`Retrying in ${Math.round(delay)}ms with jitter factor ${jitter.toFixed(2)}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }
  
  /**
   * Get token information
   * @param {string} tokenAddress - Token address
   * @returns {Promise<Object>} Token information
   */
  async getTokenInfo(tokenAddress) {
    try {
      if (!tokenAddress || !tokenAddress.startsWith('0x')) {
        return { symbol: "UNKNOWN", decimals: 18 };
      }
      
      // Check cache
      if (this.tokenInfoCache.has(tokenAddress)) {
        return this.tokenInfoCache.get(tokenAddress);
      }
      
      // Try to get token info from cache
      try {
        const cachedTokens = await this.loadTokensMetadata();
        if (cachedTokens[tokenAddress.toLowerCase()]) {
          const tokenInfo = {
            symbol: cachedTokens[tokenAddress.toLowerCase()].symbol || "UNKNOWN",
            decimals: cachedTokens[tokenAddress.toLowerCase()].decimals || 18
          };
          
          this.tokenInfoCache.set(tokenAddress, tokenInfo);
          return tokenInfo;
        }
      } catch (err) {
        console.warn(`Could not load token info from cache for ${tokenAddress}:`, err);
      }
      
      // Query on-chain
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          "function symbol() view returns (string)",
          "function decimals() view returns (uint8)"
        ],
        this.provider
      );
      
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol().catch(() => "UNKNOWN"),
        tokenContract.decimals().catch(() => 18)
      ]);
      
      const info = { symbol, decimals };
      this.tokenInfoCache.set(tokenAddress, info);
      return info;
    } catch (error) {
      console.warn(`Warning: Could not get token info for ${tokenAddress}:`, error);
      return { symbol: "UNKNOWN", decimals: 18 };
    }
  }
  
  /**
   * Get all reward vaults from GitHub metadata
   * This is more efficient than querying all vaults from the blockchain
   * @returns {Promise<Array<string>>} Array of vault addresses
   */
  async getRewardVaults() {
    try {
      console.log("Fetching vaults from GitHub metadata...");
      
      // Import and use metadataService
      const metadataService = await import('../services/MetadataService').then(module => module.default);
      
      // Get vaults from metadata service (which will use localStorage cache if available)
      const vaultsResult = await metadataService.getVaults();
      
      if (vaultsResult.success && vaultsResult.vaults && Array.isArray(vaultsResult.vaults.data)) {
        const vaultsData = vaultsResult.vaults.data;
        console.log(`Loaded ${vaultsData.length} vaults from GitHub metadata`);
        
        // Extract and normalize addresses
        const vaultAddresses = [];
        
        // Initialize the vault cache if needed
        this.vaultCache = this.vaultCache || new Map();
        
        for (const vault of vaultsData) {
          try {
            // Should be vaultAddress based on the GitHub structure
            let vaultAddress = vault.vaultAddress || vault.address;
            
            if (!vaultAddress || typeof vaultAddress !== 'string' || !vaultAddress.startsWith('0x')) {
              console.warn(`Skipping vault with invalid address: ${JSON.stringify(vault)}`);
              continue;
            }
            
            // Convert to lowercase first for consistent normalization
            const normalizedAddress = ethers.utils.getAddress(vaultAddress.toString().toLowerCase());
            vaultAddresses.push(normalizedAddress);
            
            // Store complete metadata for this vault in memory for later use
            this.vaultCache.set(normalizedAddress, {
              // Basic info
              name: vault.name || "Unknown Vault",
              protocol: vault.protocol || "",
              description: vault.description || "",
              // Token addresses
              stakeTokenAddress: vault.stakingTokenAddress || "",
              rewardTokenAddress: vault.rewardTokenAddress || "",
              // Additional metadata from GitHub
              logoURI: vault.logoURI || "",
              url: vault.url || "",
              owner: vault.owner || "",
              // Protocol metadata
              protocolLogo: vault.protocolLogo || "",
              protocolUrl: vault.protocolUrl || "",
              protocolDescription: vault.protocolDescription || ""
            });
            
          } catch (err) {
            console.warn(`Error processing vault address: ${err.message}`, err);
          }
        }
        
        console.log(`Processed ${vaultAddresses.length} valid vault addresses with metadata`);
        return vaultAddresses;
      } else {
        // If GitHub metadata isn't available, try cache
        console.warn("Failed to get vaults from GitHub metadata, trying cache");
        
        try {
          const cachedVaults = localStorage.getItem('vaultsMetadata');
          if (cachedVaults) {
            const parsed = JSON.parse(cachedVaults);
            console.log(`Using cached vault addresses (${parsed.length} vaults)`);
            return parsed;
          }
        } catch (cacheError) {
          console.warn("Cache retrieval error:", cacheError);
        }
        
        // If nothing else works, return empty array
        console.error("Could not get vault addresses from any source");
        return [];
      }
    } catch (error) {
      console.error(`Error getting reward vaults: ${error.message}`);
      
      // Try to get from cache if available
      try {
        const cachedVaults = localStorage.getItem('vaultsMetadata');
        if (cachedVaults) {
          const parsed = JSON.parse(cachedVaults);
          console.log(`Using cached vault addresses (${parsed.length} vaults)`);
          return parsed;
        }
      } catch (cacheError) {
        console.warn("Cache retrieval error:", cacheError);
      }
      
      // Return empty array if all else fails
      console.error("Could not get vault addresses from any source");
      return [];
    }
  }
  
  /**
   * Get token information from contract
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<Object>} Token information
   */
  async getTokenInfo(tokenAddress) {
    try {
      if (!this.provider) throw new Error("Provider not initialized");
      
      // Validate address
      if (!tokenAddress || typeof tokenAddress !== 'string' || !tokenAddress.startsWith('0x')) {
        console.warn(`Warning: Invalid token address: ${tokenAddress}`);
        return { symbol: "UNKNOWN", decimals: 18 };
      }
      
      // Normalize address - always convert to lowercase first to ensure consistent normalization
      try {
        // Always convert to lowercase first to ensure consistent normalization
        const addressString = tokenAddress.toString().toLowerCase();
        tokenAddress = ethers.utils.getAddress(addressString);
      } catch (err) {
        console.warn(`Warning: Could not normalize token address ${tokenAddress}:`, err.message);
        return { symbol: "UNKNOWN", decimals: 18 };
      }
      
      // Check in-memory cache first
      if (this.tokenInfoCache.has(tokenAddress)) {
        return this.tokenInfoCache.get(tokenAddress);
      }
      
      // Check local storage cache next
      const localStorageKey = `tokenInfo-${tokenAddress}`;
      try {
        const cachedInfo = localStorage.getItem(localStorageKey);
        if (cachedInfo) {
          const parsed = JSON.parse(cachedInfo);
          this.tokenInfoCache.set(tokenAddress, parsed);
          return parsed;
        }
      } catch (cacheError) {
        console.warn(`Token cache error for ${tokenAddress}:`, cacheError);
      }
      
      // Query token contract directly
      console.log(`Fetching token info for ${tokenAddress} from chain...`);
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          "function symbol() view returns (string)",
          "function decimals() view returns (uint8)"
        ],
        this.provider
      );
      
      // Get token data with fallbacks
      const [symbol, decimals] = await Promise.all([
        this.retryPromise(() => tokenContract.symbol().catch(() => "UNKNOWN")),
        this.retryPromise(() => tokenContract.decimals().catch(() => 18))
      ]);
      
      const info = { 
        symbol, 
        decimals: typeof decimals === 'number' ? decimals : parseInt(decimals.toString())
      };
      
      // Cache the result
      this.tokenInfoCache.set(tokenAddress, info);
      
      // Also store in localStorage for persistence
      try {
        localStorage.setItem(localStorageKey, JSON.stringify(info));
      } catch (storageError) {
        console.warn(`Could not cache token info for ${tokenAddress}:`, storageError);
      }
      
      return info;
    } catch (error) {
      console.warn(`Warning: Could not get token info for ${tokenAddress}:`, error.message);
      return { symbol: "UNKNOWN", decimals: 18 };
    }
  }
  
  /**
   * Makes an authenticated API call to the OogaBooga API
   * @param {string} endpoint - API endpoint path
   * @param {Object} params - Query parameters to include in the request
   * @returns {Promise<Object>} API response data
   * @throws {Error} If API key is missing or API call fails
   */
  async apiCallWithAuth(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error("OogaBooga API key not set. Please set it in settings.");
    }
    
    const url = endpoint.startsWith('http') ? endpoint : `${tokenBridge.apiBaseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${this.apiKey.trim()}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        return await response.json();
      } else {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Get a readable source name from the reward type
   * @param {string} rewardType - Reward type from API
   * @returns {string} Human-readable source name
   */
  getSourceName(rewardType) {
    const sourceMap = {
      'airdrops': 'Airdrop Allocation',
      'validators': 'Validator Rewards',
      'faucets': 'Faucet Claim',
      'liquidity': 'Liquidity Rewards',
      'staking': 'Staking Rewards'
    };
    
    return sourceMap[rewardType] || rewardType.charAt(0).toUpperCase() + rewardType.slice(1);
  }
  
  /**
   * Claim selected rewards for an address
   * @param {string} address - Wallet address to claim for
   * @param {Array} selectedRewards - Array of selected reward objects
   * @returns {Promise<Object>} Claim result
   */
  async claimRewards(address, selectedRewards) {
    if (!this.isInitialized()) throw new Error("RewardsService not initialized");
    
    try {
      // Validate address
      if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
        throw new Error(`Invalid address provided for claiming rewards: ${address}`);
      }
      
      if (!this.provider) {
        throw new Error("Provider not available");
      }
      
      // Normalize address - always convert to lowercase first for consistency
      const normalizedAddress = ethers.utils.getAddress(address.toLowerCase());
      
      // Need a signer to send transactions
      const signer = this.provider.getSigner();
      if (!signer) {
        throw new Error("Signer not available. Make sure wallet is connected.");
      }
      
      console.log(`Claiming rewards for ${normalizedAddress}...`);
      
      // Group rewards by type
      const vaultRewards = selectedRewards.filter(r => r.type === 'vault');
      const bgtStakerRewards = selectedRewards.find(r => r.type === 'bgtStaker');
      
      // Track claim results
      const claimResults = [];
      const claimedRewards = [];
      
      // 1. Claim vault rewards
      if (vaultRewards.length > 0) {
        console.log(`Claiming rewards from ${vaultRewards.length} vaults...`);
        
        // Process each vault
        for (const reward of vaultRewards) {
          try {
            console.log(`Claiming from vault ${reward.name} (${reward.vaultAddress})...`);
            
            // Validate and normalize vault address
            if (!reward.vaultAddress || typeof reward.vaultAddress !== 'string' || !reward.vaultAddress.startsWith('0x')) {
              console.error(`Invalid vault address: ${reward.vaultAddress}`);
              throw new Error(`Invalid vault address format for ${reward.name}`);
            }
            
            // Normalize vault address - always convert to lowercase first for consistency
            const normalizedVaultAddress = ethers.utils.getAddress(reward.vaultAddress.toString().toLowerCase());
            
            // Create contract instance with signer
            const vaultContract = new ethers.Contract(
              normalizedVaultAddress,
              ["function getReward() external"],
              signer
            );
            
            // Execute claim
            const tx = await vaultContract.getReward();
            console.log(`Transaction sent: ${tx.hash}`);
            
            // Wait for confirmation
            console.log("Waiting for transaction confirmation...");
            const receipt = await tx.wait();
            
            if (receipt.status === 1) {
              console.log(`Successfully claimed ${reward.earned} ${reward.rewardToken.symbol} from ${reward.name}`);
              claimedRewards.push(reward);
              claimResults.push({
                type: 'vault',
                name: reward.name,
                success: true,
                amount: reward.earned,
                symbol: reward.rewardToken.symbol,
                txHash: tx.hash
              });
            } else {
              console.error(`Claim transaction failed for ${reward.name}`);
              claimResults.push({
                type: 'vault',
                name: reward.name,
                success: false,
                error: "Transaction failed"
              });
            }
          } catch (error) {
            console.error(`Error claiming from vault ${reward.name}:`, error);
            claimResults.push({
              type: 'vault',
              name: reward.name,
              success: false,
              error: error.message || "Claim failed"
            });
          }
        }
      }
      
      // 2. Claim BGT Staker rewards
      if (bgtStakerRewards) {
        try {
          console.log(`Claiming BGT Staker rewards...`);
          
          // Normalize address - always convert to lowercase first for consistency
          const normalizedBgtStakerAddress = ethers.utils.getAddress(bgtStakerRewards.contractAddress.toLowerCase());
          
          // Create contract instance with signer
          const bgtStaker = new ethers.Contract(
            normalizedBgtStakerAddress,
            ["function getReward() external"],
            signer
          );
          
          // Execute claim
          const tx = await bgtStaker.getReward();
          console.log(`Transaction sent: ${tx.hash}`);
          
          // Wait for confirmation
          console.log("Waiting for transaction confirmation...");
          const receipt = await tx.wait();
          
          if (receipt.status === 1) {
            console.log(`Successfully claimed ${bgtStakerRewards.earned} ${bgtStakerRewards.rewardToken.symbol} from BGT Staker`);
            claimedRewards.push(bgtStakerRewards);
            claimResults.push({
              type: 'bgtStaker',
              name: bgtStakerRewards.name,
              success: true,
              amount: bgtStakerRewards.earned,
              symbol: bgtStakerRewards.rewardToken.symbol,
              txHash: tx.hash
            });
          } else {
            console.error("BGT Staker claim transaction failed");
            claimResults.push({
              type: 'bgtStaker',
              name: bgtStakerRewards.name,
              success: false,
              error: "Transaction failed"
            });
          }
        } catch (error) {
          console.error("Error claiming BGT Staker rewards:", error);
          claimResults.push({
            type: 'bgtStaker',
            name: bgtStakerRewards.name,
            success: false,
            error: error.message || "Claim failed"
          });
        }
      }
      
      // Calculate total claimed value
      const totalClaimed = claimedRewards.reduce((sum, reward) => sum + (reward.valueUsd || 0), 0);
      
      // Remove claimed rewards from the checked rewards
      const claimedIds = new Set(claimedRewards.map(r => r.id));
      this.checkedRewards = this.checkedRewards.filter(r => !claimedIds.has(r.id));
      
      // Summarize results
      console.log(`Claim operations complete. ${claimedRewards.length}/${selectedRewards.length} claims successful.`);
      
      return {
        success: claimedRewards.length > 0,
        claimedRewards: claimedRewards,
        claimResults: claimResults,
        totalClaimed,
        remainingRewards: this.checkedRewards
      };
    } catch (error) {
      console.error("Error claiming rewards:", error);
      
      return {
        success: false,
        error: error.message || "Failed to claim rewards",
        claimedRewards: [],
        remainingRewards: this.checkedRewards
      };
    }
  }
  /**
   * Find validator info by public key
   * @param {string} pubkey - Validator's public key
   * @returns {Object} Validator information
   */
  findValidatorByPubkey(pubkey) {
    if (!pubkey) return { pubkey: "unknown", name: "Unknown Validator" };
    
    // Access the validator map
    if (this.validatorMap && Object.keys(this.validatorMap).length > 0) {
      // Try to find by lowercase key for case-insensitive matching
      const validator = this.validatorMap[pubkey.toLowerCase()];
      if (validator) {
        return validator;
      }
    }
    
    // If not found, create a generic validator object
    return {
      pubkey: pubkey,
      id: pubkey,
      name: `Validator ${pubkey.substring(0, 8)}`
    };
  }
  
  /**
   * Load validators from file
   * @returns {Promise<Array<Object>>} Array of validator objects
   */
  async loadValidatorsFromFile() {
    try {
      // Import and use metadataService to get validator list
      const metadataService = await import('../services/MetadataService').then(module => module.default);
      
      // First try to load from cache
      const validatorsResult = await metadataService.getValidators();
      
      // Extract validators from the result
      if (validatorsResult && validatorsResult.success) {
        if (validatorsResult.validators) {
          // Try different structures based on the format
          if (Array.isArray(validatorsResult.validators.data)) {
            // { validators: { data: [...] } }
            return validatorsResult.validators.data;
          } else if (Array.isArray(validatorsResult.validators)) {
            // { validators: [...] }
            return validatorsResult.validators;
          } else if (validatorsResult.validators.validators && Array.isArray(validatorsResult.validators.validators)) {
            // { validators: { validators: [...] } }
            return validatorsResult.validators.validators;
          }
        }
      }
      
      // If we couldn't load from cache, fetch from source
      console.log("No validators in cache, fetching from source...");
      const freshValidatorsResult = await metadataService.fetchValidators();
      
      if (freshValidatorsResult && freshValidatorsResult.success) {
        if (freshValidatorsResult.validators && Array.isArray(freshValidatorsResult.validators.data)) {
          return freshValidatorsResult.validators.data;
        }
      }
      
      console.warn("No validators found in source data");
      return [];
      
    } catch (error) {
      console.error("Error loading validators:", error);
      return [];
    }
  }

  /**
   * Build validator map for efficient lookups
   * @param {Array<Object>} validators - Array of validator objects
   * @returns {Object} Map of validator pubkeys to validator objects
   */
  buildValidatorMap(validators) {
    const validatorMap = {};
    
    validators.forEach(validator => {
      if (validator.id) {
        // Store with id as key (case-insensitive)
        validatorMap[validator.id.toLowerCase()] = {
          pubkey: validator.id,  // Use id as pubkey
          id: validator.id,
          name: validator.name || `Validator ${validator.id.substring(0, 8)}`
        };
      }
    });
    
    console.log(`Built validator map with ${Object.keys(validatorMap).length} validators`);
    return validatorMap;
  }

  /**
   * Check validator boosts for a user
   * @param {string} address - User wallet address
   * @returns {Promise<Object>} Validator boost information
   */
  async checkValidatorBoosts(address) {
    if (!this.isInitialized()) {
      console.warn("RewardsService not initialized when checking validator boosts");
      return { activeBoosts: [], queuedBoosts: [] };
    }
    
    try {
      console.log(`Checking validator boosts for ${address}...`);
      
      // Validate address
      if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
        console.warn(`Invalid address provided for checking validator boosts: ${address}`);
        return { activeBoosts: [], queuedBoosts: [] };
      }
      
      // Normalize the address
      const normalizedAddress = ethers.utils.getAddress(address.toLowerCase());
      
      // Get contract addresses from config
      const validatorBoostAddress = ethers.utils.getAddress(this.contractAddresses.bgtToken.toLowerCase());
      console.log(`Using validator boost contract at: ${validatorBoostAddress}`);
      
      // Create contract instance for the validator boost contract with the correct ABIs
      const validatorBoostABI = [
        "function boosts(address account) external view returns (uint256)",
        "function boostees(bytes calldata pubkey) external view returns (uint256)",
        "function boosted(address account, bytes calldata pubkey) external view returns (uint256)",
        "function queuedBoost(address account) external view returns (uint256)",
        "function boostedQueue(address account, bytes calldata pubkey) external view returns (uint256)"
      ];
      
      const validatorBoost = new ethers.Contract(
        validatorBoostAddress,
        validatorBoostABI,
        this.provider
      );
      
      // Load validators from file and build map
      let validators = await this.loadValidatorsFromFile();
      
      // Create validator map for efficient lookups if not already cached
      if (!this.validatorMap || Object.keys(this.validatorMap).length === 0) {
        this.validatorMap = this.buildValidatorMap(validators);
      }
      
      // Check total boosts to see if user has any boosts allocated
      let totalBoosts, totalQueuedBoost;
      try {
        totalBoosts = await this.retryPromise(() => validatorBoost.boosts(normalizedAddress), 3);
        totalQueuedBoost = await this.retryPromise(() => validatorBoost.queuedBoost(normalizedAddress), 3);
        
        console.log(`Total active boosts: ${ethers.utils.formatEther(totalBoosts)} BGT`);
        console.log(`Total queued boosts: ${ethers.utils.formatEther(totalQueuedBoost)} BGT`);
      } catch (err) {
        console.error("Error checking total boosts:", err);
        return { 
          activeBoosts: [], 
          queuedBoosts: [],
          error: "Failed to check validator contract. Please try again later."
        };
      }
      
      // Track active and queued boosts
      const activeBoosts = [];
      const queuedBoosts = [];
      
      // Helper function to convert hex string to bytes calldata format
      const hexToBytes = (hexString) => {
        // Ensure the hex string starts with 0x
        const hexWithPrefix = hexString.startsWith('0x') ? hexString : '0x' + hexString;
        try {
          // Convert hex string to byte array as expected by the contract
          return ethers.utils.arrayify(hexWithPrefix);
        } catch (err) {
          console.warn(`Failed to convert hex string to bytes: ${hexString}`, err);
          return null;
        }
      };
      
      // Only check individual validators if user has any boost allocation
      if (!totalBoosts.isZero() || !totalQueuedBoost.isZero()) {
        console.log(`User has boosts: ${ethers.utils.formatEther(totalBoosts)} BGT active and ${ethers.utils.formatEther(totalQueuedBoost)} BGT queued`);
        
        // Get all validators from the map
        const validatorsToCheck = Object.values(this.validatorMap);
        
        // Check all validators like in the CLI version
        console.log(`Checking boosts for all ${validatorsToCheck.length} validators...`);
        
        // Check validators in batches to improve performance
        if (validatorsToCheck.length > 0) {
          // Process in batches of reasonable size to avoid overwhelming the network
          const BATCH_SIZE = 5;
          const totalValidators = validatorsToCheck.length;
          
          for (let i = 0; i < totalValidators; i += BATCH_SIZE) {
            const batch = validatorsToCheck.slice(i, i + BATCH_SIZE);
            const batchEnd = Math.min(i + BATCH_SIZE, totalValidators);
            console.log(`Processing batch ${i+1}-${batchEnd} of ${totalValidators} validators...`);
            
            // Process batch in parallel for better performance
            await Promise.all(batch.map(async (validator) => {
              try {
                const validatorKey = validator.pubkey || validator.id;
                if (!validatorKey) return;
                
                // Convert validator key to bytes
                const validatorBytes = hexToBytes(validatorKey);
                if (!validatorBytes) {
                  console.warn(`Skipping validator ${validator.name} - invalid pubkey format`);
                  return;
                }
                
                // Check for active and queued boosts in parallel
                const [boostAmount, queuedAmount] = await Promise.all([
                  this.retryPromise(() => validatorBoost.boosted(normalizedAddress, validatorBytes), 3),
                  this.retryPromise(() => validatorBoost.boostedQueue(normalizedAddress, validatorBytes), 3)
                ]);
                
                // Process active boost if exists
                if (!boostAmount.isZero()) {
                  console.log(`Found boost for validator ${validator.name}: ${ethers.utils.formatEther(boostAmount)} BGT`);
                  
                  // Get total boost for this validator
                  const totalValidatorBoost = await this.retryPromise(() => 
                    validatorBoost.boostees(validatorBytes), 3
                  );
                  
                  // Calculate share percentage
                  const userBoostAmountFloat = parseFloat(ethers.utils.formatEther(boostAmount));
                  const totalBoostFloat = parseFloat(ethers.utils.formatEther(totalValidatorBoost));
                  const sharePercent = totalBoostFloat > 0 
                    ? ((userBoostAmountFloat / totalBoostFloat) * 100).toFixed(2)
                    : "0.00";
                  
                  activeBoosts.push({
                    pubkey: validatorKey,
                    id: validator.id,
                    name: validator.name,
                    userBoostAmount: ethers.utils.formatEther(boostAmount),
                    totalBoost: ethers.utils.formatEther(totalValidatorBoost),
                    share: sharePercent,
                    status: "active"
                  });
                }
                
                // Process queued boost if exists
                if (!queuedAmount.isZero()) {
                  console.log(`Found queued boost for validator ${validator.name}: ${ethers.utils.formatEther(queuedAmount)} BGT`);
                  
                  queuedBoosts.push({
                    pubkey: validatorKey,
                    id: validator.id,
                    name: validator.name,
                    queuedBoostAmount: ethers.utils.formatEther(queuedAmount),
                    status: "queued"
                  });
                }
              } catch (err) {
                console.warn(`Error checking boost for validator ${validator.name}:`, err);
              }
            }));
            
            // Small delay between batches to prevent rate limiting
            if (i + BATCH_SIZE < totalValidators) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
        }
      }
      
      console.log(`Found ${activeBoosts.length} active validator boosts`);
      console.log(`Found ${queuedBoosts.length} queued validator boosts`);
      
      return {
        activeBoosts,
        queuedBoosts,
        totalActiveBoost: ethers.utils.formatEther(totalBoosts),
        totalQueuedBoost: ethers.utils.formatEther(totalQueuedBoost)
      };
    } catch (error) {
      console.error("Error checking validator boosts:", error);
      return { 
        activeBoosts: [], 
        queuedBoosts: [],
        error: error.message 
      };
    }
  }
}

// Export singleton instance
const rewardsService = new RewardsService();
export default rewardsService;