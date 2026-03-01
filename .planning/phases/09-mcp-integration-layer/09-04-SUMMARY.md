---
phase: 09-mcp-integration-layer
plan: 04
subsystem: execution
tags: [rtk, executor, fallback, error-handling, tee, allowlist]

# Dependency graph
requires:
  - phase: 09-02
    provides: RTKConfig module for configuration
  - phase: 09-03
    provides: ErrorClassifier for three-tier error classification
provides:
  - NativeExecutor for fallback command execution
  - RTKExecutor with automatic fallback logic
  - Command allowlist to prevent unsupported flag errors
  - Tee output saving for debugging failed commands
  - Exit code preservation from both RTK and native execution
affects:
  - Phase 10: Core Command Integration
  - Phase 11: Test Optimization

tech-stack:
  added: [Node.js child_process]
  patterns: [Strategy pattern, Error classification, Allowlist validation]

key-files:
  created:
    - server/mcp/tools/native-executor.js - Native command execution fallback
    - server/mcp/tools/rtk-executor.js - RTK execution with fallback logic
    - test/native-executor.test.js - NativeExecutor test suite
    - test/rtk-executor.test.js - RTKExecutor test suite
  modified: []

key-decisions:
  - "Implemented three-tier fallback: Tier 1/2 errors trigger native fallback, Tier 3 does not"
  - "Command allowlist prevents RTK failures from unsupported flags"
  - "Tee output saved to /workspace/.rtk/tee/ on failures for debugging"
  - "Used shell: false in spawn for security (prevents injection)"
  - "Buffer.concat pattern for efficient large output handling"

patterns-established:
  - "Fallback pattern: Try RTK → classify error → fallback if appropriate"
  - "Allowlist validation: Check command + flags before RTK execution"
  - "Tee debugging: Automatic output capture on failures"
  - "Standardized result format: { stdout, stderr, exitCode, source }"

requirements-completed: [ERROR-01, ERROR-02, ERROR-04]

# Metrics
duration: 5min
completed: 2026-03-01
---

# Phase 09 Plan 04: RTK Executor with Fallback Summary

**NativeExecutor and RTKExecutor modules implementing automatic fallback to native execution on Tier 1/2 errors, command allowlist for unsupported flags, and tee output saving for debugging.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-01T18:21:27Z
- **Completed:** 2026-03-01T18:26:34Z
- **Tasks:** 3
- **Files created:** 4
- **Tests:** 40 passing

## Accomplishments

- **NativeExecutor** (162 lines): Native command execution with spawn, shell: false for security, timeout support, and standardized result format
- **RTKExecutor** (330 lines): RTK execution with automatic fallback, command allowlist validation, tee output saving, and error classification integration
- **Command allowlist**: Prevents RTK failures by bypassing RTK for unsupported commands/flags
- **Three-tier fallback**: Tier 1 (spawn) and Tier 2 (RTK processing) errors trigger native fallback; Tier 3 (command) errors do not
- **Tee output**: Failed commands automatically save output to `/workspace/.rtk/tee/{timestamp}_{command}.log`
- **Comprehensive tests**: 40 tests covering all execution paths, error scenarios, and edge cases

## Task Commits

Each task committed atomically:

1. **Task 1: NativeExecutor** - `0c0a95a` (feat)
   - Native command execution using child_process.spawn
   - Security with shell: false
   - Timeout and error handling
   
2. **Task 2: RTKExecutor** - `bb1354f` (feat)
   - RTK execution with fallback logic
   - Error classification integration
   - Command allowlist and tee output
   
3. **Task 3: Tests** - `8f6db6a` (test)
   - 18 tests for NativeExecutor
   - 22 tests for RTKExecutor
   - All 40 tests passing

**Note:** 09-03 dependency (error-classifier) was already completed in commits `df91f67` and `2f003e8`.

## Files Created

- `server/mcp/tools/native-executor.js` (162 lines) - NativeExecutor class
  - Uses spawn with shell: false for security
  - Handles ENOENT (127), EACCES (126) errors
  - Timeout support via setTimeout/kill
  - Buffer.concat for efficient output handling

- `server/mcp/tools/rtk-executor.js` (330 lines) - RTKExecutor class
  - Integrates RTKConfig, ErrorClassifier, NativeExecutor
  - Command allowlist for ls, grep, rg, git, cat, head, tail, wc, find, sort, uniq
  - Three-tier error classification for fallback decisions
  - Tee output saving on failures
  - Command mapping for RTK subcommands

- `test/native-executor.test.js` (406 lines) - 18 tests
  - Basic execution, command not found, non-zero exits
  - Timeout handling, options support, output streaming
  - Exit codes constants, security (shell: false)

- `test/rtk-executor.test.js` (406 lines) - 22 tests
  - RTK disabled flow, allowlist validation
  - Error classification integration
  - Command mapping, exit code preservation
  - Constructor options, module exports

## Decisions Made

1. **Three-tier fallback logic**: Tier 1 (spawn/execution) and Tier 2 (RTK processing) errors trigger native fallback, while Tier 3 (command) errors return the failure directly. This prevents infinite fallback loops on actual command failures.

2. **Command allowlist**: Explicit list of supported commands and flags prevents RTK from receiving unsupported flags that would cause errors. Commands not in allowlist bypass RTK entirely.

3. **Tee output location**: `/workspace/.rtk/tee/{timestamp}_{command}.log` follows existing RTK workspace pattern for consistency.

4. **shell: false security**: Using spawn with array arguments instead of shell string prevents command injection vulnerabilities.

5. **Standardized result format**: All executors return `{ stdout, stderr, exitCode, source }` for consistent handling upstream.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Error-classifier.js dependency not available**
- **Found during:** Task 1 preparation
- **Issue:** 09-03 plan existed but error-classifier.js wasn't in MCP tools directory
- **Fix:** Discovered error-classifier was already committed (commits df91f67, 2f003e8) but in different location. The file existed at server/mcp/tools/error-classifier.js after investigation.
- **Verification:** Module loads and all 22 error-classifier tests pass
- **Committed in:** Already committed as part of 09-03

**2. [Rule 1 - Bug] Incorrect relative path for RTKConfig import**
- **Found during:** Task 2 verification
- **Issue:** Used `../config/rtk-config.js` but correct path is `../../config/rtk-config.js` from server/mcp/tools/
- **Fix:** Updated import path
- **Files modified:** server/mcp/tools/rtk-executor.js
- **Verification:** Module loads successfully
- **Committed in:** bb1354f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correct module resolution. No scope creep.

## Issues Encountered

None. All tasks completed smoothly:
- NativeExecutor implementation matched specification
- RTKExecutor integrated all dependencies correctly
- All 40 tests pass on first run
- No additional dependencies required

## User Setup Required

None - no external service configuration required. The modules work with existing environment variables:
- `CONTEXTFS_RTK_ENABLED`: Controls RTK enablement
- `CONTEXTFS_RTK_STATUS`: Container status from init-rtk.sh
- `CONTEXTFS_RTK_PATH`: Optional RTK binary path
- `CONTEXTFS_RTK_TIMEOUT`: Execution timeout
- `CONTEXTFS_RTK_TEE_ON_ERROR`: Enable/disable tee output

## Next Phase Readiness

- ✅ ERROR-01 satisfied: Graceful fallback on Tier 1/2 errors
- ✅ ERROR-02 satisfied: Tee feature saves full output on failures  
- ✅ ERROR-04 satisfied: Command allowlist prevents unsupported flag failures
- ✅ NativeExecutor ready for use as fallback layer
- ✅ RTKExecutor ready for integration with MCP tools
- ✅ Exit codes preserved for both RTK and native execution
- ✅ Comprehensive test coverage (40 tests)

**Ready for Phase 10: Core Command Integration**

---
*Phase: 09-mcp-integration-layer*
*Plan: 04*
*Completed: 2026-03-01*