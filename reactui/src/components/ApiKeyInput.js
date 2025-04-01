import React, { useState } from 'react';

/**
 * Component for inputting and saving API keys
 * 
 * @param {Object} props Component props
 * @param {function} props.onSave Callback for when API key is saved
 * @param {string} props.savedKey Currently saved API key
 */
function ApiKeyInput({ onSave, savedKey }) {
  const [apiKey, setApiKey] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (apiKey.trim()) {
      onSave(apiKey.trim());
      setApiKey('');
    }
  };
  
  return (
    <div className="api-key-input">
      <h3>OogaBooga API Key</h3>
      <p>
        An API key is required to fetch token prices from OogaBooga.
        {savedKey && ' You have already set an API key.'}
      </p>
      
      <form onSubmit={handleSubmit}>
        <div className="input-group">
          <input
            type={isVisible ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your OogaBooga API key"
            className="api-key-field"
          />
          <button 
            type="button" 
            onClick={() => setIsVisible(!isVisible)}
            className="toggle-visibility"
          >
            {isVisible ? 'Hide' : 'Show'}
          </button>
        </div>
        
        <button 
          type="submit" 
          disabled={!apiKey.trim()}
          className="save-button"
        >
          Save API Key
        </button>
      </form>
      
      {savedKey && (
        <div className="key-status">
          <p>Status: ✅ API key is set</p>
        </div>
      )}
    </div>
  );
}

export default ApiKeyInput;