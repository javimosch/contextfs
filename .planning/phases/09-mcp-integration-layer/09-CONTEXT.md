# Phase 9: MCP Integration Layer - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate RTK proxying into ContextFS MCP tool execution flow with configurable fallback and error handling. ContextFS must reliably detect RTK availability and gracefully fall back to native execution when RTK is disabled, unavailable, or fails. Does NOT include the actual command proxying logic (Phase 10) or test optimization (Phase 11).

</domain>

<decisions>
## Implementation Decisions

### Configuration Toggle System
- RTK enabled by **auto-detect** — if RTK binary is available and healthy, enable it; otherwise disable
- **Environment variable only** — use `CONTEXTFS_RTK_ENABLED` (true/false) for configuration
  - If set to "true" or "false", respect that setting
  - If unset or invalid, auto-detect based on RTK binary availability
- **No per-workspace or per-command configuration** for v1.1 — global setting only
- **Verbose startup logging** — container logs RTK binary location, version, and status on startup
  - Example: "RTK binary found at /usr/local/bin/rtk", "RTK version: 0.23.0", "Status: enabled"

### Claude's Discretion
- Exact log format and verbosity levels
- How to handle invalid CONTEXTFS_RTK_ENABLED values (treat as unset vs error)
- RTK availability check implementation details (version command vs health script)
- Container startup hook location (entrypoint vs init script)

</decisions>

<specifics>
## Specific Ideas

- Auto-detect logic: Check if `rtk --version` returns 0 and valid version string
- Container startup should log RTK status before any commands execute
- Keep configuration simple — environment variable is sufficient for v1.1
- Fallback to native execution is the critical behavior — must be rock-solid

</specifics>

<deferred>
## Deferred Ideas

- Per-workspace RTK configuration (v1.2 candidate)
- Per-command RTK enable/disable (v1.2 candidate)
- Hot-reload of RTK configuration without container restart
- RTK configuration UI in dashboard

</deferred>

---

*Phase: 09-mcp-integration-layer*
*Context gathered: 2026-03-01*
