// Test script for the Safe SDK integration
const { ethers } = require('ethers');
const SafeProtocolKit = require('@safe-global/protocol-kit');
const SafeServiceClient = require('@safe-global/safe-service-client').default;
const config = require('./config');

async function testSafeSdk() {
    try {
        console.log('Testing Safe SDK integration...');
        
        // Create an ethers provider
        const provider = new ethers.providers.JsonRpcProvider(config.networks.berachain.rpcUrl);
        console.log(`Connected to provider: ${config.networks.berachain.rpcUrl}`);
        
        // Create a test wallet (this is just for testing and will not be used to sign anything)
        const wallet = ethers.Wallet.createRandom().connect(provider);
        console.log(`Test wallet address: ${wallet.address}`);
        
        // Create ethAdapter
        console.log('Creating SafeProvider ethAdapter...');
        const ethAdapter = new SafeProtocolKit.SafeProvider({
            provider,
            signer: wallet
        });
        
        console.log('SafeProvider created successfully');
        
        // Get Safe info from service
        const serviceUrl = config.networks.berachain.safe.serviceUrl;
        console.log(`Initializing Safe Service Client with URL: ${serviceUrl}`);
        
        const safeServiceClient = new SafeServiceClient({
            txServiceUrl: serviceUrl,
            ethAdapter
        });
        
        console.log('Safe Service Client initialized successfully');
        
        // Log package versions
        console.log('----- Package Versions -----');
        console.log(`Ethers: ${ethers.version}`);
        console.log(`Safe SDK Version: ${SafeProtocolKit.DEFAULT_SAFE_VERSION}`);
        console.log('---------------------------');
        
        console.log('Test completed successfully');
    } catch (error) {
        console.error('Error during test:', error);
    }
}

testSafeSdk().catch(console.error);