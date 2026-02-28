---
phase: quick
plan: 25
type: execute
wave: 1
subsystem: CLI
requires: []
provides: [server-cwd-support]
affects: [bin/contextfs.js, server/index.js]
tech-stack:
  added: []
  patterns: [CLI argument parsing]
key-files:
  created: []
  modified:
    - bin/contextfs.js
    - server/index.js
decisions: []
metrics:
  duration: 3 min
  completed_at: "2026-02-28"
---

# Quick Task 25: Add --cwd support to server local command

## Summary

Added `--cwd <path>` support to the `contextfs server --local` command, allowing users to specify a custom workspace root directory instead of being restricted to the hardcoded `~/.contextfs/workspaces/local` path.

**Key changes:**
- Server help text now shows `--cwd` option with "local mode only" note
- Added example: `contextfs server --local --cwd /data/workspaces`
- Server parses `--cwd` argument using existing `getArg` helper
- Custom path uses `path.resolve()` for correct absolute path handling
- Falls back to default path when `--cwd` not provided

## Deviations from Plan

None — plan executed exactly as written.

## Tasks Completed

| Task | Name | Commit | Description |
|------|------|--------|-------------|
| 1 | Add --cwd option to server help text | bf55044 | Added `--cwd <path>` option and example to `showServerHelp()` |
| 2 | Parse --cwd argument in server/index.js | 837cfcd | Added `CWD_ARG` parsing and conditional `localWorkspaceRoot` assignment |
| 3 | Verify implementation | - | Verified help output and argument parsing logic |

## Commits

- `bf55044`: feat(quick-25): add --cwd option to server help text
- `837cfcd`: feat(quick-25): parse --cwd argument in server

## Verification

```bash
# Help text displays correctly
$ node bin/contextfs.js server --help
# Shows: --cwd <path>        Workspace root path (local mode only)
# Shows: contextfs server --local --cwd /data/workspaces

# Argument parsing test passed
$ node -e "...test script..."
# LOCAL_MODE: true
# CWD_ARG: /tmp/test-workspace
# localWorkspaceRoot: /tmp/test-workspace
# All tests passed!
```

## Usage Example

```bash
# Use custom workspace root in local mode
contextfs server --local --cwd /data/workspaces

# Still works with default path
contextfs server --local
```

## Self-Check: PASSED

- [x] `bin/contextfs.js` modified and committed
- [x] `server/index.js` modified and committed
- [x] Help text includes `--cwd` option
- [x] Server parses `--cwd` argument correctly
- [x] Custom path resolution works
- [x] Fallback to default path works
