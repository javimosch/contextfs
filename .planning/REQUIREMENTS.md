# Requirements: ContextFS v1.1 RTK Integration

**Defined:** 2026-03-01
**Core Value:** Secure, distributed execution that gives AI agents a "place to think" without compromising the host system's security.

## v1 Requirements

Requirements for RTK integration milestone. Each maps to roadmap phases.

### Infrastructure

- [x] **INFRA-01**: RTK binary v0.23.0+ installed in runtime-full Docker stage
- [x] **INFRA-02**: Multi-arch support (x86_64, aarch64) for RTK binary
- [x] **INFRA-03**: Shell wrapper script (`rtk-shell-wrapper.sh`) with fallback logic
- [x] **INFRA-04**: Health check script verifying RTK installation and functionality
- [x] **INFRA-05**: Workspace-scoped RTK database configuration

### Configuration

- [ ] **CONFIG-01**: Environment variable `CONTEXTFS_RTK_ENABLED` for global toggle
- [ ] **CONFIG-02**: Per-workspace RTK enable/disable configuration
- [ ] **CONFIG-03**: RTK binary availability detection at container startup
- [ ] **CONFIG-04**: Graceful degradation when RTK is disabled or unavailable

### Core Command Integration

- [ ] **CORE-01**: `ls` command proxied through RTK with tree formatting
- [ ] **CORE-02**: `grep` / `rg` commands proxied through RTK with grouped results
- [ ] **CORE-03**: `git status` / `git diff` / `git log` proxied through RTK
- [ ] **CORE-04**: `docker ps` / `docker images` proxied through RTK
- [ ] **CORE-05**: Exit codes preserved for all proxied commands
- [ ] **CORE-06**: 60-80% token reduction verified for core commands

### Test Optimization

- [ ] **TEST-01**: Pattern detection for test commands (`*test*`, `cargo test`, `npm test`)
- [ ] **TEST-02**: `rtk test` wrapper for bash test execution
- [ ] **TEST-03**: `npm test` proxied through RTK with failures-only output
- [ ] **TEST-04**: `cargo test` proxied through RTK with failures-only output
- [ ] **TEST-05**: 85-90% token reduction verified for test commands

### Advanced Features

- [ ] **ADV-01**: `read` tool integrated with RTK for filtered file reading
- [ ] **ADV-02**: `smart` tool using RTK for 2-line code summaries
- [ ] **ADV-03**: Tee output recovery enabled for debugging failures
- [ ] **ADV-04**: Ultra-compact mode (`-u` flag) support for maximum compression
- [ ] **ADV-05**: Argument passthrough for supported command flags

### Error Handling

- [ ] **ERROR-01**: Graceful fallback to native execution on RTK errors
- [ ] **ERROR-02**: Tee feature saves full output on command failures
- [ ] **ERROR-03**: Error classification (RTK vs command vs native failure)
- [ ] **ERROR-04**: Command allowlist prevents unsupported flag failures

## v2 Requirements (Deferred)

### Analytics & Monitoring

- **ANALYTICS-01**: Token savings tracking per workspace session
- **ANALYTICS-02**: `rtk gain` metrics exposure in ContextFS
- **ANALYTICS-03**: Dashboard integration for token usage analytics
- **ANALYTICS-04**: Usage reporting and optimization recommendations

### Additional Commands

- **EXTRA-01**: `rtk docker logs` integration for container log filtering
- **EXTRA-02**: Package manager support (pip/npm/pnpm list)
- **EXTRA-03**: Lint tool integration (ESLint/ruff/golangci-lint)

## Out of Scope

| Feature | Reason |
|---------|--------|
| RTK Auto-Rewrite Hook | Incompatible with MCP tool model; ContextFS has own config system |
| settings.json Patching | ContextFS uses environment-based configuration |
| Global RTK Installation | Violates container isolation principles |
| All 50+ RTK Commands at Once | Phased rollout reduces risk; defer low-value commands to v2 |
| RTK Version Auto-Update | Container images should pin versions for reproducibility |
| Token Savings Dashboard (v1.1) | Requires persistence layer; defer to v1.2 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 8 | Complete |
| INFRA-02 | Phase 8 | Complete |
| INFRA-03 | Phase 8 | Complete |
| INFRA-04 | Phase 8 | Complete |
| INFRA-05 | Phase 8 | Complete |
| CONFIG-01 | Phase 9 | Pending |
| CONFIG-02 | Phase 9 | Pending |
| CONFIG-03 | Phase 9 | Pending |
| CONFIG-04 | Phase 9 | Pending |
| ERROR-01 | Phase 9 | Pending |
| ERROR-02 | Phase 9 | Pending |
| ERROR-03 | Phase 9 | Pending |
| ERROR-04 | Phase 9 | Pending |
| CORE-01 | Phase 10 | Pending |
| CORE-02 | Phase 10 | Pending |
| CORE-03 | Phase 10 | Pending |
| CORE-04 | Phase 10 | Pending |
| CORE-05 | Phase 10 | Pending |
| CORE-06 | Phase 10 | Pending |
| TEST-01 | Phase 11 | Pending |
| TEST-02 | Phase 11 | Pending |
| TEST-03 | Phase 11 | Pending |
| TEST-04 | Phase 11 | Pending |
| TEST-05 | Phase 11 | Pending |
| ADV-01 | Phase 11 | Pending |
| ADV-02 | Phase 11 | Pending |
| ADV-03 | Phase 11 | Pending |
| ADV-04 | Phase 11 | Pending |
| ADV-05 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0 ✓

### Phase Groupings

- **Phase 8** (Infrastructure): INFRA-01 through INFRA-05 (5 requirements)
- **Phase 9** (Integration Layer): CONFIG-01 through CONFIG-04, ERROR-01 through ERROR-04 (8 requirements)
- **Phase 10** (Core Commands): CORE-01 through CORE-06 (6 requirements)
- **Phase 11** (Test + Advanced): TEST-01 through TEST-05, ADV-01 through ADV-05 (10 requirements)

---
*Requirements defined: 2026-03-01*
*Last updated: 2026-03-01 after initial definition*
