// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title Berabundler_SwapBundler
 * @dev Contract for bundling token swaps from OogaBooga Router in a single transaction
 */
contract Berabundler_SwapBundler is Ownable, ReentrancyGuard {
    // Constructor to initialize Ownable with msg.sender as owner
    constructor() Ownable(msg.sender) {}

    // Operation types
    uint8 public constant TYPE_APPROVE = 1;
    uint8 public constant TYPE_SWAP = 3;

    // Event emitted when a bundle is executed
    event BundleExecuted(address indexed user, uint256 operationCount);

    // Event emitted when a swap is executed
    event SwapExecuted(
        address indexed user,
        address indexed router,
        address indexed inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 outputReceived
    );

    // An operation in the bundle
    struct Operation {
        uint8 operationType;     // Type of operation
        address target;          // Target contract address (router for swaps)
        bytes data;              // Call data (from API response)
        uint256 value;           // BERA value to send (for native token swaps)
        address tokenAddress;    // Input token address
        uint256 tokenAmount;     // Input token amount
        address outputToken;     // Output token address
        uint256 minOutputAmount; // Minimum output amount expected
    }

    /**
     * @dev Execute a bundle of operations
     * @param operations Array of operations to execute
     */
    function executeBundle(Operation[] calldata operations) external payable nonReentrant {
        require(operations.length > 0, "Empty bundle");

        for (uint i = 0; i < operations.length; i++) {
            Operation calldata op = operations[i];

            if (op.operationType == TYPE_APPROVE) {
                _executeApprove(op);
            } else if (op.operationType == TYPE_SWAP) {
                _executeSwap(op);
            } else {
                revert("Unsupported operation type");
            }
        }

        emit BundleExecuted(msg.sender, operations.length);

        // Return any unused BERA to the sender
        uint256 remainingBalance = address(this).balance;
        if (remainingBalance > 0) {
            (bool success, ) = payable(msg.sender).call{value: remainingBalance}("");
            require(success, "BERA return failed");
        }
    }

    /**
     * @dev Execute an approve operation
     * @param operation Approval operation
     */
    function _executeApprove(Operation calldata operation) internal {
        require(operation.tokenAddress != address(0), "Cannot approve zero address token");
        require(operation.target != address(0), "Cannot approve to zero address");

        // Transfer tokens from sender if needed
        IERC20 token = IERC20(operation.tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        if (balance < operation.tokenAmount) {
            require(token.transferFrom(msg.sender, address(this), operation.tokenAmount), "Token transfer failed");
        }

        // Approve router to spend tokens
        require(token.approve(operation.target, operation.tokenAmount), "Token approval failed");
    }

    /**
     * @dev Execute a swap operation
     * @param operation Swap operation from API
     */
    function _executeSwap(Operation calldata operation) internal {
        // Handle native token (BERA)
        if (operation.tokenAddress == address(0)) {
            require(operation.value > 0, "Native token swap requires value");
            require(operation.value <= address(this).balance, "Insufficient BERA balance");
        } else {
            // Handle ERC20 tokens
            IERC20 inputToken = IERC20(operation.tokenAddress);

            // Transfer tokens from sender if needed
            uint256 balance = inputToken.balanceOf(address(this));
            if (balance < operation.tokenAmount) {
                require(inputToken.transferFrom(msg.sender, address(this), operation.tokenAmount), "Token transfer failed");
            }

            // Approve router to spend tokens
            require(inputToken.approve(operation.target, operation.tokenAmount), "Router approval failed");
        }

        // Record initial balances
        uint256 initialOutputBalance;
        if (operation.outputToken == address(0)) {
            // For native token output, record balance minus the value we're sending
            initialOutputBalance = address(this).balance - operation.value;
        } else {
            // For ERC20 output, record current balance
            initialOutputBalance = IERC20(operation.outputToken).balanceOf(address(this));
        }

        // Execute the swap by calling the router with data from API
        (bool success, ) = operation.target.call{value: operation.value}(operation.data);
        require(success, "Router call failed");

        // Calculate received amount
        uint256 outputReceived;
        if (operation.outputToken == address(0)) {
            // For native token output
            outputReceived = address(this).balance - initialOutputBalance;

            // Send BERA to user
            if (outputReceived > 0) {
                (bool transferSuccess, ) = payable(msg.sender).call{value: outputReceived}("");
                require(transferSuccess, "BERA transfer failed");
            }
        } else {
            // For ERC20 output
            IERC20 outputToken = IERC20(operation.outputToken);
            outputReceived = outputToken.balanceOf(address(this)) - initialOutputBalance;

            // Send tokens to user
            if (outputReceived > 0) {
                require(outputToken.transfer(msg.sender, outputReceived), "Token transfer failed");
            }
        }

        // Verify minimum output amount
        require(outputReceived >= operation.minOutputAmount, "Slippage too high");

        emit SwapExecuted(
            msg.sender,
            operation.target,
            operation.tokenAddress,
            operation.tokenAmount,
            operation.outputToken,
            outputReceived
        );
    }

    /**
     * @dev Rescue stuck tokens in case of emergency
     * @param token Token address (zero for native token)
     * @param amount Amount to rescue
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient balance");
            (bool success, ) = payable(owner()).call{value: amount}("");
            require(success, "BERA rescue failed");
        } else {
            IERC20 erc20 = IERC20(token);
            require(erc20.balanceOf(address(this)) >= amount, "Insufficient token balance");
            require(erc20.transfer(owner(), amount), "Token rescue failed");
        }
    }

    // Allow the contract to receive BERA
    receive() external payable {}
}
