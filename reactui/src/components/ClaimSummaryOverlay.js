import React from 'react';
import './ClaimSummaryOverlay.css';

/**
 * Claim Summary Overlay
 * 
 * This component displays a summary of rewards to be claimed and validator 
 * delegation details before proceeding with the transaction.
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen Whether the overlay is open
 * @param {function} props.onClose Function to close the overlay
 * @param {Array} props.selectedRewards Selected rewards to claim
 * @param {Object} props.validatorPreferences Validator preferences for redelegation
 * @param {function} props.onProceed Function to call when proceeding with claim
 */
function ClaimSummaryOverlay({ 
  isOpen, 
  onClose, 
  selectedRewards = [],
  validatorPreferences = null,
  onProceed
}) {
  if (!isOpen) return null;
  
  // Calculate total BGT and HONEY amounts
  const totalBGT = selectedRewards
    .filter(reward => reward.rewardToken && reward.rewardToken.symbol === 'BGT')
    .reduce((sum, reward) => sum + parseFloat(reward.earned), 0)
    .toFixed(2);
    
  const totalHONEY = selectedRewards
    .filter(reward => reward.rewardToken && reward.rewardToken.symbol === 'HONEY')
    .reduce((sum, reward) => sum + parseFloat(reward.earned), 0)
    .toFixed(2);
  
  // Determine if we have BGT rewards and validator preferences
  const hasBGT = parseFloat(totalBGT) > 0;
  const hasValidatorPreferences = validatorPreferences && 
                                validatorPreferences.validators && 
                                validatorPreferences.validators.length > 0;
  
  // Get unique reward sources for display
  const rewardSources = [...new Set(selectedRewards.map(reward => {
    if (reward.type === 'bgtStaker') return 'BGT Staker';
    if (reward.type === 'vault') return `${reward.name || 'Vault'}`;
    return reward.name || 'Unknown';
  }))];
  
  return (
    <div className="overlay-base">
      <div className="cli-overlay-terminal">
        <div className="cli-overlay-header">
          <div className="cli-overlay-title">
            <span className="cli-prompt">berabundle$</span> 
            <span className="cli-overlay-command">claim-rewards --count {selectedRewards.length}</span>
          </div>
          <button className="cli-overlay-close" onClick={onClose}>&times;</button>
        </div>
        
        <div className="cli-overlay-content">
          <div className="swap-instruction" style={{ marginBottom: '12px', color: '#aaa' }}>
            # Summary of rewards to be claimed
          </div>
          
          <div className="cli-table">
            <div className="cli-row header-row" style={{ color: '#888', fontSize: '0.85rem', borderBottom: '1px solid #333', padding: '4px 12px', marginBottom: '8px' }}>
              <div className="cli-cell" style={{ width: '30%' }}>TOKEN</div>
              <div className="cli-cell" style={{ width: '70%', textAlign: 'right' }}>AMOUNT</div>
            </div>
            
            {parseFloat(totalBGT) > 0 && (
              <div className="cli-row selected">
                <div className="cli-cell token-symbol">BGT</div>
                <div className="cli-cell token-value">{totalBGT}</div>
              </div>
            )}
            
            {parseFloat(totalHONEY) > 0 && (
              <div className="cli-row selected">
                <div className="cli-cell token-symbol">HONEY</div>
                <div className="cli-cell token-value">{totalHONEY}</div>
              </div>
            )}
          </div>
          
          <div style={{ marginTop: '15px', color: '#aaa', fontSize: '0.9rem' }}>
            <span style={{ marginRight: '10px' }}>From:</span>
            {rewardSources.map((source, index) => (
              <div key={index} style={{ marginTop: '4px', paddingLeft: '20px', color: '#ddd' }}>
                - {source}
              </div>
            ))}
          </div>
          
          {hasBGT && hasValidatorPreferences && (
            <div style={{ marginTop: '25px', borderTop: '1px solid #333', paddingTop: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ color: '#ffc045', fontSize: '1rem', fontWeight: 'bold' }}>
                  # Redelegation Plan
                </div>
                <button 
                  className="cli-btn" 
                  onClick={() => onClose('editValidators')}
                  style={{ fontSize: '0.85rem', padding: '4px 10px' }}
                >
                  edit-validators
                </button>
              </div>
              
              <div style={{ color: '#aaa', marginBottom: '12px', fontSize: '0.9rem' }}>
                Your BGT rewards will be automatically redelegated to these validators:
              </div>
              
              <div className="cli-table" style={{ border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
                <div className="cli-row header-row" style={{ color: '#888', fontSize: '0.85rem', borderBottom: '1px solid #333', padding: '4px 12px' }}>
                  <div className="cli-cell" style={{ width: '50%' }}>VALIDATOR</div>
                  <div className="cli-cell" style={{ width: '20%', textAlign: 'center' }}>PERCENT</div>
                  <div className="cli-cell" style={{ width: '30%', textAlign: 'right' }}>AMOUNT</div>
                </div>
                
                {validatorPreferences.validators.map((validator, index) => {
                  const allocation = validatorPreferences.allocations[validator.pubkey] || 0;
                  const amount = (parseFloat(totalBGT) * allocation / 100).toFixed(2);
                  
                  return (
                    <div key={validator.pubkey} className="cli-row">
                      <div className="cli-cell">
                        <div style={{ fontWeight: 'bold' }}>{validator.name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#999' }}>{validator.pubkey.substring(0, 8)}...</div>
                      </div>
                      <div className="cli-cell" style={{ textAlign: 'center', color: '#ffc045' }}>
                        {allocation}%
                      </div>
                      <div className="cli-cell" style={{ textAlign: 'right' }}>
                        {amount} BGT
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          <div className="swap-actions" style={{ marginTop: '25px' }}>
            <div className="cli-command-row">
              <span className="cli-prompt">berabundle$</span> 
              <button 
                className="cli-btn cli-btn-claim" 
                onClick={onProceed}
              >
                {hasBGT && hasValidatorPreferences 
                  ? 'execute-claim-and-delegate' 
                  : 'execute-claim'}
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
    </div>
  );
}

export default ClaimSummaryOverlay;