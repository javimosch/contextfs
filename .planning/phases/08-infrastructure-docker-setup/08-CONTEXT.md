# Phase 8: Infrastructure & Docker Setup - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Install RTK (Rust Token Killer) binary into ContextFS Docker containers with multi-architecture support. Includes shell wrapper scripts, health checks, and workspace-scoped database configuration. Does NOT include MCP integration logic or command proxying (Phase 9).

</domain>

<decisions>
## Implementation Decisions

### RTK Installation Method
- Download pre-built binary from GitHub releases (rtk-ai/rtk)
- Use curl to fetch binary directly from GitHub releases page
- Basic verification via executable test only (run `rtk --version` after install)
- Install to `/usr/local/bin/rtk` (standard location, already in PATH)

### Multi-Architecture Support
- Support both x86_64 (Intel/AMD) and aarch64 (ARM64/Apple Silicon)
- Use Docker build arguments to conditionally download correct architecture binary
- Both architectures must pass health checks

### Claude's Discretion
- Exact curl flags and error handling during download
- Dockerfile stage placement (runtime-full recommended)
- Specific RTK version to pin (suggest v0.23.0+)
- Shell wrapper implementation details
- Health check script complexity

</decisions>

<specifics>
## Specific Ideas

- RTK binary is ~4MB, installation should be fast
- Installation should happen in the runtime-full stage only (not runtime-base)
- Simple verification: `rtk --version` should return expected version
- Binary URL pattern: `https://github.com/rtk-ai/rtk/releases/download/v${VERSION}/rtk-${ARCH}-unknown-linux-musl.tar.gz`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-infrastructure-docker-setup*
*Context gathered: 2026-03-01*
