# Roadmap: ContextFS

## Milestones

- ✅ **v1.0 MVP** — Core remote execution environment with MCP and Dashboard (shipped 2026-02-27). [Archive](.planning/milestones/v1.0-ROADMAP.md)
- ⏳ **v1.1 RTK Integration** — Token optimization via RTK proxy in Docker containers

## v1.1 RTK Integration Summary

**Goal:** Integrate RTK proxy support into ContextFS Docker containers to reduce LLM token consumption by 60-90% on common operations.

**Previous:** v1.0 completed through Phase 7
**Phases:** 8-11
**Depth:** Medium (Standard)

| Phase | Focus | Plans | Status | Completed |
|-------|-------|-------|--------|-----------|
| 8 | Infrastructure & Docker Setup | 2/2 | Complete | 2026-03-01 |
| 9 | MCP Integration Layer | 4/4 | Complete | 2026-03-01 |
| 10 | Core Command Integration | 3/3 | Complete | 2026-03-01 |
| 11 | Test Optimization & Advanced Features | 0/2 | Ready | - |

## Phases

### v1.0 MVP (Phases 1-7) — SHIPPED 2026-02-27

- [x] Phase 1: Foundation & CLI — completed 2026-02-27
- [x] Phase 2: Data Plane & Security — completed 2026-02-27
- [x] Phase 3: Control Plane & Scheduling — completed 2026-02-27
- [x] Phase 3.1: Dashboard & Management UX — completed 2026-02-27
- [x] Phase 4: MCP Gateway & Connectivity — completed 2026-02-27
- [x] Phase 5: Chat TUI Validation — completed 2026-02-27
- [x] Phase 5.1: Agent-Managed Workspaces — completed 2026-02-27
- [x] Phase 6: Documentation & Migration — completed 2026-02-27
- [x] Phase 7: Container Strategy — completed 2026-02-27

### v1.1 RTK Integration (Phases 8-11)

- [x] **Phase 8: Infrastructure & Docker Setup** - RTK binary installed with multi-arch support, shell wrappers, and health checks (completed 2026-03-01)
- [x] **Phase 9: MCP Integration Layer** - Configuration toggles, availability detection, and robust error handling with graceful fallback (completed 2026-03-01)
- [x] **Phase 10: Core Command Integration** - ls, grep, git, and docker commands proxied through RTK with token reduction verification (completed 2026-03-01)
- [ ] **Phase 11: Test Optimization & Advanced Features** - Pattern detection for tests, read/smart tools, and ultra-compact mode

## Phase Details

### Phase 8: Infrastructure & Docker Setup
**Goal:** RTK binary is available and functional in ContextFS Docker containers with proper health monitoring

**Depends on:** Phase 7 (v1.0 completion)

**Requirements:** INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05

**Success Criteria** (what must be TRUE):
1. `rtk --version` returns v0.23.0+ when executed inside runtime-full container
2. Both x86_64 and aarch64 architectures have working RTK binaries
3. Shell wrapper script (`rtk-shell-wrapper.sh`) exists with fallback logic
4. Health check script passes for RTK installation and basic functionality
5. Workspace-scoped RTK database directory exists at `/workspace/.rtk/`

**Plans:** 2/2 plans complete

**Plan List:**
- [ ] `08-01-PLAN.md` — RTK binary installation with multi-arch support (INFRA-01, INFRA-02)
- [ ] `08-02-PLAN.md` — Shell wrapper, health checks, and workspace configuration (INFRA-03, INFRA-04, INFRA-05)

**Wave Structure:**
```
Wave 1: 08-01 (RTK binary installation - no dependencies)
Wave 2: 08-02 (Scripts and compose - depends on 08-01)
```

---

### Phase 9: MCP Integration Layer
**Goal:** ContextFS reliably detects RTK availability and gracefully falls back to native execution when needed

**Depends on:** Phase 8

**Requirements:** CONFIG-01, CONFIG-03, CONFIG-04, ERROR-01, ERROR-02, ERROR-03, ERROR-04  
*Note: CONFIG-02 (per-workspace configuration) deferred to v1.2 per user decision*

**Success Criteria** (what must be TRUE):
1. Setting `CONTEXTFS_RTK_ENABLED=false` completely disables RTK proxying for all commands
2. Container startup detects RTK availability and logs the result
3. When RTK fails, command automatically retries with native execution
4. Failed RTK commands save full output via tee feature for debugging
5. Error messages clearly distinguish between RTK errors, command errors, and native failures
6. Commands with unsupported flags bypass RTK and execute natively

**Plans:** 4/4 plans complete

**Plan List:**
- [x] `09-01-PLAN.md` — Container initialization script with RTK detection and logging (CONFIG-03) ✓ Complete
- [x] `09-02-PLAN.md` — Configuration module with boolean parsing and auto-detect (CONFIG-01, CONFIG-04) ✓ Complete
- [x] `09-03-PLAN.md` — Error classification system with three-tier logic (ERROR-03) ✓ Complete
- [ ] `09-04-PLAN.md` — RTK executor with fallback, tee output, and allowlist (ERROR-01, ERROR-02, ERROR-04)

**Wave Structure:**
```
Wave 1: 09-01, 09-02 (initialization and config - no dependencies)
Wave 2: 09-03, 09-04 (error handling and executor - depends on config)
```

---

### Phase 10: Core Command Integration
**Goal:** High-frequency commands (ls, grep, git, docker) automatically use RTK for 60-80% token reduction

**Depends on:** Phase 9

**Requirements:** CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06

**Success Criteria** (what must be TRUE):
1. `ls` on directories with 50+ files returns tree-formatted output with aggregated counts
2. `grep` searches return grouped results instead of line-by-line matches
3. `git status`, `git diff`, and `git log` produce ultra-compact formatted output
4. `docker ps` and `docker images` return compact container/image listings
5. Failed commands (non-zero exit codes) are correctly identified as failures
6. Core commands achieve measured 60-80% token reduction versus native output

**Plans:** 3/3 plans complete

**Wave Structure:**
```
Wave 1: 10-01 (Token tracking infrastructure - no dependencies) ✓ Complete
Wave 2: 10-02 (Spawn wrapper and integration - depends on 10-01) ✓ Complete
Wave 3: 10-03 (Verification and bash adapter - depends on 10-02) ✓ Complete
```

**Plan List:**
- [x] `10-01-PLAN.md` — Token tracking, logging, and command parser infrastructure (CORE-06) ✓ Complete
- [x] `10-02-PLAN.md` — Spawn wrapper and bash tool integration (CORE-01, CORE-02, CORE-03, CORE-04, CORE-05) ✓ Complete
- [x] `10-03-PLAN.md` — Token reduction verification and bash adapter (CORE-05, CORE-06) ✓ Complete

---

### Phase 11: Test Optimization & Advanced Features
**Goal:** Test commands and advanced tools achieve 85-90% token savings while maintaining debugging capabilities

**Depends on:** Phase 10

**Requirements:** TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, ADV-01, ADV-02, ADV-03, ADV-04, ADV-05

**Success Criteria** (what must be TRUE):
1. Commands matching `*test*`, `cargo test`, or `npm test` patterns are auto-detected
2. Test commands show only failures (hiding passing test output)
3. `npm test` and `cargo test` achieve 85-90% token reduction on typical suites
4. `read` tool can filter file contents through RTK for large files
5. `smart` tool provides 2-line code summaries for any file
6. Ultra-compact mode (`-u` flag) produces maximum compression when requested
7. Supported command flags pass through to RTK without errors

**Plans:** TBD

---

## Dependencies

```
Phase 8 (Infrastructure)
    ↓
Phase 9 (Integration Layer)
    ↓
Phase 10 (Core Commands)
    ↓
Phase 11 (Test + Advanced)
```

## Progress Table

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-7   | v1.0      | —              | ✓ Complete | 2026-02-27 |
| 8     | v1.1      | 2/2            | ✓ Complete | 2026-03-01 |
| 9     | v1.1      | 4/4            | ✓ Complete | 2026-03-01 |
| 10    | v1.1      | 3/3            | ✓ Complete | 2026-03-01 |
| 11    | v1.1      | 0/2            | ⏸️ Ready | - |

## Requirements Coverage

**Total v1.1 Requirements:** 29

| Category | Count | Phase | Status |
|----------|-------|-------|--------|
| Infrastructure | 5 | Phase 8 | ✅ Mapped |
| Configuration | 4 | Phase 9 | ✅ Mapped |
| Error Handling | 4 | Phase 9 | ✅ Mapped |
| Core Commands | 6 | Phase 10 | ✅ Mapped |
| Test Optimization | 5 | Phase 11 | ✅ Mapped |
| Advanced Features | 5 | Phase 11 | ✅ Mapped |

**Coverage:** 29/29 requirements mapped ✓

### Traceability Matrix

| Requirement | Phase | Description |
|-------------|-------|-------------|
| INFRA-01 | Phase 8 | RTK binary v0.23.0+ in runtime-full stage |
| INFRA-02 | Phase 8 | Multi-arch support (x86_64, aarch64) |
| INFRA-03 | Phase 8 | Shell wrapper script with fallback |
| INFRA-04 | Phase 8 | Health check script |
| INFRA-05 | Phase 8 | Workspace-scoped RTK database |
| CONFIG-01 | Phase 9 | Environment variable `CONTEXTFS_RTK_ENABLED` |
| CONFIG-02 | Phase 9 | Per-workspace RTK configuration |
| CONFIG-03 | Phase 9 | RTK availability detection at startup | ✅ Complete |
| CONFIG-04 | Phase 9 | Graceful degradation when disabled |
| ERROR-01 | Phase 9 | Graceful fallback on RTK errors |
| ERROR-02 | Phase 9 | Tee output saves full output on failures |
| ERROR-03 | Phase 9 | Error classification system | ✅ Complete
| ERROR-04 | Phase 9 | Command allowlist for flags |
| CORE-01 | Phase 10 | `ls` proxied through RTK | ✅ Complete
| CORE-02 | Phase 10 | `grep`/`rg` proxied through RTK | ✅ Complete
| CORE-03 | Phase 10 | `git` commands proxied through RTK | ✅ Complete
| CORE-04 | Phase 10 | `docker` commands proxied through RTK | ✅ Complete
| CORE-05 | Phase 10 | Exit codes preserved | ✅ Complete
| CORE-06 | Phase 10 | 60-80% token reduction verified | ✅ Complete
| TEST-01 | Phase 11 | Pattern detection for test commands |
| TEST-02 | Phase 11 | `rtk test` wrapper |
| TEST-03 | Phase 11 | `npm test` proxied through RTK |
| TEST-04 | Phase 11 | `cargo test` proxied through RTK |
| TEST-05 | Phase 11 | 85-90% token reduction for tests |
| ADV-01 | Phase 11 | `read` tool with RTK integration |
| ADV-02 | Phase 11 | `smart` tool for code summaries |
| ADV-03 | Phase 11 | Tee output recovery enabled |
| ADV-04 | Phase 11 | Ultra-compact mode (`-u` flag) |
| ADV-05 | Phase 11 | Argument passthrough for flags |

## Research Context

Based on research analysis:
- **Phase 8 (Infrastructure)** requires multi-arch testing on Apple Silicon
- **Phase 9 (Integration)** needs error classification strategy validation
- **Phase 11 (Test + Advanced)** requires pattern matching accuracy testing
- Analytics deferred to v1.2 (requires persistence layer)

See `.planning/research/SUMMARY.md` for full details.

---

*Roadmap updated: 2026-03-01 — Phase 10-03 complete (Token reduction verification and bash-rtk-adapter with 71 new tests)*
