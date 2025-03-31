/**
 * progressTracker.js - Progress tracking for long-running operations
 * 
 * This module provides a simple progress tracking mechanism for CLI operations
 * that take a significant amount of time.
 */

/**
 * Class for tracking progress of operations
 */
class ProgressTracker {
    /**
     * Create a new ProgressTracker
     * @param {Object} options - Tracker options
     */
    constructor(options = {}) {
        this.active = false;
        this.startTime = 0;
        this.current = 0;
        this.total = options.total || 100;
        this.status = options.status || 'Processing...';
        this.lastLoggedPercentage = 0;
        this.logInterval = options.logInterval || 10; // Log every 10%
        this.silent = options.silent || false;
    }
    
    /**
     * Start tracking progress
     * @param {number} total - Total steps (default: 100)
     * @param {string} status - Operation description
     */
    start(total = 100, status = 'Processing...') {
        this.active = true;
        this.startTime = Date.now();
        this.current = 0;
        this.total = total;
        this.status = status;
        this.lastLoggedPercentage = 0;
        
        if (!this.silent) {
            console.log(`\nStarting: ${status}`);
        }
    }
    
    /**
     * Update progress
     * @param {number} value - Current progress value
     * @param {string} status - Updated status message (optional)
     */
    update(value, status = null) {
        if (!this.active) return;
        
        // Update progress tracking
        this.current = value;
        
        if (status !== null) {
            this.status = status;
        }
        
        const percentage = Math.round((value / this.total) * 100);
        
        // Only log at certain intervals to avoid console spam
        if (percentage - this.lastLoggedPercentage >= this.logInterval || percentage === 100) {
            if (!this.silent) {
                console.log(`[${percentage}%] ${this.status} (${value}/${this.total})`);
            }
            this.lastLoggedPercentage = percentage;
        }
    }
    
    /**
     * Stop tracking and report final status
     */
    stop() {
        if (!this.active) return;
        
        const duration = (Date.now() - this.startTime) / 1000;
        const percentage = Math.round((this.current / this.total) * 100);
        
        if (!this.silent) {
            console.log(`\n✅ Completed: ${this.current}/${this.total} (${percentage}%) in ${duration.toFixed(1)}s - ${this.status || 'Done'}\n`);
        }
        
        this.active = false;
    }
    
    /**
     * Create a callback function that updates progress
     * This is useful for passing to methods that expect a progress callback
     * @returns {Function} Progress callback function
     */
    createCallback() {
        return (current, total, status) => {
            this.update(current, status);
        };
    }
}

module.exports = ProgressTracker;