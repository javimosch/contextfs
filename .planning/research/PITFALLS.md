# Domain Pitfalls Research: Remote Filesystem Orchestration

**Domain:** Remote Filesystem Orchestration & MCP (ContextFS)
**Researched:** 2026-02-27
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: State Fragmentation via Non-Sticky Routing

**What goes wrong:**
In a distributed system, a virtual client (logical tenant) starts an operation (e.g., `git init`) on WS Client A. A subsequent command (e.g., `git commit`) is routed to WS Client B because it has slightly more RAM. The second command fails because the `.git` directory only exists on WS Client A.

**Why it happens:**
Developers prioritize "perfect" load balancing (least-loaded) over "functional" consistency (session affinity).

**How to avoid:**
Implement **Sticky Affinity** at the server-side scheduler. Once a Virtual Client is assigned to a WS Client, all its workspaces and requests must route to that specific node until the session expires or the node disconnects.

**Warning signs:**
- Frequent "file not found" errors during multi-step tool calls.
- Inconsistent `ls` results between consecutive requests.
- High "workspace synchronization" overhead if trying to sync state between nodes (don't do this; use stickiness instead).

**Phase to address:**
Phase 3 (New `contextfs/server` - Assignment Engine).

---

### Pitfall 2: The "Noisy Neighbor" Resource Exhaustion

**What goes wrong:**
One Virtual Client runs an infinite loop or a heavy `npm install` that consumes 100% CPU/RAM of the host WS Client. All other Virtual Clients sharing that physical node become unresponsive (Denial of Service).

**Why it happens:**
Lack of hard resource limits (cgroups/Docker quotas) or admission control at the scheduler level.

**How to avoid:**
1. Use Dockerized execution with hard limits (`--cpus`, `--memory`).
2. Implement "Admission Control" in the Server scheduler that rejects new Virtual Client assignments to nodes approaching 80% utilization.

**Warning signs:**
- WS Client heartbeats timing out under load.
- Latency spikes for all tenants on a specific node.
- OOM (Out of Memory) kills of the `contextfs client` process.

**Phase to address:**
Phase 2.1 (Security and filesystem ownership) & Phase 7 (Container strategy).

---

### Pitfall 3: Directory Traversal via Symlink Attacks

**What goes wrong:**
A malicious agent or user creates a symlink `ln -s /etc/shadow ./.contextfs/workspaces/evil/passwords`. The `contextfs.read` tool, which only checks if the path starts with the workspace root, follows the symlink and leaks host secrets.

**Why it happens:**
Path validation often uses simple string prefix checks (`startsWith`) instead of resolving real paths or using container isolation.

**How to avoid:**
1. Always resolve the `realpath` of the target file *and* ensure the resolved path is still within the workspace root.
2. Use Docker volumes with `ro` (read-only) mounts for sensitive areas or total isolation.

**Warning signs:**
- Code allowing absolute path arguments in tools.
- Lack of `fs.realpathSync` in path validation logic.

**Phase to address:**
Phase 2.1 (Security and filesystem ownership model).

---

### Pitfall 4: Orphaned Processes and Resource Leaks

**What goes wrong:**
A `bash_script_once` call spawns a background process (e.g., a dev server) that doesn't exit. The client disconnects, but the process keeps running, consuming RAM and holding file locks indefinitely.

**Why it happens:**
Failure to track child process PIDs and enforce a strict cleanup lifecycle on session termination or timeout.

**How to avoid:**
1. Implement a process group leader (`setsid`) and kill the entire group on timeout or client exit.
2. Enforce a mandatory `max_execution_time` for all script calls.

**Warning signs:**
- "Zombie" processes visible in `top` on execution nodes.
- "Address already in use" errors when restarting tasks.

**Phase to address:**
Phase 2 (New `contextfs/client` - `command-runner.js`).

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Simple string path prefix check | Fast to implement | Directory traversal vulnerabilities | Never (Security Critical) |
| Round-robin load balancing | Easy to code | State fragmentation (breaks multi-step tasks) | Only for stateless read-only tasks |
| Running Docker as root | Avoids permission headaches | Host system compromise risk | Local dev only, never in remote mode |
| In-memory Registry | No database dependency | Loss of assignment state on server restart | MVP / Phase 1-3 only |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP (Model Context Protocol) | Hardcoding workspace paths in prompts | Use `contextfs.use_workspace` to set dynamic context |
| Docker API | Directly exposing `/var/run/docker.sock` | Use a restricted proxy or the Docker CLI wrapper |
| OpenRouter / LLMs | Passing raw filesystem errors to the LLM | Sanitize paths in error messages to avoid leaking host structure |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Large directory `ls` | 10s+ latency on `contextfs.list` | Implement pagination or max-depth limits | > 5,000 files in a folder |
| Real-time Log Streaming over WS | High CPU usage on server/client | Use buffered chunks and throttle UI updates | > 10 active log streams |
| Centralized Registry Bottleneck | Assignment latency on new connections | Use a fast key-value store (Redis) for registry in V2 | > 500 concurrent WS Clients |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Unauthenticated WS Registration | Unauthorized nodes joining the cluster | Enforce `registrationToken` in Phase 1 |
| Mounting `~/.contextfs` in Docker | Container can modify other tenant's workspaces | Mount only the specific `{virtualClientId}` subdirectory |
| Lack of Command Denylist | Access to `curl`, `rm -rf /`, or `nmap` | Implement a `disallowed_patterns` regex in the client runner |

## "Looks Done But Isn't" Checklist

- [ ] **Docker Mode:** Often missing user-namespace mapping — verify `vc_{id}` user exists and owns the files.
- [ ] **Load Balancing:** Often missing health check decay — verify nodes are removed if heartbeats miss 3x.
- [ ] **Sticky Affinity:** Often missing "Rebalancing" logic — verify what happens if a "stuck" node dies (reassignment strategy).
- [ ] **Clean Terminate:** Often missing `SIGKILL` escalation — verify processes are killed if `SIGTERM` fails.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| State Fragmentation | MEDIUM | Manual cleanup of fragmented workspaces; force reassignment to a single node. |
| Host Compromise | CRITICAL | Wipe node; rotate all API keys; audit Docker escape logs. |
| Resource Exhaustion | LOW | Restart the affected WS Client; scheduler automatically moves tenants (if sticky affinity is broken/expired). |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| State Fragmentation | Phase 3 (Server) | Run consecutive `git` commands via different MCP sessions. |
| Directory Traversal | Phase 2.1 (Security) | Attempt to read `/etc/passwd` using `../../` patterns. |
| Noisy Neighbor | Phase 7 (Docker) | Run `yes > /dev/null` in one container; check impact on others. |
| Orphaned Processes | Phase 2 (Client) | Kill the client process; verify all sub-processes terminate. |

## Sources

- [Docker Security Best Practices](https://docs.docker.com/engine/security/best-practices/)
- [OWASP: Command Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
- [NIST: Guide to Container Security](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-190.pdf)
- [Distributed Systems: The CAP Theorem and Consistency Challenges](https://en.wikipedia.org/wiki/CAP_theorem)

---

# Domain Pitfalls: RTK Integration into ContextFS

**Domain:** Command proxy/output filtering for LLM context optimization  
**Context:** Adding RTK proxy to existing ContextFS Docker environment with MCP tool execution  
**Researched:** 2026-03-01  
**Confidence:** HIGH (based on RTK documentation, ContextFS project context, and common proxy integration patterns)

---

## Critical Pitfalls (RTK Integration)

### RTK Pitfall 1: RTK Binary Confusion — Installing the Wrong Package

**What goes wrong:**
The system installs `rtk` from the wrong source (Rust Type Kit from `reachingforthejack/rtk` instead of Rust Token Killer from `rtk-ai/rtk`). The wrong package doesn't provide command proxying or token filtering — it generates Rust types. ContextFS believes RTK is installed and available, but `rtk git status` fails or behaves unexpectedly, breaking all proxied commands.

**Why it happens:**
- Two different projects share the name "rtk"
- Cargo crates.io may serve the wrong package
- Package managers (apt/dnf) might have incorrect packages
- Installation scripts don't verify the installed binary supports expected subcommands

**How to avoid:**
1. **Always verify post-installation:** Run `rtk gain` to confirm token tracking works
2. **Check version:** `rtk --version` should show Token Killer version (0.22.2+)
3. **Use explicit source:** Install from `rtk-ai/rtk` GitHub releases or official install script
4. **Integration test:** After Docker build, run `rtk ls` on a test directory to verify functionality

**Warning signs:**
- `rtk gain` returns "command not found" or error
- `rtk git status` returns raw git output without filtering
- Binary is in PATH but doesn't recognize any `rtk <command>` syntax
- Cargo install succeeds but package is only ~1MB (Token Killer is larger)

**Phase to address:** Phase 1 — Docker Image Setup

---

### RTK Pitfall 2: Silent Output Corruption — Critical Errors Hidden by Filtering

**What goes wrong:**
RTK aggressively filters command output to save tokens, but in doing so it removes critical error information, partial success indicators, or diagnostic context that the LLM needs to understand failures. The LLM receives "test failed" without stack traces, or "build error" without the actual error message, leading to debugging loops and wasted tokens.

**Why it happens:**
- RTK's design optimizes for success cases ("ok ✓" responses)
- Failure output filtering may be too aggressive (e.g., showing only "2 tests failed" without details)
- ContextFS's error-sensitive workflows depend on specific error patterns for diagnosis
- No mechanism to request "full output" when needed

**How to avoid:**
1. **Use RTK's tee feature:** Enable `tee` in config to save full output on failures
2. **Implement fallback on non-zero exit:** When exit code ≠ 0, re-run without RTK proxy
3. **Whitelist non-filtered commands:** Don't proxy commands known to need full output (debugging, inspection)
4. **Add `rtk proxy` passthrough:** Support explicit proxy mode for raw output when needed
5. **Parse tee output hint:** When RTK outputs `[full output: path]`, read that file for LLM

**Warning signs:**
- LLM asks "what was the actual error?" repeatedly
- Commands show failure but no actionable information
- Debug workflows become more verbose instead of less
- Token savings drop because LLM re-runs commands to get details

**Phase to address:** Phase 2 — MCP Integration Layer

---

### RTK Pitfall 3: Exit Code Propagation Failure — False Success/Failure Signals

**What goes wrong:**
RTK proxy swallows or misreports the exit code of the underlying command. A failed `git push` (exit code 1) appears as success to ContextFS because RTK returned exit code 0 after successful filtering. Or conversely, RTK crashes and returns non-zero even when the command succeeded, causing the LLM to retry unnecessarily.

**Why it happens:**
- RTK wrapper exits with its own status, not the wrapped command's status
- Panics or errors in RTK's filtering logic terminate with non-zero before command completes
- Signal handling differences between RTK (Rust) and shell execution
- ContextFS relies on exit codes for MCP tool success/failure reporting

**How to avoid:**
1. **Always preserve exit codes:** Verify RTK propagates exit code from underlying command
2. **Explicit exit code handling:** In integration layer, capture RTK exit code separately from command exit code
3. **Test failure cases:** Integration tests must verify commands with known failures return correct codes
4. **Use `--verbose` for debugging:** When exit codes mismatch, use `rtk -v` to see raw output and exit status

**Warning signs:**
- LLM reports "command succeeded" but nothing actually happened
- Build/test failures don't trigger appropriate error handling
- CI/CD integration breaks because exit codes are wrong
- `echo $?` after RTK command shows unexpected values

**Phase to address:** Phase 2 — MCP Integration Layer

---

### RTK Pitfall 4: Missing Graceful Fallback — Total Failure When RTK Errors

**What goes wrong:**
When RTK encounters an error (binary missing, panic, incompatible command arguments), the entire tool execution fails instead of falling back to native execution. ContextFS becomes completely dependent on RTK availability and correctness, creating a single point of failure.

**Why it happens:**
- Integration assumes RTK is always available and working
- No try/catch or fallback logic around RTK invocation
- Configuration flag enables RTK globally without conditional logic
- Docker image doesn't include RTK or has PATH issues

**How to avoid:**
1. **Implement fallback chain:** Try RTK → if error, run native command → if error, report failure
2. **Feature flag with degradation:** `rtk.enabled` config allows graceful disable
3. **Detect RTK availability:** Check `which rtk` and `rtk --version` before attempting proxy
4. **Catch-all error handler:** Any RTK error triggers native execution, never hard failure
5. **Log fallback events:** Track when fallback occurs for debugging but don't fail

**Warning signs:**
- Commands fail with "rtk: command not found" in Docker containers
- System becomes unusable when RTK is uninstalled or broken
- Simple commands like `ls` fail because RTK wrapper crashed
- Configuration changes require restart to take effect

**Phase to address:** Phase 2 — MCP Integration Layer

---

### RTK Pitfall 5: Argument Parsing Mismatch — Commands Fail with Flags

**What goes wrong:**
Commands with flags and arguments work natively but fail when proxied through RTK. For example, `git log --oneline --graph` fails because RTK's argument parser doesn't recognize those flags or passes them incorrectly to the underlying command.

**Why it happens:**
- RTK uses clap for argument parsing with specific configurations
- Some RTK versions had bugs with `trailing_var_arg` and `allow_hyphen_values`
- RTK may inject its own flags that conflict with user flags (e.g., `--no-merges`)
- ContextFS passes arbitrary command strings that RTK hasn't explicitly implemented

**How to avoid:**
1. **Whitelist supported commands:** Only proxy commands RTK explicitly supports with full flag passthrough
2. **Test common flag combinations:** Verify `git log --oneline`, `cargo test --package`, etc. work
3. **Use `rtk proxy` mode:** For unknown flags, use passthrough mode that doesn't filter
4. **Validate before proxy:** Check if command+flags combination is in supported set
5. **Monitor for failures:** Log when RTK rejects arguments that native accepts

**Warning signs:**
- Commands work without flags but fail with flags
- Error messages mention "unexpected argument" or "found '--'"
- Users must remove flags to make commands work
- Regression in command flexibility after RTK integration

**Phase to address:** Phase 2 — MCP Integration Layer

---

### RTK Pitfall 6: Tee Output Path Issues — Can't Recover Full Output in Docker

**What goes wrong:**
RTK's tee feature saves full output to `~/.local/share/rtk/tee/`, but in Docker containers this path may be:
- Not persisted (ephemeral container storage)
- Not accessible from the host or LLM context
- Permission denied (wrong user/ownership)
- Different path than expected (overridden by `RTK_TEE_DIR`)

The LLM sees "[full output: /path]" but cannot read that file, causing confusion.

**Why it happens:**
- Docker containers have isolated filesystems
- RTK uses home directory paths by default
- Volume mounts may not include RTK's data directory
- User ID mismatch between container and host

**How to avoid:**
1. **Configure tee directory:** Set `RTK_TEE_DIR` to a shared volume path
2. **Volume mount strategy:** Mount a host directory for RTK data persistence
3. **Fallback on tee failure:** If tee file can't be read, automatically re-run without RTK
4. **Relative paths:** Use paths relative to workspace that are accessible
5. **Document tee locations:** Ensure LLM knows where to find tee files

**Warning signs:**
- RTK references tee files that don't exist
- Permission denied when trying to read tee output
- Token savings from tee feature not realized (re-running commands anyway)
- File not found errors in logs

**Phase to address:** Phase 1 — Docker Image Setup

---

### RTK Pitfall 7: Performance Overhead — RTK Slows Down Fast Commands

**What goes wrong:**
RTK adds startup and processing overhead that makes fast commands (like `ls`) perceptibly slower. While RTK targets <10ms startup, Docker overhead, filesystem layers, and container resource limits can push this higher, degrading the user experience.

**Why it happens:**
- Docker adds filesystem and process overhead
- RTK binary may not be cached in memory
- ContextFS executes many small commands sequentially
- Each RTK invocation pays the startup cost

**How to avoid:**
1. **Benchmark in Docker:** Measure `rtk ls` vs `ls` in actual ContextFS containers
2. **Consider batching:** Group multiple operations to amortize RTK startup cost
3. **Selective proxying:** Only use RTK for high-output commands (git, tests, builds)
4. **Monitor timing:** Track command execution time, alert if overhead >50ms
5. **Optimize image:** Ensure RTK binary is in layer cache, minimize filesystem traversal

**Warning signs:**
- Commands feel sluggish after RTK integration
- `time rtk ls` shows significantly more than 10ms
- High-frequency commands (file reads, status checks) become slow
- User complaints about responsiveness

**Phase to address:** Phase 1 — Docker Image Setup

---

### RTK Pitfall 8: Configuration Drift — Inconsistent RTK Behavior Across Environments

**What goes wrong:**
RTK behaves differently in development vs staging vs production because of:
- Different config files (`~/.config/rtk/config.toml`)
- Environment variables (`RTK_DB_PATH`, `RTK_TEE`)
- Version differences between environments
- Missing or outdated RTK.md/CLAUDE.md in some workspaces

ContextFS expects consistent behavior but gets different filtering levels or tee settings.

**How to avoid:**
1. **Explicit configuration:** Set all RTK options via environment variables, not config files
2. **Version pinning:** Install specific RTK version, not "latest"
3. **Dockerfile as source of truth:** All RTK configuration in container build
4. **Config validation:** On startup, verify RTK configuration matches expected values
5. **Consistent base image:** Use same Docker base image across all environments

**Warning signs:**
- Same command produces different output in different environments
- Token savings vary significantly between dev and prod
- Missing tee files in some containers
- Behavior changes after container rebuilds

**Phase to address:** Phase 1 — Docker Image Setup

---

## RTK Integration Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Global RTK enable | Simple config | All commands proxied, including incompatible ones | Only in Phase 2 with whitelist |
| Skip tee setup | Faster setup | Lost error context, re-running commands | Never — tee is essential for error-sensitive workflows |
| Ignore exit codes | Simpler integration | Wrong success/failure reporting | Never — breaks MCP contract |
| No version pinning | Always latest | Breaking changes, inconsistent behavior | Only for rapid prototyping |
| Hardcoded RTK path | Simple invocation | Fails on different Docker base images | Only if path is standardized |

---

## RTK Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Docker** | Install RTK in final stage only | Multi-stage build with RTK in builder + final, verify in both |
| **MCP Tool Execution** | Proxy all Bash tools through RTK | Whitelist supported commands, fallback for others |
| **Git Operations** | Proxy all git subcommands equally | Special handling for `git push` (needs exit codes), skip `git checkout` |
| **Test Runners** | Filter all test output | Use `rtk test` which shows failures only, preserves essential info |
| **Error Recovery** | Depend on tee files in ephemeral storage | Mount persistent volume or implement fallback re-execution |
| **Configuration** | Use RTK config files | Environment variables only for containerized environments |

---

## RTK Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| **RTK startup overhead** | Commands feel slow, `time` shows high latency | Benchmark and monitor, selective proxying | >100 commands/minute |
| **Tee file accumulation** | Disk fills up, container bloat | Rotate tee files, limit `max_files` | Long-running containers (days+) |
| **Tracking database growth** | Large SQLite file, slow queries | RTK auto-cleanup (90 days), or disable tracking | High-volume usage (10k+ commands) |
| **Unnecessary proxying** | Fast commands slowed down | Only proxy high-output commands | Any command frequency |

---

## RTK Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| **Install RTK from untrusted source** | Supply chain attack, malicious binary | Use official releases, verify checksums |
| **Tee files contain secrets** | Sensitive data in logs | Tee only on failures, sanitize paths |
| **RTK hooks modify commands unsafely** | Command injection | Validate hook scripts, use official hooks only |
| **Tracking database exposes history** | Information disclosure about workspace | Keep DB in container, don't mount to host |
| **Proxying sudo/root commands** | Privilege escalation | Never proxy commands with elevated privileges |

---

## RTK UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| **Invisible filtering** | User doesn't know output was compressed | Add indicator (e.g., "[rtk]") or document in tool description |
| **Can't get full output** | User needs raw data but RTK filters it | Provide `--verbose` flag or `rtk proxy` command |
| **No transparency on savings** | User can't verify token savings | Expose `rtk gain` metrics in dashboard |
| **Inconsistent availability** | Sometimes RTK works, sometimes not | Clear feature flag, status indicator |
| **Confusing fallback** | User sees different output formats randomly | Log fallback events, consistent formatting |

---

## RTK "Looks Done But Isn't" Checklist

- [ ] **RTK installed:** Verify with `rtk gain` — just checking `which rtk` is insufficient
- [ ] **Exit codes preserved:** Test a failing command, verify exit code matches native
- [ ] **Tee accessible:** Create a failing command, verify tee file exists and is readable
- [ ] **Fallback works:** Remove RTK binary, verify commands still execute natively
- [ ] **Configuration persistent:** Restart container, verify RTK config still applies
- [ ] **Version pinned:** Dockerfile specifies exact RTK version, not "latest"
- [ ] **High-value commands:** bash, ls, grep, git, docker, npm/cargo tests all tested with RTK
- [ ] **Error scenarios:** Test what happens when RTK panics, binary missing, or disk full

---

## RTK Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong RTK installed | LOW | Uninstall wrong package, install correct one, verify with `rtk gain` |
| Exit code propagation bug | MEDIUM | Disable RTK integration via feature flag, use native execution |
| Tee path not accessible | LOW | Update `RTK_TEE_DIR` env var, restart container |
| RTK performance degradation | LOW | Disable RTK for fast commands (ls, cat), keep for slow (tests, builds) |
| Silent output corruption | HIGH | Review RTK filtering logic, add whitelist for affected commands, re-enable cautiously |
| Configuration drift | MEDIUM | Standardize on env vars, rebuild containers with pinned version |
| Argument parsing failures | MEDIUM | Add command to unsupported list, use native execution for that command |

---

## RTK Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| RTK Binary Confusion | Phase 1 — Docker Image Setup | `rtk gain` returns token stats, not error |
| Silent Output Corruption | Phase 2 — MCP Integration Layer | Failing commands show tee output or full error context |
| Exit Code Propagation Failure | Phase 2 — MCP Integration Layer | Integration tests verify exit codes match native |
| Missing Graceful Fallback | Phase 2 — MCP Integration Layer | Remove RTK binary, all commands still work |
| Argument Parsing Mismatch | Phase 2 — MCP Integration Layer | Test suite with common flag combinations passes |
| Tee Output Path Issues | Phase 1 — Docker Image Setup | Tee files accessible at configured path |
| Performance Overhead | Phase 1 — Docker Image Setup | Benchmark shows <50ms overhead for common commands |
| Configuration Drift | Phase 1 — Docker Image Setup | Same Dockerfile produces consistent behavior |

---

## RTK Sources

- RTK Official Documentation (ref-rtk/README.md, ref-rtk/CLAUDE.md)
- ContextFS Project Requirements (.planning/PROJECT.md)
- RTK Name Collision Warning (documented in README)
- RTK Exit Code and Tee Implementation Patterns
- Docker Container Best Practices for CLI Tools

---

*Pitfalls research for: ContextFS (Remote Filesystem Orchestration)*  
*Researched: 2026-02-27 (Core), 2026-03-01 (RTK Integration)*
