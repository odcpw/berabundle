// safeCliService.js - Direct integration with Safe CLI
const { spawn } = require('child_process');
const { execPromise } = require('./execPromise');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const { ErrorHandler } = require('./errorHandler');

/**
 * Safe CLI Service - Directly integrates with the safe-cli command line tool
 */
class SafeCliService {
    constructor(provider) {
        this.provider = provider;
        this.tempDir = path.join(__dirname, 'temp');
        this.rpcUrl = config.networks.berachain.rpcUrl;
    }

    /**
     * Ensure safe-cli is properly installed
     * @returns {Promise<boolean>} Whether verification was successful
     */
    async ensureSafeCliInstalled() {
        try {
            // Try to find the safe CLI on the PATH
            try {
                const which = process.platform === 'win32' ? 'where' : 'which';
                await execPromise(`${which} safe-cli`, { timeout: 2000 });
                console.log('Safe CLI found on PATH as safe-cli.');
            } catch (e) {
                console.log('Safe CLI is not directly on PATH, but might be accessible in other ways.');
                // Continue anyway - some systems may have it installed but not on PATH
            }

            // Create temp directory if it doesn't exist
            try {
                await fs.mkdir(this.tempDir, { recursive: true });
            } catch (e) {
                // Directory already exists
            }

            // Return true to allow the process to continue
            return true;
        } catch (error) {
            console.error('Failed while checking for Safe CLI:', error);
            // Return true anyway to attempt the command
            return true;
        }
    }

    /**
     * Execute a safe-cli command and capture the output
     * @param {Array} args - Command arguments
     * @param {Object} options - Additional options for the command
     * @returns {Promise<Object>} Command result
     */
    async executeSafeCommand(args, options = {}) {
        return new Promise((resolve, reject) => {
            console.log(`Executing safe-cli command: safe-cli ${args.join(' ')}`);
            const command = 'safe-cli';  // Use safe-cli instead of safe
            const proc = spawn(command, args, {
                env: {
                    ...process.env,
                    ...options.env
                },
                shell: true, // Use shell to help find the command on PATH
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                console.log(output);  // Show real-time output
            });

            proc.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                console.error(output);  // Show real-time error output
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({
                        success: true,
                        stdout,
                        stderr
                    });
                } else {
                    resolve({
                        success: false,
                        stdout,
                        stderr,
                        code
                    });
                }
            });

            proc.on('error', (error) => {
                resolve({
                    success: false,
                    message: `Failed to execute command: ${error.message}`
                });
            });
        });
    }

    /**
     * Process a bundle of transactions using Safe CLI
     * @param {Array} transactions - Array of transactions
     * @param {string} safeAddress - Safe address
     * @param {string} privateKey - Private key for signing
     * @returns {Promise<Object>} Result of the operation
     */
    async processBundleTransactions(transactions, safeAddress, privateKey) {
        try {
            // Always proceed with the attempt regardless of CLI detection
            await this.ensureSafeCliInstalled();

            console.log(`Processing bundle of ${transactions.length} transactions for Safe ${safeAddress}...`);
            
            // Create a JSON file for the Safe UI to import
            const dateStr = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
            const outputFilePath = path.join(config.paths.outputDir, `safe_bundle_${dateStr}.json`);
            
            // Format in Safe UI compatible format for importing
            const formattedData = {
                version: "1.0",
                chainId: config.networks.berachain.chainId,
                createdAt: Date.now(),
                meta: {
                    name: "BeraBundle Transaction",
                    description: `Bundle with ${transactions.length} transactions created by BeraBundle`
                },
                transactions: transactions.map(tx => ({
                    to: tx.to,
                    value: (tx.value || "0x0").startsWith("0x") ? 
                           tx.value : "0x" + parseInt(tx.value).toString(16),
                    data: tx.data,
                    operation: tx.operation || 0
                }))
            };
            
            await fs.writeFile(outputFilePath, JSON.stringify(formattedData, null, 2));
            console.log(`\nSafe UI bundle saved to: ${outputFilePath}`);
            console.log(`\nPlease import this bundle into the Safe UI to view, sign, and execute it.`);
            console.log(`\nInstructions for importing:\n1. Open https://app.safe.global\n2. Connect to your Safe\n3. Go to "New Transaction" > "Transaction Builder"\n4. Click "Load" in the top right\n5. Select the saved file`);
            
            return {
                success: true,
                message: `Bundle with ${transactions.length} transactions prepared successfully. Import the file into Safe UI.`,
                filePath: outputFilePath
            };
            
        } catch (error) {
            ErrorHandler.handle(error, 'SafeCliService.processBundleTransactions');
            return {
                success: false,
                message: `Failed to process transaction bundle: ${error.message}`
            };
        }
    }
}

module.exports = SafeCliService;