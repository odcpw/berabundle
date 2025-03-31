/**
 * FSHelpers - File system utilities for the BeraBundle application
 * 
 * This utility class provides centralized methods for:
 * - Directory creation and verification
 * - File existence checking
 * - Security operations like clipboard clearing
 * 
 * These utilities are used across the application to ensure
 * consistent file system operations and error handling.
 */

const fs = require('fs').promises;
const config = require('../config');
const { execPromise } = require('./execPromise');
const { ErrorHandler } = require('./errorHandler');

/**
 * Helper functions for file system operations
 */
class FSHelpers {
    /**
     * Creates all required application directories if they don't exist
     * 
     * Ensures that the output, metadata, and user preferences directories
     * defined in the application config are available. Creates them with
     * recursive mode if needed.
     * 
     * @returns {Promise<boolean>} True if all directories were verified/created, false otherwise
     */
    static async ensureDirectoriesExist() {
        try {
            const directories = [
                config.paths.outputDir,
                config.paths.metadataDir,
                config.paths.userprefsDir
            ];
            
            console.log("Ensuring all required directories exist...");
            
            for (const dir of directories) {
                try {
                    await fs.mkdir(dir, { recursive: true });
                    console.log(`Directory verified: ${dir}`);
                } catch (error) {
                    console.error(`Error creating directory ${dir}: ${error.message}`);
                }
            }
            
            return true;
        } catch (error) {
            ErrorHandler.handle(error, 'FSHelpers.ensureDirectoriesExist');
            return false;
        }
    }

    /**
     * Checks if a file exists at the specified path
     * 
     * This is a centralized utility method used throughout the application
     * to safely check for file existence without throwing exceptions.
     * 
     * @param {string} filePath - Absolute path to the file to check
     * @returns {Promise<boolean>} True if the file exists and is accessible, false otherwise
     */
    static async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Clears the system clipboard for security purposes
     * 
     * Used after sensitive information (like private keys) might have been
     * copied to the clipboard. Provides platform-specific implementations
     * for Linux, macOS and Windows.
     * 
     * @returns {Promise<boolean>} True if clipboard was successfully cleared, false otherwise
     */
    static async clearClipboard() {
        try {
            // Different clipboard clearing commands for different OS
            let command = '';
            let timeout = 1000; // 1 second timeout for clipboard operation
            
            if (process.platform === 'linux') {
                // Check if xclip is installed first
                try {
                    await execPromise('which xclip', { timeout: 500 });
                    command = 'echo -n "" | xclip -selection clipboard';
                } catch (e) {
                    // Skip clipboard clearing if xclip isn't installed
                    return true;
                }
            } else if (process.platform === 'darwin') {
                // For macOS
                command = 'pbcopy < /dev/null';
            } else if (process.platform === 'win32') {
                // For Windows
                command = 'echo | clip';
            } else {
                // Skip for unsupported platforms
                return true;
            }
            
            if (command) {
                await execPromise(command, { timeout });
            }
            
            return true;
        } catch (error) {
            return false; // Indicate failure to clear clipboard
        }
    }
}

module.exports = FSHelpers;