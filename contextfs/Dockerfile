# Stage 1: Builder
# Purpose: Install npm dependencies with --omit=dev for minimal footprint
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --omit=dev

# Stage 2: Base Runtime
# Purpose: Minimal image with Node.js, tini, and contextfs client (no optional tools)
FROM node:22-alpine AS runtime-base

# Install tini process manager (critical for signal handling in containers)
RUN apk add --no-cache tini

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy entire contextfs codebase
COPY bin ./bin
COPY client ./client
COPY chat ./chat
COPY server ./server
COPY shared ./shared
COPY package*.json ./

# Set default working directory for mounted volumes
WORKDIR /workspace

# Use tini as init to properly handle signals
ENTRYPOINT ["/sbin/tini", "--"]

# Default command: start the client
CMD ["node", "/app/bin/contextfs.js", "client"]

# Stage 3: Full Runtime
# Purpose: Extended image with common development tools for broader use cases
FROM runtime-base AS runtime-full

# Install common CLI tools used in ContextFS workflows
# - git: version control operations
# - ripgrep: fast file searching (rg)
# - tree: directory structure visualization
# - curl: HTTP requests and downloads
# - bash: full shell for complex scripts
RUN apk add --no-cache \
    git \
    ripgrep \
    tree \
    curl \
    bash

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

# Copy RTK helper scripts
COPY scripts/rtk-shell-wrapper.sh /usr/local/bin/
COPY scripts/healthcheck-rtk.sh /usr/local/bin/
COPY scripts/init-rtk.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/rtk-shell-wrapper.sh /usr/local/bin/healthcheck-rtk.sh /usr/local/bin/init-rtk.sh

# Health check for RTK
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /usr/local/bin/healthcheck-rtk.sh

# Use init-rtk.sh as ENTRYPOINT to detect RTK before starting main process
# init-rtk.sh will exec tini and then the main command
ENTRYPOINT ["/usr/local/bin/init-rtk.sh", "/sbin/tini", "--"]
CMD ["node", "/app/bin/contextfs.js", "client"]
