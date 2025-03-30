#!/bin/bash
# Script to set up directories for Safe CLI integration

# Create temp directory for Safe CLI operations
mkdir -p temp

# Ensure safe-cli is installed and available
if ! command -v safe &> /dev/null; then
    echo "safe-cli not found. Please install it with pipx:"
    echo ""
    echo "  pipx install safe-cli"
    echo ""
    echo "Or with pip:"
    echo ""
    echo "  pip install -U safe-cli"
    echo ""
    exit 1
fi

echo "Safe CLI found: $(safe --version)"
echo "Setup complete. Safe CLI is ready to use."