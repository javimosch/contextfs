#!/bin/sh
# init-rtk.sh - Container initialization script with RTK detection
#
# This script runs at container startup to detect RTK availability,
# log status verbosely, and export configuration for child processes.
#
# It runs BEFORE the main container process starts via ENTRYPOINT.
#
# Environment Variables:
#   CONTEXTFS_RTK_ENABLED - "true" | "false" | (unset for auto-detect)
#   CONTEXTFS_RTK_STATUS  - Exported: "enabled" | "disabled" | "unavailable"
#   CONTEXTFS_RTK_VERSION - Exported: version string (e.g., "0.23.0") if available
#
# Usage:
#   ENTRYPOINT ["/usr/local/bin/init-rtk.sh"]
#   CMD ["node", "/app/bin/contextfs.js", "client"]

set -e

# Configuration
RTK_BINARY_PATH="/usr/local/bin/rtk"

# Initialize status variables
RTK_STATUS="unavailable"
RTK_VERSION=""

# Log function with [RTK] prefix for easy grepping
log_rtk() {
    echo "[RTK] $1"
}

# Function to check if RTK binary exists and is executable
check_rtk_binary() {
    if [ -f "$RTK_BINARY_PATH" ] && [ -x "$RTK_BINARY_PATH" ]; then
        return 0
    fi
    return 1
}

# Function to get RTK version
get_rtk_version() {
    "$RTK_BINARY_PATH" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1
}

# Main detection logic
log_rtk "Starting RTK initialization..."

# Check CONTEXTFS_RTK_ENABLED environment variable
case "${CONTEXTFS_RTK_ENABLED:-}" in
    "false"|"FALSE"|"False")
        RTK_STATUS="disabled"
        log_rtk "Explicitly disabled by CONTEXTFS_RTK_ENABLED=false"
        ;;
    "true"|"TRUE"|"True"|"")
        # Proceed to binary detection (true or unset = auto-detect)
        if [ -z "${CONTEXTFS_RTK_ENABLED:-}" ]; then
            log_rtk "CONTEXTFS_RTK_ENABLED not set, auto-detecting..."
        else
            log_rtk "Explicitly enabled by CONTEXTFS_RTK_ENABLED=true"
        fi
        
        # Check if binary exists
        if check_rtk_binary; then
            log_rtk "Binary found at $RTK_BINARY_PATH"
            
            # Try to get version
            RTK_VERSION=$(get_rtk_version)
            if [ -n "$RTK_VERSION" ]; then
                log_rtk "Version: $RTK_VERSION"
                RTK_STATUS="enabled"
            else
                log_rtk "Warning: Binary exists but version check failed"
                RTK_STATUS="unavailable"
            fi
        else
            log_rtk "Binary not found at $RTK_BINARY_PATH"
            RTK_STATUS="unavailable"
        fi
        ;;
    *)
        # Invalid value
        log_rtk "Warning: Invalid CONTEXTFS_RTK_ENABLED value '$CONTEXTFS_RTK_ENABLED', treating as unset"
        log_rtk "Auto-detecting RTK..."
        
        # Check if binary exists
        if check_rtk_binary; then
            log_rtk "Binary found at $RTK_BINARY_PATH"
            
            # Try to get version
            RTK_VERSION=$(get_rtk_version)
            if [ -n "$RTK_VERSION" ]; then
                log_rtk "Version: $RTK_VERSION"
                RTK_STATUS="enabled"
            else
                log_rtk "Warning: Binary exists but version check failed"
                RTK_STATUS="unavailable"
            fi
        else
            log_rtk "Binary not found at $RTK_BINARY_PATH"
            RTK_STATUS="unavailable"
        fi
        ;;
esac

# Export status for child processes
export CONTEXTFS_RTK_STATUS="$RTK_STATUS"
if [ -n "$RTK_VERSION" ]; then
    export CONTEXTFS_RTK_VERSION="$RTK_VERSION"
fi

# Log final status
log_rtk "Status: $RTK_STATUS"

# Expected container startup log output:
# [RTK] Starting RTK initialization...
# [RTK] Auto-detecting RTK...
# [RTK] Binary found at /usr/local/bin/rtk
# [RTK] Version: 0.23.0
# [RTK] Status: enabled

# Execute main container process
# This replaces the current script process with the main command
# ensuring initialization completes BEFORE MCP server starts
exec "$@"
