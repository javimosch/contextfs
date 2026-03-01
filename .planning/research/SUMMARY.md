# Research Summary: ContextFS v1.1 RTK Integration

**Project:** ContextFS v1.1 RTK Integration  
**Domain:** Token Optimization Proxy / LLM Tool Execution  
**Researched:** 2026-03-01  
**Confidence:** HIGH

---

## Executive Summary

RTK (Rust Token Killer) integration into ContextFS represents a **high-value, low-complexity enhancement** that delivers 60-90% token reduction on common development operations (git, grep, ls, npm test, cargo test) by proxying tool outputs through a filtering layer before they reach the LLM context window. The integration is primarily operational—adding a ~4MB static binary to the Docker image and implementing transparent shell-level command interception—rather than requiring significant architectural changes to ContextFS itself.

The recommended approach follows a **Docker-layer integration pattern**: install the RTK v0.23.0+ pre-built binary in the `runtime-full` image stage, use shell aliases and wrapper functions for transparent command interception, and maintain graceful fallback to native execution at all times. This preserves the existing ContextFS execution chain (message-handler.js → command-runner.js → spawn.js) while adding token optimization at the container boundary. Key risks center on **exit code propagation**, **silent output corruption** during failures, and **graceful degradation** when RTK is unavailable—all addressable through careful integration testing and robust fallback logic.

---

## Key Findings

### Recommended Stack

RTK integration requires minimal stack changes: a single pre-built binary installed via GitHub releases, environment variable configuration, and shell-level interception. The Docker-layer approach keeps ContextFS Node.js code unchanged while enabling RTK for all containerized tool executions.

**Core technologies:**
- **RTK Binary v0.23.0+**: Token optimization proxy — statically compiled, musl libc compatible, ~4MB size impact
- **Docker Multi-Stage Build**: RTK installation in `runtime-full` stage only — avoids bloating minimal images, uses BuildKit for multi-arch support (x86_64, aarch64)
- **Shell Wrapper Scripts**: Transparent command interception — rtk-shell-wrapper.sh with fallback logic, /etc/profile.d/rtk.sh for aliases
- **Environment Configuration**: `CONTEXTFS_RTK_ENABLED`, `RTK_DB_PATH`, `RTK_FALLBACK` — container-friendly, no config files needed

**Installation approach:**
```dockerfile
ARG RTK_VERSION=0.23.0
RUN curl -fsSL \
    "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-x86_64-unknown-linux-musl.tar.gz" | \
    tar -xz -C /usr/local/bin && chmod +x /usr/local/bin/rtk
```

### Expected Features

RTK support enables substantial token savings across ContextFS's existing tool suite. Table stakes features provide immediate value; differentiators deepen integration; anti-features are explicitly avoided.

**Must have (table stakes):**
- **RTK Proxy Routing** — Core middleware intercepting tool calls and routing through RTK (enables all savings)
- **bash → rtk test/err** — Shows failures only (90% token reduction on test output)
- **ls → rtk ls** — Tree format with aggregated counts (80% savings)
- **grep/rg → rtk grep** — Grouped search results (80% savings)
- **git status/diff/log** — Ultra-compact formatting (75-80% savings)
- **docker ps → rtk docker ps** — Compact container list (80% savings)
- **npm/cargo test → rtk test** — Failures-only output (90% savings)
- **Graceful Fallback** — Required for reliability; RTK errors must never break workflows
- **Configuration Toggle** — Enable/disable RTK per workspace or globally

**Should have (differentiators):**
- **Smart Command Detection** — Auto-detect which commands benefit from RTK using pattern matching (+10-15% coverage)
- **Token Savings Analytics** — Track and report savings per session via `rtk gain` metrics
- **read/smart Tools** — New capabilities leveraging RTK's file reading with intelligent filtering (70-85% savings)
- **Tee Output Recovery** — Save full output on failure for re-reading (essential for debugging)
- **Ultra-Compact Mode** — `-u` flag for maximum compression (+5-10% extra savings)

**Defer (v2+):**
- **Container Logs (rtk docker logs)** — Lower frequency usage
- **Package Manager Support** — pip/npm/pnpm list (nice-to-have)
- **Lint Integration** — ESLint/ruff/golangci-lint (specialized use case)
- **RTK Version Management** — Auto-update mechanisms

**Anti-features (explicitly NOT implementing):**
- RTK Auto-Rewrite Hook (incompatible with MCP tool model)
- settings.json Patching (ContextFS has own config system)
- Global RTK Installation (violates container isolation)
- All 50+ RTK Commands at Once (phased rollout preferred)

### Architecture Approach

The integration follows a **transparent proxy pattern** at the Docker/shell layer rather than modifying ContextFS tool dispatch logic. This preserves existing execution flows while adding token optimization.

**Major components:**

1. **Docker Image Layer** — RTK binary installation in `runtime-full` stage with multi-arch support (amd64/arm64)
2. **RTK Shell Wrapper Script** (`rtk-shell-wrapper.sh`) — Transparent command interception with fallback support; checks if RTK supports command, executes via RTK or falls back to native
3. **RTK Configuration** — Environment-based config (`RTK_ENABLED`, `RTK_FALLBACK`, `RTK_DB_PATH`); workspace-scoped database at `/workspace/.rtk/history.db`
4. **Health Check Script** (`rtk-health-check.sh`) — Container verification: binary exists, version check, basic functionality test, database directory writable
5. **Shell Profile Integration** — `/etc/profile.d/rtk.sh` sources wrapper, sets up aliases (git, ls, grep, npm, cargo, docker)

**Data flow:**
```
[MCP Tool Call] → [spawn.js] → [Shell Alias] → [RTK Wrapper] → 
[RTK Binary] → [Filtered Output] → [LLM Response]
                    ↓
            [Fallback on Error] → [Native Tool] → [Raw Output]
```

**Key architectural decisions:**
- Docker-layer integration (not code-level) → Zero ContextFS Node.js changes
- Shell aliases (not PATH interception) → Easier enable/disable, explicit fallback
- Workspace-scoped database (not global) → Survives container restarts, per-workspace analytics

### Critical Pitfalls

Research identified 8 RTK-specific pitfalls that must be addressed during implementation, plus 4 general ContextFS pitfalls relevant to containerized execution.

**Top RTK Integration Pitfalls:**

1. **RTK Binary Confusion** — Installing wrong package (Rust Type Kit vs Rust Token Killer)  
   *Prevention:* Always verify with `rtk gain` post-install; install from `rtk-ai/rtk` GitHub releases; check version shows Token Killer (0.22.2+)

2. **Silent Output Corruption** — Critical errors hidden by aggressive filtering  
   *Prevention:* Enable `tee` feature to save full output on failures; implement fallback on non-zero exit; whitelist commands needing full output

3. **Exit Code Propagation Failure** — RTK swallows/misreports underlying command exit codes  
   *Prevention:* Verify RTK propagates exit codes; capture RTK exit code separately; integration tests for known failures; use `rtk -v` for debugging

4. **Missing Graceful Fallback** — Total failure when RTK errors  
   *Prevention:* Implement try RTK → if error, run native → if error, report failure chain; feature flag with degradation; detect RTK availability before proxy

5. **Argument Parsing Mismatch** — Commands with flags fail when proxied  
   *Prevention:* Whitelist supported commands with full flag passthrough; test common flag combinations; use `rtk proxy` mode for unknown flags

**Additional concerns:**
- **Tee Output Path Issues** — Tee files in `~/.local/share/rtk/tee/` may not be accessible in Docker  
  *Prevention:* Configure `RTK_TEE_DIR` to shared volume; verify tee files readable
- **Performance Overhead** — RTK adds 5-15ms overhead per command  
  *Prevention:* Benchmark in Docker; selective proxying for high-output commands only; monitor timing
- **Configuration Drift** — Inconsistent behavior across environments  
  *Prevention:* Use environment variables only (not config files); pin RTK version in Dockerfile

---

## Implications for Roadmap

Based on research, the following phase structure is recommended for ContextFS v1.1 RTK Integration:

### Phase 1: Infrastructure & Docker Setup
**Rationale:** RTK must be available in the container before any configuration or testing can occur. Foundation layer for all subsequent phases.

**Delivers:**
- Updated Dockerfile with `runtime-rtk` stage
- RTK binary installation (v0.23.0) with multi-arch support
- Shell wrapper scripts (`rtk-shell-wrapper.sh`, `rtk-health-check.sh`)
- Build verification and health checks passing

**Addresses:** RTK Binary Confusion (verify correct package), Configuration Drift (Dockerfile as source of truth), Tee Output Path Issues (configure paths)

**Avoids:** Installing RTK in runtime-base (adds bloat); compiling from source (adds 500MB toolchain)

**Research flags:** 
- ⚠️ **Needs verification:** Multi-arch testing on Apple Silicon (aarch64) before production
- ✅ **Standard patterns:** Docker multi-stage builds, binary installation

### Phase 2: MCP Integration Layer
**Rationale:** Once RTK is available in containers, implement the proxy routing layer with robust fallback and error handling. This is where most pitfalls must be prevented.

**Delivers:**
- RTK availability detection (`rtk --version` check)
- Command allowlist for supported RTK commands
- Graceful fallback implementation (try RTK → native on error)
- Exit code propagation verification
- Configuration toggle (`CONTEXTFS_RTK_ENABLED`)

**Implements:** Proxy routing layer; shell-level interception via aliases; error handling layer

**Addresses:** Silent Output Corruption (tee + fallback), Exit Code Propagation Failure (explicit handling), Missing Graceful Fallback (degradation chain), Argument Parsing Mismatch (whitelist approach)

**Research flags:**
- ⚠️ **Needs research:** Error classification—distinguish "RTK not installed" vs "RTK command failed" vs "underlying command failed"
- ⚠️ **Needs validation:** Exit code preservation across all supported commands

### Phase 3: Core Command Integration
**Rationale:** With infrastructure and routing in place, enable high-value, low-complexity command replacements that provide 80% of token savings.

**Delivers:**
- `ls` → `rtk ls` integration
- `grep` → `rtk grep` integration
- `git status/diff/log` → `rtk git` integration
- `docker ps` → `rtk docker ps` integration
- Token savings validation for each command

**Addresses:** Table stakes features for 70-80% token reduction

**Research flags:**
- ✅ **Standard patterns:** Direct command replacement; RTK documentation comprehensive

### Phase 4: Test Optimization
**Rationale:** Test execution produces the highest-volume output; 90% savings here has outsized impact on overall session token usage.

**Delivers:**
- Pattern detection for test commands (`*test*`, `cargo test`, `npm test`)
- `rtk test` wrapper for test execution
- `rtk err` wrapper for error-only output
- npm/cargo test integration
- Failures-only output validation

**Implements:** Smart command detection (pattern matching); bash tool enhancement

**Addresses:** 90% token savings on test output—highest impact feature

**Research flags:**
- ⚠️ **Needs validation:** Pattern matching accuracy—avoid false positives on non-test commands

### Phase 5: Analytics & Monitoring (v1.2 candidate)
**Rationale:** Token savings tracking validates RTK value and identifies optimization opportunities. Deferred to v1.2 as it requires persistence layer and adds complexity.

**Delivers:**
- `rtk gain` metrics exposure
- Per-workspace savings tracking
- Dashboard integration for token analytics
- Usage reporting

**Addresses:** Token Savings Analytics differentiator; user value validation

**Research flags:**
- ⚠️ **Needs research:** Metrics persistence strategy—SQLite like RTK does, or ContextFS registry?

### Phase Ordering Rationale

1. **Infrastructure before integration:** RTK must be in containers before routing logic can be tested
2. **Routing before commands:** The proxy layer must handle fallback before any command uses RTK
3. **Core commands before test optimization:** Establish patterns with simple commands (ls, grep) before complex pattern matching (test detection)
4. **Functionality before analytics:** Prove RTK works before measuring savings; defer metrics to v1.2
5. **Phased rollout over big-bang:** Reduces risk, enables iterative validation, aligns with RTK's own recommendation

**Estimated impact by phase:**
- Phase 1-2: 0% (foundation, no user-facing change)
- Phase 3: ~60% token savings (core commands)
- Phase 4: ~85% token savings (core + tests)
- Phase 5: Validation only (metrics)

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** Error classification strategies; exit code propagation edge cases
- **Phase 4:** Test command pattern matching accuracy; avoiding false positives
- **Phase 5:** Metrics persistence architecture decision

Phases with standard patterns (skip research-phase):
- **Phase 1:** Docker multi-stage builds, binary installation—well-documented patterns
- **Phase 3:** Direct command replacement—RTK documentation comprehensive

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | RTK official releases well-documented; pre-built binaries verified; installation pattern proven |
| Features | **HIGH** | RTK command list from official README; token savings from empirical benchmarks; feature matrix validated |
| Architecture | **HIGH** | Docker-layer approach standard for CLI tools; shell wrapper patterns established; ContextFS execution flow well-understood |
| Pitfalls | **HIGH** | 8 RTK-specific pitfalls identified from documentation and integration patterns; prevention strategies documented |

**Overall confidence:** **HIGH**

All research based on official RTK documentation (ref-rtk/README.md, ref-rtk/ARCHITECTURE.md), ContextFS project requirements, and established Docker/container patterns. Token savings claims are backed by RTK's empirical measurements.

### Gaps to Address

1. **Multi-arch binary verification:** Need to test aarch64 RTK binary on Apple Silicon Docker before production deployment
2. **Error classification strategy:** Distinguish RTK availability vs RTK command failure vs underlying command failure
3. **Metrics persistence decision:** If implementing token analytics, decide between RTK's SQLite approach vs ContextFS registry
4. **RTK version compatibility:** Confirm minimum RTK version required (currently recommending 0.23.0+)
5. **Performance benchmarking:** Measure actual overhead in ContextFS Docker containers (target <50ms)

---

## Sources

### Primary (HIGH confidence)
- RTK GitHub Releases — https://github.com/rtk-ai/rtk/releases (version information, binary availability)
- ref-rtk/README.md (local) — Official documentation, comprehensive command reference, token savings benchmarks
- ref-rtk/ARCHITECTURE.md (local) — Proxy pattern, module design, filtering strategies
- ref-rtk/CLAUDE.md (local) — Command routing, performance constraints, testing patterns
- .planning/PROJECT.md (local) — ContextFS requirements and constraints

### Secondary (MEDIUM confidence)
- ContextFS Dockerfile (local) — Multi-stage container build structure
- ContextFS message-handler.js, command-runner.js, spawn.js (local) — Tool execution flow
- Docker Security Best Practices — Container isolation patterns

### Tertiary (LOW confidence)
- Community RTK integration examples — Validation of patterns (may vary by use case)

---

*Research completed: 2026-03-01*  
*Ready for roadmap: YES*
