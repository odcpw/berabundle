// validatorSelector.js - Script for fetching and selecting validators
const { ethers } = require('ethers');
const fs = require('fs').promises;
const inquirer = require('inquirer');
const config = require('./config');
const RedelegationManager = require('./redelegationManager');
const WalletService = require('./walletService');

/**
 * Main function to run the validator selector
 */
async function main() {
    try {
        // Initialize provider
        const provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
        console.log(`Connected to ${config.networks.berachain.name}`);

        // Initialize services
        const walletService = new WalletService(provider);
        await walletService.initialize();
        
        const redelegationManager = new RedelegationManager(provider);
        await redelegationManager.initialize();

        // Get wallets
        const wallets = walletService.getWallets();
        if (Object.keys(wallets).length === 0) {
            console.log('No wallets found. Please add a wallet first.');
            return;
        }

        // Select wallet
        const walletNames = Object.keys(wallets);
        const { selectedWallet } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedWallet',
                message: 'Select wallet:',
                choices: walletNames
            }
        ]);

        const userAddress = wallets[selectedWallet];
        console.log(`Selected wallet: ${selectedWallet} (${userAddress})`);

        // Fetch or use existing validators
        let validators = redelegationManager.getValidators();
        
        if (validators.length === 0) {
            const { shouldFetch } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'shouldFetch',
                    message: 'No validators found. Would you like to fetch validators from the network?',
                    default: true
                }
            ]);

            if (shouldFetch) {
                validators = await fetchValidators(provider);
                await redelegationManager.saveValidators(validators);
            } else {
                console.log('Operation cancelled.');
                return;
            }
        }

        // Get user preferences
        const userPrefs = redelegationManager.getUserPreferences(userAddress);

        // Display main menu
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Choose an action:',
                choices: [
                    'Select Validators',
                    'Set Allocation Percentages',
                    'View Current Preferences',
                    'Exit'
                ]
            }
        ]);

        if (action === 'Exit') {
            return;
        } else if (action === 'View Current Preferences') {
            displayPreferences(userPrefs);
            return;
        } else if (action === 'Select Validators') {
            await selectValidators(validators, userPrefs, userAddress, redelegationManager);
        } else if (action === 'Set Allocation Percentages') {
            if (!userPrefs.validators || userPrefs.validators.length === 0) {
                console.log('Please select validators first.');
                return;
            }
            await setAllocations(userPrefs, userAddress, redelegationManager);
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

/**
 * Fetch validators from the network (mock implementation)
 */
async function fetchValidators(provider) {
    console.log('Fetching validators from the network...');
    
    // In a real implementation, this would query the blockchain
    // For now, we'll return some sample validators
    return [
        {
            name: 'Validator 1',
            pubkey: '0x68b58f24be0e7c16df3852402e8475e8b3cc53a64cfaf45da3dbc148cdc05d30',
            status: 'Active'
        },
        {
            name: 'Validator 2',
            pubkey: '0x7ae16e33e1d91c81c1c23e6c3e04e47d35872db8cde65f4c8ff81e2bc418d0c7',
            status: 'Active'
        },
        {
            name: 'Validator 3',
            pubkey: '0x9de0c8f3c5a998e437b563c8210deafabb8f5932d2324239c41c5de1608fe09e',
            status: 'Active'
        }
    ];
}

/**
 * Display user preferences
 */
function displayPreferences(userPrefs) {
    console.log('\nCurrent Delegation Preferences:');
    
    if (!userPrefs.validators || userPrefs.validators.length === 0) {
        console.log('No validators selected.');
        return;
    }
    
    console.log('\nSelected Validators:');
    for (const validator of userPrefs.validators) {
        const allocation = userPrefs.allocations ? userPrefs.allocations[validator.pubkey] || 0 : 0;
        console.log(`- ${validator.name} (${validator.pubkey.substring(0, 10)}...): ${allocation}%`);
    }
    
    if (userPrefs.lastUpdated) {
        console.log(`\nLast updated: ${userPrefs.lastUpdated}`);
    }
}

/**
 * Select validators from the list
 */
async function selectValidators(validators, userPrefs, userAddress, redelegationManager) {
    const { selectedValidators } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selectedValidators',
            message: 'Select validators to delegate to (use space to select):',
            choices: validators.map(v => ({
                name: `${v.name} (${v.pubkey.substring(0, 10)}...)`,
                value: v,
                checked: userPrefs.validators?.some(uv => uv.pubkey === v.pubkey) || false
            }))
        }
    ]);
    
    if (selectedValidators.length === 0) {
        console.log('No validators selected. Operation cancelled.');
        return;
    }
    
    // Create default allocations if needed
    const defaultAllocation = Math.floor(100 / selectedValidators.length);
    const remainder = 100 - (defaultAllocation * selectedValidators.length);
    
    const allocations = {};
    selectedValidators.forEach((validator, index) => {
        // Add the remainder to the first validator
        const allocation = index === 0 ? defaultAllocation + remainder : defaultAllocation;
        allocations[validator.pubkey] = allocation;
    });
    
    // Save the preferences
    await redelegationManager.setUserPreferences(userAddress, selectedValidators, allocations);
    
    console.log(`Selected ${selectedValidators.length} validators with default allocations.`);
    console.log('You can adjust allocations using the "Set Allocation Percentages" option.');
    
    // Show the current preferences
    const updatedPrefs = redelegationManager.getUserPreferences(userAddress);
    displayPreferences(updatedPrefs);
}

/**
 * Set allocation percentages for validators
 */
async function setAllocations(userPrefs, userAddress, redelegationManager) {
    const questions = [];
    const validators = userPrefs.validators;
    
    console.log('\nSet percentage allocation for each validator (must add up to 100%):');
    
    // Create questions for each validator except the last one
    for (let i = 0; i < validators.length - 1; i++) {
        const validator = validators[i];
        const currentAllocation = userPrefs.allocations?.[validator.pubkey] || 0;
        
        questions.push({
            type: 'number',
            name: validator.pubkey,
            message: `Allocation for ${validator.name} (%):`,
            default: currentAllocation,
            validate: (input) => {
                if (isNaN(input) || input < 0 || input > 100) {
                    return 'Please enter a valid percentage between 0 and 100';
                }
                return true;
            }
        });
    }
    
    // Get allocations for all validators except the last one
    const answers = await inquirer.prompt(questions);
    
    // Calculate the allocation for the last validator
    const totalAllocated = Object.values(answers).reduce((sum, value) => sum + value, 0);
    const lastValidator = validators[validators.length - 1];
    const lastAllocation = 100 - totalAllocated;
    
    if (lastAllocation < 0) {
        console.log('Total allocation exceeds 100%. Please try again.');
        return;
    }
    
    // Add the last validator allocation
    answers[lastValidator.pubkey] = lastAllocation;
    
    console.log(`\nAutomatic allocation for ${lastValidator.name}: ${lastAllocation}%`);
    
    // Get confirmation
    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Save these allocations?',
            default: true
        }
    ]);
    
    if (confirm) {
        await redelegationManager.setUserPreferences(userAddress, validators, answers);
        console.log('Allocations saved successfully.');
        
        // Show the current preferences
        const updatedPrefs = redelegationManager.getUserPreferences(userAddress);
        displayPreferences(updatedPrefs);
    } else {
        console.log('Operation cancelled.');
    }
}

// Run the script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { fetchValidators };