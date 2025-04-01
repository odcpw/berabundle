import React from 'react';
import './CliTokenList.css';

/**
 * CLI-like component to display a list of tokens with their balances and values
 * 
 * @param {Object} props Component props
 * @param {Array} props.tokens Array of token objects with balance info
 * @param {string} props.totalValueUsd Total portfolio value in USD
 * @param {string} props.totalValueNative Total portfolio value in native currency
 * @param {boolean} props.loading Whether data is loading
 * @param {string} props.error Error message to display
 * @param {boolean} props.selectable Whether tokens can be selected
 * @param {Function} props.onTokenSelect Callback when tokens are selected
 */
function CliTokenList({ 
  tokens, 
  totalValueUsd, 
  totalValueNative, 
  loading, 
  error, 
  selectable = true,
  onTokenSelect = () => {}
}) {
  const [selectedTokens, setSelectedTokens] = React.useState({});
  
  // Handle token selection
  const handleTokenSelect = (token) => {
    if (token.isNative || token.address === 'native') return;
    
    const newSelections = { ...selectedTokens };
    newSelections[token.address] = !newSelections[token.address];
    setSelectedTokens(newSelections);
    
    // Notify parent component about selected tokens
    const selectedTokensList = Object.entries(newSelections)
      .filter(([_, isSelected]) => isSelected)
      .map(([address]) => tokens.find(t => t.address === address))
      .filter(t => t);
      
    onTokenSelect(selectedTokensList);
  };

  // If loading, show a spinner
  if (loading) {
    return (
      <div className="cli-terminal">
        <div className="cli-header">
          <span className="cli-prompt">berabundle$</span> token-list
        </div>
        <div className="cli-content">
          <p>Loading token balances...</p>
          <div className="cli-loader"></div>
        </div>
      </div>
    );
  }
  
  // If error, show error message
  if (error) {
    return (
      <div className="cli-terminal">
        <div className="cli-header">
          <span className="cli-prompt">berabundle$</span> token-list
        </div>
        <div className="cli-content">
          <p className="cli-error">Error: {error}</p>
        </div>
      </div>
    );
  }
  
  // If no tokens, show empty message
  if (!tokens || tokens.length === 0) {
    return (
      <div className="cli-terminal">
        <div className="cli-header">
          <span className="cli-prompt">berabundle$</span> token-list
        </div>
        <div className="cli-content">
          <p>No tokens found with non-zero balance.</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="cli-terminal">
      <div className="cli-header">
        <span className="cli-prompt">berabundle$</span> token-list --balances
      </div>
      <div className="cli-content">
        <div className="cli-table">
          {tokens.map((token, index) => (
            <div 
              key={token.address || index} 
              className={`cli-row ${token.isNative ? 'native-token' : ''} ${selectedTokens[token.address] ? 'selected' : ''}`}
              onClick={() => selectable && handleTokenSelect(token)}
            >
              <div className="cli-cell token-symbol">
                {selectedTokens[token.address] && !token.isNative ? '[X]' : '[ ]'} {token.symbol}
              </div>
              <div className="cli-cell token-balance">
                {parseFloat(token.balance).toFixed(2)}
              </div>
              <div className="cli-cell token-price">
                {token.priceUsd 
                  ? `$${parseFloat(token.priceUsd).toFixed(3)}`
                  : '-'
                }
              </div>
              <div className="cli-cell token-value">
                {token.valueUsd
                  ? `$${parseFloat(token.valueUsd).toFixed(2)}`
                  : '-'
                }
              </div>
            </div>
          ))}
        </div>
        
        {totalValueUsd && (
          <div className="cli-summary">
            <div className="cli-summary-line">
              <span className="cli-summary-label">Total Value:</span>
              <span className="cli-summary-value">{totalValueUsd}</span>
            </div>
            {totalValueNative && (
              <div className="cli-summary-line">
                <span className="cli-summary-label">Value in BERA:</span>
                <span className="cli-summary-value">{totalValueNative}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CliTokenList;