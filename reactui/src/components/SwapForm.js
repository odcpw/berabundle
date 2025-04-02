import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './SwapForm.css';
import tokenBridge from '../services/TokenBridge';
import metadataService from '../services/MetadataService';

/**
 * Component for creating token swap transactions
 * 
 * @param {Object} props Component props
 * @param {Array} props.selectedTokens Array of selected tokens to swap
 * @param {Object} props.beraToken BERA token data
 * @param {Function} props.onClose Callback to close the swap form
 * @param {Function} props.onSwap Callback to execute the swap
 */
function SwapForm({ selectedTokens, beraToken, onClose, onSwap }) {
  const [swapAmounts, setSwapAmounts] = useState({});
  const [totalValueUsd, setTotalValueUsd] = useState(0);
  const [estimatedOutput, setEstimatedOutput] = useState(0);
  const [targetToken, setTargetToken] = useState({ address: '0x0000000000000000000000000000000000000000', symbol: 'BERA', decimals: 18 });
  const [availableTokens, setAvailableTokens] = useState([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [error, setError] = useState('');
  const [approvalStatus, setApprovalStatus] = useState({});

  // Initialize swap amounts with MAX by default
  useEffect(() => {
    if (selectedTokens && selectedTokens.length > 0) {
      const initialAmounts = {};
      
      // Set all tokens to MAX by default (include BERA)
      selectedTokens.forEach(token => {
        const amount = token.balance;
        const numericAmount = parseFloat(amount);
        const valueUsd = token.priceUsd ? numericAmount * token.priceUsd : 0;
        
        initialAmounts[token.address] = {
          rawInput: amount,
          amount: numericAmount,
          valueUsd,
          isValid: true
        };
      });
      
      setSwapAmounts(initialAmounts);
      
      // Only check approvals for non-native tokens
      const nonNativeTokens = selectedTokens.filter(token => 
        !(token.isNative || token.address === 'native' || token.symbol === 'BERA')
      );
      
      // Check approval status for each token
      checkTokenApprovals(nonNativeTokens);
    }
  }, [selectedTokens]);
  
  // Check if tokens are approved for the bundler contract
  const checkTokenApprovals = async (tokensToCheck) => {
    if (!tokenBridge.isInitialized() || !window.ethereum) return;
    
    try {
      // Get current account
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accounts || accounts.length === 0) return;
      
      const address = accounts[0];
      const updatedApprovalStatus = {...approvalStatus}; // Start with current status
      
      // Check each token's approval status
      for (const token of tokensToCheck) {
        if (token.isNative || token.address === 'native' || token.symbol === 'BERA') continue;
        
        // Skip if already approved and not rechecking
        if (updatedApprovalStatus[token.address]?.isApproved && 
            !updatedApprovalStatus[token.address]?.checking) {
          continue;
        }
        
        try {
          // Set checking status first
          updatedApprovalStatus[token.address] = {
            ...(updatedApprovalStatus[token.address] || {}),
            checking: true
          };
          
          // Update UI immediately to show checking
          setApprovalStatus({...updatedApprovalStatus});
          
          // Convert amount to wei
          const amount = swapAmounts[token.address]?.amount || token.balance;
          const amountWei = ethers.utils.parseUnits(
            amount.toString(),
            token.decimals || 18
          );
          
          // Check if token is approved
          const isApproved = await tokenBridge.checkBundlerApproval(
            token.address,
            address,
            amountWei
          );
          
          // Update this token's status
          updatedApprovalStatus[token.address] = {
            ...(updatedApprovalStatus[token.address] || {}),
            isApproved,
            checking: false
          };
        } catch (error) {
          console.error(`Error checking approval for ${token.symbol}:`, error);
          updatedApprovalStatus[token.address] = {
            ...(updatedApprovalStatus[token.address] || {}),
            isApproved: false,
            checking: false,
            error: error.message
          };
        }
      }
      
      // Update state once with all changes
      setApprovalStatus(updatedApprovalStatus);
    } catch (error) {
      console.error("Error checking token approvals:", error);
    }
  };

  // Load available tokens from OogaBooga API
  useEffect(() => {
    async function loadAvailableTokens() {
      setIsLoadingTokens(true);
      try {
        const result = await metadataService.getOogaBoogaTokens();
        if (result.success && result.tokens) {
          // Convert token map to array
          const tokenArray = Object.values(result.tokens.data);
          
          // Sort tokens by symbol
          const sortedTokens = [...tokenArray].sort((a, b) => a.symbol.localeCompare(b.symbol));
          
          setAvailableTokens(sortedTokens);
          
          // Pre-select BERA as target token by default
          const beraToken = sortedTokens.find(token => 
            token.symbol === 'BERA' || 
            token.address === '0x0000000000000000000000000000000000000000'
          );
          
          if (beraToken) {
            setTargetToken(beraToken);
          }
        } else {
          console.error("Failed to load tokens:", result.error);
        }
      } catch (error) {
        console.error("Error loading tokens:", error);
      } finally {
        setIsLoadingTokens(false);
      }
    }
    
    loadAvailableTokens();
  }, []);

  // Update total values when amounts change
  useEffect(() => {
    let total = 0;
    let valid = false;

    // Calculate total value
    Object.values(swapAmounts).forEach(tokenData => {
      total += tokenData.valueUsd || 0;
      if (tokenData.isValid) valid = true;
    });

    // Calculate estimated output based on target token
    let estimatedOutput = 0;
    if (targetToken && targetToken.priceUsd && total > 0) {
      estimatedOutput = total / targetToken.priceUsd;
    } else if (targetToken && targetToken.symbol === 'BERA' && beraToken && beraToken.priceUsd && total > 0) {
      // Fallback to using beraToken price if available
      estimatedOutput = total / beraToken.priceUsd;
    }

    setTotalValueUsd(total);
    setEstimatedOutput(estimatedOutput);
    setIsValid(valid);
  }, [swapAmounts, targetToken, beraToken]);

  // Handle amount change for a token
  const handleAmountChange = (token, value) => {
    // Store raw input value for display
    const inputValue = value.trim();
    
    // Parse numeric value for calculations
    const numericAmount = parseFloat(inputValue);
    
    // Validate amount
    const isValid = 
      inputValue !== '' && 
      !isNaN(numericAmount) && 
      numericAmount > 0 && 
      numericAmount <= parseFloat(token.balance);
    
    // Calculate value in USD
    const valueUsd = isValid && token.priceUsd 
      ? numericAmount * token.priceUsd 
      : 0;
    
    // Update state
    setSwapAmounts(prev => ({
      ...prev,
      [token.address]: {
        rawInput: inputValue,      // Store raw input value
        amount: isValid ? numericAmount : 0, // Store numeric amount
        valueUsd,
        isValid
      }
    }));

    // Clear error if any input is valid
    if (isValid) {
      setError('');
    }
    
    // Re-check approval if amount significantly changed (avoid constant rechecking)
    if (isValid) {
      // Get previous amount
      const prevAmount = parseFloat(approvalStatus[token.address]?.lastCheckedAmount || '0');
      const amountChange = Math.abs(numericAmount - prevAmount);
      
      // Only recheck if amount changed significantly (20% or more)
      const threshold = Math.max(prevAmount * 0.2, 0.01); // 20% or at least 0.01
      
      if (amountChange > threshold || !approvalStatus[token.address]?.lastCheckedAmount) {
        console.log(`Amount changed significantly for ${token.symbol}: ${prevAmount} -> ${numericAmount}`);
        
        // Update with checking status and remember the amount we're checking
        setApprovalStatus(prev => ({
          ...prev,
          [token.address]: {
            ...(prev[token.address] || {}),
            checking: true,
            lastCheckedAmount: numericAmount.toString()
          }
        }));
        
        // Only check this single token
        setTimeout(() => checkTokenApprovals([token]), 100);
      }
    }
  };
  
  // Approve a token to the bundler
  const handleApproveToken = async (token) => {
    try {
      // Get the current amount to store with approval
      const currentAmount = swapAmounts[token.address]?.amount || token.balance;
      
      // Update approval status to show loading
      setApprovalStatus(prev => ({
        ...prev,
        [token.address]: {
          ...prev[token.address],
          checking: true,
          approving: true,
          error: null
        }
      }));
      
      // Send approval transaction
      const result = await tokenBridge.approveTokenToBundler(token.address);
      
      if (result.success) {
        console.log(`Successfully approved ${token.symbol} to bundler, tx: ${result.hash}`);
        
        // Update approval status with successful approval
        setApprovalStatus(prev => ({
          ...prev,
          [token.address]: {
            isApproved: true,
            checking: false,
            approving: false,
            lastCheckedAmount: currentAmount.toString(),
            hash: result.hash,
            error: null
          }
        }));
      } else {
        console.error(`Failed to approve ${token.symbol}: ${result.error}`);
        
        // Update approval status with error
        setApprovalStatus(prev => ({
          ...prev,
          [token.address]: {
            ...(prev[token.address] || {}),
            isApproved: false,
            checking: false,
            approving: false,
            error: result.error
          }
        }));
      }
    } catch (error) {
      console.error(`Error approving ${token.symbol}:`, error);
      setApprovalStatus(prev => ({
        ...prev,
        [token.address]: {
          ...(prev[token.address] || {}),
          isApproved: false,
          checking: false,
          approving: false,
          error: error.message
        }
      }));
    }
  };

  // Handle percentage selection
  const handlePercentClick = (token, percentage) => {
    if (percentage === 0) {
      handleAmountChange(token, '0');
      return;
    }
    
    const amount = (parseFloat(token.balance) * (percentage / 100)).toFixed(2);
    handleAmountChange(token, amount);
  };

  // Get token price for the selected target token
  const getTargetTokenPrice = async (token) => {
    if (!token || !token.address) return null;
    
    try {
      const price = await tokenBridge.getTokenPrice(token.address);
      console.log(`[DEBUG] Price for ${token.symbol}: ${price}`);
      return price;
    } catch (error) {
      console.error(`[DEBUG] Error getting price for ${token.symbol}:`, error);
      return null;
    }
  };
  
  // Handle target token change
  const handleTargetTokenChange = async (event) => {
    const tokenAddress = event.target.value;
    const selected = availableTokens.find(token => token.address === tokenAddress);
    
    if (selected) {
      console.log("[DEBUG] Selected target token:", selected);
      
      // Update the target token state
      setTargetToken(prev => ({ ...selected }));
      
      // Get price for the new target token if not available
      if (!selected.priceUsd) {
        const price = await getTargetTokenPrice(selected);
        if (price) {
          setTargetToken(prev => ({ ...prev, priceUsd: price }));
        }
      }
      
      // Recalculate estimated output based on new target token price
      const total = Object.values(swapAmounts).reduce((sum, tokenData) => sum + (tokenData.valueUsd || 0), 0);
      
      let newEstimatedOutput = 0;
      if (selected.priceUsd && total > 0) {
        newEstimatedOutput = total / selected.priceUsd;
        setEstimatedOutput(newEstimatedOutput);
      } else if (beraToken && beraToken.priceUsd && total > 0 && selected.symbol === 'BERA') {
        // Fallback to beraToken price for BERA
        newEstimatedOutput = total / beraToken.priceUsd;
        setEstimatedOutput(newEstimatedOutput);
      }
      
      // For any token with valid amount, regenerate swap data through API
      const validTokens = Object.entries(swapAmounts)
        .filter(([address, data]) => data.isValid)
        .map(([address]) => selectedTokens.find(t => t.address === address))
        .filter(token => token);
      
      if (validTokens.length > 0) {
        console.log("[DEBUG] Valid tokens for recalculating swap data:", validTokens);
        // We have valid tokens, we should recalculate swap data, but we'll do this at execution time
        // to avoid making too many API calls
      }
    }
  };
  
  // Handle swap button click
  const handleSwap = () => {
    if (!isValid) {
      setError('Please enter valid amounts for at least one token');
      return;
    }
    
    // Check if all tokens are approved
    const validTokenAddresses = selectedTokens
      .filter(token => 
        !(token.isNative || token.address === 'native' || token.symbol === 'BERA') &&
        swapAmounts[token.address]?.isValid
      )
      .map(token => token.address);
    
    // Check for any tokens that need approval
    const needsApproval = validTokenAddresses.some(address => 
      !approvalStatus[address]?.isApproved && swapAmounts[address]?.isValid
    );
    
    if (needsApproval) {
      setError('Some tokens need approval before swapping. Please approve them first.');
      return;
    }

    // Create swap data based on the form inputs
    const swapData = selectedTokens
      .filter(token => swapAmounts[token.address]?.isValid)
      .map(token => ({
        ...token, // Include all token data
        amount: swapAmounts[token.address].amount.toString(),
        valueUsd: swapAmounts[token.address].valueUsd
      }));

    // Create bundle options that include the target token
    // The API will generate fresh transaction data upon execution
    const bundleOptions = {
      targetToken: targetToken,
      regenerateOnExecute: true // Flag to ensure fresh quotes for the current target token
    };

    console.log(`[DEBUG] Executing swap with target token: ${targetToken.symbol} (${targetToken.address})`);
    console.log(`[DEBUG] Selected amount(s): ${swapData.map(token => `${token.amount} ${token.symbol}`).join(', ')}`);
    console.log(`[DEBUG] Estimated output: ${estimatedOutput.toFixed(6)} ${targetToken.symbol}`);

    // Set bundleMethod to use Berabundler contract
    onSwap(swapData, totalValueUsd, estimatedOutput, 'berabundler', bundleOptions);
  };

  // Show all tokens, including BERA
  const validTokens = selectedTokens;
  
  // If no valid tokens are selected
  if (!validTokens || validTokens.length === 0) {
    return (
      <div className="cli-overlay-terminal">
        <div className="cli-overlay-header">
          <div className="cli-overlay-title">
            <span className="cli-prompt">berabundle$</span> <span className="cli-overlay-command">swap --tokens 0</span>
          </div>
          <button className="cli-overlay-close" onClick={onClose}>&times;</button>
        </div>
        <div className="cli-overlay-content">
          <p className="cli-error">Error: No tokens selected for swap. Please select at least one token.</p>
          <div className="cli-command-row" style={{marginTop: '20px'}}>
            <span className="cli-prompt">berabundle$</span> 
            <button className="cli-btn" onClick={onClose}>exit</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cli-overlay-terminal">
      <div className="cli-overlay-header">
        <div className="cli-overlay-title">
          <span className="cli-prompt">berabundle$</span> <span className="cli-overlay-command">swap --tokens {validTokens.length}</span>
        </div>
        <button className="cli-overlay-close" onClick={onClose}>&times;</button>
      </div>

      <div className="cli-overlay-content">
        <div className="swap-instruction" style={{ marginBottom: '12px', color: '#aaa' }}>
          # Enter amount for each token you want to swap
        </div>

        <div className="cli-table">
          {/* Table header row to match main interface */}
          <div className="cli-row header-row" style={{ color: '#888', fontSize: '0.85rem', borderBottom: '1px solid #333', padding: '4px 12px', marginBottom: '8px' }}>
            <div className="cli-cell token-symbol" style={{ width: '20%' }}>TOKEN</div>
            <div className="cli-cell token-balance" style={{ width: '45%', textAlign: 'center' }}>AMOUNT</div>
            <div className="cli-cell token-value" style={{ width: '15%' }}>VALUE</div>
            <div className="cli-cell token-approval" style={{ width: '20%', textAlign: 'center' }}>APPROVED</div>
          </div>
          
          {validTokens.map(token => (
            <div 
              key={token.address} 
              className={`cli-row ${swapAmounts[token.address]?.isValid ? 'selected' : ''}`}
            >
              <div className="cli-cell token-symbol">
                {token.symbol}
              </div>
              
              <div className="cli-cell token-balance">
                <input
                  type="text"
                  value={swapAmounts[token.address]?.rawInput || ''}
                  onChange={(e) => handleAmountChange(token, e.target.value)}
                  className={`cli-amount-input ${swapAmounts[token.address]?.isValid ? 'valid' : ''}`}
                />
                <div style={{ display: 'inline-flex', whiteSpace: 'nowrap' }}>
                  <span 
                    className="cli-command-option" 
                    onClick={() => handlePercentClick(token, 100)}
                  >
                    --max
                  </span>
                  <span 
                    className="cli-command-option" 
                    onClick={() => handlePercentClick(token, 0)}
                  >
                    --none
                  </span>
                </div>
              </div>
              
              <div className="cli-cell token-value">
                {swapAmounts[token.address]?.isValid && swapAmounts[token.address]?.valueUsd > 0 
                  ? `$${swapAmounts[token.address].valueUsd.toFixed(2)}`
                  : '-'
                }
              </div>
              
              <div className="cli-cell token-approval">
                {approvalStatus[token.address] ? (
                  <>
                    {approvalStatus[token.address].checking ? (
                      <span style={{ color: '#888' }}>checking...</span>
                    ) : approvalStatus[token.address].approving ? (
                      <span style={{ color: '#888' }}>approving...</span>
                    ) : approvalStatus[token.address].isApproved ? (
                      <span style={{ color: '#55bb55' }}>✓ yes</span>
                    ) : (
                      <button 
                        className="cli-approve-btn"
                        onClick={() => handleApproveToken(token)}
                        disabled={!swapAmounts[token.address]?.isValid}
                        style={{
                          padding: '2px 6px',
                          marginLeft: '2px',
                          background: '#444',
                          color: '#55bb55',
                          border: '1px solid #666',
                          borderRadius: '3px',
                          cursor: 'pointer'
                        }}
                      >
                        approve
                      </button>
                    )}
                    
                    {approvalStatus[token.address].error && (
                      <div style={{ color: '#dd5555', fontSize: '0.8rem', marginTop: '4px' }}>
                        Error: {approvalStatus[token.address].error.substring(0, 40)}...
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ color: '#888' }}>checking...</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="cli-error" style={{margin: '10px 0'}}>
            Error: {error}
          </div>
        )}

        <div className="cli-swap-summary">
          <div className="cli-summary-line">
            <span className="cli-summary-label">Total Value:</span>
            <span className="cli-summary-value">
              ${totalValueUsd.toFixed(2)}
            </span>
          </div>
          
          <div className="cli-summary-line">
            <span className="cli-summary-label">Target Token:</span>
            <select
              className="cli-select"
              value={targetToken.address}
              onChange={handleTargetTokenChange}
              style={{
                padding: '2px 6px', 
                background: '#333',
                color: '#fff',
                border: '1px solid #666',
                borderRadius: '3px',
                marginLeft: '8px',
                fontFamily: 'monospace',
                fontSize: '0.9rem'
              }}
            >
              {isLoadingTokens ? (
                <option value="">Loading tokens...</option>
              ) : (
                availableTokens.map(token => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))
              )}
            </select>
          </div>
          
          <div className="cli-summary-line">
            <span className="cli-summary-label">Estimated Output:</span>
            <span className="cli-summary-value">
              {estimatedOutput.toFixed(6)} {targetToken.symbol}
            </span>
          </div>
        </div>

        <div className="swap-actions">
          <div className="cli-command-row">
            <span className="cli-prompt">berabundle$</span> 
            <button 
              className="cli-btn cli-btn-swap" 
              onClick={handleSwap}
              disabled={!isValid}
            >
              execute-swap
            </button>
            <button 
              className="cli-btn" 
              onClick={onClose}
            >
              cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SwapForm;