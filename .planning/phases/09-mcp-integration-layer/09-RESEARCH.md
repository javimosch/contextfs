# Phase 9: MCP Integration Layer - Research

**Researched:** 2026-03-01
**Domain:** MCP Tool Execution, Docker Entrypoint Patterns, Environment Configuration
**Confidence:** HIGH

## Summary

Phase 9 integrates RTK proxying into ContextFS MCP tool execution flow. The core challenge is creating a reliable, observable configuration system that auto-detects RTK availability at container startup, gracefully falls back to native execution when RTK is unavailable or fails, and provides clear error classification for debugging.

Key decisions from user: RTK enabled by auto-detect using `CONTEXTFS_RTK_ENABLED` environment variable only (no per-workspace config in v1.1), with verbose startup logging showing RTK status. This research focuses on Docker entrypoint initialization patterns, Node.js child process error handling with fallback, and MCP tool integration architecture.

**Primary recommendation:** Implement a startup initialization script in the Docker entrypoint that detects RTK availability, logs status, and configures the MCP tool execution layer to use either RTK or native execution with comprehensive error classification.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- RTK enabled by **auto-detect** — if RTK binary is available and healthy, enable it; otherwise disable
- **Environment variable only** — use `CONTEXTFS_RTK_ENABLED` (true/false) for configuration
  - If set to "true" or "false", respect that setting
  - If unset or invalid, auto-detect based on RTK binary availability
- **No per-workspace or per-command configuration** for v1.1 — global setting only
- **Verbose startup logging** — container logs RTK binary location, version, and status on startup
  - Example: "RTK binary found at /usr/local/bin/rtk", "RTK version: 0.23.0", "Status: enabled"

### Claude's Discretion
- Exact log format and verbosity levels
- How to handle invalid CONTEXTFS_RTK_ENABLED values (treat as unset vs error)
- RTK availability check implementation details (version command vs health script)
- Container startup hook location (entrypoint vs init script)

### Deferred Ideas (OUT OF SCOPE)
- Per-workspace RTK configuration (v1.2 candidate)
- Per-command RTK enable/disable (v1.2 candidate)
- Hot-reload of RTK configuration without container restart
- RTK configuration UI in dashboard
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONFIG-01 | Environment variable `CONTEXTFS_RTK_ENABLED` for global toggle | Use Node.js `process.env` with boolean parsing; Docker `ENV` instruction |
| CONFIG-02 | Per-workspace RTK enable/disable configuration | **DEFERRED** — marked as pending but context explicitly defers per-workspace config to v1.2 |
| CONFIG-03 | RTK binary availability detection at container startup | Docker entrypoint script with `command -v rtk` or `rtk --version` check; capture stdout for version |
| CONFIG-04 | Graceful degradation when RTK is disabled or unavailable | Implement fallback chain: RTK → native → error; Node.js child process with try/catch wrapper |
| ERROR-01 | Graceful fallback to native execution on RTK errors | Error classification strategy: RTK exit codes, spawn errors, timeout detection |
| ERROR-02 | Tee feature saves full output on command failures | Use `rtk` with tee flag or implement wrapper that pipes to both RTK and file |
| ERROR-03 | Error classification (RTK vs command vs native failure) | Three-tier classification: spawn/execution errors, RTK processing errors, target command exit codes |
| ERROR-04 | Command allowlist prevents unsupported flag failures | Maintain supported commands list; validate arguments before RTK invocation |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js child_process | Built-in (v22+) | Spawn RTK/native commands with fallback | Native Node.js API, no dependencies, supports streaming and async patterns |
| Docker ENTRYPOINT | Docker 20.10+ | Container startup initialization | Industry standard for pre-execution setup, runs before CMD |
| Shell (/bin/sh) | Alpine 3.19+ | RTK availability detection | Universal availability, minimal overhead for simple checks |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| util.promisify | Node.js built-in | Convert callback-based exec to Promise | For async/await error handling patterns |
| AbortController | Node.js v15.4+ | Cancel long-running RTK commands | Timeout handling for hanging processes |
| dotenv | ^16.0.0 | Local development environment loading | If running outside Docker for testing |

### Existing ContextFS Infrastructure
| Component | Location | Purpose |
|-----------|----------|---------|
| rtk-shell-wrapper.sh | /usr/local/bin/ | Shell-level fallback wrapper |
| healthcheck-rtk.sh | /usr/local/bin/ | Docker health check script |
| Dockerfile runtime-full | contextfs/Dockerfile | RTK binary installation stage |

**Installation:**
```bash
# No additional npm packages required — using Node.js built-ins
# RTK binary already installed via Dockerfile in Phase 8
```

## Architecture Patterns

### Recommended Project Structure
```
contextfs/
├── bin/
│   └── contextfs.js           # Main entry point
├── server/
│   ├── mcp/
│   │   └── tools/
│   │       ├── rtk-executor.js    # NEW: RTK execution wrapper
│   │       ├── native-executor.js # NEW: Native command fallback
│   │       └── error-classifier.js # NEW: Error classification
│   └── config/
│       └── rtk-config.js      # NEW: RTK configuration management
├── scripts/
│   ├── rtk-shell-wrapper.sh   # EXISTING: Shell wrapper
│   ├── healthcheck-rtk.sh     # EXISTING: Health check
│   └── init-rtk.sh            # NEW: Container initialization
└── Dockerfile
```

### Pattern 1: Docker Entrypoint Initialization
**What:** Container startup script that detects RTK, logs status, and configures environment before starting main process.

**When to use:** When you need to perform setup or validation before the main container process starts.

**Implementation:**
```bash
#!/bin/sh
# scripts/init-rtk.sh

set -e

RTK_BINARY="/usr/local/bin/rtk"
RTK_VERSION=""
RTK_STATUS="disabled"

# Check if RTK is explicitly disabled
if [ "${CONTEXTFS_RTK_ENABLED}" = "false" ]; then
    echo "[RTK] Explicitly disabled by CONTEXTFS_RTK_ENABLED=false"
    RTK_STATUS="disabled"
elif [ -x "${RTK_BINARY}" ]; then
    # Check if RTK is healthy
    if RTK_VERSION=$(rtk --version 2>/dev/null); then
        RTK_STATUS="enabled"
        echo "[RTK] Binary found at ${RTK_BINARY}"
        echo "[RTK] Version: ${RTK_VERSION}"
        echo "[RTK] Status: enabled"
    else
        echo "[RTK] Binary exists but is not functional"
        RTK_STATUS="unavailable"
    fi
else
    echo "[RTK] Binary not found at ${RTK_BINARY}"
    RTK_STATUS="unavailable"
fi

# Export for child processes
export CONTEXTFS_RTK_STATUS="${RTK_STATUS}"

# Execute the main command
exec "$@"
```

### Pattern 2: Node.js Child Process with Fallback
**What:** Execute command through RTK first, catch errors, fall back to native execution.

**When to use:** When RTK execution might fail and you need guaranteed command completion.

**Implementation:**
```javascript
// server/mcp/tools/rtk-executor.js
const { spawn } = require('child_process');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);

class RTKExecutor {
  constructor(config = {}) {
    this.rtkEnabled = this.isRTKEnabled();
    this.rtkPath = config.rtkPath || 'rtk';
    this.timeout = config.timeout || 30000;
  }

  isRTKEnabled() {
    const envValue = process.env.CONTEXTFS_RTK_ENABLED;
    if (envValue === 'true') return true;
    if (envValue === 'false') return false;
    // Auto-detect: check if RTK is functional
    return process.env.CONTEXTFS_RTK_STATUS === 'enabled';
  }

  async execute(command, args = [], options = {}) {
    if (!this.rtkEnabled) {
      return this.executeNative(command, args, options);
    }

    try {
      return await this.executeRTK(command, args, options);
    } catch (error) {
      if (error.shouldFallback) {
        console.warn(`[RTK] Falling back to native execution: ${error.message}`);
        return this.executeNative(command, args, options);
      }
      throw error;
    }
  }

  async executeRTK(command, args, options) {
    const rtkArgs = this.mapToRTKArgs(command, args);
    
    return new Promise((resolve, reject) => {
      const child = spawn(this.rtkPath, rtkArgs, {
        cwd: options.cwd,
        env: process.env,
        timeout: this.timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data; });
      child.stderr?.on('data', (data) => { stderr += data; });

      child.on('error', (error) => {
        reject(new RTKExecutionError('SPAWN_FAILED', error.message, { shouldFallback: true }));
      });

      child.on('close', (code, signal) => {
        if (signal) {
          reject(new RTKExecutionError('SIGNAL_TERMINATED', `Process terminated by ${signal}`, { shouldFallback: true }));
        } else if (code !== 0) {
          // Check if this is an RTK error or target command error
          if (this.isRTKError(stderr)) {
            reject(new RTKExecutionError('RTK_ERROR', stderr, { shouldFallback: true, exitCode: code }));
          } else {
            // Target command failed — this is expected behavior, don't fallback
            resolve({ stdout, stderr, exitCode: code, source: 'rtk' });
          }
        } else {
          resolve({ stdout, stderr, exitCode: 0, source: 'rtk' });
        }
      });
    });
  }

  async executeNative(command, args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data; });
      child.stderr?.on('data', (data) => { stderr += data; });

      child.on('error', (error) => {
        reject(new NativeExecutionError('NATIVE_SPAWN_FAILED', error.message));
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0, source: 'native' });
      });
    });
  }

  mapToRTKArgs(command, args) {
    const commandMap = {
      'ls': ['ls', ...args],
      'grep': ['grep', ...args],
      'rg': ['grep', ...args],
    };
    return commandMap[command] || [command, ...args];
  }

  isRTKError(stderr) {
    // RTK-specific error patterns
    const rtkErrorPatterns = [
      /rtk:.*error/i,
      /RTK.*Error/i,
      /invalid.*flag.*rtk/i,
    ];
    return rtkErrorPatterns.some(pattern => pattern.test(stderr));
  }
}

class RTKExecutionError extends Error {
  constructor(type, message, metadata = {}) {
    super(message);
    this.name = 'RTKExecutionError';
    this.type = type;
    this.shouldFallback = metadata.shouldFallback || false;
    this.exitCode = metadata.exitCode;
  }
}

class NativeExecutionError extends Error {
  constructor(type, message) {
    super(message);
    this.name = 'NativeExecutionError';
    this.type = type;
  }
}

module.exports = { RTKExecutor, RTKExecutionError, NativeExecutionError };
```

### Pattern 3: Error Classification Strategy
**What:** Three-tier error classification to distinguish RTK failures from command failures.

**When to use:** For debugging, metrics, and determining whether to fallback.

**Classification tiers:**

| Tier | Error Type | Examples | Fallback? |
|------|------------|----------|-----------|
| 1 | Spawn/Execution | Binary not found, permission denied, timeout | Yes |
| 2 | RTK Processing | Invalid arguments, unsupported flags, RTK crash | Yes |
| 3 | Target Command | Command not found, command exit code != 0 | No |

**Implementation:**
```javascript
// server/mcp/tools/error-classifier.js

class ErrorClassifier {
  static classify(error, stderr = '') {
    // Tier 1: Spawn errors
    if (error.code === 'ENOENT') {
      return { tier: 1, type: 'BINARY_NOT_FOUND', fallback: true };
    }
    if (error.code === 'EACCES') {
      return { tier: 1, type: 'PERMISSION_DENIED', fallback: true };
    }
    if (error.code === 'ETIMEDOUT' || error.type === 'SIGNAL_TERMINATED') {
      return { tier: 1, type: 'TIMEOUT', fallback: true };
    }

    // Tier 2: RTK processing errors
    if (this.isRTKProcessingError(stderr)) {
      return { tier: 2, type: 'RTK_PROCESSING_ERROR', fallback: true };
    }

    // Tier 3: Target command errors (expected, don't fallback)
    return { tier: 3, type: 'COMMAND_ERROR', fallback: false };
  }

  static isRTKProcessingError(stderr) {
    const patterns = [
      /rtk:.*unrecognized.*option/i,
      /rtk:.*invalid.*argument/i,
      /RTK.*panic/i,
      /RTK.*internal.*error/i,
    ];
    return patterns.some(p => p.test(stderr));
  }
}

module.exports = { ErrorClassifier };
```

### Anti-Patterns to Avoid

1. **Synchronous spawn in request path:** Using `spawnSync` or `execSync` blocks the event loop and can freeze the MCP server under load. Always use async patterns.

2. **No timeout on RTK commands:** RTK could hang on certain inputs. Always set a timeout and handle `AbortSignal`.

3. **Ignoring exit codes:** Distinguish between RTK failure (fallback) and target command failure (return to caller). Don't blanket-fallback on all non-zero exits.

4. **Shell injection via arguments:** Never pass unsanitized user input to shell commands. Use `spawn` with `shell: false` and pass arguments as array.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process spawning | Custom spawn wrapper | Node.js `child_process.spawn()` | Handles stdio, signals, cross-platform edge cases |
| Environment parsing | Manual string parsing | Boolean parsing with validation | Handles 'true', 'TRUE', '1', edge cases consistently |
| Timeout handling | setTimeout + manual kill | `timeout` option in spawn + AbortSignal | Proper cleanup, signal handling |
| Error propagation | Custom error types only | Extend Error with metadata | Stack traces, instanceof checks, debugging |

**Key insight:** The existing `rtk-shell-wrapper.sh` provides shell-level fallback, but MCP tools need Node.js-level integration for proper error classification and MCP response formatting. Use both layers: shell wrapper for basic command fallback, Node.js executor for MCP integration.

## Common Pitfalls

### Pitfall 1: Zombie Processes
**What goes wrong:** Child processes spawned without proper cleanup become zombies if parent crashes or doesn't wait.

**Why it happens:** `spawn()` creates detached processes by default; if parent exits without `child.kill()`, child keeps running.

**How to avoid:**
```javascript
// Always handle process cleanup
process.on('exit', () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
});

// Or use AbortSignal for timeout/cancellation
const controller = new AbortController();
const child = spawn('rtk', args, { signal: controller.signal });
setTimeout(() => controller.abort(), 30000);
```

**Warning signs:** High process count in container, `ps aux` showing many defunct processes.

### Pitfall 2: Buffer Overflows
**What goes wrong:** Large RTK output exceeds Node.js default buffer (1MB), causing truncated output or crash.

**Why it happens:** `exec` and `execFile` have `maxBuffer` default of 1MB. `spawn` with string accumulation has no limit.

**How to avoid:**
```javascript
// For exec/execFile, increase maxBuffer
execFile('rtk', args, { maxBuffer: 10 * 1024 * 1024 }); // 10MB

// For spawn with large output, use streaming
const chunks = [];
child.stdout.on('data', chunk => chunks.push(chunk));
child.on('close', () => {
  const output = Buffer.concat(chunks).toString(); // Handle large output safely
});
```

### Pitfall 3: Environment Variable Type Confusion
**What goes wrong:** `CONTEXTFS_RTK_ENABLED=false` is truthy as a string, causing RTK to be "enabled".

**Why it happens:** All env vars are strings; JavaScript `"false"` is truthy.

**How to avoid:**
```javascript
function parseBooleanEnv(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = value.toString().toLowerCase().trim();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return undefined; // Invalid value triggers auto-detect
}

const rtkEnabled = parseBooleanEnv(process.env.CONTEXTFS_RTK_ENABLED);
```

### Pitfall 4: Container Startup Race Conditions
**What goes wrong:** MCP server starts before RTK initialization completes, causing first commands to miss RTK.

**Why it happens:** Docker `CMD` runs immediately after `ENTRYPOINT` without waiting for setup.

**How to avoid:** Ensure initialization is synchronous in entrypoint before `exec "$@"`. The shell script approach (Pattern 1) handles this correctly.

## Code Examples

### MCP Tool Integration Pattern
```javascript
// server/mcp/tools/command-tool.js
const { RTKExecutor } = require('./rtk-executor');

class CommandTool {
  constructor() {
    this.executor = new RTKExecutor();
  }

  async callTool(name, arguments) {
    const command = this.mapToolToCommand(name, arguments);
    
    try {
      const result = await this.executor.execute(command.cmd, command.args, {
        cwd: arguments.workingDirectory,
      });

      return {
        content: [{
          type: 'text',
          text: result.stdout || result.stderr,
        }],
        isError: result.exitCode !== 0,
        metadata: {
          exitCode: result.exitCode,
          executionSource: result.source, // 'rtk' or 'native'
        },
      };
    } catch (error) {
      // Even fallback failed — return error to MCP client
      return {
        content: [{
          type: 'text',
          text: `Execution failed: ${error.message}`,
        }],
        isError: true,
        metadata: {
          errorType: error.type || 'UNKNOWN',
          errorClass: error.name,
        },
      };
    }
  }

  mapToolToCommand(toolName, args) {
    const mappings = {
      'list_directory': { cmd: 'ls', args: [args.path, '-la'] },
      'search_files': { cmd: 'rg', args: [args.pattern, args.path] },
      // ... more mappings
    };
    return mappings[toolName];
  }
}

module.exports = { CommandTool };
```

### Environment Configuration Module
```javascript
// server/config/rtk-config.js

class RTKConfig {
  static getConfig() {
    const rawValue = process.env.CONTEXTFS_RTK_ENABLED;
    const parsedValue = this.parseBoolean(rawValue);
    
    return {
      // Explicit config takes precedence
      enabled: parsedValue !== undefined 
        ? parsedValue 
        : this.detectRTKAvailability(),
      
      // Auto-detect result for logging
      autoDetected: parsedValue === undefined,
      
      // RTK binary path (for custom installations)
      binaryPath: process.env.CONTEXTFS_RTK_PATH || 'rtk',
      
      // Timeout for RTK commands (ms)
      timeout: parseInt(process.env.CONTEXTFS_RTK_TIMEOUT, 10) || 30000,
      
      // Whether to save full output on failure
      teeOnError: process.env.CONTEXTFS_RTK_TEE !== 'false',
      
      // Status from container initialization
      containerStatus: process.env.CONTEXTFS_RTK_STATUS || 'unknown',
    };
  }

  static parseBoolean(value) {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).toLowerCase().trim();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
    return undefined; // Invalid - will auto-detect
  }

  static detectRTKAvailability() {
    // Check the status set by container init script
    return process.env.CONTEXTFS_RTK_STATUS === 'enabled';
  }

  static validate() {
    const config = this.getConfig();
    
    if (config.autoDetected) {
      console.log('[RTK-Config] Auto-detected RTK status:', config.enabled ? 'enabled' : 'disabled');
    } else {
      console.log('[RTK-Config] Explicit RTK setting:', config.enabled ? 'enabled' : 'disabled');
    }

    return config;
  }
}

module.exports = { RTKConfig };
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shell-only fallback | Shell + Node.js layers | 2026 (Phase 9) | Better error classification, MCP integration |
| Simple env var checking | Structured parsing with auto-detect | 2026 (Phase 9) | More robust configuration handling |
| Synchronous exec | Async spawn with AbortSignal | Node.js v15.4+ | Non-blocking, cancellable operations |
| Custom timeout handling | Built-in timeout options | Node.js v15.13+ | Cleaner code, better resource cleanup |

**Deprecated/outdated:**
- None identified for this phase

## Open Questions

1. **Invalid CONTEXTFS_RTK_ENABLED values handling**
   - What we know: Context.md gives discretion on treating as unset vs error
   - What's unclear: Should we fail container startup or silently auto-detect?
   - Recommendation: Treat as unset (auto-detect) but log warning. Failures during execution should return clear error to MCP client.

2. **RTK availability check granularity**
   - What we know: Context mentions `rtk --version` or health script
   - What's unclear: Is version check sufficient or do we need functional test?
   - Recommendation: Use `rtk --version` for startup check (fast), defer functional verification to first command execution. Add `rtk health` or similar if available in RTK v0.23.0+.

3. **Tee feature implementation location**
   - What we know: ERROR-02 requires tee feature for debugging
   - What's unclear: Implement in RTK wrapper vs Node.js layer vs both?
   - Recommendation: Implement tee in Node.js layer for MCP integration; RTK may have native tee support via flags (`rtk --tee` if available).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in Test Runner (node:test) + assert |
| Config file | None — use package.json test script |
| Quick run command | `node --test test/rtk-executor.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONFIG-01 | CONTEXTFS_RTK_ENABLED=true enables RTK | unit | `node --test test/config/rtk-config.test.js` | ❌ Wave 0 |
| CONFIG-01 | CONTEXTFS_RTK_ENABLED=false disables RTK | unit | `node --test test/config/rtk-config.test.js` | ❌ Wave 0 |
| CONFIG-03 | RTK binary detection at startup | integration | `node --test test/integration/rtk-detection.test.js` | ❌ Wave 0 |
| CONFIG-04 | Fallback to native on RTK unavailable | integration | `node --test test/integration/fallback.test.js` | ❌ Wave 0 |
| ERROR-01 | Graceful fallback on RTK error | unit | `node --test test/rtk-executor.test.js` | ❌ Wave 0 |
| ERROR-03 | Error classification (3 tiers) | unit | `node --test test/error-classifier.test.js` | ❌ Wave 0 |
| ERROR-04 | Command allowlist validation | unit | `node --test test/command-allowlist.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/<specific>.test.js -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/config/rtk-config.test.js` — covers CONFIG-01, CONFIG-02 (deferred), CONFIG-03
- [ ] `test/rtk-executor.test.js` — covers ERROR-01, CONFIG-04
- [ ] `test/error-classifier.test.js` — covers ERROR-03
- [ ] `test/command-allowlist.test.js` — covers ERROR-04
- [ ] `test/integration/rtk-detection.test.js` — covers CONFIG-03, CONFIG-04
- [ ] `scripts/init-rtk.sh` — container startup initialization script
- [ ] `server/mcp/tools/rtk-executor.js` — main executor implementation
- [ ] `server/mcp/tools/error-classifier.js` — error classification module
- [ ] `server/config/rtk-config.js` — configuration management

## Sources

### Primary (HIGH confidence)
- Node.js child_process documentation (v25.7.0) — API patterns, error handling, timeout options
- Docker ENTRYPOINT documentation — Container initialization patterns
- MCP Specification (modelcontextprotocol.io) — Tool execution patterns, JSON-RPC structure

### Secondary (MEDIUM confidence)
- ContextFS Phase 8 artifacts (Dockerfile, rtk-shell-wrapper.sh, healthcheck-rtk.sh) — Existing infrastructure patterns
- Phase 9 CONTEXT.md — User requirements and constraints
- REQUIREMENTS.md — Specific requirement IDs and acceptance criteria

### Tertiary (LOW confidence)
- None — all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Node.js built-ins and Docker patterns are well-established
- Architecture: HIGH — Based on MCP specification and existing ContextFS infrastructure
- Pitfalls: MEDIUM-HIGH — Common Node.js child process issues documented in official sources

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (30 days for stable Node.js/Docker patterns)
