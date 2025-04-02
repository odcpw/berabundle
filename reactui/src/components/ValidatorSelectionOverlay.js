import React, { useState, useEffect } from 'react';
import './ValidatorSelectionOverlay.css';
import metadataService from '../services/MetadataService';

/**
 * Validator Selection Overlay
 * 
 * This component allows users to select validators and set allocation percentages
 * similar to the CLI validator selection flow.
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen Whether the overlay is open
 * @param {function} props.onClose Function to close the overlay
 * @param {string} props.userAddress User's wallet address
 * @param {function} props.onSubmit Function to call when user submits selections
 * @param {Object} props.existingPreferences Existing validator preferences if any
 */
function ValidatorSelectionOverlay({ 
  isOpen, 
  onClose, 
  userAddress, 
  onSubmit,
  existingPreferences = null
}) {
  // States
  const [step, setStep] = useState('select'); // 'select', 'allocate', 'review'
  const [validators, setValidators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Selection states
  const [selectedValidators, setSelectedValidators] = useState([]);
  const [allocations, setAllocations] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  
  // Load validators on mount
  useEffect(() => {
    if (isOpen) {
      loadValidators();
    }
  }, [isOpen]);
  
  // Load existing preferences if provided
  useEffect(() => {
    if (existingPreferences) {
      if (existingPreferences.validators && existingPreferences.validators.length > 0) {
        setSelectedValidators(existingPreferences.validators);
      }
      
      if (existingPreferences.allocations) {
        setAllocations(existingPreferences.allocations);
      }
    }
  }, [existingPreferences]);
  
  // Load validators from the metadata service
  const loadValidators = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // First check if we already have validators in cache
      let validatorsResult = await metadataService.getValidators();
      
      if (!validatorsResult.success || !validatorsResult.validators || 
          !validatorsResult.validators.data || validatorsResult.validators.data.length === 0) {
        // If not, fetch them from source
        console.log('No validators in cache, fetching from source...');
        validatorsResult = await metadataService.fetchValidators();
      }
      
      if (validatorsResult.success && validatorsResult.validators && 
          validatorsResult.validators.data && validatorsResult.validators.data.length > 0) {
        
        // Convert validators to a consistent format
        const formattedValidators = validatorsResult.validators.data.map(validator => ({
          id: validator.id,
          pubkey: validator.id, // Use id as pubkey
          name: validator.name || `Validator ${validator.id.substring(0, 8)}`,
          description: validator.description || '',
          website: validator.website || '',
          logo: validator.logo || '',
          commission: validator.commission || '0%'
        }));
        
        // Sort alphabetically by name
        formattedValidators.sort((a, b) => a.name.localeCompare(b.name));
        
        setValidators(formattedValidators);
      } else {
        setError('Failed to load validators. Please try again.');
      }
    } catch (err) {
      console.error('Error loading validators:', err);
      setError('Error loading validators: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };
  
  // Handle validator selection toggle
  const toggleValidator = (validator) => {
    const isSelected = selectedValidators.some(v => v.pubkey === validator.pubkey);
    
    if (isSelected) {
      // Remove from selections
      setSelectedValidators(selectedValidators.filter(v => v.pubkey !== validator.pubkey));
      
      // Remove from allocations
      const newAllocations = { ...allocations };
      delete newAllocations[validator.pubkey];
      setAllocations(newAllocations);
    } else {
      // Add to selections
      setSelectedValidators([...selectedValidators, validator]);
    }
  };
  
  // Move to allocation step
  const goToAllocationStep = () => {
    if (selectedValidators.length === 0) {
      setError('Please select at least one validator.');
      return;
    }
    
    // Create default equal allocations
    const defaultAllocation = Math.floor(100 / selectedValidators.length);
    const remainder = 100 - (defaultAllocation * selectedValidators.length);
    
    const newAllocations = {};
    selectedValidators.forEach((validator, index) => {
      // Add the remainder to the first validator
      newAllocations[validator.pubkey] = index === 0 ? defaultAllocation + remainder : defaultAllocation;
    });
    
    setAllocations(newAllocations);
    setStep('allocate');
  };
  
  // Handle allocation change
  const handleAllocationChange = (pubkey, value) => {
    // Ensure value is a number
    const numericValue = parseInt(value);
    
    if (isNaN(numericValue)) return;
    
    // Update allocations
    const newAllocations = { ...allocations };
    newAllocations[pubkey] = numericValue;
    setAllocations(newAllocations);
  };
  
  // Calculate total allocation
  const totalAllocation = Object.values(allocations).reduce((sum, value) => sum + value, 0);
  
  // Filter validators based on search term
  const filteredValidators = validators.filter(validator => {
    return validator.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           validator.pubkey.toLowerCase().includes(searchTerm.toLowerCase());
  });
  
  // Submit final selections
  const submitSelections = () => {
    // Make sure allocations add up to 100%
    if (totalAllocation !== 100) {
      setError('Total allocation must equal 100%. Current total: ' + totalAllocation + '%');
      return;
    }
    
    // Call the onSubmit callback with the selections
    onSubmit({
      validators: selectedValidators,
      allocations: allocations
    });
    
    // Close the overlay
    onClose();
  };
  
  // Reset selections
  const resetSelections = () => {
    setShowConfirmation(false);
    setSelectedValidators([]);
    setAllocations({});
    setStep('select');
  };
  
  // Close without saving
  const closeWithoutSaving = () => {
    if (selectedValidators.length > 0 && !showConfirmation) {
      setShowConfirmation(true);
    } else {
      setShowConfirmation(false);
      onClose();
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="validator-overlay">
      <div className="validator-overlay-content">
        <div className="validator-overlay-header">
          <h2>{step === 'select' ? 'Select Validators' : 'Set Allocation Percentages'}</h2>
          <button className="close-button" onClick={closeWithoutSaving}>&times;</button>
        </div>
        
        {error && (
          <div className="validator-error">
            {error}
            <button className="error-dismiss" onClick={() => setError(null)}>×</button>
          </div>
        )}
        
        {showConfirmation && (
          <div className="confirmation-dialog">
            <div className="confirmation-content">
              <h3>Unsaved Changes</h3>
              <p>You have unsaved validator selections. Are you sure you want to close without saving?</p>
              <div className="confirmation-buttons">
                <button onClick={() => setShowConfirmation(false)}>Cancel</button>
                <button className="danger" onClick={() => {
                  setShowConfirmation(false);
                  onClose();
                }}>Close Without Saving</button>
              </div>
            </div>
          </div>
        )}
        
        {loading ? (
          <div className="validator-loading">
            <div className="validator-loader"></div>
            <p>Loading validators...</p>
          </div>
        ) : (
          <>
            {step === 'select' && (
              <div className="validator-selection-step">
                <p className="step-instructions">
                  Select the validators you want to delegate your BGT rewards to.
                </p>
                
                <div className="validator-search">
                  <input
                    type="text"
                    placeholder="Search validators by name or pubkey..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                
                <div className="validator-list">
                  {filteredValidators.length === 0 ? (
                    <div className="no-validators">
                      No validators found matching your search.
                    </div>
                  ) : (
                    filteredValidators.map((validator) => {
                      const isSelected = selectedValidators.some(v => v.pubkey === validator.pubkey);
                      
                      return (
                        <div 
                          key={validator.pubkey}
                          className={`validator-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleValidator(validator)}
                        >
                          <div className="validator-checkbox">
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => {}}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                          <div className="validator-info">
                            <div className="validator-name">{validator.name}</div>
                            <div className="validator-pubkey">{validator.pubkey.substring(0, 10)}...</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                
                <div className="selection-counter">
                  Selected: {selectedValidators.length} validators
                </div>
                
                <div className="validator-buttons">
                  <button 
                    className="secondary-button" 
                    onClick={closeWithoutSaving}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    onClick={goToAllocationStep}
                    disabled={selectedValidators.length === 0}
                  >
                    Next: Set Allocations
                  </button>
                </div>
              </div>
            )}
            
            {step === 'allocate' && (
              <div className="validator-allocation-step">
                <p className="step-instructions">
                  Set the percentage of your BGT rewards to allocate to each validator.
                  Total allocation must equal 100%.
                </p>
                
                <div className="allocation-list">
                  {selectedValidators.map((validator, index) => (
                    <div key={validator.pubkey} className="allocation-item">
                      <div className="allocation-info">
                        <div className="allocation-name">{validator.name}</div>
                        <div className="allocation-pubkey">{validator.pubkey.substring(0, 10)}...</div>
                      </div>
                      <div className="allocation-input">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={allocations[validator.pubkey] || 0}
                          onChange={(e) => handleAllocationChange(validator.pubkey, e.target.value)}
                        />
                        <span className="percentage-sign">%</span>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className={`allocation-total ${totalAllocation !== 100 ? 'error' : ''}`}>
                  Total: {totalAllocation}% {totalAllocation !== 100 ? '(Must equal 100%)' : '✓'}
                </div>
                
                <div className="validator-buttons">
                  <button 
                    className="secondary-button" 
                    onClick={() => setStep('select')}
                  >
                    Back to Selection
                  </button>
                  <button
                    className="primary-button"
                    onClick={submitSelections}
                    disabled={totalAllocation !== 100}
                  >
                    Save Preferences
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ValidatorSelectionOverlay;