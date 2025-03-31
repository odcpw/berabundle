/**
 * fileStorage.js - File-based storage engine
 * 
 * Provides utilities for storing and retrieving data in the filesystem.
 * Used as the base for all file-based storage in the application.
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');

/**
 * File-based storage engine
 */
class FileStorage {
    /**
     * Create a new FileStorage instance
     * @param {Object} options - Storage options
     */
    constructor(options = {}) {
        this.baseDir = options.baseDir || config.paths.userprefsDir;
    }
    
    /**
     * Initialize the storage engine
     * @returns {Promise<boolean>} Success flag
     */
    async initialize() {
        // Ensure base directory exists
        await this.ensureDirectory(this.baseDir);
        return true;
    }
    
    /**
     * Ensure a directory exists
     * @param {string} dirPath - Directory path
     * @returns {Promise<void>}
     */
    async ensureDirectory(dirPath) {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }
    
    /**
     * Get a full path for a filename
     * @param {string} filename - Base filename
     * @returns {string} Full file path
     */
    getFilePath(filename) {
        return path.join(this.baseDir, filename);
    }
    
    /**
     * Save data to a file
     * @param {string} filename - File to save to
     * @param {Object|string} data - Data to save
     * @returns {Promise<boolean>} Success flag
     */
    async saveToFile(filename, data) {
        const filePath = this.getFilePath(filename);
        const serializedData = typeof data === 'string' 
            ? data 
            : JSON.stringify(data, null, 2);
            
        try {
            await this.ensureDirectory(path.dirname(filePath));
            await fs.writeFile(filePath, serializedData, 'utf8');
            return true;
        } catch (error) {
            console.error(`Error saving to file ${filePath}:`, error);
            return false;
        }
    }
    
    /**
     * Load data from a file
     * @param {string} filename - File to load from
     * @param {boolean} parseJson - Whether to parse as JSON
     * @returns {Promise<Object|string|null>} Loaded data or null if file doesn't exist
     */
    async loadFromFile(filename, parseJson = true) {
        const filePath = this.getFilePath(filename);
        
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return parseJson ? JSON.parse(data) : data;
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist
                return null;
            }
            console.error(`Error loading from file ${filePath}:`, error);
            return null;
        }
    }
    
    /**
     * Delete a file
     * @param {string} filename - File to delete
     * @returns {Promise<boolean>} Success flag
     */
    async deleteFile(filename) {
        const filePath = this.getFilePath(filename);
        
        try {
            await fs.unlink(filePath);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, consider it a success
                return true;
            }
            console.error(`Error deleting file ${filePath}:`, error);
            return false;
        }
    }
    
    /**
     * List files in a directory
     * @param {string} subdir - Subdirectory to list (relative to base dir)
     * @param {string} pattern - Optional filter pattern
     * @returns {Promise<Array<string>>} List of filenames
     */
    async listFiles(subdir = '', pattern = null) {
        const dirPath = path.join(this.baseDir, subdir);
        
        try {
            // Ensure directory exists
            await this.ensureDirectory(dirPath);
            
            // Get all files
            const files = await fs.readdir(dirPath);
            
            // Filter by pattern if provided
            if (pattern) {
                const regex = new RegExp(pattern);
                return files.filter(file => regex.test(file));
            }
            
            return files;
        } catch (error) {
            console.error(`Error listing files in ${dirPath}:`, error);
            return [];
        }
    }
}

module.exports = FileStorage;