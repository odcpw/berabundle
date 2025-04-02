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
    return approvalTxs.map(tx => ({
      operationType: TYPE_APPROVE,
      target: tx.to,
      data: "0x", // We don't need data for approvals as the contract handles it
      value: 0,
      tokenAddress: tx.token.address,
      tokenAmount: ethers.constants.MaxUint256.toString(),
      recipients: [],
      amounts: []
    }));
  }

  /**
   * Create operations for token swaps
   * @param {Array} swapTxs - Array of swap transactions
   * @returns {Array} Array of Operation objects for swaps
   */
  createSwapOperations(swapTxs) {
    return swapTxs.map(tx => ({
      operationType: TYPE_SWAP,
      target: tx.to,
      data: tx.data,
      value: tx.value ? ethers.BigNumber.from(tx.value).toString() : "0",
      tokenAddress: "0x0000000000000000000000000000000000000000", // not used for swaps
      tokenAmount: "0", // not used for swaps
      recipients: [],
      amounts: []
    }));
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
      
      // Create operations for the bundle
      const operations = [
        ...this.createApprovalOperations(approvalTxs),
        ...this.createSwapOperations(swapTxs),
        ...this.createRevokeApprovalOperations(approvalTxs) // Revoke approvals after swaps
      ];
      
      console.log(`Created ${operations.length} operations for Berabundler`);
      
      // Calculate total value needed
      const totalValue = swapTxs.reduce((sum, tx) => {
        if (tx.value) {
          return sum.add(ethers.BigNumber.from(tx.value));
        }
        return sum;
      }, ethers.BigNumber.from(0));
      
      console.log(`Total value needed: ${ethers.utils.formatEther(totalValue)} BERA`);

      // Execute the bundle
      const tx = await this.contract.executeBundle(
        operations,
        { value: totalValue }
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
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
const berabundlerService = new BerabundlerService();
export default berabundlerService;