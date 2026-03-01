# Phase 8: Infrastructure & Docker Setup - Research

**Researched:** 2026-03-01
**Domain:** Docker containerization, multi-architecture builds, GitHub releases binary distribution
**Confidence:** HIGH

## Summary

This phase focuses on installing the RTK (Rust Token Killer) binary into ContextFS Docker containers with multi-architecture support (x86_64 and aarch64). The implementation requires modifications to the existing multi-stage Dockerfile to download and install pre-built RTK binaries from GitHub releases.

**Primary recommendation:** Install RTK v0.23.0 in the `runtime-full` stage using curl to download from GitHub releases, with architecture detection via Docker build arguments. Use a shell wrapper script for fallback logic and a simple health check that verifies `rtk --version` returns the expected version.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **RTK Installation Method:** Download pre-built binary from GitHub releases (rtk-ai/rtk)
- **Download Tool:** Use curl to fetch binary directly from GitHub releases page
- **Verification Method:** Basic verification via executable test only (run `rtk --version` after install)
- **Install Path:** Install to `/usr/local/bin/rtk` (standard location, already in PATH)
- **Multi-Architecture Support:** Support both x86_64 (Intel/AMD) and aarch64 (ARM64/Apple Silicon)

### Claude's Discretion
- Exact curl flags and error handling during download
- Dockerfile stage placement (runtime-full recommended)
- Specific RTK version to pin (suggest v0.23.0+)
- Shell wrapper implementation details
- Health check script complexity

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | RTK binary v0.23.0+ installed in runtime-full Docker stage | Use curl to download from GitHub releases in runtime-full stage; RTK v0.23.0 is latest stable release (Feb 28, 2026) |
| INFRA-02 | Multi-arch support (x86_64, aarch64) for RTK binary | Use Docker TARGETARCH build argument; RTK provides binaries for both architectures |
| INFRA-03 | Shell wrapper script (`rtk-shell-wrapper.sh`) with fallback logic | Create bash wrapper that checks RTK availability, falls back to native commands on failure |
| INFRA-04 | Health check script verifying RTK installation and functionality | Simple script running `rtk --version` and checking exit code; integrate with Docker HEALTHCHECK or compose healthcheck |
| INFRA-05 | Workspace-scoped RTK database configuration | RTK uses per-project database; configure via environment or bind mount to workspace |
</phase_requirements>

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|--------------|---------|---------|--------------|
| RTK (Rust Token Killer) | v0.23.0+ | Token reduction proxy | Required for 60-90% token reduction on common operations; latest stable as of Feb 2026 |
| curl | latest (Alpine) | Download RTK binary from GitHub | Already installed in runtime-full stage; standard HTTP client |
| tar | latest (Alpine) | Extract RTK archive | Standard tool for archive extraction |
| Docker BuildKit | latest | Multi-architecture builds | Native support for TARGETARCH and TARGETPLATFORM arguments |

### Installation Details
**RTK Binary URL Pattern:**
```
https://github.com/rtk-ai/rtk/releases/download/v${VERSION}/rtk-${ARCH}-unknown-linux-musl.tar.gz
```

**Architecture Mapping:**
| Docker TARGETARCH | RTK Archive Arch | Binary Arch |
|-------------------|------------------|-------------|
| amd64 | x86_64 | x86_64 |
| arm64 | aarch64 | aarch64 |

**Installation Steps:**
```bash
# 1. Download archive
curl -fsSL -o rtk.tar.gz "${RTK_URL}"

# 2. Extract
tar -xzf rtk.tar.gz

# 3. Install binary
mv rtk /usr/local/bin/rtk
chmod +x /usr/local/bin/rtk

# 4. Verify
rtk --version
```

## Architecture Patterns

### Recommended Project Structure
```
contextfs/
├── Dockerfile                    # Multi-stage Docker build (modified)
├── compose.yml                   # Docker Compose config (add health checks)
├── scripts/
│   ├── install-rtk.sh           # RTK installation script
│   ├── rtk-shell-wrapper.sh     # Shell wrapper with fallback
│   └── healthcheck-rtk.sh       # Health check script
└── ...
```

### Pattern 1: Multi-Architecture Docker Build
**What:** Use Docker build arguments to conditionally download correct architecture binary
**When to use:** When building for multiple architectures (x86_64, aarch64)
**Example:**
```dockerfile
# Source: Docker multi-platform builds documentation
ARG TARGETARCH
ARG RTK_VERSION=0.23.0

RUN case "${TARGETARCH}" in \
    amd64) RTK_ARCH=x86_64 ;; \
    arm64) RTK_ARCH=aarch64 ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL -o /tmp/rtk.tar.gz \
    "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-${RTK_ARCH}-unknown-linux-musl.tar.gz" && \
    tar -xzf /tmp/rtk.tar.gz -C /usr/local/bin rtk && \
    chmod +x /usr/local/bin/rtk && \
    rm /tmp/rtk.tar.gz && \
    rtk --version
```

### Pattern 2: Shell Wrapper with Fallback
**What:** A shell script that wraps RTK commands with fallback to native execution
**When to use:** When RTK might be unavailable or fail
**Example:**
```bash
#!/bin/bash
# rtk-shell-wrapper.sh
# Wrapper script that falls back to native commands if RTK fails

set -euo pipefail

# Check if RTK is available and enabled
if [ -z "${CONTEXTFS_RTK_ENABLED:-}" ] || [ "${CONTEXTFS_RTK_ENABLED}" != "true" ]; then
    # RTK disabled, run native command directly
    exec "$@"
fi

if ! command -v rtk &> /dev/null; then
    echo "Warning: RTK not found, falling back to native execution" >&2
    exec "$@"
fi

# Attempt RTK execution, fall back on failure
if rtk "$@"; then
    exit 0
else
    RTK_EXIT=$?
    echo "Warning: RTK failed (exit ${RTK_EXIT}), falling back to native execution" >&2
    exec "$@"
fi
```

### Pattern 3: Docker Health Check
**What:** Verify RTK installation is functional
**When to use:** Container startup verification
**Example:**
```dockerfile
# Dockerfile healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD rtk --version || exit 1
```

Or in compose.yml:
```yaml
healthcheck:
  test: ["CMD", "rtk", "--version"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 5s
```

### Anti-Patterns to Avoid
- **Installing RTK in runtime-base:** Keep runtime-base minimal; install RTK only in runtime-full
- **Using ADD instead of curl:** ADD doesn't handle redirects well for GitHub releases; use curl with -fsSL
- **Hardcoding architecture:** Always use TARGETARCH for multi-arch support
- **No version pinning:** Always pin RTK version for reproducible builds

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-arch binary downloads | Custom script with uname -m | Docker TARGETARCH argument | Docker provides consistent arch mapping; handles emulation cases |
| Archive extraction | Custom unpack code | tar command | tar is standard, handles edge cases, already available |
| HTTP download with redirects | wget with manual redirect handling | curl -fsSL | curl handles redirects, SSL, errors natively |
| Health check logic | Complex custom checker | rtk --version | Simple, fast, validates binary works |
| Architecture detection | Manual /proc/cpuinfo parsing | TARGETARCH build arg | Docker handles emulation, cross-compilation scenarios |

**Key insight:** Docker build arguments (TARGETARCH, TARGETPLATFORM) are the standard way to handle multi-architecture builds. Don't parse `uname -m` or `/proc/cpuinfo` — the build argument abstracts away host/target architecture differences during cross-compilation.

## Common Pitfalls

### Pitfall 1: GitHub Release Asset Names
**What goes wrong:** Architecture naming mismatch between Docker (amd64/arm64) and RTK (x86_64/aarch64)
**Why it happens:** Different naming conventions — Docker uses Linux kernel arch names, RTK uses Rust target arch names
**How to avoid:** Map TARGETARCH explicitly:
```dockerfile
RUN case "${TARGETARCH}" in \
    amd64) RTK_ARCH=x86_64 ;; \
    arm64) RTK_ARCH=aarch64 ;; \
    *) exit 1 ;; \
    esac
```
**Warning signs:** Build succeeds on one arch but fails on other; "file not found" errors when binary exists

### Pitfall 2: musl vs glibc Binary Compatibility
**What goes wrong:** Downloading glibc-linked binary that won't run on Alpine (musl libc)
**Why it happens:** Alpine uses musl libc by default, not glibc
**How to avoid:** RTK provides `*-unknown-linux-musl.tar.gz` archives specifically for Alpine — use these, not `*-unknown-linux-gnu.tar.gz`
**Warning signs:** "No such file or directory" errors for dynamically linked binaries

### Pitfall 3: curl Redirect Handling
**What goes wrong:** curl doesn't follow redirects, downloads HTML error page instead of binary
**Why it happens:** GitHub releases use redirects to S3/CDN for actual asset downloads
**How to avoid:** Always use `-L` flag with curl to follow redirects:
```bash
curl -fsSL -o rtk.tar.gz "${URL}"
```
**Warning signs:** tar extraction fails with "not in gzip format"; downloaded file is small (< 1KB)

### Pitfall 4: Binary Permissions
**What goes wrong:** Binary installed without execute permission
**Why it happens:** Archives might not preserve permissions; extraction might create non-executable file
**How to avoid:** Always chmod after extraction:
```bash
chmod +x /usr/local/bin/rtk
```
**Warning signs:** "Permission denied" when trying to run rtk

### Pitfall 5: Layer Caching Issues
**What goes wrong:** Dockerfile always downloads RTK even when version hasn't changed
**Why it happens:** RUN commands with curl aren't cached if any part of command changes
**How to avoid:** Use ARG for version, put download in separate layer:
```dockerfile
ARG RTK_VERSION=0.23.0
RUN curl ... # This layer is cached as long as VERSION doesn't change
```
**Warning signs:** Slow rebuilds; unnecessary network traffic during builds

## Code Examples

### Dockerfile: RTK Installation in runtime-full
```dockerfile
# Stage 3: Full Runtime
# Purpose: Extended image with common development tools + RTK
FROM runtime-base AS runtime-full

# Install common CLI tools used in ContextFS workflows
RUN apk add --no-cache \
    git \
    ripgrep \
    tree \
    curl \
    bash \
    tar

# Install RTK binary with multi-architecture support
ARG RTK_VERSION=0.23.0
ARG TARGETARCH

RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) RTK_ARCH='x86_64' ;; \
        arm64) RTK_ARCH='aarch64' ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; \
    esac; \
    RTK_URL="https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-${RTK_ARCH}-unknown-linux-musl.tar.gz"; \
    echo "Downloading RTK ${RTK_VERSION} for ${RTK_ARCH}..."; \
    curl -fsSL -o /tmp/rtk.tar.gz "${RTK_URL}"; \
    tar -xzf /tmp/rtk.tar.gz -C /usr/local/bin rtk; \
    chmod +x /usr/local/bin/rtk; \
    rm /tmp/rtk.tar.gz; \
    # Verify installation
    rtk --version

# Copy wrapper scripts
COPY scripts/rtk-shell-wrapper.sh /usr/local/bin/
COPY scripts/healthcheck-rtk.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/rtk-shell-wrapper.sh /usr/local/bin/healthcheck-rtk.sh

# Set up health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /usr/local/bin/healthcheck-rtk.sh

# Inherit entrypoint and cmd from runtime-base
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/bin/contextfs.js", "client"]
```

### Shell Wrapper: rtk-shell-wrapper.sh
```bash
#!/bin/bash
# rtk-shell-wrapper.sh - Wrap commands with RTK fallback logic
#
# Usage: rtk-shell-wrapper.sh <command> [args...]
# Example: rtk-shell-wrapper.sh ls -la

set -euo pipefail

# Configuration
RTK_ENABLED="${CONTEXTFS_RTK_ENABLED:-false}"
RTK_FALLBACK_ON_ERROR="${CONTEXTFS_RTK_FALLBACK:-true}"

# Extract the command (first argument)
COMMAND="${1:-}"
shift || true

# If RTK is disabled, run native command directly
if [ "${RTK_ENABLED}" != "true" ]; then
    exec "${COMMAND}" "$@"
fi

# Check if RTK binary exists
if ! command -v rtk &> /dev/null; then
    echo "Warning: RTK binary not found, using native ${COMMAND}" >&2
    exec "${COMMAND}" "$@"
fi

# Map common commands to RTK subcommands
case "${COMMAND}" in
    ls)
        RTK_CMD="rtk ls"
        ;;
    grep|rg)
        RTK_CMD="rtk grep"
        ;;
    git)
        # git has subcommands, pass through for now
        RTK_CMD=""
        ;;
    *)
        RTK_CMD=""
        ;;
esac

# If we have an RTK equivalent, try it first
if [ -n "${RTK_CMD}" ] && [ "${RTK_FALLBACK_ON_ERROR}" = "true" ]; then
    if ${RTK_CMD} "$@"; then
        exit 0
    else
        RTK_EXIT=$?
        echo "Warning: RTK failed (exit ${RTK_EXIT}), using native ${COMMAND}" >&2
        exec "${COMMAND}" "$@"
    fi
else
    # No RTK equivalent or fallback disabled
    exec "${COMMAND}" "$@"
fi
```

### Health Check: healthcheck-rtk.sh
```bash
#!/bin/bash
# healthcheck-rtk.sh - Verify RTK installation and basic functionality

set -euo pipefail

# Check if RTK binary exists and is executable
if ! command -v rtk &> /dev/null; then
    echo "Health check failed: RTK binary not found in PATH"
    exit 1
fi

# Check if RTK can execute and return version
if ! rtk --version &> /dev/null; then
    echo "Health check failed: RTK --version command failed"
    exit 1
fi

# Verify version matches expected (optional, can be disabled)
EXPECTED_VERSION="${RTK_EXPECTED_VERSION:-0.23.0}"
INSTALLED_VERSION=$(rtk --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

if [ "${INSTALLED_VERSION}" != "${EXPECTED_VERSION}" ]; then
    echo "Health check warning: Version mismatch (expected ${EXPECTED_VERSION}, got ${INSTALLED_VERSION})"
    # Don't fail health check on version mismatch, just warn
fi

echo "Health check passed: RTK ${INSTALLED_VERSION} is functional"
exit 0
```

### Docker Compose: Updated compose.yml
```yaml
name: contextfs

services:
  server:
    build:
      context: ..
      dockerfile: contextfs/Dockerfile
      target: runtime-base
    image: contextfs/client:base
    container_name: contextfs-server
    working_dir: /app
    volumes:
      - ..:/app
      - ./data:/root/.contextfs
    environment:
      - PORT=3010
      - VERBOSE=1
    ports:
      - "3015:3010"
    networks:
      - contextfs
    command: node bin/contextfs.js server --port 3010 --insecure --verbose
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3010/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 10s

  client:
    build:
      context: ..
      dockerfile: contextfs/Dockerfile
      target: runtime-full
    image: contextfs/client:full
    container_name: contextfs-client
    depends_on:
      server:
        condition: service_healthy
    volumes:
      - ./workspace:/workspace
      # RTK workspace-scoped database
      - ./workspace/.rtk:/workspace/.rtk
    environment:
      - CONTEXTFS_SERVER_URL=ws://server:3010
      - CONTEXTFS_API_KEY=local-dev-key
      - CONTEXTFS_WS_CLIENT_ID=compose-client-1
      - CONTEXTFS_RTK_ENABLED=true
      - VERBOSE=1
      # RTK workspace configuration
      - RTK_WORKSPACE=/workspace
    networks:
      - contextfs
    command: node /app/bin/contextfs.js client --url ws://server:3010 --ws-client-id compose-client-1 --api-key local-dev-key --verbose
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck-rtk.sh"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s

networks:
  contextfs:
    driver: bridge
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual binary copy into image | curl from GitHub releases | 2026-03 (this phase) | Automated, version-pinned, reproducible builds |
| Single architecture images | Multi-platform builds with TARGETARCH | 2020+ (Docker BuildKit) | Native performance on both Intel and Apple Silicon |
| Runtime version detection | Build-time architecture mapping | 2020+ (Docker BuildKit) | Cleaner, more deterministic builds |

**Deprecated/outdated:**
- Using `uname -m` in Dockerfile: Not reliable with QEMU emulation or cross-compilation
- ADD for GitHub releases: Doesn't handle redirects properly
- Runtime architecture detection: TARGETARCH is the modern standard

## Open Questions

1. **RTK Database Location**
   - What we know: RTK uses a SQLite database for caching and token tracking
   - What's unclear: Exact default location and configuration method for workspace scoping
   - Recommendation: Mount workspace directory and set `RTK_WORKSPACE` or bind mount `~/.rtk` to workspace-specific location

2. **Shell Wrapper Integration Point**
   - What we know: Wrapper needed for fallback logic (INFRA-03)
   - What's unclear: Whether wrapper replaces commands via alias, function, or PATH manipulation
   - Recommendation: Start with explicit wrapper calls, integrate deeper in Phase 9 (MCP Integration Layer)

3. **Health Check Frequency**
   - What we know: Docker HEALTHCHECK and compose healthcheck available
   - What's unclear: Optimal interval for RTK (fast enough to catch issues, not so frequent it impacts performance)
   - Recommendation: Start with 30s interval, 10s timeout, 3 retries

4. **RTK Configuration Persistence**
   - What we know: RTK needs workspace-scoped config (INFRA-05)
   - What's unclear: Whether RTK respects environment variables or requires config file
   - Recommendation: Research RTK CLI documentation; likely supports both `--workspace` flag and env var

## Validation Architecture

> nyquist_validation is enabled in `.planning/config.json`

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Docker container testing + shell scripts |
| Config file | `contextfs/compose.yml` |
| Quick run command | `docker compose -f contextfs/compose.yml ps` |
| Full suite command | `docker compose -f contextfs/compose.yml up --build --wait` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | RTK v0.23.0+ installed | integration | `docker run --rm contextfs/client:full rtk --version` | ❌ Wave 0 |
| INFRA-02 | Multi-arch support | manual | Build and test on both x86_64 and ARM64 hosts | ❌ Manual validation |
| INFRA-03 | Shell wrapper functional | integration | `docker run --rm contextfs/client:full rtk-shell-wrapper.sh echo test` | ❌ Wave 0 |
| INFRA-04 | Health check passes | integration | `docker inspect --format='{{.State.Health.Status}}' contextfs-client` | ❌ Wave 0 |
| INFRA-05 | Workspace DB scoped | integration | Verify `~/.rtk` is bind-mounted to workspace | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `docker compose -f contextfs/compose.yml up -d --build`
- **Per wave merge:** `docker compose -f contextfs/compose.yml up --build --wait && docker compose -f contextfs/compose.yml down`
- **Phase gate:** Full rebuild on clean environment, verify all requirements

### Wave 0 Gaps
- [ ] `contextfs/scripts/install-rtk.sh` — RTK installation script
- [ ] `contextfs/scripts/rtk-shell-wrapper.sh` — shell wrapper with fallback
- [ ] `contextfs/scripts/healthcheck-rtk.sh` — health check script
- [ ] Dockerfile modifications — RTK installation in runtime-full stage
- [ ] compose.yml modifications — health checks and volume mounts
- [ ] Multi-arch testing — requires access to both x86_64 and ARM64 hardware

## Sources

### Primary (HIGH confidence)
- [Docker multi-platform builds documentation](https://docs.docker.com/build/building/multi-platform/) — TARGETARCH, TARGETPLATFORM usage
- [Docker HEALTHCHECK reference](https://docs.docker.com/engine/reference/builder/#healthcheck) — health check syntax and options
- [GitHub rtk-ai/rtk releases](https://github.com/rtk-ai/rtk/releases) — Verified v0.23.0 exists, binary naming pattern confirmed
- [GitHub Releases REST API](https://docs.github.com/en/rest/releases/releases) — Asset download URL pattern
- Current `contextfs/Dockerfile` — Existing multi-stage structure
- Current `contextfs/compose.yml` — Existing compose configuration

### Secondary (MEDIUM confidence)
- RTK v0.23.0 release notes (Feb 28, 2026) — Features and bug fixes
- Alpine Linux package availability — curl, tar, bash

### Tertiary (LOW confidence)
- RTK workspace database configuration — Needs verification with RTK documentation
- Exact RTK CLI behavior — Needs runtime testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Docker multi-arch is mature, RTK releases are publicly available
- Architecture: HIGH — Dockerfile pattern is well-documented and tested
- Pitfalls: MEDIUM-HIGH — Common Docker/Alpine issues well-documented

**Research date:** 2026-03-01
**Valid until:** 2026-06-01 (RTK may release new versions; Docker patterns are stable)

---

*Phase 8: Infrastructure & Docker Setup — Research Complete*
