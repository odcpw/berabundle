import React, { useState, useEffect } from 'react';
import './MetadataManager.css';
import metadataService from '../services/MetadataService';

/**
 * Component for managing and displaying metadata status
 * Handles fetching and updating tokens, vaults, and validators
 */
function MetadataManager() {
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [metadata, setMetadata] = useState({
    githubTokens: null,
    oogaBoogaTokens: null,
    vaults: null,
    validators: null,
    lastUpdate: null
  });

  // Initialize and load metadata on component mount
  useEffect(() => {
    const fetchInitialMetadata = async () => {
      setLoading(true);
      try {
        // First check if we have cached data
        const cachedStatus = metadataService.getAllMetadataStatus();
        
        if (cachedStatus.githubTokens || cachedStatus.oogaBoogaTokens || 
            cachedStatus.vaults || cachedStatus.validators) {
          setMetadata(cachedStatus);
          setLoading(false);
        } else {
          // No cached data, fetch all metadata
          await fetchAllMetadata();
        }
      } catch (err) {
        console.error("Error loading metadata:", err);
        setError(err.message || "Failed to load metadata");
        setLoading(false);
      }
    };
    
    fetchInitialMetadata();
  }, []);
  
  // Fetch all metadata from API
  const fetchAllMetadata = async () => {
    setUpdating(true);
    setError('');
    
    try {
      const results = await Promise.all([
        metadataService.getGitHubTokens(),
        metadataService.getOogaBoogaTokens(),
        metadataService.getVaults(),
        metadataService.getValidators()
      ]);
      
      setMetadata({
        githubTokens: results[0].success ? { data: results[0].tokens, timestamp: Date.now() } : null,
        oogaBoogaTokens: results[1].success ? { data: results[1].tokens, timestamp: Date.now() } : null,
        vaults: results[2].success ? { data: results[2].vaults, timestamp: Date.now() } : null,
        validators: results[3].success ? { data: results[3].validators, timestamp: Date.now() } : null,
        lastUpdate: Date.now()
      });
      
      localStorage.setItem('berabundle_metadata_last_update', Date.now().toString());
    } catch (err) {
      console.error("Error fetching metadata:", err);
      setError(err.message || "Failed to fetch metadata");
    } finally {
      setUpdating(false);
      setLoading(false);
    }
  };

  // Update all metadata from sources
  const handleUpdateAll = async () => {
    setUpdating(true);
    setError('');
    
    try {
      const result = await metadataService.updateAllMetadata();
      
      if (result.success) {
        // Refresh metadata status
        setMetadata(metadataService.getAllMetadataStatus());
      } else {
        setError(result.error || "Failed to update metadata");
      }
    } catch (err) {
      console.error("Error updating metadata:", err);
      setError(err.message || "Failed to update metadata");
    } finally {
      setUpdating(false);
    }
  };

  // Format timestamp to readable date
  const formatDate = (timestamp) => {
    if (!timestamp) return 'Never';
    
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Calculate time ago string
  const getTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    
    const now = Date.now();
    const diff = now - timestamp;
    
    // Less than a minute
    if (diff < 60 * 1000) {
      return 'just now';
    }
    
    // Minutes
    if (diff < 60 * 60 * 1000) {
      const minutes = Math.floor(diff / (60 * 1000));
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }
    
    // Hours
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }
    
    // Days
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  };

  // Show loading state
  if (loading) {
    return (
      <div className="metadata-manager">
        <h3>Metadata Status</h3>
        <div className="metadata-loading">
          <div className="loading-spinner"></div>
          <p>Loading metadata...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="metadata-manager">
      <h3>Metadata Status</h3>
      
      {/* GitHub Tokens */}
      <div className="metadata-card">
        <div className="metadata-header">
          <h4 className="metadata-title">GitHub Tokens</h4>
        </div>
        <div className="metadata-content">
          <div className="metadata-stats">
            <div className="metadata-stat">
              <div className="metadata-stat-label">Count</div>
              <div className="metadata-stat-value">
                {metadata.githubTokens ? Array.isArray(metadata.githubTokens.data) ? metadata.githubTokens.data.length : Object.keys(metadata.githubTokens.data).length : 'Not loaded'}
              </div>
            </div>
            <div className="metadata-stat">
              <div className="metadata-stat-label">Last Updated</div>
              <div className="metadata-stat-value">
                {metadata.githubTokens ? getTimeAgo(metadata.githubTokens.timestamp) : 'Never'}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* OogaBooga Tokens */}
      <div className="metadata-card">
        <div className="metadata-header">
          <h4 className="metadata-title">OogaBooga Tokens</h4>
        </div>
        <div className="metadata-content">
          <div className="metadata-stats">
            <div className="metadata-stat">
              <div className="metadata-stat-label">Count</div>
              <div className="metadata-stat-value">
                {metadata.oogaBoogaTokens ? 
                  (metadata.oogaBoogaTokens.data && metadata.oogaBoogaTokens.data.count) || 
                  metadata.oogaBoogaTokens.count || 
                  (metadata.oogaBoogaTokens.data ? Object.keys(metadata.oogaBoogaTokens.data).length : 0) || 
                  'Not loaded' 
                  : 'Not loaded'}
              </div>
            </div>
            <div className="metadata-stat">
              <div className="metadata-stat-label">Last Updated</div>
              <div className="metadata-stat-value">
                {metadata.oogaBoogaTokens ? getTimeAgo(metadata.oogaBoogaTokens.timestamp) : 'Never'}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Vaults */}
      <div className="metadata-card">
        <div className="metadata-header">
          <h4 className="metadata-title">Vaults</h4>
        </div>
        <div className="metadata-content">
          <div className="metadata-stats">
            <div className="metadata-stat">
              <div className="metadata-stat-label">Count</div>
              <div className="metadata-stat-value">
                {metadata.vaults ? metadata.vaults.count || (metadata.vaults.data ? metadata.vaults.data.length : 0) : 'Not loaded'}
              </div>
            </div>
            <div className="metadata-stat">
              <div className="metadata-stat-label">Last Updated</div>
              <div className="metadata-stat-value">
                {metadata.vaults ? getTimeAgo(metadata.vaults.timestamp) : 'Never'}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Validators */}
      <div className="metadata-card">
        <div className="metadata-header">
          <h4 className="metadata-title">Validators</h4>
        </div>
        <div className="metadata-content">
          <div className="metadata-stats">
            <div className="metadata-stat">
              <div className="metadata-stat-label">Count</div>
              <div className="metadata-stat-value">
                {metadata.validators ? metadata.validators.count || (metadata.validators.data ? metadata.validators.data.length : 0) : 'Not loaded'}
              </div>
            </div>
            <div className="metadata-stat">
              <div className="metadata-stat-label">Last Updated</div>
              <div className="metadata-stat-value">
                {metadata.validators ? getTimeAgo(metadata.validators.timestamp) : 'Never'}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Controls */}
      <div className="metadata-controls">
        <button 
          onClick={handleUpdateAll}
          disabled={updating}
          className="update-button"
        >
          {updating ? 'Updating...' : 'Update All Metadata'}
        </button>
      </div>
      
      {/* Last update timestamp */}
      {metadata.lastUpdate && (
        <div className="last-update">
          <p>Last updated: {formatDate(metadata.lastUpdate)}</p>
        </div>
      )}
      
      {/* Error message */}
      {error && (
        <div className="metadata-error">
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}

export default MetadataManager;