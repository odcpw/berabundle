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

  // Initialize swap amounts with MAX by default
  useEffect(() => {
    if (selectedTokens && selectedTokens.length > 0) {
      const initialAmounts = {};
      
      // Filter out native BERA tokens (just to be safe)
      const validTokens = selectedTokens.filter(token => 
        !(token.isNative || token.address === 'native' || token.symbol === 'BERA')
      );
      
      // Set all tokens to MAX by default
      validTokens.forEach(token => {
        const amount = token.balance;
        const numericAmount = parseFloat(amount);
        const valueUsd = token.priceUsd ? numericAmount * token.priceUsd : 0;
        
        initialAmounts[token.address] = {
          amount,
          valueUsd,
          isValid: true
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

  // Handle percentage selection
  const handlePercentClick = (token, percentage) => {
    if (percentage === 0) {
      handleAmountChange(token, '0');
      return;
    }
    
    const amount = (parseFloat(token.balance) * (percentage / 100)).toFixed(2);
    handleAmountChange(token, amount);
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
      <div className="cli-overlay-terminal">
        <div className="cli-overlay-header">
          <div className="cli-overlay-title">
            <span className="cli-prompt">berabundle$</span> <span className="cli-overlay-command">swap --tokens 0</span>
          </div>
          <button className="cli-overlay-close" onClick={onClose}>&times;</button>
        </div>
        <div className="cli-overlay-content">
          <p className="cli-error">Error: No valid tokens selected for swap. Please select non-BERA tokens.</p>
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
            <div className="cli-cell token-symbol" style={{ width: '25%' }}>TOKEN</div>
            <div className="cli-cell token-balance" style={{ width: '55%', textAlign: 'center' }}>AMOUNT</div>
            <div className="cli-cell token-value" style={{ width: '20%' }}>VALUE</div>
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
                  value={swapAmounts[token.address]?.amount 
                    ? parseFloat(swapAmounts[token.address].amount).toFixed(2) 
                    : ''}
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
            <span className="cli-summary-label">Estimated BERA:</span>
            <span className="cli-summary-value">
              {estimatedBera.toFixed(6)} BERA
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