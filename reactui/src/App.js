import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './App.css';
import CliTokenList from './components/CliTokenList';
import CliRewardsList from './components/CliRewardsList';
import CliValidatorBoosts from './components/CliValidatorBoosts';
import ApiKeyInput from './components/ApiKeyInput';
import MetadataManager from './components/MetadataManager';
import SwapForm from './components/SwapForm';
import ValidatorSelectionOverlay from './components/ValidatorSelectionOverlay';
import ClaimSummaryOverlay from './components/ClaimSummaryOverlay';
import tokenBridge from './services/TokenBridge';
import metadataService from './services/MetadataService';
import rewardsService from './services/RewardsService';

function App() {
  // Wallet connection state
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [showWalletDetails, setShowWalletDetails] = useState(false);
  
  // Token state
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('oogaboogaApiKey') || '');
  const [tokens, setTokens] = useState([]);
  const [totalValueUsd, setTotalValueUsd] = useState('');
  const [totalValueBera, setTotalValueBera] = useState('');
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [tokenError, setTokenError] = useState('');
  
  // Swap state
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [showSwapForm, setShowSwapForm] = useState(false);
  const [beraToken, setBeraToken] = useState(null);
  const [swapStatus, setSwapStatus] = useState({ loading: false, success: false, error: null });
  
  // Rewards state
  const [rewards, setRewards] = useState([]);
  const [selectedRewards, setSelectedRewards] = useState([]);
  const [loadingRewards, setLoadingRewards] = useState(false);
  const [rewardsError, setRewardsError] = useState('');
  const [claimStatus, setClaimStatus] = useState({ loading: false, success: false, error: null });
  
  // Validator boosts state
  const [validatorBoosts, setValidatorBoosts] = useState({ activeBoosts: [], queuedBoosts: [] });
  const [loadingBoosts, setLoadingBoosts] = useState(false);
  const [boostsError, setBoostsError] = useState('');
  
  // Validator selection state
  const [showValidatorSelection, setShowValidatorSelection] = useState(false);
  const [validatorPreferences, setValidatorPreferences] = useState(null);
  const [pendingRewardsForClaim, setPendingRewardsForClaim] = useState([]);
  
  // Claim summary state
  const [showClaimSummary, setShowClaimSummary] = useState(false);
  const [rewardsToProcess, setRewardsToProcess] = useState([]);
  
  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  
  
  // Network details based on Berachain
  const networkDetails = {
    name: 'Berachain (Artio)',
    chainId: '0x2328', // 9000 in decimal
    rpcUrl: 'https://artio.rpc.berachain.com',
    currencySymbol: 'BERA',
    blockExplorerUrl: 'https://artio.beratrail.io'
  };

  // Initialize services when provider and API key are available
  useEffect(() => {
    if (provider && apiKey) {
      // Get signer from provider
      const signer = provider.getSigner();
      
      // Initialize services with provider, signer and API key
      const tokenBridgeInitialized = tokenBridge.initialize(provider, apiKey, signer);
      const rewardsServiceInitialized = rewardsService.initialize(provider, apiKey);
      
      if (!tokenBridgeInitialized) {
        console.error("Failed to initialize token bridge");
      }
      
      if (!rewardsServiceInitialized) {
        console.error("Failed to initialize rewards service");
      }
    }
  }, [provider, apiKey]);

  // Handle API key save
  const handleSaveApiKey = (newApiKey) => {
    localStorage.setItem('oogaboogaApiKey', newApiKey);
    setApiKey(newApiKey);
    
    if (provider) {
      const signer = provider.getSigner();
      tokenBridge.initialize(provider, newApiKey, signer);
      rewardsService.initialize(provider, newApiKey);
    }
  };
  
  // Handle reward selection
  const handleRewardSelect = (selected) => {
    setSelectedRewards(selected);
  };

  // Connect wallet function
  async function connectWallet() {
    setConnecting(true);
    setError('');
    
    try {
      // Check if window.ethereum exists (MetaMask or other injected provider)
      if (!window.ethereum) {
        throw new Error("No Ethereum wallet found. Please install MetaMask or another compatible wallet.");
      }

      const ethersProvider = new ethers.providers.Web3Provider(window.ethereum);
      
      // Request account access
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const selectedAccount = accounts[0];
      
      // Get network information
      const { chainId } = await ethersProvider.getNetwork();
      
      // Get account balance
      const balanceWei = await ethersProvider.getBalance(selectedAccount);
      const balanceEth = ethers.utils.formatEther(balanceWei);
      
      // Set state with collected information
      setProvider(ethersProvider);
      setAccount(selectedAccount);
      setChainId(chainId);
      setBalance(balanceEth);
      
      // Set up listeners for account and chain changes
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

    } catch (err) {
      console.error("Connection error:", err);
      setError(err.message || "Failed to connect to wallet");
    } finally {
      setConnecting(false);
    }
  }

  function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
      // User disconnected their wallet
      disconnectWallet();
    } else {
      // User switched accounts
      setAccount(accounts[0]);
      updateBalance(accounts[0]);
    }
  }

  function handleChainChanged(chainIdHex) {
    // When chain changes, reload the page as recommended by MetaMask
    window.location.reload();
  }

  async function updateBalance(address) {
    if (provider) {
      try {
        const balanceWei = await provider.getBalance(address);
        setBalance(ethers.utils.formatEther(balanceWei));
      } catch (err) {
        console.error("Error updating balance:", err);
      }
    }
  }

  function disconnectWallet() {
    // Clean up listeners
    if (window.ethereum) {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    }
    
    // Reset state
    setProvider(null);
    setAccount('');
    setChainId(null);
    setBalance(null);
    setTokens([]);
    setTotalValueUsd('');
    setTotalValueBera('');
  }

  async function switchToBerachain() {
    if (!window.ethereum) return;

    try {
      // Try to switch to the Berachain network
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkDetails.chainId }],
      });
    } catch (switchError) {
      // If the network is not available, add it
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: networkDetails.chainId,
                chainName: networkDetails.name,
                rpcUrls: [networkDetails.rpcUrl],
                nativeCurrency: {
                  name: networkDetails.currencySymbol,
                  symbol: networkDetails.currencySymbol,
                  decimals: 18
                },
                blockExplorerUrls: [networkDetails.blockExplorerUrl]
              },
            ],
          });
        } catch (addError) {
          console.error("Error adding Berachain:", addError);
          setError("Failed to add Berachain network to your wallet.");
        }
      } else {
        console.error("Error switching to Berachain:", switchError);
        setError("Failed to switch to Berachain network.");
      }
    }
  }

  // Handle token selection from the TokenList component
  const handleTokenSelect = (selected) => {
    setSelectedTokens(selected);
  };

  // Handle swap form close
  const handleCloseSwapForm = () => {
    setShowSwapForm(false);
  };
  
  // Check rewards function
  async function checkRewards() {
    if (!account || !rewardsService.isInitialized()) return;
    
    setLoadingRewards(true);
    setRewardsError('');
    setClaimStatus({ loading: false, success: false, error: null });
    
    try {
      // First check validator boosts so we can include them in the rewards
      await checkValidatorBoosts();
      
      // Call rewards service to check for claimable rewards
      const result = await rewardsService.checkRewards(account);
      
      if (result.success) {
        // Inject validator boost data into BGT Staker rewards
        const processedRewards = result.rewards.map(reward => {
          if (reward.type === 'bgtStaker') {
            return {
              ...reward,
              validatorBoosts: validatorBoosts
            };
          }
          return reward;
        });
        
        setRewards(processedRewards || []);
      } else {
        setRewardsError(result.error || "Failed to check rewards");
      }
    } catch (err) {
      console.error("Error checking rewards:", err);
      setRewardsError(err.message || "Failed to check rewards");
    } finally {
      setLoadingRewards(false);
    }
  }
  
  // Check validator boosts function
  async function checkValidatorBoosts() {
    if (!account || !rewardsService.isInitialized()) return;
    
    setLoadingBoosts(true);
    setBoostsError('');
    
    try {
      // Call rewards service to check for validator boosts
      const boostsResult = await rewardsService.checkValidatorBoosts(account);
      
      if (boostsResult.error) {
        setBoostsError(boostsResult.error || "Failed to check validator boosts");
        return null;
      } else {
        setValidatorBoosts(boostsResult);
        return boostsResult;
      }
    } catch (err) {
      console.error("Error checking validator boosts:", err);
      setBoostsError(err.message || "Failed to check validator boosts");
      return null;
    } finally {
      setLoadingBoosts(false);
    }
  }
  
  // Handle validator preferences submission
  const handleValidatorPreferencesSubmit = (preferences) => {
    // Save preferences to localStorage
    try {
      // Format for localStorage - similar to the CLI format
      const prefsToSave = {
        validators: preferences.validators,
        allocations: preferences.allocations
      };
      
      // Create a boost_allocation-compatible format
      const boostAllocations = {};
      boostAllocations[account.toLowerCase()] = prefsToSave;
      
      // Save to localStorage to mimic the CLI flow
      localStorage.setItem('boost_allocation', JSON.stringify(boostAllocations));
      
      console.log('Saved validator preferences:', preferences);
      setValidatorPreferences(preferences);
      
      // Close validator selection and proceed to claim summary
      setShowValidatorSelection(false);
      setRewardsToProcess(pendingRewardsForClaim);
      setShowClaimSummary(true);
    } catch (err) {
      console.error('Error saving validator preferences:', err);
      setClaimStatus({
        loading: false,
        success: false,
        error: 'Failed to save validator preferences'
      });
    }
  };
  
  // Check for validator preferences
  const checkValidatorPreferences = () => {
    try {
      // Read from localStorage
      const storedPrefs = localStorage.getItem('boost_allocation');
      if (storedPrefs) {
        const allPrefs = JSON.parse(storedPrefs);
        // Get preferences for current account
        if (allPrefs[account.toLowerCase()]) {
          return allPrefs[account.toLowerCase()];
        }
      }
      return null;
    } catch (err) {
      console.warn('Error reading validator preferences:', err);
      return null;
    }
  };
  
  // Proceed with claim after ensuring validator preferences
  const proceedWithClaim = async (selectedRewardsToProcess) => {
    setClaimStatus({
      loading: true,
      success: false,
      error: null
    });
    
    try {
      // Call rewards service to claim rewards
      const result = await rewardsService.claimRewards(account, selectedRewardsToProcess);
      
      if (result.success) {
        setClaimStatus({
          loading: false,
          success: true,
          error: null
        });
        
        // Update the rewards list with remaining unclaimed rewards
        setRewards(result.remainingRewards || []);
        setSelectedRewards([]);
        
        // Clear pending rewards
        setPendingRewardsForClaim([]);
        
        // Update token balances after claiming
        setTimeout(() => {
          loadTokenBalances();
        }, 1000);
      } else {
        setClaimStatus({
          loading: false,
          success: false,
          error: result.error || "Failed to claim rewards"
        });
      }
    } catch (err) {
      console.error("Error claiming rewards:", err);
      setClaimStatus({
        loading: false,
        success: false,
        error: err.message || "Failed to claim rewards"
      });
    }
  };
  
  // Claim rewards function with validator preferences check
  async function claimRewards() {
    if (!account || !rewardsService.isInitialized() || selectedRewards.length === 0) return;
    
    // Check if BGT rewards are being claimed
    const hasBgtRewards = selectedRewards.some(reward => 
      reward.rewardToken && reward.rewardToken.symbol === 'BGT' && 
      parseFloat(reward.earned) > 0
    );
    
    // If claiming BGT rewards, check for validator preferences
    if (hasBgtRewards) {
      // Load existing preferences
      const existingPrefs = checkValidatorPreferences();
      
      if (existingPrefs && existingPrefs.validators && existingPrefs.validators.length > 0) {
        // We have preferences, show claim summary
        setValidatorPreferences(existingPrefs);
        setRewardsToProcess(selectedRewards);
        setShowClaimSummary(true);
      } else {
        // No preferences set, show validator selection overlay
        setPendingRewardsForClaim(selectedRewards);
        setShowValidatorSelection(true);
      }
    } else {
      // No BGT rewards, still show summary but without redelegation
      setRewardsToProcess(selectedRewards);
      setShowClaimSummary(true);
    }
  };

  // Execute token swap
  const handleSwap = async (swapData, totalValueUsd, estimatedOutput, bundleMethod = 'individual', bundleOptions = {}) => {
    if (!account || !provider || swapData.length === 0) return;
    
    setSwapStatus({
      loading: true,
      success: false,
      error: null
    });
    
    try {
      console.log(`[DEBUG] ======= STARTING SWAP EXECUTION =======`);
      console.log(`[DEBUG] Executing swap with method: ${bundleMethod}`);
      console.log("[DEBUG] Swap data:", JSON.stringify(swapData, null, 2));
      console.log("[DEBUG] Total value:", totalValueUsd);
      console.log("[DEBUG] Target token:", bundleOptions.targetToken?.symbol || "BERA");
      console.log("[DEBUG] Estimated output:", estimatedOutput);
      console.log("[DEBUG] User account:", account);
      
      // Start timing
      const startTime = performance.now();
      
      console.log("[DEBUG] Creating swap bundle...");
      // Create a swap bundle using the TokenBridge with the target token
      const bundle = await tokenBridge.createSwapBundle(account, swapData, bundleOptions);
      
      const bundleCreateTime = performance.now();
      console.log(`[DEBUG] Bundle creation completed in ${(bundleCreateTime - startTime).toFixed(2)}ms`);
      
      if (bundle.error) {
        throw new Error(`Failed to create swap bundle: ${bundle.error}`);
      }
      
      console.log("[DEBUG] Created swap bundle:", JSON.stringify(bundle, null, 2));
      console.log(`[DEBUG] Bundle contains ${bundle.approvalTxs.length} approvals and ${bundle.swapTxs.length} swaps`);
      
      let swapResult;
      
      if (bundleMethod === 'berabundler') {
        // Use Berabundler contract
        console.log("[DEBUG] Executing swap through Berabundler contract...");
        swapResult = await tokenBridge.executeSwapBundle(bundle);
        
        const executionTime = performance.now();
        console.log(`[DEBUG] Swap execution completed in ${(executionTime - bundleCreateTime).toFixed(2)}ms`);
      } else {
        // Fallback to individual transaction execution
        console.log("[DEBUG] Executing swap transactions individually...");
        // This would be implemented in a real application
        throw new Error("Individual transaction execution not implemented");
      }
      
      if (!swapResult.success) {
        console.error("[DEBUG] Swap execution failed:", swapResult);
        throw new Error(swapResult.error || "Swap execution failed");
      }
      
      console.log("[DEBUG] Swap successful:", JSON.stringify(swapResult, null, 2));
      console.log(`[DEBUG] Swap transaction hash: ${swapResult.hash}`);
      
      if (swapResult.receipt) {
        console.log("[DEBUG] Transaction receipt:", JSON.stringify(swapResult.receipt, null, 2));
        console.log(`[DEBUG] Gas used: ${swapResult.receipt.gasUsed.toString()}`);
        console.log(`[DEBUG] Block number: ${swapResult.receipt.blockNumber}`);
      }
      
      // Calculate total execution time
      const endTime = performance.now();
      console.log(`[DEBUG] Total swap process completed in ${(endTime - startTime).toFixed(2)}ms`);
      console.log(`[DEBUG] ======= SWAP EXECUTION COMPLETE =======`);
      
      // Update swap status
      setSwapStatus({
        loading: false,
        success: true,
        hash: swapResult.hash,
        error: null
      });
      
      // Clear selected tokens and close form
      setSelectedTokens([]);
      setShowSwapForm(false);
      
      // Refresh token balances after swap
      setTimeout(() => {
        loadTokenBalances();
      }, 2000);
      
    } catch (err) {
      console.error("[DEBUG] Swap error:", err);
      console.error("[DEBUG] Error stack:", err.stack);
      console.log(`[DEBUG] ======= SWAP EXECUTION FAILED =======`);
      
      setSwapStatus({
        loading: false,
        success: false,
        error: err.message || "Failed to execute swap"
      });
    }
  };
  
  // Load token balances from the wallet using GitHub and OogaBooga metadata
  async function loadTokenBalances() {
    if (!account || !tokenBridge.isInitialized()) return;
    
    setLoadingTokens(true);
    setTokenError('');
    setSelectedTokens([]);
    setShowSwapForm(false);
    
    try {
      // Get the GitHub or OogaBooga tokens
      let tokenList = [];
      let tokensMap = {};
      
      // First try to get the OogaBooga tokens (preferred, as they have more data)
      const oogaboogaTokensResult = await metadataService.getOogaBoogaTokens();
      
      if (oogaboogaTokensResult.success && oogaboogaTokensResult.tokens && oogaboogaTokensResult.tokens.data) {
        tokensMap = oogaboogaTokensResult.tokens.data;
        console.log(`Using OogaBooga tokens (${Object.keys(tokensMap).length} tokens)`);
      } else {
        // Fallback to GitHub tokens
        const githubTokensResult = await metadataService.getGitHubTokens();
        
        if (githubTokensResult.success && githubTokensResult.tokens && githubTokensResult.tokens.data) {
          // Convert GitHub token array to map for easier lookup
          const githubTokens = githubTokensResult.tokens.data;
          githubTokens.forEach(token => {
            tokensMap[token.address.toLowerCase()] = token;
          });
          console.log(`Using GitHub tokens (${Object.keys(tokensMap).length} tokens)`);
        } else {
          console.log('No tokens available from GitHub or OogaBooga');
          setTokenError("Failed to load token data. Please update metadata.");
          setLoadingTokens(false);
          return;
        }
      }
      
      // Get native BERA balance
      const beraBalance = await provider.getBalance(account);
      const formattedBeraBalance = ethers.utils.formatEther(beraBalance);
      
      // Convert to array and filter out native tokens (we'll add them separately)
      const tokensList = Object.values(tokensMap).filter(token => 
        token.address !== "0x0000000000000000000000000000000000000000" && 
        token.symbol !== "BERA"
      );
      
      // Process tokens in batches to prevent too many concurrent requests
      const batch = 15;
      const tokens = [];
      
      // Show incremental progress
      let processedCount = 0;
      const totalCount = tokensList.length;
      
      for (let i = 0; i < tokensList.length; i += batch) {
        const batchTokens = tokensList.slice(i, i + batch);
        
        // Get balances for each token in parallel
        const batchResults = await Promise.all(batchTokens.map(async token => {
          try {
            // Create an ERC20 contract interface for the token
            const tokenContract = new ethers.Contract(
              token.address,
              ["function balanceOf(address) view returns (uint256)"],
              provider
            );
            
            // Get the raw balance
            const rawBalance = await tokenContract.balanceOf(account);
            const balance = ethers.utils.formatUnits(rawBalance, token.decimals || 18);
            
            // Track progress
            processedCount++;
            
            // Only return tokens with non-zero balance
            if (parseFloat(balance) > 0) {
              return {
                ...token,
                balance,
                formattedBalance: parseFloat(balance).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 6
                }),
                priceUsd: null,
                valueUsd: 0,
                formattedValueUsd: "$0.00"
              };
            }
            return null;
          } catch (error) {
            processedCount++;
            console.error(`Error checking balance for ${token.symbol || token.address}:`, error);
            return null;
          }
        }));
        
        // Filter out null values (tokens with zero balance)
        tokens.push(...batchResults.filter(t => t !== null));
      }
      
      // Now fetch prices only for tokens with balance
      for (const token of tokens) {
        try {
          const price = await tokenBridge.getTokenPrice(token.address);
          if (price !== null) {
            token.priceUsd = price;
            token.valueUsd = parseFloat(token.balance) * price;
            token.formattedValueUsd = token.valueUsd.toLocaleString(undefined, {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });
          }
        } catch (priceError) {
          console.error(`Error fetching price for ${token.symbol}:`, priceError);
          // Continue with other tokens
        }
      }
      
      // Get BERA price
      let beraPrice = null;
      try {
        beraPrice = await tokenBridge.getTokenPrice('BERA');
      } catch (priceError) {
        console.error("Error fetching BERA price:", priceError);
      }
      
      const beraValueUsd = beraPrice ? parseFloat(formattedBeraBalance) * beraPrice : 0;
      
      // Create BERA token object
      const beraTokenObj = {
        name: 'BERA',
        symbol: 'BERA',
        address: 'native',
        decimals: 18,
        balance: formattedBeraBalance,
        formattedBalance: parseFloat(formattedBeraBalance).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 6
        }),
        priceUsd: beraPrice,
        valueUsd: beraValueUsd,
        formattedValueUsd: beraValueUsd.toLocaleString(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }),
        isNative: true
      };
      
      // Add BERA to token list at the beginning
      tokens.unshift(beraTokenObj);
      
      // Set BERA token for swap calculations
      setBeraToken(beraTokenObj);
      
      // Calculate total value in USD and BERA
      const totalValueUsd = tokens.reduce((sum, token) => sum + (token.valueUsd || 0), 0);
      const totalValueBera = beraPrice ? totalValueUsd / beraPrice : 0;
      
      // Update state
      setTokens(tokens);
      setTotalValueUsd(totalValueUsd.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }));
      setTotalValueBera(`${totalValueBera.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
      })} BERA`);
      
    } catch (err) {
      console.error("Error loading token balances:", err);
      setTokenError(err.message || "Failed to load token balances");
    } finally {
      setLoadingTokens(false);
    }
  }

  // Toggle wallet details tooltip
  const toggleWalletDetails = () => {
    setShowWalletDetails(!showWalletDetails);
  };
  
  // Toggle settings panel
  const toggleSettings = () => {
    setShowSettings(!showSettings);
  };
  

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-logo">
          <h1>BERABUNDLE</h1>
        </div>
        
        <div className="header-actions">
          {account && (
            <>
              <button 
                className="settings-button" 
                onClick={toggleSettings}
                title="Settings"
              >
                ⚙️
              </button>
            </>
          )}
          
          {!account ? (
            <button 
              className={`wallet-connect-button ${connecting ? 'connecting' : ''}`}
              onClick={connectWallet} 
              disabled={connecting}
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          ) : (
            <button 
              className="wallet-connect-button connected"
              onClick={toggleWalletDetails}
            >
              <span className="wallet-address">
                {`${account.substring(0, 6)}...${account.substring(account.length - 4)}`}
              </span>
              {showWalletDetails ? "▲" : "▼"}
            </button>
          )}
        </div>
        
        {/* Wallet Details Tooltip */}
        {account && showWalletDetails && (
          <div className="stats-tooltip">
            <div className="stat-row">
              <span className="stat-label">Network:</span>
              <span className="stat-value">
                {chainId === 9000 ? "Berachain Artio" : `Chain ID: ${chainId}`}
              </span>
            </div>
            
            <div className="stat-row">
              <span className="stat-label">Address:</span>
              <span className="stat-value">
                {`${account.substring(0, 6)}...${account.substring(account.length - 4)}`}
              </span>
            </div>
            
            <div className="stat-row">
              <span className="stat-label">Balance:</span>
              <span className="stat-value">
                {balance ? `${parseFloat(balance).toFixed(4)} ${networkDetails.currencySymbol}` : "Loading..."}
              </span>
            </div>
            
            {chainId !== 9000 && (
              <button 
                onClick={switchToBerachain}
                style={{ width: '100%', marginTop: '10px', fontSize: '12px' }}
              >
                Switch to Berachain
              </button>
            )}
            
            <button 
              onClick={disconnectWallet} 
              style={{ width: '100%', marginTop: '10px', fontSize: '12px' }}
            >
              Disconnect
            </button>
          </div>
        )}
      </header>

      <div className="main-content">
        <div className="content-wrapper">
          {!account ? (
            <div className="welcome-message">
              <h2>Welcome to BeraBundle</h2>
              <p>Connect your wallet to get started with token swaps and claims</p>
            </div>
          ) : (
            <>
              <div className="cli-mode-layout">
                {/* CLI Action Commands */}
                <div className="cli-main-terminal">
                  <div className="cli-main-header">
                    <span className="cli-prompt">berabundle$</span> help
                  </div>
                  <div className="cli-main-content">
                    <div className="cli-command-row">
                      <span className="cli-prompt">berabundle$</span> token-list
                      <span 
                        className={`cli-main-command ${loadingTokens ? 'loading' : ''}`} 
                        onClick={loadingTokens || !apiKey ? null : loadTokenBalances}
                        title="Check token balances"
                      >
                        --check-balances
                      </span>
                    </div>
                    
                    <div className="cli-command-row">
                      <span className="cli-prompt">berabundle$</span> rewards
                      <span 
                        className={`cli-main-command ${loadingRewards ? 'loading' : ''}`} 
                        onClick={loadingRewards || !apiKey ? null : checkRewards}
                        title="Check claimable rewards"
                      >
                        --check-claimable
                      </span>
                    </div>
                    
                    {selectedTokens.length > 0 && (
                      <div className="cli-command-row">
                        <span className="cli-prompt">berabundle$</span> swap
                        <span 
                          className="cli-main-command swap" 
                          onClick={() => setShowSwapForm(true)}
                          title="Swap selected tokens"
                        >
                          --tokens {selectedTokens.length}
                        </span>
                      </div>
                    )}
                    
                    {selectedRewards.length > 0 && (
                      <div className="cli-command-row">
                        <span className="cli-prompt">berabundle$</span> claim
                        <span 
                          className={`cli-main-command claim ${claimStatus.loading ? 'loading' : ''}`} 
                          onClick={claimStatus.loading ? null : claimRewards}
                          title="Claim selected rewards"
                        >
                          --rewards {selectedRewards.length}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* CLI Terminals */}
                <div className="cli-terminal-layout">
                  <div className="cli-terminal-container">
                    <CliTokenList 
                      tokens={tokens}
                      totalValueUsd={totalValueUsd}
                      totalValueNative={totalValueBera}
                      loading={loadingTokens}
                      error={tokenError}
                      selectable={true}
                      onTokenSelect={handleTokenSelect}
                    />
                  </div>
                  
                  <div className="cli-terminal-container cli-rewards-column">
                    <CliRewardsList 
                      rewards={rewards}
                      loading={loadingRewards}
                      error={rewardsError}
                      onClaimSelected={handleRewardSelect}
                    />
                    
                    <div style={{ marginTop: '15px' }}>
                      <CliValidatorBoosts 
                        validatorBoosts={validatorBoosts}
                        loading={loadingBoosts}
                        error={boostsError}
                      />
                    </div>
                  </div>
                </div>
                
                {/* Status Messages */}
                <div className="cli-status-messages">
                  {swapStatus.loading && (
                    <div className="cli-status loading">
                      Processing swap... Please wait.
                    </div>
                  )}
                  
                  {swapStatus.success && (
                    <div className="cli-status success">
                      Swap completed successfully!
                    </div>
                  )}
                  
                  {swapStatus.error && (
                    <div className="cli-status error">
                      Error: {swapStatus.error}
                    </div>
                  )}
                  
                  {claimStatus.loading && (
                    <div className="cli-status loading">
                      Processing claim... Please wait.
                    </div>
                  )}
                  
                  {claimStatus.success && (
                    <div className="cli-status success">
                      Rewards claimed successfully!
                    </div>
                  )}
                  
                  {claimStatus.error && (
                    <div className="cli-status error">
                      Error: {claimStatus.error}
                    </div>
                  )}
                </div>
              </div>
              
              {error && <p style={{ color: "red" }}>{error}</p>}
            </>
          )}
        </div>
      </div>
      
      {/* Swap Form (modal) */}
      {showSwapForm && (
        <div className="swap-form-overlay">
          <SwapForm 
            selectedTokens={selectedTokens}
            beraToken={beraToken}
            onClose={handleCloseSwapForm}
            onSwap={handleSwap}
          />
        </div>
      )}
      
      {/* Validator Selection Overlay */}
      <ValidatorSelectionOverlay
        isOpen={showValidatorSelection}
        onClose={() => {
          setShowValidatorSelection(false);
          setPendingRewardsForClaim([]);
          setClaimStatus({
            loading: false,
            success: false,
            error: 'Validator selection cancelled'
          });
        }}
        userAddress={account}
        onSubmit={handleValidatorPreferencesSubmit}
        existingPreferences={validatorPreferences}
      />
      
      {/* Claim Summary Overlay */}
      <ClaimSummaryOverlay
        isOpen={showClaimSummary}
        onClose={(action) => {
          setShowClaimSummary(false);
          
          if (action === 'editValidators') {
            // Show validator selection overlay with existing preferences
            setPendingRewardsForClaim(rewardsToProcess);
            setShowValidatorSelection(true);
          } else {
            // Just close the overlay
            setRewardsToProcess([]);
          }
        }}
        selectedRewards={rewardsToProcess}
        validatorPreferences={validatorPreferences}
        onProceed={() => {
          setShowClaimSummary(false);
          proceedWithClaim(rewardsToProcess);
        }}
      />
      
      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-overlay">
          <div className="settings-panel">
            <div className="settings-header">
              <h2>Settings</h2>
              <button className="close-button" onClick={toggleSettings}>&times;</button>
            </div>
            
            <div className="settings-content">
              {/* API Key Section */}
              <div className="settings-section">
                <h3>API Key</h3>
                <div className="settings-section-content">
                  <ApiKeyInput 
                    onSave={handleSaveApiKey}
                    savedKey={apiKey}
                  />
                </div>
              </div>
              
              {/* Metadata Section */}
              <div className="settings-section">
                <h3>Metadata Management</h3>
                <div className="settings-section-content">
                  <MetadataManager />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;