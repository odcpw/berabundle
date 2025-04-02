#!/bin/bash
# run-safe-test.sh - Script to test the Safe integration in BeraBundle

echo "===================================================="
echo "BeraBundle - Safe Transaction Service Integration Test"
echo "===================================================="
echo

# Step 1: Test the working direct API implementation
echo "STEP 1: Testing direct Safe Transaction Service API implementation"
node test-safe-proposal.js
echo

# Step 2: Test the integration with BeraBundle using SafeExecutor
echo "STEP 2: Testing SafeExecutor integration"
node test-safe-executor.js
echo

echo "Tests completed!"
echo
echo "To use Safe in the main application:"
echo "1. Run BeraBundle: node berabundle.js"
echo "2. Generate a bundle: Select 'Claim Rewards'"
echo "3. Choose 'Safe UI' format when prompted"
echo "4. Send the bundle: Select 'Send Bundle'"
echo "5. When prompted, select the Safe address to send to"
echo
echo "The transaction will appear in the Safe UI for all owners to review and confirm."