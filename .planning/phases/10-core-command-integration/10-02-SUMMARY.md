---
phase: 10-core-command-integration
plan: 02
subsystem: command-execution
tags: [spawn, rtk, command-interception, native-prefix, exit-codes]

# Dependency graph
requires:
  - phase: 10-core-command-integration
    provides: [TokenTracker, CommandParser, RTKExecutor]
provides:
  - SpawnWrapper module for transparent spawn interception
  - client/spawn.js integration with RTK routing
  - native: prefix bypass functionality
  - Exit code preservation (0, 1, 126, 127)
  - Fallback logic for RTK errors
affects:
  - client/spawn.js
  - server/mcp/tools/spawn-wrapper.js
  - All commands using runCommand/runCommandStreaming

tech-stack:
  added: []
  patterns:
    - "Lazy initialization for optional dependencies"
    - "Transparent interception with fallback"
    - "EventEmitter-compatible process mocking"

key-files:
  created:
    - server/mcp/tools/spawn-wrapper.js - SpawnWrapper class for RTK interception
    - test/spawn-wrapper.test.js - 34 unit tests for SpawnWrapper
    - test/core-commands.test.js - 25 integration tests for core commands
  modified:
    - client/spawn.js - Integrated SpawnWrapper with runCommand/runCommandStreaming

key-decisions:
  - "Strip native: prefix in client/spawn.js before execution to ensure commands work even when RTK is unavailable"
  - "Use lazy initialization for RTK components to avoid issues in non-container environments"
  - "Return exit code 127 for ENOENT (command not found) and 126 for EACCES/EPERM (permission denied)"
  - "Shell commands (bash/sh with -c flag) bypass RTK to maintain compatibility"

patterns-established:
  - "Transparent interception: Commands route through RTK automatically without code changes"
  - "Bypass prefix: native:command executes natively, bypassing RTK entirely"
  - "Exit code preservation: All exit codes (0, 1, 126, 127) pass through exactly"

requirements-completed: [CORE-01, CORE-02, CORE-03, CORE-04, CORE-05]

duration: 18min
completed: 2026-03-01
---

# Phase 10 Plan 02: Spawn Wrapper and Bash Tool Integration

**Transparent spawn-level interception routing ls, grep, git, docker through RTK with automatic fallback and exit code preservation**

## Performance

- **Duration:** 18 min
- **Started:** 2026-03-01T19:14:54Z
- **Completed:** 2026-03-01T19:22:58Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- **SpawnWrapper module** - Complete spawn interception with RTK routing, fallback logic, and exit code preservation
- **client/spawn.js integration** - RTK-aware runCommand and runCommandStreaming with native: prefix support
- **59 passing tests** - 34 unit tests for SpawnWrapper + 25 integration tests for core commands
- **Exit code preservation** - Exact exit codes (0, 1, 126, 127) maintained through RTK and native execution
- **native: bypass prefix** - Commands prefixed with `native:` bypass RTK and execute natively

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SpawnWrapper module** - `55e323e` (feat)
   - SpawnWrapper class with shouldUseRTK(), execute(), wrapSpawn() methods
   - 34 unit tests covering routing, bypass, fallback, exit codes

2. **Task 2: Integrate with client/spawn.js** - `3193400` (feat)
   - Lazy initialization of RTK components
   - RTK routing in runCommand() and runCommandStreaming()
   - Shell command bypass for -c flag

3. **Task 3: Create core command integration tests** - `03456fd` (feat)
   - 25 integration tests for ls, grep, git, docker
   - Exit code preservation tests
   - native: prefix bypass tests
   - Error handling and edge case coverage

## Files Created/Modified

- `server/mcp/tools/spawn-wrapper.js` (178 lines) - SpawnWrapper class for transparent interception
- `test/spawn-wrapper.test.js` (481 lines) - Comprehensive unit tests
- `test/core-commands.test.js` (340 lines) - Integration tests for core commands
- `client/spawn.js` (+89/-2 lines) - RTK integration with backward compatibility

## Decisions Made

1. **Strip native: prefix early** - Handle prefix stripping in client/spawn.js before any execution path to ensure consistent behavior
2. **Lazy initialization** - Initialize RTK components only when needed to avoid issues in non-container environments
3. **Exit code standards** - Follow POSIX conventions: 127 for command not found, 126 for permission denied
4. **Shell bypass** - Always bypass RTK for shell commands (-c flag) to avoid complex parsing issues

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **Exit code 127 not preserved** - Fixed by updating error handler to check error.code === 'ENOENT'
2. **native: prefix not stripped** - Fixed by handling prefix in client/spawn.js before both RTK and native paths
3. **Test glob patterns returning exit code 2** - Updated test to accept exit code 2 (ls returns 2 for unmatched globs)

All issues were minor test adjustments, no architectural changes required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Spawn interception foundation complete
- Core commands (ls, grep, git, docker) automatically use RTK when enabled
- Exit codes preserved exactly for compatibility
- Fallback to native execution on RTK errors
- Ready for Phase 10-03: Advanced commands and shell integration

---
*Phase: 10-core-command-integration*
*Completed: 2026-03-01*