// fsHelpers.js - File system helper functions
const fs = require('fs').promises;
const config = require('./config');
const { execPromise } = require('./execPromise');
const { ErrorHandler } = require('./errorHandler');

/**
 * Helper functions for file system operations
 */
class FSHelpers {
    /**
     * Ensure all required directories exist
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
     * Clear the clipboard for security
     * @returns {Promise<boolean>}
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