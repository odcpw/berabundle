import React, { useState } from 'react';
import './RewardsList.css';

/**
 * Component to display claimable rewards
 * 
 * @param {Object} props Component props
 * @param {Array} props.rewards Array of reward objects
 * @param {boolean} props.loading Whether data is loading
 * @param {string} props.error Error message to display
 * @param {Function} props.onClaimSelected Callback when claim button is clicked
 */
function RewardsList({ rewards = [], loading = false, error = null, onClaimSelected = () => {} }) {
  const [selectedRewards, setSelectedRewards] = useState({});
  
  // Handle reward selection
  const handleRewardSelect = (rewardId) => {
    const newSelections = { ...selectedRewards };
    newSelections[rewardId] = !newSelections[rewardId];
    setSelectedRewards(newSelections);
    
    // Notify parent component about selected rewards
    const selectedRewardsList = Object.entries(newSelections)
      .filter(([_, isSelected]) => isSelected)
      .map(([id]) => rewards.find(r => r.id === id))
      .filter(r => r);
      
    onClaimSelected(selectedRewardsList);
  };
  
  // Handle select all button
  const handleSelectAll = () => {
    const newSelections = { ...selectedRewards };
    
    // Check if all rewards are already selected
    const allSelected = rewards.every(reward => selectedRewards[reward.id]);
    
    // Toggle selection for all rewards
    rewards.forEach(reward => {
      newSelections[reward.id] = !allSelected;
    });
    
    setSelectedRewards(newSelections);
    
    // Notify parent component about selected rewards
    const selectedRewardsList = !allSelected ? [...rewards] : [];
    onClaimSelected(selectedRewardsList);
  };
  
  // If loading, show a spinner
  if (loading) {
    return (
      <div className="rewards-list-container">
        <div className="loader">
          <div className="loader-spinner"></div>
          <p>Loading claimable rewards...</p>
        </div>
      </div>
    );
  }
  
  // If error, show error message
  if (error) {
    return (
      <div className="rewards-list-container">
        <div className="error-message">
          <p>Error loading rewards: {error}</p>
        </div>
      </div>
    );
  }
  
  // If no rewards, show table with empty message
  if (!rewards || rewards.length === 0) {
    return (
      <div className="rewards-list-container">
        <div className="rewards-list">
          <table>
            <thead>
              <tr>
                <th className="select-column"></th>
                <th>Reward</th>
                <th>Amount</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr className="empty-row">
                <td colSpan={4} className="empty-message">
                  No claimable rewards found.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  
  // Calculate total claimable value
  const totalValue = rewards.reduce((sum, reward) => sum + (reward.valueUsd || 0), 0);
  
  return (
    <div className="rewards-list-container">
      <div className="rewards-list-header">
        <h2 className="rewards-list-title">Claimable Rewards</h2>
        {rewards.length > 0 && (
          <button 
            className="select-all-button" 
            onClick={handleSelectAll}
          >
            {rewards.every(reward => selectedRewards[reward.id]) 
              ? "Deselect All" 
              : "Select All"}
          </button>
        )}
      </div>
      
      <div className="rewards-list">
        <table>
          <thead>
            <tr>
              <th className="select-column"></th>
              <th>Reward</th>
              <th>Amount</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rewards.map((reward) => (
              <tr key={reward.id}>
                <td className="select-column">
                  <input
                    type="checkbox"
                    checked={!!selectedRewards[reward.id]}
                    onChange={() => handleRewardSelect(reward.id)}
                    className="reward-checkbox"
                  />
                </td>
                <td>
                  <div className="reward-cell">
                    <div className="reward-icon" style={{
                      backgroundImage: reward.iconUrl ? `url(${reward.iconUrl})` : 'none',
                      backgroundColor: reward.iconUrl ? 'transparent' : '#997328'
                    }}>
                      {!reward.iconUrl && reward.symbol?.substring(0, 2)}
                    </div>
                    <div>
                      <div className="reward-name">{reward.name}</div>
                      <div className="reward-source">{reward.source}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="reward-amount">
                    {reward.formattedAmount || reward.amount}
                  </div>
                </td>
                <td>
                  <div className="reward-value">
                    {reward.formattedValueUsd || (reward.valueUsd 
                      ? reward.valueUsd.toLocaleString('en-US', {
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
      
      {totalValue > 0 && (
        <div className="total-value">
          <div className="total-value-row">
            <span>Total Value:</span>
            <span>{totalValue.toLocaleString('en-US', {
              style: 'currency',
              currency: 'USD'
            })}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default RewardsList;