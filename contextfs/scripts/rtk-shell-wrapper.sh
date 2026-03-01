#!/bin/bash
# rtk-shell-wrapper.sh - Wrap commands with RTK fallback logic
#
# Usage: rtk-shell-wrapper.sh <command> [args...]
# Example: rtk-shell-wrapper.sh ls -la

set -euo pipefail

# Configuration
RTK_ENABLED="${CONTEXTFS_RTK_ENABLED:-false}"
RTK_FALLBACK_ON_ERROR="${CONTEXTFS_RTK_FALLBACK:-true}"

# Extract the command (first argument)
COMMAND="${1:-}"
shift || true

# If RTK is disabled, run native command directly
if [ "${RTK_ENABLED}" != "true" ]; then
    exec "${COMMAND}" "$@"
fi

# Check if RTK binary exists
if ! command -v rtk &> /dev/null; then
    echo "Warning: RTK binary not found, using native ${COMMAND}" >&2
    exec "${COMMAND}" "$@"
fi

# Map common commands to RTK subcommands
case "${COMMAND}" in
    ls)
        RTK_CMD="rtk ls"
        ;;
    grep|rg)
        RTK_CMD="rtk grep"
        ;;
    git)
        # git has subcommands, pass through for now
        RTK_CMD=""
        ;;
    *)
        RTK_CMD=""
        ;;
esac

# If we have an RTK equivalent, try it first
if [ -n "${RTK_CMD}" ] && [ "${RTK_FALLBACK_ON_ERROR}" = "true" ]; then
    if ${RTK_CMD} "$@"; then
        exit 0
    else
        RTK_EXIT=$?
        echo "Warning: RTK failed (exit ${RTK_EXIT}), using native ${COMMAND}" >&2
        exec "${COMMAND}" "$@"
    fi
else
    # No RTK equivalent or fallback disabled
    exec "${COMMAND}" "$@"
fi
