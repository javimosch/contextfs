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

# Inherit entrypoint and cmd from runtime-base
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/bin/contextfs.js", "client"]
