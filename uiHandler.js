// uiHandler-inquirer.js - Drop-in replacement for uiHandler.js using Inquirer.js
const inquirer = require('inquirer');
const chalk = require('chalk');
const cliProgress = require('cli-progress');

/**
 * Handles CLI user interface interactions using Inquirer.js
 * Maintains the same interface as the original UIHandler for compatibility
 */
class UIHandler {
    constructor() {
        // Keep the progress bar implementation the same
        this.progressBar = new cliProgress.SingleBar({
            format: '{bar} {percentage}% | {value}/{total} | {status}',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
        });
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
        // Convert our option format to Inquirer format
        const choices = options.map(option => ({
            name: option.label,
            value: option.value,
            short: option.key
        }));
        
        const result = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: prompt,
                choices: choices
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
                default: false
            }
        ]);
        
        return result.confirmed;
    }

    /**
     * Start a progress bar
     * @param {number} total - Total steps
     * @param {string} status - Initial status
     */
    startProgress(total, status = 'Processing...') {
        this.progressBar.start(total, 0, { status });
    }

    /**
     * Update the progress bar
     * @param {number} value - Current progress value
     * @param {string} status - Current status
     */
    updateProgress(value, status = null) {
        const payload = status ? { status } : undefined;
        this.progressBar.update(value, payload);
    }

    /**
     * Stop the progress bar
     */
    stopProgress() {
        this.progressBar.stop();
    }

    /**
     * Format a reward summary
     * @param {Array} rewards - Rewards data
     * @returns {string} Formatted summary
     */
    formatRewardSummary(rewards) {
        if (!rewards || rewards.length === 0) {
            return chalk.yellow("No rewards found.");
        }
        
        let output = "";
        let totalRewards = 0;
        
        rewards.forEach(vault => {
            if (parseFloat(vault.earned) > 0) {
                output += `${chalk.white(vault.vaultAddress)}\n`;
                output += `  ${chalk.green(parseFloat(vault.earned).toFixed(2))} ${vault.rewardToken.symbol}\n`;
                totalRewards += parseFloat(vault.earned);
            }
        });
        
        if (output === "") {
            return chalk.yellow("No rewards to claim.");
        }
        
        output += chalk.cyan("\nTotal rewards: ") + chalk.green(`${totalRewards.toFixed(2)} BGT`);
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
     * Close the UI handler (for compatibility with original)
     */
    close() {
        // No readline interface to close in this implementation
    }
}

module.exports = UIHandler;