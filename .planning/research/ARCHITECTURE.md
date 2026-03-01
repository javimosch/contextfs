# Architecture Research: RTK Integration

**Domain:** Token Optimization Proxy for LLM Tool Execution  
**Researched:** 2026-03-01  
**Confidence:** HIGH

## Executive Summary

RTK (Rust Token Killer) integration with ContextFS Docker execution follows a **transparent proxy pattern** where high-frequency tool calls (git, ls, grep, npm, cargo) are intercepted and filtered through RTK before returning to the LLM. This achieves 60-90% token reduction with ~5-15ms overhead per command.

**Key Design Decision:** Install RTK as a first-class binary in Docker images and use shell-level command interception rather than modifying ContextFS tool dispatch logic. This preserves the existing message-handler.js → command-runner.js → spawn.js execution chain while adding token optimization at the execution boundary.

---

## Integration Points with Existing Tool Execution

### Current Execution Flow (Without RTK)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ContextFS Tool Execution Flow                           │
└─────────────────────────────────────────────────────────────────────────────┘

[MCP Request]
      ↓
[message-handler.js] ── Routes tool calls via `runFsTool()` or `runCommands()`
      ↓
[command-runner.js] ─── Executes TOOLS.BASH_SCRIPT_ONCE, TOOLS.LIST, etc.
      ↓
[spawn.js] ──────────── Spawns child processes (bash, git, npm, etc.)
      ↓
[Raw Output] ────────── Returns unfiltered stdout/stderr to LLM
```

### RTK-Enhanced Execution Flow (With RTK)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  RTK-Integrated Tool Execution Flow                         │
└─────────────────────────────────────────────────────────────────────────────┘

[MCP Request]
      ↓
[message-handler.js] ── Unchanged routing logic
      ↓
[command-runner.js] ─── Unchanged tool dispatch
      ↓
[spawn.js] ──────────── Command execution
      │
      ├─ Is command RTK-supported? ───┬── YES ──→ [RTK Proxy] ──→ [Filtered Output]
      │                                 │
      └── NO ──────────────────────────┴────────→ [Native Tool] ──→ [Raw Output]
      │
      ↓
[Response] ──────────── Optimized or raw output to LLM
```

### Integration Point 1: Docker Image Layer (Primary)

**Location:** `Dockerfile` (runtime-full stage)

**Change:** Add RTK binary installation to the container build

```dockerfile
# Stage 3: Full Runtime with RTK
FROM runtime-base AS runtime-full

# Install common CLI tools
RUN apk add --no-cache \
    git \
    ripgrep \
    tree \
    curl \
    bash

# Install RTK binary
ARG RTK_VERSION=0.22.2
RUN curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-v${RTK_VERSION}-linux-amd64.tar.gz" | \
    tar -xz -C /usr/local/bin

# Configure shell-level RTK interception
COPY docker/rtk-shell-wrapper.sh /usr/local/bin/rtk-wrapper
RUN chmod +x /usr/local/bin/rtk-wrapper
```

**Why here:** 
- RTK is a compiled Rust binary (~4MB) with no runtime dependencies
- Installing at the Docker layer keeps ContextFS Node.js code unchanged
- Shell-level interception works for all tool invocations (bash_script_once, runCommands)

### Integration Point 2: Shell-Level Command Interception

**Location:** Docker container environment (runtime configuration)

**Strategy:** Use shell aliases and PATH manipulation to transparently route commands through RTK

```bash
# /etc/profile.d/rtk.sh - sourced by all interactive shells
export RTK_ENABLED=1
export RTK_DB_PATH=/workspace/.rtk/history.db

# Function wrappers for supported commands
rtk_wrap() {
    local cmd="$1"
    shift
    if [[ "$RTK_ENABLED" == "1" ]] && command -v rtk &> /dev/null; then
        rtk "$cmd" "$@"
    else
        "$cmd" "$@"
    fi
}

# Command aliases
alias git='rtk_wrap git'
alias ls='rtk_wrap ls'
alias grep='rtk_wrap grep'
alias npm='rtk_wrap npm'
alias cargo='rtk_wrap cargo'
alias docker='rtk_wrap docker'
```

### Integration Point 3: ContextFS Configuration (Optional Enhancement)

**Location:** `client/config.js` or environment variables

**Change:** Add RTK enablement flag and configuration

```javascript
// client/config.js
const RTK_CONFIG = {
  enabled: process.env.RTK_ENABLED === '1',
  dbPath: process.env.RTK_DB_PATH || '/workspace/.rtk/history.db',
  fallbackOnError: true,  // Graceful degradation
  supportedCommands: [
    'git', 'ls', 'grep', 'find', 
    'npm', 'cargo', 'docker', 'bash'
  ]
};
```

---

## New Components Needed

### Component 1: RTK Shell Wrapper Script

**File:** `contextfs/docker/rtk-shell-wrapper.sh`

**Purpose:** Transparent command interception with fallback support

```bash
#!/bin/bash
# RTK Shell Wrapper - Transparent proxy with fallback

set -euo pipefail

RTK_BINARY="/usr/local/bin/rtk"
RTK_ENABLED="${RTK_ENABLED:-1}"
RTK_FALLBACK="${RTK_FALLBACK:-1}"

# Extract command name from invocation
COMMAND="$1"
shift

# Check if RTK is enabled and available
if [[ "$RTK_ENABLED" != "1" ]] || [[ ! -x "$RTK_BINARY" ]]; then
    exec "$COMMAND" "$@"
fi

# Check if RTK supports this command
if "$RTK_BINARY" --help 2>/dev/null | grep -q "^  $COMMAND "; then
    # RTK supports this command - proxy through RTK
    if "$RTK_BINARY" "$COMMAND" "$@"; then
        exit 0
    else
        RTK_EXIT=$?
        # On RTK failure, fallback to native if configured
        if [[ "$RTK_FALLBACK" == "1" ]] && [[ $RTK_EXIT -ne 0 ]]; then
            echo "[RTK fallback] Executing native: $COMMAND $*" >&2
            exec "$COMMAND" "$@"
        else
            exit $RTK_EXIT
        fi
    fi
else
    # RTK doesn't support this command - execute natively
    exec "$COMMAND" "$@"
fi
```

### Component 2: Dockerfile RTK Stage

**File:** `contextfs/Dockerfile` (modification)

**New Stage:** Add RTK installation between runtime-base and runtime-full

```dockerfile
# Stage 3: RTK Installation
FROM runtime-base AS runtime-rtk

ARG RTK_VERSION=0.22.2
ARG TARGETARCH

# Install RTK binary based on architecture
RUN case "${TARGETARCH}" in \
    "amd64") RTK_ARCH="x86_64-unknown-linux-musl" ;; \
    "arm64") RTK_ARCH="aarch64-unknown-linux-musl" ;; \
    *) RTK_ARCH="x86_64-unknown-linux-musl" ;; \
    esac && \
    curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-v${RTK_VERSION}-${RTK_ARCH}.tar.gz" | \
    tar -xz -C /usr/local/bin && \
    chmod +x /usr/local/bin/rtk

# Create RTK data directory
RUN mkdir -p /workspace/.rtk

# Stage 4: Full Runtime (with tools + RTK)
FROM runtime-rtk AS runtime-full

# Install common CLI tools
RUN apk add --no-cache \
    git \
    ripgrep \
    tree \
    curl \
    bash

# Configure RTK environment
ENV RTK_ENABLED=1
ENV RTK_DB_PATH=/workspace/.rtk/history.db
ENV PATH="/usr/local/bin:${PATH}"

# Copy shell wrapper for transparent interception
COPY docker/rtk-shell-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/rtk-shell-wrapper.sh

# Create bash profile with RTK aliases
RUN echo 'source /usr/local/bin/rtk-shell-wrapper.sh' > /etc/profile.d/rtk.sh
```

### Component 3: RTK Configuration File

**File:** `contextfs/docker/rtk-config.toml`

**Purpose:** RTK behavior configuration for containerized environments

```toml
[general]
default_filter_level = "minimal"
enable_tracking = true
retention_days = 30  # Shorter retention for containers

[tracking]
database_path = "/workspace/.rtk/history.db"

[tee]
enabled = true
directory = "/workspace/.rtk/tee"
max_files = 10
max_size_kb = 512
```

### Component 4: Health Check Script

**File:** `contextfs/docker/rtk-health-check.sh`

**Purpose:** Verify RTK is functioning correctly in container

```bash
#!/bin/bash
# RTK Health Check for ContextFS containers

set -e

RTK_BINARY="/usr/local/bin/rtk"
RTK_DB="${RTK_DB_PATH:-/workspace/.rtk/history.db}"

echo "=== RTK Health Check ==="

# Check binary exists and is executable
if [[ ! -x "$RTK_BINARY" ]]; then
    echo "FAIL: RTK binary not found or not executable"
    exit 1
fi
echo "✓ RTK binary found"

# Check version
RTK_VERSION=$("$RTK_BINARY" --version 2>/dev/null || echo "unknown")
echo "✓ RTK version: $RTK_VERSION"

# Test basic functionality
TEST_OUTPUT=$(echo -e "line1\nline2\nline3" | "$RTK_BINARY" proxy cat 2>/dev/null || true)
if [[ -n "$TEST_OUTPUT" ]]; then
    echo "✓ RTK proxy mode functional"
else
    echo "WARN: RTK proxy test inconclusive"
fi

# Check database directory
DB_DIR=$(dirname "$RTK_DB")
if [[ -d "$DB_DIR" ]] || mkdir -p "$DB_DIR" 2>/dev/null; then
    echo "✓ RTK database directory accessible"
else
    echo "WARN: RTK database directory not writable"
fi

echo "=== Health Check Complete ==="
exit 0
```

---

## Data Flow Changes

### Flow 1: Direct Execution (No RTK)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Direct Execution Path                               │
└─────────────────────────────────────────────────────────────────────────────┘

[LLM Request]
      ↓
[MCP Tool Call]  "bash: git status"
      ↓
[message-handler.js]  runFsTool(TOOLS.BASH_SCRIPT_ONCE, params)
      ↓
[command-runner.js]  runBashScriptOnce(params)
      ↓
[spawn.js]  spawn('bash', ['-c', 'git status'])
      ↓
[Native git]  Executes git status
      ↓
[Raw Output]  "On branch main\nYour branch is up to date...\n\nmodified: file1.js\nmodified: file2.js\n..."
      ↓
[LLM Response]  ~150-500 tokens
```

### Flow 2: RTK-Proxied Execution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        RTK-Proxied Execution Path                           │
└─────────────────────────────────────────────────────────────────────────────┘

[LLM Request]
      ↓
[MCP Tool Call]  "bash: git status"
      ↓
[message-handler.js]  runFsTool(TOOLS.BASH_SCRIPT_ONCE, params)
      ↓
[command-runner.js]  runBashScriptOnce(params)
      ↓
[spawn.js]  spawn('bash', ['-c', 'git status'])
      ↓
[Shell Alias Intercept]  git → rtk_wrap git
      ↓
[RTK Proxy]  rtk git status
      ├─ [Module Router] → git::run(["status"], verbose)
      ├─ [Execute Native] → git status (capture output)
      ├─ [Filter] → "2 modified" (stats extraction strategy)
      ├─ [Track] → SQLite INSERT token savings
      ↓
[Filtered Output]  "2 modified ✓"
      ↓
[LLM Response]  ~5-10 tokens (96% reduction)
```

### Flow 3: Unsupported Command (Transparent Pass-Through)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Unsupported Command Pass-Through                        │
└─────────────────────────────────────────────────────────────────────────────┘

[LLM Request]
      ↓
[MCP Tool Call]  "bash: custom-tool --arg"
      ↓
[spawn.js]  spawn('bash', ['-c', 'custom-tool --arg'])
      ↓
[Shell Wrapper Check]  Is 'custom-tool' in RTK supported list?
      ↓
      NO ──────────────────────────────────────────────────────────┐
                                                                   ↓
[Native Execution]  custom-tool --arg (unchanged)
                                                                   ↓
[Raw Output]  Returns directly to LLM
```

### Flow 4: RTK Failure with Fallback

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        RTK Failure + Fallback                               │
└─────────────────────────────────────────────────────────────────────────────┘

[spawn.js]  spawn('bash', ['-c', 'git log --exotic-flag'])
      ↓
[RTK Proxy]  rtk git log --exotic-flag
      ↓
[RTK Error]  Unknown flag or filter failure
      ↓
[Fallback Decision]  RTK_FALLBACK=1?
      ↓
      YES ─────────────────────────────────────────────────────────┐
                                                                   ↓
[Native Execution]  git log --exotic-flag (raw output)
                                                                   ↓
[LLM Response]  Unoptimized but functional
```

---

## Component Interactions

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ContextFS with RTK Integration                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              Host System                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Docker Engine                                 │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    ContextFS Container                          │  │  │
│  │  │                                                                 │  │  │
│  │  │  ┌─────────────────┐      ┌───────────────────────────────┐    │  │  │
│  │  │  │  ContextFS      │      │         RTK Layer             │    │  │  │
│  │  │  │  Client         │      │                               │    │  │  │
│  │  │  │                 │      │  ┌─────────────────────────┐  │    │  │  │
│  │  │  │  ┌───────────┐  │      │  │  RTK Binary (~4MB)      │  │    │  │  │
│  │  │  │  │ message-  │  │──────┼─→│  • git module           │  │    │  │  │
│  │  │  │  │ handler   │  │      │  │  • grep module          │  │    │  │  │
│  │  │  │  └───────────┘  │      │  │  • ls module            │  │    │  │  │
│  │  │  │       ↓         │      │  │  • npm/docker modules   │  │    │  │  │
│  │  │  │  ┌───────────┐  │      │  │  • 30+ command modules  │  │    │  │  │
│  │  │  │  │ command-  │  │──────┼─→│  • filter.rs            │  │    │  │  │
│  │  │  │  │ runner    │  │      │  │  • tracking.rs          │  │    │  │  │
│  │  │  │  └───────────┘  │      │  └─────────────────────────┘  │    │  │  │
│  │  │  │       ↓         │      │              ↓                │    │  │  │
│  │  │  │  ┌───────────┐  │      │  ┌─────────────────────────┐  │    │  │  │
│  │  │  │  │   spawn   │  │←─────┼──│  Shell Wrapper Scripts  │  │    │  │  │
│  │  │  │  │   .js     │  │      │  │  • /etc/profile.d/rtk.sh│  │    │  │  │
│  │  │  │  └───────────┘  │      │  │  • rtk-shell-wrapper.sh │  │    │  │  │
│  │  │  │       ↓         │      │  └─────────────────────────┘  │    │  │  │
│  │  │  │  ┌───────────┐  │      └───────────────────────────────┘    │  │  │
│  │  │  │  │  Native   │  │                                             │  │  │
│  │  │  │  │  Tools    │  │      ┌─────────────────────────┐            │  │  │
│  │  │  │  │  (git,    │  │      │  RTK Data Volume        │            │  │  │
│  │  │  │  │   npm,    │  │──────┼─→ /workspace/.rtk/       │            │  │  │
│  │  │  │  │   docker) │  │      │  • history.db            │            │  │  │
│  │  │  │  └───────────┘  │      │  • config.toml           │            │  │  │
│  │  │  │                 │      │  • tee/ (raw outputs)    │            │  │  │
│  │  │  └─────────────────┘      └─────────────────────────┘            │  │  │
│  │  │                                                                    │  │  │
│  │  └────────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                           │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Data Stores

| Store | Location | Purpose | Persistence |
|-------|----------|---------|-------------|
| **RTK History DB** | `/workspace/.rtk/history.db` | Token savings metrics | Workspace-scoped (survives container restarts) |
| **RTK Config** | `/workspace/.rtk/config.toml` | Filter levels, retention | Workspace-scoped |
| **RTK Tee** | `/workspace/.rtk/tee/` | Raw output recovery | Ephemeral (configurable rotation) |
| **ContextFS Memory** | `/workspace/memory/` | Agent memory | Workspace-scoped |

---

## Suggested Build Order

### Phase 1: Infrastructure (Week 1)

**Priority:** Foundation  
**Dependencies:** None

1. **Update Dockerfile** with RTK installation stage
   - Add `runtime-rtk` stage between runtime-base and runtime-full
   - Multi-arch support (amd64, arm64)
   - Verify binary installation

2. **Create shell wrapper scripts**
   - `docker/rtk-shell-wrapper.sh` - Transparent command interception
   - `docker/rtk-health-check.sh` - Container health verification
   - Test fallback behavior

3. **Build and verify Docker images**
   - Build new runtime-full image
   - Run health checks
   - Verify RTK binary accessible

### Phase 2: Configuration (Week 1-2)

**Priority:** Core functionality  
**Dependencies:** Phase 1

4. **Create RTK configuration templates**
   - `docker/rtk-config.toml` - Container-optimized defaults
   - 30-day retention (vs 90-day default)
   - Workspace-scoped database paths

5. **Add environment variable support**
   - `RTK_ENABLED` - Global enable/disable
   - `RTK_FALLBACK` - Control fallback behavior
   - `RTK_DB_PATH` - Database location override

6. **Test basic RTK commands in container**
   - `rtk git status`
   - `rtk ls`
   - `rtk grep`
   - Verify token reduction

### Phase 3: Integration (Week 2)

**Priority:** End-to-end functionality  
**Dependencies:** Phase 2

7. **Enable shell-level interception**
   - Configure bash profile in container
   - Set up command aliases
   - Test transparent proxy behavior

8. **Test with ContextFS tool calls**
   - BASH_SCRIPT_ONCE tool with git commands
   - LIST tool (uses native ls - needs verification)
   - Complex npm/docker commands

9. **Verify fallback behavior**
   - Simulate RTK failure
   - Confirm native execution fallback
   - Test unsupported commands pass-through

### Phase 4: Validation (Week 3)

**Priority:** Production readiness  
**Dependencies:** Phase 3

10. **Token savings validation**
    - Run test suite with/without RTK
    - Measure token reduction percentages
    - Validate 60-90% savings target

11. **Performance benchmarking**
    - Measure command latency overhead
    - Verify <15ms per-command overhead
    - Load testing with concurrent tool calls

12. **Documentation and rollout**
    - Update deployment docs
    - Add RTK monitoring to dashboard
    - Document configuration options

### Build Order Rationale

**Why this order:**
1. **Infrastructure first:** RTK must be available in the container before any configuration or testing
2. **Configuration before integration:** Shell wrappers need RTK binary present to test
3. **Integration before validation:** Can't validate what isn't integrated
4. **Parallelizable work:** Phases 1-2 can overlap with ContextFS code changes if needed

**Critical path:** Dockerfile → Shell Wrappers → Configuration → Tool Testing → Validation

---

## Architecture Decisions

### Decision 1: Docker-Layer Integration vs Code-Level Integration

**Chosen:** Docker-layer (install RTK binary, shell-level interception)

**Alternative considered:** Modify `command-runner.js` to detect and invoke RTK

**Why Docker-layer wins:**
- Zero changes to ContextFS Node.js codebase
- Works for all command types (FS tools, bash scripts, raw commands)
- RTK can be updated independently of ContextFS releases
- Easier rollback (revert to previous Docker image)
- Consistent with RTK's design as a CLI proxy

**Trade-off:** Less granular control over when RTK is applied

### Decision 2: Shell Aliases vs PATH Interception

**Chosen:** Shell aliases with wrapper functions

**Alternative considered:** Rename RTK binary to match command names and use PATH ordering

**Why aliases win:**
- Preserves ability to call native commands when needed
- Easier to enable/disable per-session
- Fallback logic is explicit in shell code
- No filesystem manipulation required

### Decision 3: Workspace-Scoped vs Global RTK Database

**Chosen:** Workspace-scoped (`/workspace/.rtk/history.db`)

**Alternative considered:** Global database in container (`~/.local/share/rtk/`)

**Why workspace-scoped wins:**
- Container ephemeral - database must survive restarts
- Workspace volume is persisted across container lifecycles
- Enables per-workspace analytics
- Easier cleanup (delete workspace → delete analytics)

---

## Scalability Considerations

| Scale | RTK Consideration |
|-------|-------------------|
| **Single container** | RTK SQLite database on workspace volume, no contention |
| **Multiple containers** | Each container has isolated RTK database (no shared state issues) |
| **High-frequency commands** | RTK ~5-15ms overhead is negligible compared to command execution time |
| **Large output streams** | RTK filters output in memory; very large outputs (>10MB) may need streaming consideration |
| **Concurrent commands** | RTK is single-threaded but command-parallelism happens at ContextFS spawn level |

### Performance Budget

| Component | Target | Worst Case |
|-----------|--------|------------|
| RTK overhead | <15ms per command | <50ms for complex filters |
| Token reduction | 60-90% | 40% (edge cases) |
| Database writes | ~1-3ms | ~5ms under load |
| Memory footprint | <5MB | <10MB with large outputs |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Modifying ContextFS Tool Dispatch

**What:** Adding RTK detection logic to `message-handler.js` or `command-runner.js`

**Why avoid:** Tight coupling between ContextFS and RTK; harder to maintain; doesn't catch all command invocations

**Instead:** Keep interception at shell/Docker layer

### Anti-Pattern 2: Global RTK Database in Container

**What:** Storing RTK analytics in container filesystem (`~/.local/share/rtk/`)

**Why avoid:** Container is ephemeral; database lost on restart

**Instead:** Mount database to workspace volume (`/workspace/.rtk/`)

### Anti-Pattern 3: Disabling Fallback

**What:** Setting `RTK_FALLBACK=0` in production

**Why avoid:** RTK bugs or unsupported edge cases break tool execution

**Instead:** Always enable fallback; RTK failure should never block agent workflow

### Anti-Pattern 4: Blind RTK Adoption

**What:** Proxying all commands through RTK without validation

**Why avoid:** Some commands may have edge cases RTK doesn't handle

**Instead:** Whitelist approach - only enable RTK for tested command types

---

## Sources

- RTK Architecture: `ref-rtk/ARCHITECTURE.md` - Proxy pattern, module design, filtering strategies
- RTK CLAUDE.md: `ref-rtk/CLAUDE.md` - Command routing, performance constraints, testing patterns
- ContextFS message-handler.js: Tool routing and dispatch logic
- ContextFS command-runner.js: FS tool and command execution
- ContextFS Dockerfile: Multi-stage container build structure

---

*Architecture research for: ContextFS v1.1 RTK Integration*  
*Researched: 2026-03-01*
