/**
 * bundleRepository.js - Repository for storing and retrieving bundles
 * 
 * This module handles the storage of generated transaction bundles, allowing them
 * to be saved, retrieved, and managed.
 */

const FileStorage = require('../engines/fileStorage');
const path = require('path');
const config = require('../../config');

/**
 * Repository for managing transaction bundles
 */
class BundleRepository {
    /**
     * Create a new BundleRepository
     * @param {Object} options - Repository options
     */
    constructor(options = {}) {
        this.storage = new FileStorage({ 
            baseDir: options.bundleDir || config.paths.outputDir 
        });
    }
    
    /**
     * Initialize the repository
     * @returns {Promise<boolean>} Success flag
     */
    async initialize() {
        return this.storage.initialize();
    }
    
    /**
     * Generate a filename for a bundle
     * @param {string} name - Wallet or account name
     * @param {string} type - Bundle type (claim, boost, swap)
     * @param {string} format - Output format (eoa, safe_ui, etc.)
     * @returns {string} Generated filename
     */
    generateFilename(name, type, format) {
        // Create a human-readable timestamp
        const now = new Date();
        const dateStr = now.toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .slice(0, 19); // Format: YYYY-MM-DD_HH-MM-SS
            
        // Convert name to safe filename format
        const safeName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        
        // Create filename with human-readable date first, followed by type and format
        return `${type}_${dateStr}_${safeName}_${format}.json`;
    }
    
    /**
     * Save a bundle to storage
     * @param {Object} bundle - Bundle data
     * @param {string} name - Wallet or account name
     * @param {string} type - Bundle type (claim, boost, swap)
     * @param {string} format - Output format (eoa, safe_ui, etc.)
     * @returns {Promise<Object>} Result with filepath and additional information
     */
    async saveBundle(bundle, name, type, format) {
        try {
            // Generate appropriate filename
            const filename = this.generateFilename(name, type, format);
            
            // Save the bundle
            const success = await this.storage.saveToFile(filename, bundle);
            
            if (!success) {
                throw new Error('Failed to save bundle');
            }
            
            // Return result with filepath
            const filepath = path.join(this.storage.baseDir, filename);
            return {
                success: true,
                filepath,
                filename,
                format
            };
        } catch (error) {
            console.error('Error saving bundle:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Load a bundle from storage
     * @param {string} filename - Bundle filename
     * @returns {Promise<Object>} Bundle data
     */
    async loadBundle(filename) {
        return this.storage.loadFromFile(filename);
    }
    
    /**
     * List all bundles
     * @param {Object} options - List options
     * @returns {Promise<Array<Object>>} Bundle list with metadata
     */
    async listBundles(options = {}) {
        const { type, format, limit, sortBy = 'date', order = 'desc' } = options;
        
        try {
            // Get all bundle files
            let files = await this.storage.listFiles('', '.+\\.json$');
            
            // Filter by type and format if specified
            if (type || format) {
                const typeRegex = type ? new RegExp(`^${type}_`) : null;
                const formatRegex = format ? new RegExp(`_${format}\\.json$`) : null;
                
                files = files.filter(file => {
                    if (typeRegex && !typeRegex.test(file)) return false;
                    if (formatRegex && !formatRegex.test(file)) return false;
                    return true;
                });
            }
            
            // Get file metadata
            const bundles = await Promise.all(files.map(async (file) => {
                try {
                    // Extract metadata from filename
                    const [type, date, time, name, format] = file
                        .replace(/\.json$/, '')
                        .split('_');
                        
                    // Get file stats
                    const filePath = path.join(this.storage.baseDir, file);
                    const stats = await this.storage.fs.stat(filePath);
                    
                    // Parse date from filename
                    const dateStr = `${date}T${time.replace(/-/g, ':')}Z`;
                    const timestamp = new Date(dateStr).getTime();
                    
                    return {
                        filename: file,
                        type,
                        name,
                        format: format.replace(/\.json$/, ''),
                        timestamp,
                        date: dateStr,
                        size: stats.size,
                        created: stats.ctime
                    };
                } catch (err) {
                    // Skip files that don't match expected format
                    return null;
                }
            }));
            
            // Filter out nulls and sort
            const validBundles = bundles.filter(bundle => bundle !== null);
            
            // Sort bundles
            validBundles.sort((a, b) => {
                let valueA, valueB;
                
                switch (sortBy) {
                    case 'date':
                        valueA = a.timestamp;
                        valueB = b.timestamp;
                        break;
                    case 'name':
                        valueA = a.name;
                        valueB = b.name;
                        break;
                    case 'type':
                        valueA = a.type;
                        valueB = b.type;
                        break;
                    case 'size':
                        valueA = a.size;
                        valueB = b.size;
                        break;
                    default:
                        valueA = a.timestamp;
                        valueB = b.timestamp;
                }
                
                // Compare based on order
                if (order === 'desc') {
                    return valueB > valueA ? 1 : -1;
                } else {
                    return valueA > valueB ? 1 : -1;
                }
            });
            
            // Apply limit if specified
            if (limit && limit > 0) {
                return validBundles.slice(0, limit);
            }
            
            return validBundles;
        } catch (error) {
            console.error('Error listing bundles:', error);
            return [];
        }
    }
    
    /**
     * Delete a bundle
     * @param {string} filename - Bundle filename
     * @returns {Promise<boolean>} Success flag
     */
    async deleteBundle(filename) {
        return this.storage.deleteFile(filename);
    }
}

module.exports = BundleRepository;