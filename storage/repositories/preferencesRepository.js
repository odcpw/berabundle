/**
 * preferencesRepository.js - Repository for user preferences
 * 
 * This module handles storage and retrieval of user preferences, including
 * validator boosting allocations and other settings.
 */

const FileStorage = require('../engines/fileStorage');
const path = require('path');
const config = require('../../config');

/**
 * Repository for user preferences
 */
class PreferencesRepository {
    /**
     * Create a new PreferencesRepository
     * @param {Object} options - Repository options
     */
    constructor(options = {}) {
        this.storage = new FileStorage({ 
            baseDir: options.prefsDir || config.paths.userprefsDir 
        });
        this.boostAllocationFile = 'boost_allocation.json';
        this.preferences = {
            boostAllocations: {} // Maps userAddress -> { validators, allocations }
        };
    }
    
    /**
     * Initialize the repository
     * @returns {Promise<boolean>} Success flag
     */
    async initialize() {
        await this.storage.initialize();
        
        // Load existing preferences
        await this.loadBoostAllocations();
        
        return true;
    }
    
    /**
     * Load validator boost allocations from file
     * @returns {Promise<Object>} Loaded allocations
     */
    async loadBoostAllocations() {
        try {
            const allocations = await this.storage.loadFromFile(this.boostAllocationFile);
            
            if (allocations) {
                this.preferences.boostAllocations = allocations;
            }
            
            return this.preferences.boostAllocations;
        } catch (error) {
            console.error('Error loading boost allocations:', error);
            return {}; 
        }
    }
    
    /**
     * Save validator boost allocations to file
     * @returns {Promise<boolean>} Success flag
     */
    async saveBoostAllocations() {
        try {
            return await this.storage.saveToFile(
                this.boostAllocationFile,
                this.preferences.boostAllocations
            );
        } catch (error) {
            console.error('Error saving boost allocations:', error);
            return false;
        }
    }
    
    /**
     * Get validator boost preferences for a user
     * @param {string} userAddress - User's wallet address
     * @returns {Object} User's preferences
     */
    getUserBoostPreferences(userAddress) {
        // Return a copy of the user's preferences or default empty preferences
        const userPrefs = this.preferences.boostAllocations[userAddress] || {};
        
        return {
            validators: userPrefs.validators ? [...userPrefs.validators] : [],
            allocations: userPrefs.allocations ? {...userPrefs.allocations} : {}
        };
    }
    
    /**
     * Set validator boost preferences for a user
     * @param {string} userAddress - User's wallet address
     * @param {Array} validators - List of validators
     * @param {Object} allocations - Allocation percentages by validator pubkey
     * @returns {Promise<boolean>} Success flag
     */
    async setUserBoostPreferences(userAddress, validators, allocations) {
        try {
            // Ensure allocations object exists
            if (!this.preferences.boostAllocations) {
                this.preferences.boostAllocations = {};
            }
            
            // Update preferences for this user
            this.preferences.boostAllocations[userAddress] = {
                validators,
                allocations
            };
            
            // Save to file
            return await this.saveBoostAllocations();
        } catch (error) {
            console.error('Error setting boost preferences:', error);
            return false;
        }
    }
    
    /**
     * Clear validator boost preferences for a user
     * @param {string} userAddress - User's wallet address
     * @returns {Promise<boolean>} Success flag
     */
    async clearUserBoostPreferences(userAddress) {
        try {
            if (this.preferences.boostAllocations && 
                this.preferences.boostAllocations[userAddress]) {
                // Delete this user's preferences
                delete this.preferences.boostAllocations[userAddress];
                
                // Save to file
                return await this.saveBoostAllocations();
            }
            
            return true;
        } catch (error) {
            console.error('Error clearing boost preferences:', error);
            return false;
        }
    }
}

module.exports = PreferencesRepository;