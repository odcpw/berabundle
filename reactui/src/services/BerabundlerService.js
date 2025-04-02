/**
 * BerabundlerService.js - Service for interacting with the Berabundler contract
 * 
 * This service handles bundling multiple transactions together for atomic execution
 * through the Berabundler contract on Berachain.
 */

import { ethers } from 'ethers';

// ABI for the BeraBundle contract (simplified to just what we need)
const BERABUNDLE_ABI = [
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "uint8",
            "name": "operationType",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "target",
            "type": "address"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          },
          {
            "internalType": "uint256",
            "name": "value",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "tokenAddress",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "tokenAmount",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "recipients",
            "type": "address[]"
          },
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "internalType": "struct BeraBundle.Operation[]",
        "name": "operations",
        "type": "tuple[]"
      }
    ],
    "name": "executeBundle",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "router",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "inputToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "inputAmount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "outputToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "outputQuote",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minOutputAmount",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "pathDefinition",
        "type": "bytes"
      },
      {
        "internalType": "address",
        "name": "executor",
        "type": "address"
      },
      {
        "internalType": "uint32",
        "name": "referralCode",
        "type": "uint32"
      }
    ],
    "name": "swap",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

// Operation types
const TYPE_APPROVE = 1;
const TYPE_REVOKE_APPROVAL = 2;
const TYPE_SWAP = 3;
const TYPE_CLAIM_REWARDS = 4;
const TYPE_BOOST = 5;
const TYPE_DISPERSE = 6;
const TYPE_GENERIC_CALL = 7;

/**
 * Service for interacting with the Berabundler contract
 */
class BerabundlerService {
  constructor() {
    // Berabundler contract address on Berachain
    this.contractAddress = '0x3072de9d5453937FA02C045883Caf363e0ea3c83';
    this.provider = null;
    this.contract = null;
  }

  /**
   * Initialize the service with a provider
   * @param {ethers.providers.Web3Provider} provider - Ethers provider
   */
  initialize(provider, signer) {
    this.provider = provider;
    this.signer = signer;
    this.contract = new ethers.Contract(this.contractAddress, BERABUNDLE_ABI, signer);
    return Boolean(this.contract);
  }

  /**
   * Check if the service is initialized
   */
  isInitialized() {
    return Boolean(this.contract && this.signer);
  }

  /**
   * Create operations for token approvals
   * @param {Array} approvalTxs - Array of approval transactions
   * @returns {Array} Array of Operation objects for approvals
   */
  createApprovalOperations(approvalTxs) {
    return approvalTxs.map(tx => {
      console.log("Creating approval operation:", tx);
      
      // Ensure we have the router address (target) and token address
      if (!tx.to || !tx.token || !tx.token.address) {
        console.error("Invalid approval transaction:", tx);
        return null;
      }
      
      return {
        operationType: TYPE_APPROVE,
        target: tx.to, // The router/spender address
        data: "0x", // We don't need data for approvals as the contract handles it
        value: 0,
        tokenAddress: tx.token.address, // The token contract address
        tokenAmount: ethers.constants.MaxUint256.toString(), // Max approval
        recipients: [],
        amounts: []
      };
    }).filter(op => op !== null); // Filter out any invalid operations
  }

  /**
   * Create operations for token swaps
   * @param {Array} swapTxs - Array of swap transactions
   * @returns {Array} Array of Operation objects for swaps
   */
  createSwapOperations(swapTxs) {
    return swapTxs.map(tx => {
      console.log("Creating operation for swap:", JSON.stringify(tx, null, 2));
      
      // Parse and normalize the value
      let valueHex;
      try {
        if (!tx.value || tx.value === '0x0' || tx.value === '0x00' || tx.value === '0') {
          valueHex = 0;
        } else if (typeof tx.value === 'string') {
          if (tx.value.startsWith('0x')) {
            // Convert hex string to number
            valueHex = ethers.BigNumber.from(tx.value).toString();
          } else {
            // Convert decimal string to number
            valueHex = ethers.BigNumber.from(tx.value).toString();
          }
        } else if (tx.value._isBigNumber) {
          // Already a BigNumber
          valueHex = tx.value.toString();
        } else {
          // Default to string representation
          valueHex = String(tx.value);
        }
      } catch (error) {
        console.error("Error parsing value:", error);
        valueHex = "0";
      }
      
      console.log(`Normalized value: ${tx.value} => ${valueHex}`);
      
      // Check if this is a native token or ERC20 token swap
      const isNativeToken = tx.token.address === 'native' || tx.token.symbol === 'BERA';
      
      // For ERC20 tokens, we need to set the tokenAddress and tokenAmount fields
      // For native token (BERA), we use the zero address and zero amount
      const tokenAddress = isNativeToken ? 
        "0x0000000000000000000000000000000000000000" : 
        tx.token.address;
      
      const tokenAmount = isNativeToken ? 
        "0" : 
        tx.token.amountIn;
      
      console.log(`Swap operation for token: ${isNativeToken ? 'Native BERA' : tx.token.symbol}`);
      console.log(`Using tokenAddress: ${tokenAddress}`);
      console.log(`Using tokenAmount: ${tokenAmount}`);
      
      return {
        operationType: TYPE_SWAP,
        target: tx.to,
        data: tx.data,
        value: valueHex,
        tokenAddress: tokenAddress,
        tokenAmount: tokenAmount,
        recipients: [],
        amounts: []
      };
    });
  }

  /**
   * Create operations for revoking approvals
   * @param {Array} approvalTxs - Array of approval transactions to revoke
   * @returns {Array} Array of Operation objects for revoking approvals
   */
  createRevokeApprovalOperations(approvalTxs) {
    return approvalTxs.map(tx => ({
      operationType: TYPE_REVOKE_APPROVAL,
      target: tx.to,
      data: "0x", // We don't need data for revocations as the contract handles it
      value: 0,
      tokenAddress: tx.token.address,
      tokenAmount: 0,
      recipients: [],
      amounts: []
    }));
  }

  /**
   * Execute a bundle of transactions through the Berabundler contract
   * @param {Object} bundle - Bundle containing approvals and swap transactions
   * @returns {Promise<Object>} Transaction response
   */
  async executeBundle(bundle) {
    if (!this.isInitialized()) {
      throw new Error("BerabundlerService not initialized");
    }

    try {
      console.log("Executing bundle through Berabundler...");
      
      // Extract transactions from the bundle
      const approvalTxs = bundle.approvalTxs || [];
      const swapTxs = bundle.swapTxs || [];
      
      console.log("Swap transactions:", JSON.stringify(swapTxs, null, 2));
      
      // Create operations for the bundle
      const operations = [
        ...this.createApprovalOperations(approvalTxs),
        ...this.createSwapOperations(swapTxs),
        ...this.createRevokeApprovalOperations(approvalTxs) // Revoke approvals after swaps
      ];
      
      console.log(`Created ${operations.length} operations for Berabundler`);
      console.log("Operations:", JSON.stringify(operations, null, 2));
      
      // Calculate total value needed for ETH transfers
      let totalValue = ethers.BigNumber.from(0);
      
      operations.forEach(op => {
        if (op.value && op.value !== "0") {
          const opValue = typeof op.value === 'string' ? 
            ethers.BigNumber.from(op.value) : 
            op.value;
          
          totalValue = totalValue.add(opValue);
        }
      });
      
      console.log(`Total value needed: ${ethers.utils.formatEther(totalValue)} BERA`);

      // For testing, let's try with a higher gas limit
      const gasLimit = 2000000; // 2 million gas
      console.log(`Setting gas limit to ${gasLimit}`);

      // Execute the bundle with higher gas limit
      const tx = await this.contract.executeBundle(
        operations,
        { 
          value: totalValue,
          gasLimit: gasLimit
        }
      );
      
      console.log(`Transaction sent: ${tx.hash}`);
      
      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      
      return {
        success: true,
        hash: tx.hash,
        receipt
      };
    } catch (error) {
      console.error("Error executing bundle:", error);
      
      // Try to extract more detailed error information
      if (error.error && error.error.message) {
        console.error("Detailed error:", error.error.message);
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Execute a direct swap using the BeraBundle.swap function
   * @param {Object} swapTx - Swap transaction details from the OogaBooga API
   * @returns {Promise<Object>} Transaction response
   */
  async executeDirectSwap(swapTx) {
    if (!this.isInitialized()) {
      throw new Error("BerabundlerService not initialized");
    }

    try {
      console.log("[DEBUG] ======= EXECUTING DIRECT SWAP =======");
      console.log("[DEBUG] Executing direct swap through Berabundler.swap...");
      console.log("[DEBUG] Swap transaction from API:", JSON.stringify(swapTx, null, 2));
      
      // Use swapParams if provided by the API; otherwise, extract individually.
      const swapParams = swapTx.swapParams || {};
      
      // 1. Router Address – prefer swapParams.router, otherwise swapTx.to
      const routerAddress = swapParams.router || swapTx.to;
      if (!routerAddress) {
        throw new Error("Router address missing from API response");
      }
      console.log(`[DEBUG] Router: ${routerAddress}`);
      
      // 2. Input Token
      const isNativeToken = swapTx.token.address === 'native' || swapTx.token.symbol === 'BERA';
      const inputToken = isNativeToken 
        ? "0x0000000000000000000000000000000000000000" 
        : (swapParams.inputToken || swapTx.token.address);
      if (!inputToken) {
        throw new Error("Input token missing from API response");
      }
      console.log(`[DEBUG] Input token: ${inputToken}`);
      
      // 3. Input Amount
      const inputAmount = swapParams.inputAmount || swapTx.token.amountIn;
      if (!inputAmount) {
        throw new Error("Input amount missing from API response");
      }
      console.log(`[DEBUG] Input amount: ${inputAmount}`);
      
      // 4. Output Token – default to native (zero address) if not specified
      const outputToken = swapParams.outputToken || ((swapTx.quote && swapTx.quote.tokenOut) 
                            ? swapTx.quote.tokenOut 
                            : "0x0000000000000000000000000000000000000000");
      console.log(`[DEBUG] Output token: ${outputToken}`);
      
      // 5. Output Quote – expected output amount
      const outputQuote = swapParams.outputQuote || (swapTx.quote && (swapTx.quote.expectedAmountOut || swapTx.quote.assumedAmountOut));
      if (!outputQuote) {
        throw new Error("Output quote missing from API response");
      }
      console.log(`[DEBUG] Output quote: ${outputQuote}`);
      
      // 6. Minimum Output Amount
      const minOutputAmount = swapParams.minOutput || (swapTx.quote && swapTx.quote.minAmountOut);
      if (!minOutputAmount) {
        throw new Error("Minimum output amount missing from API response");
      }
      console.log(`[DEBUG] Min output: ${minOutputAmount}`);
      
      // 7. Path Definition – use swapParams.pathDefinition if available, else fallback
      const pathDefinition = swapParams.pathDefinition || (swapTx.quote && (swapTx.quote.path || (swapTx.quote.routerParams && swapTx.quote.routerParams.path))) || "0x";
      console.log(`[DEBUG] Path definition: ${pathDefinition}`);
      
      // 8. Executor – try swapParams.executor then API fields then signer address
      let executor = swapParams.executor;
      if (!executor) {
        if (swapTx.recipient) {
          executor = swapTx.recipient;
        } else if (swapTx.quote && swapTx.quote.to) {
          executor = swapTx.quote.to;
        } else {
          executor = await this.signer.getAddress();
        }
      }
      console.log(`[DEBUG] Executor: ${executor}`);
      
      // 9. Referral Code – from swapParams or default to 0
      const referralCode = swapParams.referralCode !== undefined ? swapParams.referralCode : (swapTx.quote && swapTx.quote.referralCode) || 0;
      console.log(`[DEBUG] Referral code: ${referralCode}`);
      
      const gasLimit = 2000000;
      console.log(`[DEBUG] Setting gas limit to ${gasLimit}`);
      
      // Log all parameters being sent to the contract
      console.log("[DEBUG] Contract call parameters:");
      console.log({
        routerAddress,
        inputToken,
        inputAmount: inputAmount.toString(),
        outputToken,
        outputQuote: outputQuote.toString(),
        minOutputAmount: minOutputAmount.toString(),
        pathDefinition,
        executor,
        referralCode,
        value: isNativeToken ? inputAmount.toString() : "0",
        gasLimit
      });

      // First try callStatic to get the revert reason
      try {
        console.log("[DEBUG] Attempting callStatic to debug potential revert reason...");
        await this.contract.callStatic.swap(
          routerAddress,
          inputToken,
          inputAmount,
          outputToken,
          outputQuote,
          minOutputAmount,
          pathDefinition,
          executor,
          referralCode,
          { 
            value: isNativeToken ? inputAmount : 0,
            gasLimit: gasLimit
          }
        );
        console.log("[DEBUG] callStatic succeeded - no revert expected");
      } catch (staticError) {
        console.error("[DEBUG] callStatic revealed revert reason:", staticError);
        console.error("[DEBUG] Error details:", JSON.stringify(staticError, null, 2));
        if (staticError.errorArgs) {
          console.error("[DEBUG] Error arguments:", staticError.errorArgs);
        }
        if (staticError.errorName) {
          console.error("[DEBUG] Error name:", staticError.errorName);
        }
        if (staticError.reason) {
          console.error("[DEBUG] Error reason:", staticError.reason);
        }
      }
      
      console.log("[DEBUG] Sending transaction to contract...");
      // Call the contract's swap method with parameters in the correct order.
      const tx = await this.contract.swap(
        routerAddress,
        inputToken,
        inputAmount,
        outputToken,
        outputQuote,
        minOutputAmount,
        pathDefinition,
        executor,
        referralCode,
        { 
          value: isNativeToken ? inputAmount : 0,
          gasLimit: gasLimit
        }
      );
      
      console.log(`[DEBUG] Transaction sent: ${tx.hash}`);
      console.log("[DEBUG] Transaction details:", {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value.toString(),
        gasLimit: tx.gasLimit.toString(),
        gasPrice: tx.gasPrice ? tx.gasPrice.toString() : null,
        nonce: tx.nonce
      });
      
      console.log("[DEBUG] Waiting for transaction confirmation...");
      const receipt = await tx.wait();
      console.log(`[DEBUG] Transaction confirmed in block ${receipt.blockNumber}`);
      console.log("[DEBUG] Transaction receipt:", JSON.stringify(receipt, null, 2));
      console.log("[DEBUG] ======= DIRECT SWAP COMPLETE =======");
      
      return { success: true, hash: tx.hash, receipt };
    } catch (error) {
      console.error("[DEBUG] ======= DIRECT SWAP FAILED =======");
      console.error("[DEBUG] Error executing direct swap:", error);
      if (error.error && error.error.message) {
        console.error("[DEBUG] Detailed error:", error.error.message);
      }
      // Log any blockchain error data that might be available
      if (error.code) {
        console.error("[DEBUG] Error code:", error.code);
      }
      if (error.transaction) {
        console.error("[DEBUG] Error transaction:", JSON.stringify(error.transaction, null, 2));
      }
      if (error.receipt) {
        console.error("[DEBUG] Error receipt:", JSON.stringify(error.receipt, null, 2));
      }
      
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
const berabundlerService = new BerabundlerService();
export default berabundlerService;