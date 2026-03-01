# Phase 10: Core Command Integration - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate RTK proxying for high-frequency commands (ls, grep, git, docker, cat, head, tail, etc.) to achieve 60-80% token reduction. All RTK-supported commands should automatically use RTK when enabled. Does NOT include test command optimization (Phase 11) or advanced features like read/smart tools.

</domain>

<decisions>
## Implementation Decisions

### Command Routing Strategy
- **Wrap at spawn level** — Intercept all spawn calls globally in the MCP tool execution pipeline
- **All RTK supported commands** — Use RTK for any command in its allowlist (not just roadmap commands)
  - Includes: ls, grep/rg, git (status/diff/log), docker (ps/images), cat, head, tail, wc, find, sort, uniq
- **Pass all flags through** — Let RTK handle flags; it fails gracefully if unsupported
- **Special prefix bypass** — Use 'native:' prefix (e.g., 'native:ls -la') to bypass RTK for specific invocations

### Exit Code Handling
- **Pass through exactly** — Exit codes from both RTK and native execution preserved identically
- **No special handling** — RTK failures that trigger fallback still preserve original exit code from native retry
- **Transparent to callers** — MCP tools see same exit codes whether RTK or native execution used

### Token Reduction Measurement
- **Log comparison** — Measure tokens saved by comparing RTK output vs native output in execution logs
- **Periodic reporting** — Log token reduction stats periodically (every 100 commands or hourly)
- **Benchmark mode** — Optional mode to run both RTK and native and compare (for testing)

### Claude's Discretion
- Exact spawn interception implementation details
- RTK allowlist synchronization (hardcoded vs dynamic from RTK binary)
- Token reduction calculation method (character count vs actual tokens)
- Bypass prefix parsing implementation
- Logging verbosity for token stats

</decisions>

<specifics>
## Specific Ideas

- Spawn wrapper should be transparent — existing tool code shouldn't need changes
- RTK command detection should be fast (cached allowlist)
- Token reduction logging format: "RTK: ls saved 847 chars (73% reduction)"
- Bypass prefix 'native:' should be stripped before execution
- Consider adding RTK metadata to MCP tool responses (wasRTKUsed, tokensSaved)

</specifics>

<deferred>
## Deferred Ideas

- Per-command RTK enable/disable (v1.2 candidate)
- User-configurable command allowlist
- Token savings dashboard/analytics (v1.2)
- Smart command detection (auto-detect when RTK would help)
- RTK for test commands (Phase 11)
- RTK read/smart tools (Phase 11)

</deferred>

---

*Phase: 10-core-command-integration*
*Context gathered: 2026-03-01*
