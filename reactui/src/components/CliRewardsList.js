import React, { useState } from 'react';
import './CliRewardsList.css';

/**
 * CLI-like component to display claimable rewards
 * 
 * @param {Object} props Component props
 * @param {Array} props.rewards Array of reward objects
 * @param {boolean} props.loading Whether data is loading
 * @param {string} props.error Error message to display
 * @param {Function} props.onClaimSelected Callback when rewards are selected
 */
function CliRewardsList({ rewards = [], loading = false, error = null, onClaimSelected = () => {} }) {
  const [selectedRewards, setSelectedRewards] = useState({});
  
  // Handle reward selection
  const handleRewardSelect = (reward) => {
    const newSelections = { ...selectedRewards };
    newSelections[reward.id] = !newSelections[reward.id];
    setSelectedRewards(newSelections);
    
    // Notify parent component about selected rewards
    const selectedRewardsList = Object.entries(newSelections)
      .filter(([_, isSelected]) => isSelected)
      .map(([id]) => rewards.find(r => r.id === id))
      .filter(r => r);
      
    onClaimSelected(selectedRewardsList);
  };

  // If loading, show a spinner
  if (loading) {
    return (
      <div className="cli-terminal">
        <div className="cli-header">
          <span className="cli-prompt">berabundle$</span> rewards
        </div>
        <div className="cli-content">
          <p>Loading claimable rewards...</p>
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
          <span className="cli-prompt">berabundle$</span> rewards
        </div>
        <div className="cli-content">
          <p className="cli-error">Error: {error}</p>
        </div>
      </div>
    );
  }
  
  // If no rewards, show empty message
  if (!rewards || rewards.length === 0) {
    return (
      <div className="cli-terminal">
        <div className="cli-header">
          <span className="cli-prompt">berabundle$</span> rewards
        </div>
        <div className="cli-content">
          <p>No claimable rewards found.</p>
        </div>
      </div>
    );
  }
  
  // Calculate total claimable value
  const totalValue = rewards.reduce((sum, reward) => sum + (reward.valueUsd || 0), 0);
  
  return (
    <div className="cli-terminal">
      <div className="cli-header">
        <span className="cli-prompt">berabundle$</span> rewards --claimable
      </div>
      <div className="cli-content">
        {rewards.map((reward) => (
          <div 
            key={reward.id}
            className={`cli-reward ${selectedRewards[reward.id] ? 'selected' : ''}`}
            onClick={() => handleRewardSelect(reward)}
          >
            <div className="cli-reward-header">
              <div className="cli-reward-checkbox">
                {selectedRewards[reward.id] ? '[X]' : '[ ]'}
              </div>
              <div className="cli-reward-title">
                {reward.type === 'bgtStaker' 
                  ? 'BGT Staker (Honey Pool)'
                  : `${reward.name}${reward.protocol ? ` on ${reward.protocol}` : ''}`
                }
              </div>
            </div>
            
            <div className="cli-reward-details">
              {reward.type === 'vault' ? (
                <>
                  <div className="cli-reward-detail">
                    <span className="detail-label">Staking:</span> 
                    <span className="detail-value">
                      {parseFloat(reward.userStake).toFixed(2)} {reward.stakeToken.symbol}
                    </span>
                  </div>
                  <div className="cli-reward-detail">
                    <span className="detail-label">Pool Share:</span> 
                    <span className="detail-value">
                      {parseFloat(reward.share).toFixed(2)}%
                    </span>
                  </div>
                </>
              ) : reward.type === 'bgtStaker' ? (
                <>
                  <div className="cli-reward-detail">
                    <span className="detail-label">Balance:</span> 
                    <span className="detail-value">
                      {parseFloat(reward.userBalance || 0).toFixed(2)}
                    </span>
                  </div>
                  {reward.validatorBoosts && reward.validatorBoosts.activeBoosts && reward.validatorBoosts.activeBoosts.length > 0 && (
                    <div className="cli-reward-detail boost">
                      <span className="detail-label">Boost:</span> 
                      <span className="detail-value">
                        {reward.validatorBoosts.activeBoosts.length} Validators ({
                          parseFloat(reward.validatorBoosts.totalActiveBoost || 0).toFixed(2)
                        } BGT)
                      </span>
                    </div>
                  )}
                  {(!reward.validatorBoosts || !reward.validatorBoosts.activeBoosts) && reward.boostCount > 0 && (
                    <div className="cli-reward-detail boost">
                      <span className="detail-label">Boost:</span> 
                      <span className="detail-value">
                        {reward.boostCount} Validators ({parseFloat(reward.totalBoostedBGT || 0).toFixed(2)} BGT)
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="cli-reward-detail">
                  <span className="detail-label">Balance:</span> 
                  <span className="detail-value">
                    {parseFloat(reward.userBalance).toFixed(2)}
                  </span>
                </div>
              )}
              
              <div className="cli-reward-detail pending">
                <span className="detail-label">Pending:</span> 
                <span className="detail-value">
                  {parseFloat(reward.earned).toFixed(2)} {reward.rewardToken.symbol}
                </span>
              </div>
              
              {reward.valueUsd > 0 && (
                <div className="cli-reward-detail value">
                  <span className="detail-label">Value:</span> 
                  <span className="detail-value">
                    ${parseFloat(reward.valueUsd).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {totalValue > 0 && (
          <div className="cli-reward-summary">
            <span className="summary-label">Total Value:</span>
            <span className="summary-value">
              {totalValue.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default CliRewardsList;