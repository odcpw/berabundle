// uiHandler.js - Enhanced UI handling
const readline = require('readline');
const chalk = require('chalk');
const cliProgress = require('cli-progress');

/**
 * Handles CLI user interface interactions
 */
class UIHandler {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

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
        // First display all regular options
        const regularOptions = options.filter(option => !option.separator && option.key !== 'b' && option.key !== 'q');
        regularOptions.forEach(option => {
            console.log(`${chalk.yellow(option.key)}. ${option.label}`);
        });

        // Add empty line before back/quit options if they exist
        const specialOptions = options.filter(option => option.key === 'b' || option.key === 'q');
        if (specialOptions.length > 0) {
            console.log(); // Empty line as separator
        }

        // Display back/quit options
        specialOptions.forEach(option => {
            console.log(`${chalk.yellow(option.key)}. ${option.label}`);
        });
    }

    /**
     * Get user input
     * @param {string} question - Question to ask
     * @param {Function} validator - Optional validation function
     * @param {string} errorMessage - Optional error message for invalid input
     * @returns {Promise<string>} User input
     */
    async getUserInput(question, validator = null, errorMessage = 'Invalid input') {
        return new Promise((resolve) => {
            const promptUser = () => {
                this.rl.question(chalk.green(`${question} `), (answer) => {
                    // Validate input if validator is provided
                    if (validator && !validator(answer)) {
                        console.log(chalk.red(errorMessage));
                        promptUser(); // Ask again
                    } else {
                        resolve(answer.trim());
                    }
                });
            };

            promptUser();
        });
    }

    /**
     * Get user selection from a menu
     * @param {Array<{key: string, label: string, value: any}>} options - Menu options
     * @param {string} prompt - Prompt to display
     * @returns {Promise<any>} Selected value
     */
    async getSelection(options, prompt = 'Enter your choice: ') {
        const validKeys = options.map(option => option.key).filter(key => key !== '');
        
        const validator = (input) => validKeys.includes(input);
        const errorMessage = `Please enter one of: ${validKeys.join(', ')}`;
        
        const key = await this.getUserInput(prompt, validator, errorMessage);
        const selected = options.find(option => option.key === key);
        
        return selected.value;
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
        return this.getUserInput(`\n${message}`);
    }

    /**
     * Confirm an action
     * @param {string} message - Confirmation message
     * @returns {Promise<boolean>} Whether the user confirmed
     */
    async confirm(message) {
        const answer = await this.getUserInput(`${message} (yes/no): `);
        return answer.toLowerCase() === 'yes';
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
     * Close the readline interface
     */
    close() {
        this.rl.close();
    }
}

module.exports = UIHandler;