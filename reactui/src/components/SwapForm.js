import React, { useState, useEffect } from 'react';
import './SwapForm.css';

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
  const [estimatedBera, setEstimatedBera] = useState(0);
  const [isValid, setIsValid] = useState(false);
  const [error, setError] = useState('');

  // Initialize swap amounts
  useEffect(() => {
    if (selectedTokens && selectedTokens.length > 0) {
      const initialAmounts = {};
      
      // Filter out native BERA tokens (just to be safe)
      const validTokens = selectedTokens.filter(token => 
        !(token.isNative || token.address === 'native' || token.symbol === 'BERA')
      );
      
      validTokens.forEach(token => {
        initialAmounts[token.address] = {
          amount: '',
          valueUsd: 0,
          isValid: false
        };
      });
      setSwapAmounts(initialAmounts);
    }
  }, [selectedTokens]);

  // Update total values when amounts change
  useEffect(() => {
    let total = 0;
    let valid = false;

    // Calculate total value
    Object.values(swapAmounts).forEach(tokenData => {
      total += tokenData.valueUsd || 0;
      if (tokenData.isValid) valid = true;
    });

    // Calculate estimated BERA
    let estimatedBera = 0;
    if (beraToken && beraToken.priceUsd && total > 0) {
      estimatedBera = total / beraToken.priceUsd;
    }

    setTotalValueUsd(total);
    setEstimatedBera(estimatedBera);
    setIsValid(valid);
  }, [swapAmounts, beraToken]);

  // Handle amount change for a token
  const handleAmountChange = (token, value) => {
    const amount = value.trim();
    const numericAmount = parseFloat(amount);
    
    // Validate amount
    const isValid = 
      amount !== '' && 
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
        amount,
        valueUsd,
        isValid
      }
    }));

    // Clear error if any input is valid
    if (isValid) {
      setError('');
    }
  };

  // Handle max button click
  const handleMaxClick = (token) => {
    handleAmountChange(token, token.balance);
  };

  // Handle swap button click
  const handleSwap = () => {
    if (!isValid) {
      setError('Please enter valid amounts for at least one token');
      return;
    }

    // Create swap data
    const swapData = selectedTokens
      .filter(token => swapAmounts[token.address]?.isValid)
      .map(token => ({
        token,
        amount: swapAmounts[token.address].amount,
        valueUsd: swapAmounts[token.address].valueUsd
      }));

    onSwap(swapData, totalValueUsd, estimatedBera);
  };

  // Filter out native BERA tokens
  const validTokens = selectedTokens.filter(token => 
    !(token.isNative || token.address === 'native' || token.symbol === 'BERA')
  );
  
  // If no valid tokens are selected
  if (!validTokens || validTokens.length === 0) {
    return (
      <div className="swap-form">
        <div className="swap-form-header">
          <h2>Swap Tokens</h2>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="swap-form-content">
          <p>No valid tokens selected for swap. Please select non-BERA tokens from the list.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="swap-form">
      <div className="swap-form-header">
        <h2>Swap Tokens</h2>
        <button className="close-button" onClick={onClose}>&times;</button>
      </div>

      <div className="swap-form-content">
        <p className="swap-instruction">Enter the amount for each token you want to swap:</p>

        <div className="swap-tokens-list">
          {validTokens.map(token => (
            <div key={token.address} className="swap-token-row">
              <div className="token-info">
                <div className="token-icon" style={{
                  backgroundImage: token.logoURI ? `url(${token.logoURI})` : 'none',
                  backgroundColor: token.logoURI ? 'transparent' : '#444'
                }}>
                  {!token.logoURI && token.symbol.substring(0, 2)}
                </div>
                <div className="token-details">
                  <div className="token-symbol">{token.symbol}</div>
                  <div className="token-balance">Balance: {token.formattedBalance}</div>
                </div>
              </div>
              
              <div className="amount-input-container">
                <input
                  type="text"
                  value={swapAmounts[token.address]?.amount || ''}
                  onChange={(e) => handleAmountChange(token, e.target.value)}
                  className={`amount-input ${swapAmounts[token.address]?.isValid ? 'valid' : ''}`}
                  placeholder="0.0"
                />
                <button 
                  className="max-button" 
                  onClick={() => handleMaxClick(token)}
                >
                  MAX
                </button>
              </div>
              
              <div className="token-value">
                {swapAmounts[token.address]?.isValid && swapAmounts[token.address]?.valueUsd > 0 && (
                  <span>
                    ${swapAmounts[token.address].valueUsd.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="swap-error">
            <p>{error}</p>
          </div>
        )}

        <div className="swap-summary">
          <div className="summary-row">
            <span>Total Value:</span>
            <span>
              ${totalValueUsd.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </span>
          </div>
          
          <div className="summary-row">
            <span>Estimated BERA:</span>
            <span>
              {estimatedBera.toLocaleString(undefined, {
                minimumFractionDigits: 6,
                maximumFractionDigits: 6
              })} BERA
            </span>
          </div>
        </div>

        <div className="swap-actions">
          <button 
            className="cancel-button" 
            onClick={onClose}
          >
            Cancel
          </button>
          <button 
            className="swap-button" 
            onClick={handleSwap}
            disabled={!isValid}
          >
            Swap Tokens
          </button>
        </div>
      </div>
    </div>
  );
}

export default SwapForm;