import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './App.css';
import TokenList from './components/TokenList';
import ApiKeyInput from './components/ApiKeyInput';
import MetadataManager from './components/MetadataManager';
import SwapForm from './components/SwapForm';
import tokenBridge from './services/TokenBridge';
import metadataService from './services/MetadataService';

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

  // Initialize token bridge when provider and API key are available
  useEffect(() => {
    if (provider && apiKey) {
      const initialized = tokenBridge.initialize(provider, apiKey);
      if (!initialized) {
        console.error("Failed to initialize token bridge");
      }
    }
  }, [provider, apiKey]);

  // Handle API key save
  const handleSaveApiKey = (newApiKey) => {
    localStorage.setItem('oogaboogaApiKey', newApiKey);
    setApiKey(newApiKey);
    
    if (provider) {
      tokenBridge.initialize(provider, newApiKey);
    }
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

  // Execute token swap
  const handleSwap = async (swapData, totalValueUsd, estimatedBera) => {
    if (!account || !provider || swapData.length === 0) return;
    
    setSwapStatus({
      loading: true,
      success: false,
      error: null
    });
    
    try {
      // In a real implementation, this would connect to the berabundle swap function
      // For now, we'll just simulate a successful swap
      console.log("Swap data:", swapData);
      console.log("Total value:", totalValueUsd);
      console.log("Estimated BERA:", estimatedBera);
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update swap status
      setSwapStatus({
        loading: false,
        success: true,
        error: null
      });
      
      // Clear selected tokens and close form
      setSelectedTokens([]);
      setShowSwapForm(false);
      
      // Refresh token balances after swap
      setTimeout(() => {
        loadTokenBalances();
      }, 1000);
      
    } catch (err) {
      console.error("Swap error:", err);
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
            <button 
              className="settings-button" 
              onClick={toggleSettings}
              title="Settings"
            >
              ⚙️
            </button>
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
              {/* Token Balance Check Button */}
              <div className="token-check-section">
                <button 
                  onClick={loadTokenBalances} 
                  disabled={loadingTokens || !apiKey}
                  className="token-check-button"
                >
                  {loadingTokens ? "Loading Tokens..." : "Check Token Balances"}
                </button>
              </div>
              
              {/* Token List */}
              {(tokens.length > 0 || loadingTokens || tokenError) && (
                <div className="token-list-section">
                  <TokenList 
                    tokens={tokens}
                    totalValueUsd={totalValueUsd}
                    totalValueNative={totalValueBera}
                    loading={loadingTokens}
                    error={tokenError}
                    selectable={true}
                    onTokenSelect={handleTokenSelect}
                  />
                  
                  {/* Swap button below the token list if tokens are selected */}
                  {selectedTokens.length > 0 && (
                    <div className="swap-button-container">
                      <button 
                        className="action-button" 
                        onClick={() => setShowSwapForm(true)}
                      >
                        Swap {selectedTokens.length} Token{selectedTokens.length !== 1 ? 's' : ''}
                      </button>
                    </div>
                  )}
                </div>
              )}
              
              {/* Swap Status Messages */}
              {swapStatus.loading && (
                <div className="swap-status loading">
                  <div className="loading-spinner"></div>
                  <p>Processing swap...</p>
                </div>
              )}
              
              {swapStatus.success && (
                <div className="swap-status success">
                  <p>Swap completed successfully!</p>
                </div>
              )}
              
              {swapStatus.error && (
                <div className="swap-status error">
                  <p>Swap failed: {swapStatus.error}</p>
                </div>
              )}
            </>
          )}
          
          {error && <p style={{ color: "red" }}>{error}</p>}
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