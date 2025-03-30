// uiHandler-inquirer.js - Drop-in replacement for uiHandler.js using Inquirer.js
const inquirer = require('inquirer');
const chalk = require('chalk');

/**
 * Handles CLI user interface interactions using Inquirer.js
 * Maintains the same interface as the original UIHandler for compatibility
 */
class UIHandler {
    constructor() {
        // Create a simpler progress tracking object - no animated bar
        this.progress = {
            total: 0,
            current: 0,
            startTime: 0,
            status: '',
            active: false
        };
    }

    /**
     * Clear the console
     */
    clearScreen() {
        console.clear();
    }

    /**
     * Display application header
     * @param {string} title - Title to display
     */
    displayHeader(title) {
        console.log(chalk.bold.cyan("\n" + title));
        console.log(chalk.cyan("════════════════════════════════════════════════════════════"));
    }

    /**
     * Display application footer
     */
    displayFooter() {
        console.log(chalk.cyan("════════════════════════════════════════════════════════════\n"));
    }

    /**
     * Display a menu with proper spacing
     * @param {Array<{key: string, label: string, separator: boolean}>} options - Menu options
     */
    displayMenu(options) {
        // This is kept for compatibility but is not actually used for rendering
        // with Inquirer.js - the menu is rendered by getSelection
    }

    /**
     * Get user input with same interface as original
     * @param {string} question - Question to ask
     * @param {Function} validator - Optional validation function
     * @param {string} errorMessage - Optional error message for invalid input
     * @returns {Promise<string>} User input
     */
    async getUserInput(question, validator = null, errorMessage = 'Invalid input') {
        // Convert the validator function to Inquirer format
        const inquirerValidator = validator ? 
            (input) => validator(input) || errorMessage : 
            () => true;

        const result = await inquirer.prompt([
            {
                type: 'input',
                name: 'answer',
                message: question,
                validate: inquirerValidator
            }
        ]);
        
        return result.answer.trim();
    }

    /**
     * Get user selection from a menu
     * @param {Array<{key: string, label: string, value: any}>} options - Menu options
     * @param {string} prompt - Prompt to display
     * @returns {Promise<any>} Selected value
     */
    async getSelection(options, prompt = 'Enter your choice:') {
        // Filter out spacers and convert our option format to Inquirer format
        const choices = options
            .filter(option => option.value !== 'spacer') // Remove spacers
            .map(option => ({
                name: option.label,
                value: option.value,
                short: option.key
            }));
        
        // Add spacers as separators
        let inquirerChoices = [];
        let lastWasSeparator = false;
        
        options.forEach(option => {
            if (option.value === 'spacer') {
                if (!lastWasSeparator) {
                    inquirerChoices.push(new inquirer.Separator());
                    lastWasSeparator = true;
                }
            } else {
                inquirerChoices.push({
                    name: option.label,
                    value: option.value,
                    short: option.key
                });
                lastWasSeparator = false;
            }
        });
        
        const result = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: prompt,
                choices: inquirerChoices
            }
        ]);
        
        return result.choice;
    }

    /**
     * Display wallet list
     * @param {Object} wallets - Wallet object {name: address}
     */
    displayWallets(wallets) {
        console.log("\nCurrent Wallets:");
        
        const walletEntries = Object.entries(wallets);
        if (walletEntries.length === 0) {
            console.log(chalk.yellow("No wallets found."));
            return walletEntries;
        }
        
        walletEntries.forEach(([name, address], index) => {
            console.log(`${chalk.yellow(index + 1)}. ${chalk.white(name)} (${chalk.gray(address)})`);
        });
        
        return walletEntries;
    }

    /**
     * Pause execution until user presses Enter
     * @param {string} message - Message to display
     * @returns {Promise<void>} Promise that resolves when user presses Enter
     */
    async pause(message = 'Press Enter to continue...') {
        await inquirer.prompt([
            {
                type: 'input',
                name: 'continue',
                message: `\n${message}`,
                prefix: ''
            }
        ]);
    }

    /**
     * Confirm an action
     * @param {string} message - Confirmation message
     * @returns {Promise<boolean>} Whether the user confirmed
     */
    async confirm(message) {
        const result = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirmed',
                message: message,
                default: true
            }
        ]);
        
        return result.confirmed;
    }

    /**
     * Start a progress process (replaced progress bar with simple logging)
     * @param {number} total - Total steps
     * @param {string} status - Initial status
     */
    startProgress(total, status = 'Processing...') {
        // Initialize progress tracking
        this.progress = {
            total: total,
            current: 0,
            startTime: Date.now(),
            status: status,
            active: true,
            lastLoggedPercentage: 0
        };
        
        // Log the start of the process
        console.log(`\n[0%] ${status} (0/${total})`);
    }

    /**
     * Update the progress (replaced progress bar with simple logging)
     * @param {number} value - Current progress value
     * @param {string} status - Current status
     */
    updateProgress(value, status = null) {
        if (!this.progress.active) return;
        
        // Update progress tracking
        this.progress.current = value;
        if (status) {
            this.progress.status = status;
        }
        
        // Calculate percentage
        const percentage = Math.round((value / this.progress.total) * 100);
        
        // Only log if percentage changed significantly (prevent excessive logging)
        if (percentage - this.progress.lastLoggedPercentage >= 10 || percentage === 100) {
            console.log(`[${percentage}%] ${this.progress.status} (${value}/${this.progress.total})`);
            this.progress.lastLoggedPercentage = percentage;
        }
    }

    /**
     * Stop the progress tracking
     */
    stopProgress() {
        if (!this.progress.active) return;
        
        // Calculate final metrics
        const duration = (Date.now() - this.progress.startTime) / 1000;
        const percentage = Math.round((this.progress.current / this.progress.total) * 100);
        
        // Log completion
        console.log(`\n✅ Completed: ${this.progress.current}/${this.progress.total} (${percentage}%) in ${duration.toFixed(1)}s - ${this.progress.status || 'Done'}\n`);
        
        // Mark as inactive
        this.progress.active = false;
    }

    /**
     * Format a reward summary
     * @param {Array|Object} rewardsData - Rewards data (can be array of rewards or object with rewards and validatorBoosts)
     * @returns {string} Formatted summary
     */
    formatRewardSummary(rewardsData) {
        // Handle new format where we might have a combined object
        const rewards = Array.isArray(rewardsData) ? rewardsData : (rewardsData.rewards || []);
        const validatorBoosts = !Array.isArray(rewardsData) && rewardsData.validatorBoosts ? rewardsData.validatorBoosts : [];
        
        if ((!rewards || rewards.length === 0) && (!validatorBoosts || validatorBoosts.length === 0)) {
            return chalk.yellow("No rewards or validator boosts found.");
        }
        
        let output = "";
        let totalBGTRewards = 0;
        let totalHONEYRewards = 0;
        let rewardsByToken = {};
        
        // Process rewards
        if (rewards && rewards.length > 0) {
            output += chalk.cyan("Claimable Rewards:\n");
            
            rewards.forEach(item => {
                if (parseFloat(item.earned) > 0) {
                    const tokenSymbol = item.rewardToken.symbol;
                    const amount = parseFloat(item.earned);
                    
                    if (!rewardsByToken[tokenSymbol]) {
                        rewardsByToken[tokenSymbol] = 0;
                    }
                    rewardsByToken[tokenSymbol] += amount;
                    
                    if (tokenSymbol === 'BGT') {
                        totalBGTRewards += amount;
                    } else if (tokenSymbol === 'HONEY') {
                        totalHONEYRewards += amount;
                    }
                    
                    if (item.type === 'bgtStaker') {
                        output += `${chalk.white(item.name || 'BGT Staker')}\n`;
                        output += `  ${chalk.green(amount.toFixed(2))} ${tokenSymbol}\n`;
                    } else if (item.type === 'delegationRewards') {
                        output += `${chalk.white(item.name || 'Delegation Rewards')}\n`;
                        // For potential rewards (with isPotentialReward flag)
                        if (item.isPotentialReward) {
                            output += `  ${chalk.yellow('Potential rewards available (amount unknown)')}\n`;
                        } else {
                            output += `  ${chalk.green(amount.toFixed(2))} ${tokenSymbol}\n`;
                        }
                    } else {
                        // For vaults, show the name and protocol if available
                        const name = item.name || item.vaultAddress;
                        const protocol = item.protocol ? ` on ${item.protocol}` : '';
                        output += `${chalk.white(name)}${chalk.gray(protocol)}\n`;
                        output += `  ${chalk.green(amount.toFixed(2))} ${tokenSymbol}\n`;
                    }
                }
            });
        }
        
        // Process active validator boosts
        if (validatorBoosts && validatorBoosts.activeBoosts && validatorBoosts.activeBoosts.length > 0) {
            if (output) output += "\n";
            output += chalk.cyan("Active Validator Boosts:\n");
            
            let totalActiveBoost = 0;
            validatorBoosts.activeBoosts.forEach(validator => {
                const boostAmount = parseFloat(validator.userBoostAmount);
                totalActiveBoost += boostAmount;
                
                output += `${chalk.white(validator.name)} (${chalk.gray(validator.pubkey.substring(0, 10))}...)\n`;
                output += `  ${chalk.blue(boostAmount.toFixed(2))} BGT (${chalk.blue(validator.share)}% share)\n`;
            });
            
            output += chalk.cyan("\nTotal Active BGT Boosts: ") + chalk.blue(`${totalActiveBoost.toFixed(2)} BGT`);
        }
        
        // Process queued validator boosts
        if (validatorBoosts && validatorBoosts.queuedBoosts && validatorBoosts.queuedBoosts.length > 0) {
            if (output) output += "\n";
            output += chalk.cyan("Queued Validator Boosts (pending activation):\n");
            
            let totalQueuedBoost = 0;
            validatorBoosts.queuedBoosts.forEach(validator => {
                const queuedAmount = parseFloat(validator.queuedBoostAmount);
                totalQueuedBoost += queuedAmount;
                
                output += `${chalk.white(validator.name)} (${chalk.gray(validator.pubkey.substring(0, 10))}...)\n`;
                output += `  ${chalk.yellow(queuedAmount.toFixed(2))} BGT (queued)\n`;
            });
            
            output += chalk.cyan("\nTotal Queued BGT Boosts: ") + chalk.yellow(`${totalQueuedBoost.toFixed(2)} BGT`);
        }
        
        // Add token summary
        if (Object.keys(rewardsByToken).length > 0) {
            output += chalk.cyan("\n\nRewards Summary: ");
            Object.entries(rewardsByToken).forEach(([symbol, amount]) => {
                output += chalk.green(`${amount.toFixed(2)} ${symbol} `);
            });
        }
        
        return output;
    }

    /**
     * Create standardized menu options with Back and Quit
     * @param {Array} regularOptions - Regular menu options
     * @param {boolean} includeBack - Whether to include Back option
     * @param {boolean} includeQuit - Whether to include Quit option
     * @param {string} backLabel - Custom label for Back option
     * @param {string} quitLabel - Custom label for Quit option
     * @returns {Array} Complete menu options
     */
    createMenuOptions(regularOptions, includeBack = true, includeQuit = true, backLabel = 'Back to Main Menu', quitLabel = 'Quit') {
        const options = [...regularOptions];
        
        if (includeBack) {
            options.push({ key: 'b', label: backLabel, value: 'back' });
        }
        
        if (includeQuit) {
            options.push({ key: 'q', label: quitLabel, value: 'quit' });
        }
        
        return options;
    }

    /**
     * Get a single key press from the user
     * Uses inquirer to simulate key press functionality
     * @returns {Promise<string>} Key that was pressed
     */
    async getKey() {
        // We'll use inquirer's list to simulate key capture
        // This is a workaround since Inquirer doesn't directly support raw keypress events
        
        const keyMap = {
            up: 'UP',
            down: 'DOWN',
            left: 'LEFT',
            right: 'RIGHT',
            space: ' ',
            enter: 'ENTER',
            escape: 'ESCAPE',
            i: 'i',
            I: 'I',
            pageup: 'PAGEUP',
            pagedown: 'PAGEDOWN',
            backspace: 'BACKSPACE',
            '1': '1',
            '2': '2',
            '3': '3',
            '4': '4',
            '5': '5',
            '6': '6',
            '7': '7',
            '8': '8',
            '9': '9',
        };
        
        const keyChoices = [
            { name: '↑ (Up)', value: 'UP' },
            { name: '↓ (Down)', value: 'DOWN' },
            { name: 'Space (Toggle selection)', value: ' ' },
            { name: 'i (View details)', value: 'i' },
            { name: 'Enter (Confirm)', value: 'ENTER' },
            { name: 'Escape (Cancel)', value: 'ESCAPE' },
            { name: 'PgUp (Previous page)', value: 'PAGEUP' },
            { name: 'PgDn (Next page)', value: 'PAGEDOWN' },
            { name: '1-9 (Select by number)', value: '1' },
        ];
        
        const prompt = {
            type: 'list',
            name: 'key',
            message: 'Press a key to navigate:',
            choices: keyChoices,
            // Hide the list UI to make it less intrusive
            pageSize: 1
        };
        
        const result = await inquirer.prompt([prompt]);
        return result.key;
    }
    
    /**
     * Close the UI handler (for compatibility with original)
     */
    close() {
        // No readline interface to close in this implementation
    }
}

module.exports = UIHandler;