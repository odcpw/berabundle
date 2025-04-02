// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title BeraBundle
 * @dev An all-in-one bundler contract for Berachain that enables atomic execution of
 * multiple operations including swaps, reward claims, boosts, and token disperses.
 * Includes reentrancy protection for all external calls.
 */
contract BeraBundle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Native token constant
    address private constant NATIVE_TOKEN = address(0);

    // Operation types
    uint8 private constant TYPE_APPROVE = 1;
    uint8 private constant TYPE_REVOKE_APPROVAL = 2;
    uint8 private constant TYPE_SWAP = 3;
    uint8 private constant TYPE_CLAIM_REWARDS = 4;
    uint8 private constant TYPE_BOOST = 5;
    uint8 private constant TYPE_DISPERSE = 6;
    uint8 private constant TYPE_GENERIC_CALL = 7;

    // Events
    event OperationExecuted(uint8 indexed operationType, address indexed target, bool success);
    event SwapExecuted(address indexed inputToken, uint256 inputAmount, address indexed outputToken, uint256 outputAmount);
    event RewardsClaimed(address indexed vault, address indexed user);
    event TokensDispersed(address indexed token, uint256 totalAmount, uint256 recipientCount);

    // Struct for bundled operations
    struct Operation {
        uint8 operationType;
        address target;
        bytes data;
        uint256 value;
        // Additional fields for different operation types
        address tokenAddress;  // For approvals and disperses
        uint256 tokenAmount;   // For approvals
        address[] recipients;  // For disperses
        uint256[] amounts;     // For disperses
    }

    /**
     * @notice Execute a bundle of operations atomically
     * @param operations Array of operations to execute
     */
    function executeBundle(Operation[] calldata operations) external payable nonReentrant {
        uint256 totalValue = 0;

        // Calculate total value required
        for (uint256 i = 0; i < operations.length; i++) {
            if (operations[i].value > 0) {
                totalValue += operations[i].value;
            }
        }

        require(msg.value >= totalValue, "BeraBundle: insufficient value sent");

        // Execute each operation
        for (uint256 i = 0; i < operations.length; i++) {
            Operation calldata op = operations[i];

            if (op.operationType == TYPE_APPROVE) {
                // Handle token approval
                IERC20(op.tokenAddress).safeApprove(op.target, op.tokenAmount);
                emit OperationExecuted(TYPE_APPROVE, op.target, true);
            }
            else if (op.operationType == TYPE_REVOKE_APPROVAL) {
                // Revoke token approval
                IERC20(op.tokenAddress).safeApprove(op.target, 0);
                emit OperationExecuted(TYPE_REVOKE_APPROVAL, op.target, true);
            }
            else if (op.operationType == TYPE_SWAP) {
                // Execute swap through OBRouter
                (bool success, bytes memory returnData) = op.target.call{value: op.value}(op.data);
                require(success, "BeraBundle: swap failed");
                emit OperationExecuted(TYPE_SWAP, op.target, success);
            }
            else if (op.operationType == TYPE_CLAIM_REWARDS) {
                // Claim rewards ensuring they go to the caller
                bytes memory callData = abi.encodeWithSignature("getRewards(address)", msg.sender);
                (bool success, bytes memory returnData) = op.target.call(callData);
                require(success, "BeraBundle: reward claim failed");
                emit OperationExecuted(TYPE_CLAIM_REWARDS, op.target, success);
                emit RewardsClaimed(op.target, msg.sender);
            }
            else if (op.operationType == TYPE_BOOST) {
                // Handle BGT boost
                (bool success, bytes memory returnData) = op.target.call(op.data);
                require(success, "BeraBundle: boost failed");
                emit OperationExecuted(TYPE_BOOST, op.target, success);
            }
            else if (op.operationType == TYPE_DISPERSE) {
                // Disperse tokens to multiple recipients
                require(op.recipients.length == op.amounts.length, "BeraBundle: recipients and amounts length mismatch");

                uint256 totalAmount = 0;
                for (uint256 j = 0; j < op.amounts.length; j++) {
                    totalAmount += op.amounts[j];
                }

                if (op.tokenAddress == NATIVE_TOKEN) {
                    // Native token disperse
                    require(op.value >= totalAmount, "BeraBundle: insufficient value for disperse");

                    for (uint256 j = 0; j < op.recipients.length; j++) {
                        (bool success, ) = op.recipients[j].call{value: op.amounts[j]}("");
                        require(success, "BeraBundle: native transfer failed");
                    }
                } else {
                    // ERC20 token disperse
                    IERC20(op.tokenAddress).safeTransferFrom(msg.sender, address(this), totalAmount);

                    for (uint256 j = 0; j < op.recipients.length; j++) {
                        IERC20(op.tokenAddress).safeTransfer(op.recipients[j], op.amounts[j]);
                    }
                }

                emit OperationExecuted(TYPE_DISPERSE, op.tokenAddress, true);
                emit TokensDispersed(op.tokenAddress, totalAmount, op.recipients.length);
            }
            else if (op.operationType == TYPE_GENERIC_CALL) {
                // Generic call for any other operation
                (bool success, bytes memory returnData) = op.target.call{value: op.value}(op.data);
                require(success, "BeraBundle: operation failed");
                emit OperationExecuted(TYPE_GENERIC_CALL, op.target, success);
            }
        }

        // Refund any excess value
        uint256 remaining = msg.value - totalValue;
        if (remaining > 0) {
            (bool success, ) = msg.sender.call{value: remaining}("");
            require(success, "BeraBundle: refund failed");
        }
    }

    /**
     * @notice Helper function to swap tokens through OBRouter
     * @param router OBRouter address
     * @param inputToken Input token address (address(0) for native token)
     * @param inputAmount Amount of input tokens
     * @param outputToken Output token address
     * @param minOutputAmount Minimum acceptable output amount
     * @param pathDefinition Path definition from the Swap API
     * @param executor Executor address from the Swap API
     * @param referralCode Referral code
     */
    function swap(
        address router,
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 outputQuote,
        uint256 minOutputAmount,
        bytes calldata pathDefinition,
        address executor,
        uint32 referralCode
    ) external payable nonReentrant {
        // Handle token transfers
        if (inputToken != NATIVE_TOKEN) {
            IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount);
            IERC20(inputToken).safeApprove(router, inputAmount);
        } else {
            require(msg.value >= inputAmount, "BeraBundle: insufficient value");
        }

        // Create swap calldata
        bytes memory callData = abi.encodeWithSignature(
            "swap((address,uint256,address,uint256,uint256,address),bytes,address,uint32)",
                                                        // swapTokenInfo struct
                                                        inputToken,
                                                        inputAmount,
                                                        outputToken,
                                                        outputQuote,
                                                        minOutputAmount,
                                                        msg.sender, // ensure output goes to the caller
                                                        pathDefinition,
                                                        executor,
                                                        referralCode
        );

        // Execute swap
        (bool success, bytes memory returnData) = router.call{value: inputToken == NATIVE_TOKEN ? inputAmount : 0}(callData);
        require(success, "BeraBundle: swap failed");

        // Reset approval
        if (inputToken != NATIVE_TOKEN) {
            IERC20(inputToken).safeApprove(router, 0);
        }

        // Refund any excess value
        uint256 remaining = msg.value - (inputToken == NATIVE_TOKEN ? inputAmount : 0);
        if (remaining > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: remaining}("");
            require(refundSuccess, "BeraBundle: refund failed");
        }

        emit SwapExecuted(inputToken, inputAmount, outputToken, minOutputAmount);
    }

    /**
     * @notice Helper function to claim rewards from RewardVault or BGT Staker
     * @param rewardContract Address of the reward contract
     */
    function claimRewards(address rewardContract) external nonReentrant {
        bytes memory callData = abi.encodeWithSignature("getRewards(address)", msg.sender);
        (bool success, bytes memory returnData) = rewardContract.call(callData);
        require(success, "BeraBundle: reward claim failed");

        emit RewardsClaimed(rewardContract, msg.sender);
    }

    /**
     * @notice Helper function to boost BGT tokens
     * @param bgtToken BGT token address
     * @param amount Amount to boost
     */
    function boostBGT(address bgtToken, uint256 amount) external nonReentrant {
        // Transfer tokens from caller to this contract
        IERC20(bgtToken).safeTransferFrom(msg.sender, address(this), amount);

        // Approve BGT contract if needed
        IERC20(bgtToken).safeApprove(bgtToken, amount);

        // Boost tokens
        bytes memory callData = abi.encodeWithSignature("boost(address,uint256)", msg.sender, amount);
        (bool success, bytes memory returnData) = bgtToken.call(callData);
        require(success, "BeraBundle: boost failed");

        // Reset approval
        IERC20(bgtToken).safeApprove(bgtToken, 0);

        emit OperationExecuted(TYPE_BOOST, bgtToken, success);
    }

    /**
     * @notice Helper function to disperse tokens to multiple recipients
     * @param token Token address (address(0) for native token)
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to send to each recipient
     */
    function disperse(address token, address[] calldata recipients, uint256[] calldata amounts) external payable nonReentrant {
        require(recipients.length == amounts.length, "BeraBundle: recipients and amounts length mismatch");

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }

        if (token == NATIVE_TOKEN) {
            // Native token disperse
            require(msg.value >= totalAmount, "BeraBundle: insufficient value");

            for (uint256 i = 0; i < recipients.length; i++) {
                (bool success, ) = recipients[i].call{value: amounts[i]}("");
                require(success, "BeraBundle: native transfer failed");
            }

            // Refund any excess
            uint256 remaining = msg.value - totalAmount;
            if (remaining > 0) {
                (bool success, ) = msg.sender.call{value: remaining}("");
                require(success, "BeraBundle: refund failed");
            }
        } else {
            // ERC20 token disperse
            IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);

            for (uint256 i = 0; i < recipients.length; i++) {
                IERC20(token).safeTransfer(recipients[i], amounts[i]);
            }
        }

        emit TokensDispersed(token, totalAmount, recipients.length);
    }

    /**
     * @notice Fallback function to receive native tokens
     */
    receive() external payable {}
}
