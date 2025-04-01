import React, { useState } from 'react';
import './CliRewardsList.css'; // Reuse the same CSS

/**
 * CLI-like component to display validator boosts
 * 
 * @param {Object} props Component props
 * @param {Array} props.validatorBoosts Array of validator boost objects
 * @param {boolean} props.loading Whether data is loading
 * @param {string} props.error Error message to display
 */
function CliValidatorBoosts({ validatorBoosts = { activeBoosts: [], queuedBoosts: [] }, loading = false, error = null }) {
  // If loading, show a spinner
  if (loading) {
    return (
      <div className="cli-terminal">
        <div className="cli-header">
          <span className="cli-prompt">berabundle$</span> validator-boosts
        </div>
        <div className="cli-content">
          <p>Loading validator boosts...</p>
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
          <span className="cli-prompt">berabundle$</span> validator-boosts
        </div>
        <div className="cli-content">
          <p className="cli-error">Error: {error}</p>
        </div>
      </div>
    );
  }

  // If no validator boosts, show empty message
  const activeBoosts = validatorBoosts.activeBoosts || [];
  const queuedBoosts = validatorBoosts.queuedBoosts || [];
  
  if (activeBoosts.length === 0 && queuedBoosts.length === 0) {
    return (
      <div className="cli-terminal">
        <div className="cli-header">
          <span className="cli-prompt">berabundle$</span> validator-boosts
        </div>
        <div className="cli-content">
          <p>No active or queued validator boosts found.</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="cli-terminal">
      <div className="cli-header">
        <span className="cli-prompt">berabundle$</span> validator-boosts --status
      </div>
      <div className="cli-content">
        {/* Active Validator Boosts */}
        {activeBoosts.length > 0 && (
          <div className="cli-section">
            <div className="cli-section-title">Active Validator Boosts:</div>
            {activeBoosts.map((validator, index) => (
              <div key={index} className="cli-validator">
                <div className="cli-validator-header">
                  <div className="cli-validator-title">
                    {validator.name} ({validator.pubkey.substring(0, 10)}...)
                  </div>
                </div>
                
                <div className="cli-validator-details">
                  <div className="cli-validator-detail">
                    <span className="detail-label">Your Boost:</span> 
                    <span className="detail-value">
                      {parseFloat(validator.userBoostAmount).toFixed(2)} BGT
                    </span>
                  </div>
                  
                  <div className="cli-validator-detail">
                    <span className="detail-label">Total Boost:</span> 
                    <span className="detail-value">
                      {parseFloat(validator.totalBoost).toFixed(2)} BGT
                    </span>
                  </div>
                  
                  <div className="cli-validator-detail">
                    <span className="detail-label">Your Share:</span> 
                    <span className="detail-value">
                      {validator.share}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Queued Validator Boosts */}
        {queuedBoosts.length > 0 && (
          <div className="cli-section">
            <div className="cli-section-title">Queued Validator Boosts (pending activation):</div>
            {queuedBoosts.map((validator, index) => (
              <div key={index} className="cli-validator">
                <div className="cli-validator-header">
                  <div className="cli-validator-title">
                    {validator.name} ({validator.pubkey.substring(0, 10)}...)
                  </div>
                </div>
                
                <div className="cli-validator-details">
                  <div className="cli-validator-detail">
                    <span className="detail-label">Queued Boost:</span> 
                    <span className="detail-value">
                      {parseFloat(validator.queuedBoostAmount).toFixed(2)} BGT
                    </span>
                  </div>
                  
                  <div className="cli-validator-detail">
                    <span className="detail-label">Status:</span> 
                    <span className="detail-value queued">
                      Queued - needs activation
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Summary Stats */}
        <div className="cli-boost-summary">
          <div className="cli-summary-line">
            <span className="summary-label">Total Active Boosts:</span>
            <span className="summary-value">
              {activeBoosts.length} validators, 
              {activeBoosts.reduce((sum, v) => sum + parseFloat(v.userBoostAmount), 0).toFixed(2)} BGT
            </span>
          </div>
          
          {queuedBoosts.length > 0 && (
            <div className="cli-summary-line">
              <span className="summary-label">Total Queued Boosts:</span>
              <span className="summary-value">
                {queuedBoosts.length} validators, 
                {queuedBoosts.reduce((sum, v) => sum + parseFloat(v.queuedBoostAmount), 0).toFixed(2)} BGT
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CliValidatorBoosts;