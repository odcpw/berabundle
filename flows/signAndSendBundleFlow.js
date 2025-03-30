// Temporary file for debugging
const signAndSendBundleFlow = async function(bundle) {
    this.uiHandler.clearScreen();
    this.uiHandler.displayHeader("SIGN AND SEND BUNDLE");

    // Get wallets with private keys
    const wallets = this.walletService.getWallets();
    const walletEntries = Object.entries(wallets);
    
    // Filter wallets that have private keys
    const walletsWithKeys = [];
    for (const [name, address] of walletEntries) {
        const hasKey = await this.walletService.hasPrivateKey(name);
        if (hasKey) {
            walletsWithKeys.push([name, address]);
        }
    }

    if (walletsWithKeys.length === 0) {
        console.log("\nNo wallets with private keys found. Please add a private key first.");
        await this.uiHandler.pause();
        return;
    }

    // Show wallet selection
    console.log("\nSelect wallet to sign transactions:");
    walletsWithKeys.forEach(([name, address], index) => {
        console.log(`${index + 1}. ${name} (${address})`);
    });

    // Get wallet selection
    const walletNumber = await this.uiHandler.getUserInput(
        "\nEnter wallet number:",
        input => {
            const num = parseInt(input);
            return !isNaN(num) && num > 0 && num <= walletsWithKeys.length;
        },
        "Invalid wallet number"
    );

    const index = parseInt(walletNumber) - 1;
    const [name, address] = walletsWithKeys[index];

    // Get password
    const password = await this.uiHandler.getUserInput(
        "\nEnter password to decrypt the private key:",
        input => input.trim() !== '',
        "Password cannot be empty"
    );

    console.log("\nDecrypting private key and creating signer...");
    const signerResult = await this.walletService.createSigner(name, password);

    if (!signerResult.success) {
        console.log("\n❌ Error: " + signerResult.message);
        await this.uiHandler.pause();
        return;
    }

    const signer = signerResult.signer;
    console.log(`\n✅ Successfully created signer for ${name} (${address})`);

    // Get sending method
    const format = bundle.summary.format;
    
    // Verify we have a valid format
    if (format === 'unknown') {
        console.log("\n❌ Error: Could not determine bundle format.");
        console.log("This could happen if the bundle file was created with a different version of the tool.");
        console.log("Try generating a new bundle using the 'Claim Rewards' option.");
        await this.uiHandler.pause();
        return;
    }
    
    // For all formats, offer just the two options: EOA or Safe CLI
    const sendOptions = this.uiHandler.createMenuOptions([
        { key: '1', label: 'Send as EOA transaction (with Private Key)', value: 'direct' },
        { key: '2', label: 'Use Safe CLI', value: 'safe_cli' }
    ], true, false);
    
    this.uiHandler.displayMenu(sendOptions);
    const sendMethod = await this.uiHandler.getSelection(sendOptions);
    
    if (sendMethod === 'back') {
        return;
    }

    // Confirm sending transactions
    console.log("\nBundle summary:");
    let summaryText = `${bundle.summary.vaultCount} vaults`;
    if (bundle.summary.hasBGTStaker) {
        summaryText += " + BGT Staker";
    }
    if (bundle.summary.redelegationCount > 0) {
        summaryText += ` + ${bundle.summary.redelegationCount} redelegation transactions`;
    }
    console.log(`- Total: ${summaryText}`);
    console.log(`- Rewards: ${bundle.summary.rewardSummary}`);
    console.log(`- Total transactions: ${bundle.summary.totalTransactions}`);
    console.log(`- Format: ${format}`);
    
    if (sendMethod === 'safe_cli') {
        console.log(`- Using: Safe CLI`);
    }
    
    const confirmSend = await this.uiHandler.confirm("\nDo you want to send these transactions?");
    if (!confirmSend) {
        return;
    }

    let success = false;
    
    try {
        if (sendMethod === 'direct') {
            try {
                let txData = bundle.bundleData;
                
                // Check if conversion is needed
                if (format !== 'eoa') {
                    console.log("\nConverting transactions to EOA format...");
                    
                    // Extract transactions based on format
                    let transactions;
                    if (format === 'safe_ui') {
                        transactions = txData.transactions;
                    } else if (format === 'safe_cli') {
                        transactions = txData.transactions;
                    } else {
                        console.log("\n❌ Error: Unknown format cannot be converted.");
                        console.log("Try generating a new bundle using the 'Claim Rewards' option.");
                        return;
                    }
                    
                    // Use claimBundler to convert to EOA format
                    const fromAddress = await signer.getAddress();
                    txData = await this.claimBundler.estimateGasForPayloads(
                        transactions.map(tx => ({
                            to: tx.to,
                            data: tx.data,
                            value: tx.value || "0x0"
                        })),
                        fromAddress
                    );
                    
                    // Get the current chain ID
                    const network = await this.provider.getNetwork();
                    const chainId = '0x' + network.chainId.toString(16);
                    
                    // Format as EOA transactions
                    txData = txData.map(payload => ({
                        to: payload.to,
                        from: fromAddress,
                        data: payload.data,
                        value: payload.value || "0x0",
                        gasLimit: payload.gasLimit,
                        maxFeePerGas: config.gas.maxFeePerGas,
                        maxPriorityFeePerGas: config.gas.maxPriorityFeePerGas,
                        type: "0x2", // EIP-1559 transaction
                        chainId
                    }));
                    
                    console.log(`\nSuccessfully converted ${txData.length} transactions to EOA format.`);
                }
                
                // Send the EOA transactions
                await this.sendEOATransactions(txData, signer);
                success = true;
            } catch (error) {
                console.log(`\n❌ Error sending EOA transactions: ${error.message}`);
                success = false;
            }
        } else if (sendMethod === 'safe_cli') {
            try {
                console.log("\nUsing Safe CLI to process the transaction...");
                
                // Extract transactions based on format
                let transactions;
                if (format === 'safe_ui') {
                    transactions = bundle.bundleData.transactions;
                } else if (format === 'safe_cli') {
                    transactions = bundle.bundleData.transactions;
                } else if (format === 'eoa') {
                    // Convert EOA format to Safe format
                    transactions = bundle.bundleData.map(tx => ({
                        to: tx.to,
                        value: tx.value || "0x0",
                        data: tx.data,
                        operation: 0 // Call operation
                    }));
                } else {
                    console.log(`\n❌ Error: Unsupported format for Safe CLI.`);
                    return;
                }
                
                // Ask user for the Safe address
                const safeAddress = await this.uiHandler.getUserInput(
                    "Enter Safe address to use:",
                    input => ethers.utils.isAddress(input),
                    "Invalid Ethereum address format"
                );
                
                // Process the bundle using SafeCliService
                console.log(`\nProcessing transaction for Safe ${safeAddress}...`);
                const result = await this.safeCliService.processBundleTransactions(
                    transactions,
                    safeAddress
                );
                
                if (result.success) {
                    console.log(`\n✅ ${result.message}`);
                    if (result.txHash) {
                        console.log(`Transaction hash: ${result.txHash}`);
                    }
                    if (result.executed) {
                        console.log("Transaction was fully executed!");
                    } else {
                        console.log("Transaction was prepared and signed, but not executed.");
                        console.log("More signatures may be required to reach the Safe threshold.");
                    }
                    success = true;
                } else {
                    console.log(`\n❌ Error: ${result.message}`);
                    success = false;
                }
            } catch (error) {
                console.log(`\n❌ Error using Safe CLI: ${error.message}`);
                success = false;
            }
        }
        
        if (!success) {
            console.log("\n❌ Transaction sending was not completed successfully.");
        }
    } catch (error) {
        console.log(`\n❌ Error in transaction flow: ${error.message}`);
    }
    
    await this.uiHandler.pause();
};