// errorHandler.js - Centralized error handling for BeraBundle
const chalk = require('chalk'); // You'll need to add this dependency

// Error types
const ErrorType = {
    NETWORK: 'NETWORK_ERROR',
    CONTRACT: 'CONTRACT_ERROR',
    WALLET: 'WALLET_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    FILE: 'FILE_ERROR',
    UNKNOWN: 'UNKNOWN_ERROR'
};

// Common blockchain errors
const BlockchainErrors = {
    // Ethereum RPC errors
    INSUFFICIENT_FUNDS: -32000,
    REJECTED_TRANSACTION: -32003,
    TRANSACTION_UNDERPRICED: -32603,
    // Berachain specific codes can be added here
};

/**
 * Centralized error handler for BeraBundle
 */
class ErrorHandler {
    /**
     * Handle an error appropriately based on its type and context
     * @param {Error} error - The error object
     * @param {string} context - The context in which the error occurred
     * @param {boolean} shouldExit - Whether the application should exit on this error
     * @returns {string} A user-friendly error message
     */
    static handle(error, context, shouldExit = false) {
        const errorType = this.determineErrorType(error);
        const formattedMessage = this.formatErrorMessage(error, errorType, context);

        // Log the error
        console.error(chalk.red(`[ERROR] ${formattedMessage}`));

        // Log detailed error for debugging
        if (process.env.DEBUG) {
            console.error(chalk.gray('Stack trace:'));
            console.error(chalk.gray(error.stack));
        }

        // If this is a fatal error, exit the application
        if (shouldExit) {
            process.exit(1);
        }

        return formattedMessage;
    }

    /**
     * Determine the type of error
     * @param {Error} error - The error object
     * @returns {string} The error type
     */
    static determineErrorType(error) {
        if (!error) return ErrorType.UNKNOWN;

        // Network errors
        if (
            error.message.includes('network') ||
            error.message.includes('connection') ||
            error.message.includes('timeout') ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNREFUSED'
        ) {
            return ErrorType.NETWORK;
        }

        // Contract errors
        if (
            error.message.includes('call revert exception') ||
            error.message.includes('transaction failed') ||
            error.message.includes('invalid opcode') ||
            error.message.includes('execution reverted')
        ) {
            return ErrorType.CONTRACT;
        }

        // Wallet errors
        if (
            error.message.includes('private key') ||
            error.message.includes('address') ||
            error.message.includes('wallet')
        ) {
            return ErrorType.WALLET;
        }

        // File errors
        if (
            error.code === 'ENOENT' ||
            error.code === 'EACCES' ||
            error.message.includes('file')
        ) {
            return ErrorType.FILE;
        }

        // Validation errors (usually created by your own code)
        if (error.name === 'ValidationError') {
            return ErrorType.VALIDATION;
        }

        return ErrorType.UNKNOWN;
    }

    /**
     * Format an error message for user display
     * @param {Error} error - The error object
     * @param {string} type - The error type
     * @param {string} context - The context in which the error occurred
     * @returns {string} A user-friendly error message
     */
    static formatErrorMessage(error, type, context) {
        let baseMessage = `Error in ${context}: `;

        switch (type) {
            case ErrorType.NETWORK:
                return `${baseMessage}Network error. Please check your internet connection and RPC URL.`;

            case ErrorType.CONTRACT:
                // Extract more user-friendly messages for contract errors
                if (error.message.includes('execution reverted')) {
                    const revertReason = this.extractRevertReason(error.message);
                    return `${baseMessage}Transaction would fail: ${revertReason || 'Unknown reason'}`;
                }
                return `${baseMessage}Contract interaction failed. The operation could not be completed.`;

            case ErrorType.WALLET:
                return `${baseMessage}Wallet error. Please check the address or private key.`;

            case ErrorType.FILE:
                if (error.code === 'ENOENT') {
                    return `${baseMessage}File not found. Please check the path.`;
                }
                if (error.code === 'EACCES') {
                    return `${baseMessage}Permission denied. Please check file permissions.`;
                }
                return `${baseMessage}File operation failed.`;

            case ErrorType.VALIDATION:
                return `${baseMessage}${error.message}`;

            default:
                return `${baseMessage}${error.message}`;
        }
    }

    /**
     * Extract a human-readable reason from a revert error
     * @param {string} errorMessage - The raw error message
     * @returns {string} A user-friendly revert reason
     */
    static extractRevertReason(errorMessage) {
        // Try to extract revert reason from different formats
        const revertReasonMatch = errorMessage.match(/reason="([^"]+)"/);
        if (revertReasonMatch) {
            return revertReasonMatch[1];
        }

        const revDataMatch = errorMessage.match(/reverted with the following reason:\s+(.+)/);
        if (revDataMatch) {
            return revDataMatch[1];
        }

        return 'Unknown reason';
    }

    /**
     * Create a validation error
     * @param {string} message - The error message
     * @returns {Error} A validation error
     */
    static createValidationError(message) {
        const error = new Error(message);
        error.name = 'ValidationError';
        return error;
    }
}

module.exports = {
    ErrorHandler,
    ErrorType
};
