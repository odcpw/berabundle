/**
 * Utility to decrypt the private key from encrypted_keys.json
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const SecureStorage = require('./storage/engines/secureStorage');

// Constants
const address = '0x6c6eebcbd13e2bbec88e44f298b17dea0d2ce46f'; // Signer address from wallets.json

async function decryptPrivateKey() {
    try {
        // Create secure storage
        const secureStorage = new SecureStorage();
        
        // Check if we have a key for this address
        const hasKey = await secureStorage.hasPrivateKey(address);
        if (!hasKey) {
            console.error(`No private key found for address ${address}`);
            return;
        }
        
        // Prompt for password
        const password = process.argv[2];
        if (!password) {
            console.error('Please provide the password as the first argument');
            console.error('Usage: node decrypt-private-key.js <password>');
            return;
        }
        
        // Decrypt the key
        const privateKey = await secureStorage.getPrivateKey(address, password);
        if (privateKey) {
            console.log(`Decrypted private key: ${privateKey}`);
        } else {
            console.error('Failed to decrypt private key. Incorrect password or corrupted data.');
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

decryptPrivateKey().catch(console.error);