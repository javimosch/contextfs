# Technology Stack: RTK Integration for ContextFS Docker

**Project:** ContextFS v1.1 RTK Integration  
**Researched:** 2026-03-01  
**Confidence:** HIGH

---

## Executive Summary

RTK (Rust Token Killer) integration into ContextFS Docker containers requires adding a single ~4MB static binary to the `runtime-full` image, a configuration flag in the ContextFS client, and minimal wrapper logic to proxy MCP tool executions. The integration achieves 60-90% token reduction on supported commands (git, grep, ls, npm test, cargo test, docker ps) while maintaining graceful fallback to native execution.

**Current RTK Version:** v0.23.0 (2026-02-28)  
**Installation Size Impact:** +4.1 MB (negligible in container context)  
**Performance Overhead:** +5-15ms per command (acceptable for 60-90% token savings)

---

## Recommended Stack

### Core RTK Installation

| Component | Version | Purpose | Installation Method |
|-----------|---------|---------|---------------------|
| **RTK Binary** | v0.23.0+ | Token optimization proxy | Pre-built binary from GitHub releases |

**Why Pre-Built Binary:**
- No build dependencies needed in production images
- Fast, deterministic installation (single `curl` + `tar`)
- Binary is statically compiled, works on Alpine without glibc
- No Rust toolchain required in Docker image

**Docker Installation Pattern:**

```dockerfile
# In runtime-full stage
ARG RTK_VERSION=0.23.0
RUN apk add --no-cache curl tar && \
    curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-x86_64-unknown-linux-musl.tar.gz" | \
    tar -xz -C /usr/local/bin && \
    chmod +x /usr/local/bin/rtk && \
    rtk --version
```

> **Note:** Use `x86_64-unknown-linux-musl` target for Alpine Linux compatibility (musl libc).

---

### Configuration System

| Component | Location | Purpose |
|-----------|----------|---------|
| **Environment Variable** | `CONTEXTFS_RTK_ENABLED` | Global enable/disable flag |
| **Client Config** | `client.config.json` | Per-workspace RTK settings |
| **Command Allowlist** | Hardcoded in client | Supported RTK commands |

**Configuration Hierarchy:**

```javascript
// Priority order (highest to lowest):
1. Environment variable: CONTEXTFS_RTK_ENABLED=false
2. Workspace config: workspace.settings.rtk.enabled = false
3. Global default: rtk.enabled = true (for runtime-full only)
```

**Why Environment Variable First:**
- Allows emergency disable without code changes
- Fits container orchestration patterns (docker-compose, k8s)
- Zero-config for users who want it always on

---

### Integration Points

| Integration Point | Implementation | Rationale |
|-------------------|----------------|-----------|
| **MCP Tool Wrapper** | Intercept tool calls in client | Centralized control over RTK usage |
| **Command Detection** | Regex/command matching in client | Only use RTK for supported commands |
| **Error Handling** | Try/catch with fallback | Never break execution on RTK failure |
| **Exit Code Passthrough** | Proxy exit codes to caller | CI/CD compatibility |

**Supported Commands (High-Value Targets):**

| Command | RTK Subcommand | Token Savings | Priority |
|---------|---------------|---------------|----------|
| `ls` / `tree` | `rtk ls` | 70-80% | P0 |
| `grep` / `rg` | `rtk grep` | 60-80% | P0 |
| `git status` | `rtk git status` | 80-90% | P0 |
| `git log` | `rtk git log` | 80-90% | P0 |
| `git diff` | `rtk git diff` | 75-80% | P0 |
| `npm test` | `rtk test npm test` | 85-90% | P0 |
| `cargo test` | `rtk test cargo test` | 85-90% | P0 |
| `docker ps` | `rtk docker ps` | 60-80% | P1 |
| `cat <file>` | `rtk read <file>` | 40-90% | P1 |
| `bash <script>` | `rtk summary` | 50-70% | P2 |

---

## Docker Build Modifications

### Stage: runtime-full (Additions)

```dockerfile
# Stage 3: Full Runtime
FROM runtime-base AS runtime-full

# Install common CLI tools (existing)
RUN apk add --no-cache \
    git \
    ripgrep \
    tree \
    curl \
    bash

# --- RTK Integration Start ---
ARG RTK_VERSION=0.23.0
ARG RTK_ARCH=x86_64

# Install RTK binary
RUN curl -fsSL \
    "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-${RTK_ARCH}-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin \
    && chmod +x /usr/local/bin/rtk \
    && rtk --version

# Optional: Pre-configure RTK for container environment
# (no init needed since ContextFS handles proxying)
# --- RTK Integration End ---

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/bin/contextfs.js", "client"]
```

### Multi-Architecture Support

```dockerfile
# BuildKit ARG for automatic arch detection
ARG TARGETARCH
ARG RTK_VERSION=0.23.0

# Map Docker arch to RTK release arch
RUN case ${TARGETARCH} in \
    amd64) RTK_ARCH=x86_64 ;; \
    arm64) RTK_ARCH=aarch64 ;; \
    *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
esac && \
curl -fsSL \
    "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-${RTK_ARCH}-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin
```

**Why Multi-Arch:**
- Apple Silicon (M1/M2) developers use `linux/arm64`
- CI/CD typically uses `linux/amd64`
- BuildKit automatically selects correct architecture

---

## Integration Architecture

### Option A: ContextFS Client Proxy (Recommended)

```
┌────────────────────────────────────────────────────────────────┐
│                    ContextFS Client Proxy                       │
└────────────────────────────────────────────────────────────────┘

MCP Tool Call
      │
      ▼
┌─────────────────────────────────────┐
│ 1. Check: RTK enabled?              │
│    - Config flag                    │
│    - Image has rtk binary?          │
└─────────────┬───────────────────────┘
              │
      ┌───────┴────────┐
      ▼                ▼
   Yes/OK            No/Fail
      │                │
      ▼                ▼
┌────────────────┐  ┌────────────────┐
│ 2. Check:      │  │ Fallback to    │
│    Command in  │  │ native command │
│    allowlist?  │  │ (no RTK)       │
└────────┬───────┘  └────────────────┘
         │
┌────────┴────────────────┐
│ 3. Rewrite command      │
│    "git status" →       │
│    "rtk git status"     │
└────────┬────────────────┘
         │
┌────────▼────────────────┐
│ 4. Execute in container │
│    (with error handling)│
└────────┬────────────────┘
         │
┌────────▼────────────────┐
│ 5. On RTK failure:      │
│    Retry with native    │
│    (graceful fallback)  │
└─────────────────────────┘
```

**Why This Approach:**
- Single point of control for RTK integration
- Easy to toggle on/off per workspace
- Can track RTK usage metrics in ContextFS
- Graceful degradation on any failure

### Option B: Hook-Based Rewriting (Alternative)

Install RTK hook in container's `~/.claude/settings.json`:

```bash
# In Dockerfile
RUN mkdir -p /root/.claude/hooks && \
    rtk init --global --hook-only && \
    # Copy hook to expected location
    cp ~/.local/share/rtk/hooks/rtk-rewrite.sh /root/.claude/hooks/
```

**Why NOT Recommended:**
- Hook requires `~/.claude/settings.json` manipulation
- More complex to manage across container lifecycle
- Harder to disable per-workspace
- No visibility into RTK usage from ContextFS

---

## Anti-Patterns to Avoid

| Anti-Pattern | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Install RTK in runtime-base** | Adds 4MB to minimal image; not all users want RTK | Only install in `runtime-full` stage |
| **Compile RTK from source in Docker** | Adds ~500MB Rust toolchain to image | Download pre-built binary |
| **Use glibc binary on Alpine** | Alpine uses musl; glibc binary won't work | Use `*-musl.tar.gz` release |
| **Wrap EVERY command through RTK** | RTK doesn't support all commands; wastes cycles | Use allowlist of supported commands |
| **Fail hard on RTK errors** | RTK is optimization, not requirement | Always fallback to native execution |
| **Track RTK metrics in container** | SQLite writes to container filesystem (ephemeral) | Track in ContextFS registry instead |
| **Install via `cargo install`** | Requires Rust toolchain, slower builds | Use pre-built binary |
| **Bundle RTK binary in repo** | Increases repo size, stale binaries | Download at build time from GitHub |

---

## Security Considerations

| Concern | Mitigation | Confidence |
|---------|------------|------------|
| **Binary authenticity** | Verify checksums from GitHub releases | HIGH |
| **Supply chain** | Pin to specific RTK version (not `latest`) | HIGH |
| **Container escape** | RTK runs as same user as other tools (no privilege) | HIGH |
| **Network access** | RTK is offline tool (no network calls) | HIGH |
| **Shell injection** | RTK validates arguments before passing to underlying tools | MEDIUM |

**Checksum Verification (Optional but Recommended):**

```dockerfile
ARG RTK_VERSION=0.23.0
ARG RTK_CHECKSUM=abc123...  # SHA256 from GitHub release

RUN curl -fsSL -o /tmp/rtk.tar.gz \
    "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-x86_64-unknown-linux-musl.tar.gz" && \
    echo "${RTK_CHECKSUM}  /tmp/rtk.tar.gz" | sha256sum -c - && \
    tar -xz -C /usr/local/bin -f /tmp/rtk.tar.gz && \
    rm /tmp/rtk.tar.gz
```

---

## Migration Path

### Phase 1: RTK Available (v1.1.0)
- Add RTK to `runtime-full` Docker image
- Add `CONTEXTFS_RTK_ENABLED` env var support
- Enable for test workspaces only

### Phase 2: RTK Default On (v1.2.0)
- Enable by default for new workspaces
- Add telemetry to track token savings
- Document troubleshooting guide

### Phase 3: RTK Required (v2.0.0)
- Remove opt-out option
- Optimize all MCP tools for RTK
- Deprecate non-RTK paths

---

## Version Strategy

| RTK Version | ContextFS Support | Notes |
|-------------|-------------------|-------|
| **0.23.0+** | Recommended | Latest stable, mypy support, docker compose |
| **0.22.x** | Supported | Stable, git improvements |
| **0.21.x** | Minimum | Docker compose support added |
| **<0.21.0** | Not supported | Missing critical docker features |

**Upgrade Policy:**
- Pin to specific minor version in Dockerfile (e.g., `0.23.0`)
- Update quarterly after testing
- Monitor RTK changelog for breaking changes

---

## Sources

| Source | URL | Confidence |
|--------|-----|------------|
| RTK GitHub Releases | https://github.com/rtk-ai/rtk/releases | HIGH |
| RTK README | ref-rtk/README.md (local) | HIGH |
| RTK Architecture | ref-rtk/ARCHITECTURE.md (local) | HIGH |
| ContextFS Dockerfile | contextfs/Dockerfile (local) | HIGH |
| ContextFS Project Spec | .planning/PROJECT.md (local) | HIGH |

---

## Open Questions

1. **Should we track RTK savings in ContextFS registry?** Currently RTK stores to SQLite locally; could aggregate to registry for workspace-level analytics.

2. **How to handle RTK command not found?** If user overrides to `runtime-base` but config enables RTK, should we silently disable or warn?

3. **Should we cache RTK configuration?** Loading command allowlist from disk on each tool call adds ~1ms; acceptable or should cache in memory?

4. **Multi-arch testing:** Need to verify `aarch64` binary works on Apple Silicon Docker before production deployment.
