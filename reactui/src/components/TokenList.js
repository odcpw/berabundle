import React, { useState, useEffect } from 'react';
import './TokenList.css';

/**
 * Component to display a list of tokens with their balances and values
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
function TokenList({ 
  tokens, 
  totalValueUsd, 
  totalValueNative, 
  loading, 
  error, 
  selectable = true,
  onTokenSelect = () => {}
}) {
  const [sortedTokens, setSortedTokens] = useState([]);
  const [selectedTokens, setSelectedTokens] = useState({});
  const [selectableTokens, setSelectableTokens] = useState([]);
  
  // Sort tokens by value (descending) every time tokens change
  // Keep BERA at the top always
  useEffect(() => {
    if (!tokens || tokens.length === 0) {
      setSortedTokens([]);
      setSelectableTokens([]);
      return;
    }
    
    // Extract native BERA token
    const beraToken = tokens.find(t => t.symbol === 'BERA' && (t.isNative || t.address === 'native'));
    
    // Get remaining tokens and sort by value
    const otherTokens = tokens.filter(t => !(t.symbol === 'BERA' && (t.isNative || t.address === 'native')))
      .sort((a, b) => {
        const valueA = a.valueUsd || 0;
        const valueB = b.valueUsd || 0;
        return valueB - valueA; // Descending order
      });
    
    // Store selectable tokens (all non-BERA tokens)
    setSelectableTokens(otherTokens);
    
    // Combine with BERA at the top
    const result = beraToken ? [beraToken, ...otherTokens] : otherTokens;
    setSortedTokens(result);
    
    // Reset selections when tokens change
    setSelectedTokens({});
    
    // Notify parent that selections have been reset
    onTokenSelect([]);
  }, [tokens]);
  
  // Handle token selection
  const handleTokenSelect = (token) => {
    // Don't allow selecting BERA (native token)
    if (token.isNative || token.address === 'native') return;
    
    const newSelections = { ...selectedTokens };
    newSelections[token.address] = !newSelections[token.address];
    setSelectedTokens(newSelections);
    
    // Notify parent component about selected tokens
    notifySelectionChange(newSelections);
  };
  
  // Handle select all button
  const handleSelectAll = () => {
    const newSelections = { ...selectedTokens };
    
    // Check if all selectable tokens are already selected
    const allSelected = selectableTokens.every(token => selectedTokens[token.address]);
    
    // Toggle selection for all tokens
    selectableTokens.forEach(token => {
      newSelections[token.address] = !allSelected;
    });
    
    setSelectedTokens(newSelections);
    
    // Notify parent component about selected tokens
    notifySelectionChange(newSelections);
  };
  
  // Utility function to notify parent component about selection changes
  const notifySelectionChange = (selections) => {
    const selectedTokensList = Object.entries(selections)
      .filter(([_, isSelected]) => isSelected)
      .map(([address]) => tokens.find(t => t.address === address))
      .filter(t => t); // Remove undefined
      
    onTokenSelect(selectedTokensList);
  };
  // If loading, show a spinner
  if (loading) {
    return (
      <div className="token-list-container">
        <div className="loader">
          <div className="loader-spinner"></div>
          <p>Loading token balances...</p>
        </div>
      </div>
    );
  }
  
  // If error, show error message
  if (error) {
    return (
      <div className="token-list-container">
        <div className="error-message">
          <p>Error loading token balances: {error}</p>
        </div>
      </div>
    );
  }
  
  // If no tokens, show table with empty message
  if (!tokens || tokens.length === 0) {
    return (
      <div className="token-list-container">
        <div className="token-list">
          <table>
            <thead>
              <tr>
                {selectable && <th className="select-column"></th>}
                <th>Token</th>
                <th>Balance</th>
                <th>Price</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr className="empty-row">
                <td colSpan={selectable ? 5 : 4} className="empty-message">
                  No tokens found with non-zero balance.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  
  return (
    <div className="token-list-container">
      <div className="token-list-header">
        <h2 className="token-list-title">Token Balances</h2>
        {selectable && selectableTokens.length > 0 && (
          <button 
            className="select-all-button" 
            onClick={handleSelectAll}
          >
            {selectableTokens.every(token => selectedTokens[token.address]) 
              ? "Deselect All" 
              : "Select All"}
          </button>
        )}
      </div>
      
      <div className="token-list">
        <table>
          <thead>
            <tr>
              {selectable && <th className="select-column"></th>}
              <th>Token</th>
              <th>Balance</th>
              <th>Price</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {sortedTokens.map((token, index) => (
              <tr 
                key={token.address || index}
                className={token.isNative ? 'native-token' : ''}
              >
                {selectable && (
                  <td className="select-column">
                    {!token.isNative && (
                      <input 
                        type="checkbox"
                        checked={!!selectedTokens[token.address]}
                        onChange={() => handleTokenSelect(token)}
                        disabled={token.isNative}
                        className="token-checkbox"
                      />
                    )}
                  </td>
                )}
                <td>
                  <div className="token-cell">
                    <div className="token-icon" style={{
                      backgroundImage: token.logoURI ? `url(${token.logoURI})` : 'none',
                      backgroundColor: token.logoURI ? 'transparent' : '#444'
                    }}>
                      {!token.logoURI && token.symbol.substring(0, 2)}
                    </div>
                    <div>
                      <div className="token-symbol">{token.symbol}</div>
                      <div className="token-name">{token.name}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="token-balance">
                    {token.formattedBalance || parseFloat(token.balance).toLocaleString()}
                  </div>
                </td>
                <td>
                  {token.priceUsd 
                    ? `$${token.priceUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}`
                    : '-'
                  }
                </td>
                <td>
                  <div className="token-value">
                    {token.formattedValueUsd || (token.valueUsd 
                      ? token.valueUsd.toLocaleString('en-US', {
                          style: 'currency',
                          currency: 'USD'
                        })
                      : '-'
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {totalValueUsd && (
        <div className="total-value">
          <div className="total-value-row">
            <span>Total Value:</span>
            <span>{totalValueUsd}</span>
          </div>
          {totalValueNative && (
            <div className="total-value-row">
              <span>Value in BERA:</span>
              <span>{totalValueNative}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TokenList;