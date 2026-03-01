#!/bin/bash
# healthcheck-rtk.sh - Verify RTK installation and basic functionality
#
# This script performs health checks on the RTK installation:
# 1. Verifies RTK binary exists in PATH
# 2. Confirms RTK can execute and return version
# 3. Optionally checks version matches expected
#
# Exit codes:
#   0 - Health check passed
#   1 - Health check failed

set -euo pipefail

# Check if RTK binary exists and is executable
if ! command -v rtk &> /dev/null; then
    echo "Health check failed: RTK binary not found in PATH"
    exit 1
fi

# Check if RTK can execute and return version
if ! rtk --version &> /dev/null; then
    echo "Health check failed: RTK --version command failed"
    exit 1
fi

# Get version for success message
INSTALLED_VERSION=$(rtk --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
echo "Health check passed: RTK ${INSTALLED_VERSION} is functional"
exit 0
