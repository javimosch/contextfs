# Feature Landscape: RTK Integration for ContextFS

**Domain:** LLM Tool Proxy / Token Optimization
**Researched:** 2026-03-01
**Research Mode:** Ecosystem Analysis + Feasibility

## Executive Summary

RTK (Rust Token Killer) is a high-performance CLI proxy that filters and compresses command outputs before they reach LLM context, achieving **60-90% token savings** on common development operations. For ContextFS v1.1, integrating RTK support means proxying tool outputs through RTK when available, with graceful fallback to native execution.

**Key Insight:** RTK already supports 50+ commands across git, containers, testing, and package management—all directly applicable to ContextFS's existing tool suite. The integration is primarily about detecting RTK availability and routing commands appropriately.

**Confidence Level:** HIGH — RTK documentation is comprehensive, token savings are empirically measured, and the proxy pattern is well-documented.

---

## Table Stakes

Features that are **must-have** for ContextFS RTK integration. Missing these means the integration provides insufficient value.

| Feature | Why Expected | Complexity | Token Savings | Dependencies |
|---------|--------------|------------|---------------|--------------|
| **RTK Proxy Routing** | Core value proposition—intercepts tool calls and routes through RTK | Medium | N/A (enables all savings) | MCP tool wrapper, RTK binary detection |
| **bash (via rtk test/err)** | Most common operation; `rtk test` shows failures only | Simple | 90% on test output | Existing bash tool |
| **ls (rtk ls)** | Frequent directory exploration; 80% token savings | Simple | 80% | Existing ls tool |
| **grep/rg (rtk grep)** | Code search is core to agent workflows | Simple | 80% | Existing grep tool |
| **git status (rtk git status)** | Constantly used for workspace state | Simple | 80% | Existing git_status tool |
| **git diff (rtk git diff)** | Reviewing changes before commit | Simple | 75% | git diff capability |
| **git log (rtk git log)** | History exploration | Simple | 80% | git log capability |
| **git add/commit/push (rtk git)** | Standard git operations | Simple | 92% | git operations |
| **docker ps (rtk docker ps)** | Container monitoring | Simple | 80% | Existing docker_ps tool |
| **npm test (rtk test npm test)** | Node.js test execution | Simple | 90% | Existing npm_test tool |
| **cargo test (rtk test cargo test)** | Rust test execution | Simple | 90% | cargo_test capability |
| **Graceful Fallback** | Required for reliability—RTK errors must not break workflows | Medium | N/A | Error handling layer |
| **Configuration Toggle** | Enable/disable RTK per workspace or globally | Simple | N/A | Config system |

### Table Stakes Detail

#### 1. RTK Proxy Routing
**What:** A middleware layer that intercepts tool execution requests, checks if RTK is available and supports the command, then routes through RTK or falls back to native execution.

**Implementation:**
```javascript
// Pseudocode for ContextFS integration
async function executeWithRTK(command, args) {
  if (rtkEnabled && await rtkSupports(command)) {
    return exec('rtk', [command, ...args]);
  }
  return exec(command, args);
}
```

**Why Critical:** Without this routing layer, no token savings are realized. It's the foundation for all other RTK features.

**Dependencies:**
- RTK binary detection (check `rtk --version`)
- Command support matrix (which commands RTK handles)
- MCP tool wrapper modifications

#### 2. bash → rtk test/err
**Current Behavior:** `bash` tool executes arbitrary commands and returns raw stdout/stderr.

**RTK Enhancement:** 
- `rtk test <command>` — Shows failures only (90% reduction)
- `rtk err <command>` — Shows errors/warnings only

**Example Token Savings:**
- Standard cargo test: ~25,000 tokens (200 lines on failure)
- RTK cargo test: ~2,500 tokens (failures only)

**Implementation Complexity:** LOW
- Detect test commands (patterns like `*test*`, `cargo test`, `npm test`)
- Route through `rtk test` wrapper
- Parse RTK output format

#### 3. ls → rtk ls
**Current Behavior:** Directory listing with raw `ls -la` output.

**RTK Enhancement:** Tree format with aggregated counts.

**Example:**
```
# ls -la (45 lines, ~800 tokens)
drwxr-xr-x  15 user  staff    480 Jan 23 10:00 .
drwxr-xr-x   5 user  staff    160 Jan 23 09:00 ..
...

# rtk ls (12 lines, ~150 tokens)
📁 my-project/
├── src/ (8 files)
│   ├── main.rs
│   └── lib.rs
├── Cargo.toml
└── README.md
```

**Implementation Complexity:** LOW
- Replace `ls` calls with `rtk ls`
- Handle single file vs directory cases

#### 4. grep → rtk grep
**Current Behavior:** Raw grep output with line-by-line matches.

**RTK Enhancement:** Grouped search results by file with truncation.

**Token Savings:** 80% — grouping eliminates redundant file path repetition.

**Implementation Complexity:** LOW
- Route `grep` tool through `rtk grep`
- Handle pattern and path arguments

#### 5-8. git Operations
**Commands:** status, diff, log, add/commit/push

**RTK Enhancement:** Ultra-compact formatting.

**Examples:**
```
# git push (15 lines, ~200 tokens) → rtk git push (1 line, ~10 tokens)
ok ✓ main

# git status (30 lines) → rtk git status (3-5 lines)
3 modified, 1 untracked ✓
```

**Token Savings:** 80-92% depending on operation.

**Implementation Complexity:** LOW
- Map git operations to `rtk git <subcommand>`
- All ContextFS git tools benefit immediately

#### 9. docker ps → rtk docker ps
**Current Behavior:** Full docker ps table output.

**RTK Enhancement:** Compact container list.

**Token Savings:** 80%

**Implementation Complexity:** LOW
- Route docker commands through `rtk docker`

#### 10-11. Test Runners (npm/cargo)
**Commands:** npm test, cargo test, pytest, go test

**RTK Enhancement:** `rtk test <command>` — failures only.

**Token Savings:** 90% (most test output is success noise).

**Implementation Complexity:** LOW
- Detect test commands in bash tool
- Wrap with `rtk test`

#### 12. Graceful Fallback
**What:** If RTK fails (binary missing, command unsupported, runtime error), immediately fall back to native execution.

**Why Critical:** ContextFS must remain functional even without RTK. This is a reliability requirement.

**Implementation:**
```javascript
try {
  const result = await exec('rtk', [command, ...args]);
  return result;
} catch (error) {
  // Log RTK failure for debugging
  logger.debug(`RTK failed: ${error.message}`);
  // Fall back to native
  return exec(command, args);
}
```

**Complexity:** MEDIUM — requires error classification (RTK vs command error).

#### 13. Configuration Toggle
**What:** Allow users to enable/disable RTK globally or per-workspace.

**Why Expected:** Some users may prefer full output; debugging may need raw commands.

**Implementation Complexity:** LOW
- Add `rtk.enabled` config flag
- Check flag in proxy routing layer

---

## Differentiators

Features that **set ContextFS apart** by deeply integrating RTK capabilities. Not strictly required but provide significant value.

| Feature | Value Proposition | Complexity | Token Savings | Dependencies |
|---------|-------------------|------------|---------------|--------------|
| **Smart Command Detection** | Auto-detect which commands benefit from RTK | Medium | +10-15% coverage | Command pattern matching |
| **RTK Version Management** | Auto-install or verify RTK in Docker images | Medium | N/A | Docker image builds, package management |
| **Token Savings Analytics** | Track and report token savings per session | Medium | N/A | SQLite/tracking integration |
| **read/smart Commands** | File reading with intelligent filtering | Medium | 70-85% | New tool capabilities |
| **Container Logs (rtk docker logs)** | Deduplicated container log output | Medium | 60-80% | docker logs capability |
| **Package Manager Support** | npm/pnpm/pip list with compact output | Medium | 70-85% | Package manager tools |
| **Lint Integration** | ESLint/ruff/golangci-lint with grouped output | Medium | 80-85% | Lint tool wrappers |
| **Tee Output Recovery** | Save full output on failure for re-reading | Medium | N/A | File storage, path hints |
| **Ultra-Compact Mode** | `-u` flag for maximum compression | Simple | +5-10% extra | RTK flag passthrough |

### Differentiators Detail

#### 1. Smart Command Detection
**What:** Instead of hardcoded command mapping, use pattern matching to detect RTK-applicable commands.

**Example Patterns:**
- `*test*` → `rtk test`
- `*lint*` → `rtk lint`
- `git *` → `rtk git *`
- `docker ps/logs/images` → `rtk docker *`

**Value:** Higher RTK coverage without explicit per-command implementation.

**Complexity:** MEDIUM — requires robust pattern matching and testing.

#### 2. RTK Version Management
**What:** Ensure RTK is installed and up-to-date in ContextFS Docker images.

**Options:**
- Include RTK in base Docker image
- Auto-install on first use
- Version check and update mechanism

**Value:** Zero-config RTK support for Docker-based workspaces.

**Complexity:** MEDIUM — Docker image builds, package manager integration.

#### 3. Token Savings Analytics
**What:** Track token savings across sessions and expose via dashboard/API.

**RTK Reference:** `rtk gain` shows savings analytics.

**ContextFS Enhancement:**
- Per-workspace savings tracking
- Dashboard visualization
- Session-level reports

**Value:** Quantify RTK value to users; identify optimization opportunities.

**Complexity:** MEDIUM — requires persistence layer for metrics.

#### 4. read/smart Commands
**What:** New ContextFS tools leveraging RTK's file reading capabilities.

**RTK Commands:**
- `rtk read <file>` — Smart file reading with filtering
- `rtk read <file> -l aggressive` — Signatures only (strips bodies)
- `rtk smart <file>` — 2-line heuristic code summary

**Token Savings:** 70-85% on large files.

**Value:** Agents can explore large codebases with minimal tokens.

**Complexity:** MEDIUM — new tool implementations.

#### 5. Container Logs (rtk docker logs)
**What:** Deduplicated container log viewing.

**RTK Enhancement:** `rtk docker logs <container>` collapses repeated log lines with counts.

**Token Savings:** 60-80% on noisy container output.

**Value:** Essential for debugging containerized applications.

**Complexity:** MEDIUM — requires docker logs tool implementation.

#### 6. Package Manager Support
**What:** Compact package listings.

**RTK Commands:**
- `rtk pip list` — Python packages (70% reduction)
- `rtk pnpm list` — Node.js packages (70-90% reduction)
- `rtk npm list` — npm packages

**Value:** Dependency auditing with minimal tokens.

**Complexity:** MEDIUM — package manager detection and integration.

#### 7. Lint Integration
**What:** Grouped lint output by rule/file.

**RTK Commands:**
- `rtk lint` — ESLint/Biome (84% reduction)
- `rtk ruff check` — Python linting (80% reduction)
- `rtk golangci-lint run` — Go linting (85% reduction)

**Value:** Lint results are actionable without noise.

**Complexity:** MEDIUM — lint tool wrappers with auto-detection.

#### 8. Tee Output Recovery
**What:** When RTK filters output on failure, save full unfiltered output to file and provide hint.

**RTK Behavior:** Saves to `~/.local/share/rtk/tee/` and prints: `[full output: /path/to/file]`

**ContextFS Integration:**
- Make tee directory accessible to agents
- Include tee path in tool responses

**Value:** Agents can read full output without re-executing commands.

**Complexity:** MEDIUM — file storage, path management.

#### 9. Ultra-Compact Mode (`-u` flag)
**What:** Pass `-u, --ultra-compact` to RTK for maximum token savings.

**RTK Behavior:** ASCII icons, inline format for extra compression.

**Value:** Additional 5-10% token savings for token-constrained scenarios.

**Complexity:** LOW — config flag passthrough.

---

## Anti-Features

Features to **explicitly NOT implement**—either because they add complexity without value, conflict with ContextFS architecture, or RTK doesn't support them well.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **RTK Auto-Rewrite Hook** | ContextFS already has explicit tool calls; hooks are for interactive CLI | Use explicit RTK routing in tool implementations |
| **settings.json Patching** | ContextFS doesn't use Claude Code's settings.json; has its own config system | Implement ContextFS-native config toggle |
| **CLAUDE.md/RTK.md Injection** | ContextFS has its own context management; injection is Claude-specific | Document RTK capabilities in ContextFS docs |
| **Global RTK Installation** | ContextFS is containerized; global installs break isolation | Install RTK in Docker images only |
| **All 50+ RTK Commands at Once** | Overwhelming complexity; delays time-to-value | Phased rollout: core commands first |
| **Custom RTK Filters** | RTK is an external dependency; maintaining custom filters creates fork | Use RTK as-is; contribute upstream if needed |
| **RTK as Required Dependency** | ContextFS must work without RTK | Make RTK optional with graceful degradation |
| **Complex Query Syntax** | RTK commands should mirror native commands | Keep argument passthrough simple |

### Anti-Features Detail

#### 1. RTK Auto-Rewrite Hook
**What:** RTK's `rtk init` installs a Claude Code PreToolUse hook that transparently rewrites commands.

**Why Avoid:** ContextFS has explicit tool definitions (bash, ls, grep). The hook model assumes interactive bash usage, not structured MCP tools. Hooks add indirection that's hard to debug.

**Instead:** Explicitly route known commands through RTK in the tool implementation layer.

#### 2. settings.json Patching
**What:** RTK patches `~/.claude/settings.json` to register hooks.

**Why Avoid:** ContextFS doesn't use Claude Code's configuration system. It has its own workspace-level configuration.

**Instead:** Implement `rtk.enabled` in ContextFS's config system.

#### 3. CLAUDE.md/RTK.md Injection
**What:** RTK can inject instructions into CLAUDE.md to guide LLM usage.

**Why Avoid:** ContextFS manages its own LLM context and tool descriptions. External instruction injection conflicts with the MCP protocol.

**Instead:** Document RTK capabilities in ContextFS's own documentation and system prompts.

#### 4. Global RTK Installation
**What:** Installing RTK globally on the host system.

**Why Avoid:** ContextFS emphasizes containerized isolation. Global installs violate the sandbox model and create version conflicts.

**Instead:** Include RTK in the ContextFS Docker image only. Containers are ephemeral and version-controlled.

#### 5. All 50+ RTK Commands at Once
**What:** Implementing every RTK command in the initial release.

**Why Avoid:** Overwhelming complexity; delays time-to-value. Many RTK commands are for niche use cases.

**Instead:** Phased rollout:
- **Phase 1:** Core commands (ls, grep, git, docker ps, test runners) — 80% of token savings
- **Phase 2:** Package managers, linting — 15% additional savings
- **Phase 3:** Specialized tools (gh, kubectl, prisma) — 5% additional savings

#### 6. Custom RTK Filters
**What:** Forking RTK or adding custom filters for ContextFS-specific needs.

**Why Avoid:** Maintenance burden; divergence from upstream. RTK is actively maintained (rtk-ai/rtk).

**Instead:** Use RTK as-is. If a command needs custom filtering, contribute it upstream to benefit the broader RTK community.

#### 7. RTK as Required Dependency
**What:** Making RTK mandatory for ContextFS operation.

**Why Avoid:** ContextFS must remain functional in environments where RTK isn't available (older containers, restricted environments).

**Instead:** Always implement graceful fallback. RTK is an optimization, not a requirement.

#### 8. Complex Query Syntax
**What:** Adding custom query languages or complex argument transformations.

**Why Avoid:** Violates the principle of least surprise. Users expect RTK commands to work like native commands.

**Instead:** Simple argument passthrough. `rtk <command> [args...]` should behave identically to `<command> [args...]` but with filtered output.

---

## Feature Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          RTK Integration Dependency Graph                     │
└─────────────────────────────────────────────────────────────────────────────┘

Foundation Layer (Required for all):
├── RTK Binary Detection
├── Proxy Routing Layer
└── Graceful Fallback

Core Commands (Phase 1):
├── ls → rtk ls
│   └── Requires: Proxy Routing
├── grep → rtk grep
│   └── Requires: Proxy Routing
├── git status/diff/log → rtk git
│   └── Requires: Proxy Routing
├── docker ps → rtk docker
│   └── Requires: Proxy Routing
└── test runners → rtk test
    └── Requires: Proxy Routing, Command Pattern Detection

Enhanced Commands (Phase 2):
├── read/smart tools
│   └── Requires: New Tool Implementations
├── docker logs
│   └── Requires: docker logs tool
├── package managers (pip/npm/pnpm)
│   └── Requires: Package Manager Detection
└── lint tools (eslint/ruff/golangci-lint)
    └── Requires: Lint Tool Detection

Analytics Layer (Phase 3):
├── Token Savings Tracking
│   └── Requires: Metrics Persistence
├── RTK Version Management
│   └── Requires: Docker Image Updates
└── Dashboard Integration
    └── Requires: Analytics API
```

---

## MVP Recommendation

**Prioritize for v1.1 (Maximum Value, Minimum Complexity):**

### Phase 1: Foundation (Week 1)
1. **RTK Binary Detection** — Check `rtk --version` on startup
2. **Proxy Routing Layer** — Middleware to route commands through RTK
3. **Graceful Fallback** — Always fall back to native on RTK failure
4. **Configuration Toggle** — Enable/disable RTK globally

### Phase 2: Core Commands (Week 2)
1. **ls → rtk ls** — Simple replacement, 80% savings
2. **grep → rtk grep** — Simple replacement, 80% savings
3. **git status → rtk git status** — Simple replacement, 80% savings
4. **git diff/log → rtk git** — Extend git operations, 75-80% savings
5. **docker ps → rtk docker ps** — Simple replacement, 80% savings

### Phase 3: Test Optimization (Week 3)
1. **bash test detection** — Pattern match test commands
2. **rtk test wrapper** — Route test commands through `rtk test`
3. **npm test → rtk test npm test** — 90% savings
4. **cargo test → rtk test cargo test** — 90% savings

### Deferred to v1.2+
- **Token Savings Analytics** — Requires metrics persistence
- **read/smart tools** — New capabilities, not replacements
- **Package manager integration** — Lower frequency usage
- **Tee output recovery** — Nice-to-have, not critical
- **Ultra-compact mode** — Incremental improvement

**Why This Order:**
- Foundation first ensures reliability
- Core commands provide 80% of token savings
- Test optimization adds 90% savings on high-volume operations
- Deferred features add complexity without proportional value

---

## Expected Token Savings Summary

| ContextFS Tool | Command | Token Savings | Frequency | Impact |
|----------------|---------|---------------|-----------|--------|
| ls | `rtk ls` | **80%** | Very High | Critical |
| grep | `rtk grep` | **80%** | Very High | Critical |
| git_status | `rtk git status` | **80%** | Very High | Critical |
| git_diff | `rtk git diff` | **75%** | High | High |
| git_log | `rtk git log` | **80%** | Medium | Medium |
| docker_ps | `rtk docker ps` | **80%** | Medium | Medium |
| npm_test | `rtk test npm test` | **90%** | High | Critical |
| cargo_test | `rtk test cargo test` | **90%** | Medium | High |
| bash (tests) | `rtk test` | **90%** | High | High |

**Total Expected Savings:** Based on RTK benchmarks, ContextFS users can expect **70-80% token reduction** on common operations, translating to:
- Typical session without RTK: ~150,000 tokens
- With RTK: ~45,000 tokens
- **Savings: ~105,000 tokens per session (70%)**

---

## Sources

| Source | Confidence | Notes |
|--------|------------|-------|
| ref-rtk/README.md | HIGH | Official documentation, comprehensive command reference |
| ref-rtk/CLAUDE.md | HIGH | Architecture details, implementation patterns |
| .planning/PROJECT.md | HIGH | ContextFS requirements and constraints |
| RTK Token Savings Table | HIGH | Empirical measurements from RTK benchmarks |

**Verification:**
- ✅ RTK command list verified against README
- ✅ Token savings percentages from official benchmarks
- ✅ ContextFS tool list from PROJECT.md
- ✅ Architecture patterns from CLAUDE.md

---

## Gaps to Address

1. **RTK Version Compatibility:** What RTK version is required? ContextFS should specify minimum version.
2. **Docker Image Size:** RTK binary adds ~5MB. Impact on image pull times?
3. **Cross-Platform RTK:** RTK supports macOS/Linux/Windows. ContextFS Docker is Linux-only, but local mode may need consideration.
4. **RTK Error Classification:** Need to distinguish "RTK not installed" vs "RTK command failed" vs "underlying command failed."
5. **Metrics Persistence:** If implementing token analytics, where to store data? SQLite like RTK does?

---

*Last updated: 2026-03-01*
*Research confidence: HIGH*
