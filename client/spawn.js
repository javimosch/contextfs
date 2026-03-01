'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const { logVerbose } = require('./utils');

// ── RTK Integration ───────────────────────────────────────────────────────────

let spawnWrapper = null;

// Lazy-load RTK components to avoid issues in non-container environments
function getSpawnWrapper() {
  if (spawnWrapper !== null) return spawnWrapper;

  // Only initialize in container environment
  if (!isContainerEnvironment()) {
    spawnWrapper = false;
    return spawnWrapper;
  }

  try {
    const { SpawnWrapper } = require('../server/mcp/tools/spawn-wrapper.js');
    const { RTKExecutor } = require('../server/mcp/tools/rtk-executor.js');
    const { TokenTracker } = require('../server/mcp/tools/token-tracker.js');

    const tokenTracker = new TokenTracker();
    const rtkExecutor = new RTKExecutor();
    spawnWrapper = new SpawnWrapper({ rtkExecutor, tokenTracker });

    if (logVerbose) {
      console.log('[RTK] SpawnWrapper initialized in container environment');
    }
  } catch (error) {
    console.warn(`[RTK] Failed to initialize SpawnWrapper: ${error.message}`);
    spawnWrapper = false;
  }

  return spawnWrapper;
}

// ── Container detection ───────────────────────────────────────────────────────

let _isContainer = null;
function isContainerEnvironment() {
  if (_isContainer !== null) return _isContainer;
  try {
    if (fs.existsSync('/.dockerenv')) { _isContainer = true; return true; }
    try {
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('containerd')) {
        _isContainer = true; return true;
      }
    } catch (_) {}
    _isContainer = false;
    return false;
  } catch (_) {
    _isContainer = false;
    return false;
  }
}

// ── Timeout variant detection ─────────────────────────────────────────────────

let _timeoutVariant = null;
async function getTimeoutVariant() {
  if (_timeoutVariant) return _timeoutVariant;
  if (isContainerEnvironment()) { _timeoutVariant = 'none'; return 'none'; }
  try {
    const r = spawnSync('timeout', ['--version'], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0 || (r.stdout && r.stdout.includes('GNU'))) {
      _timeoutVariant = 'gnu'; return 'gnu';
    }
    // Try busybox variant: timeout -s KILL 1s true
    const r2 = spawnSync('timeout', ['-s', 'KILL', '1s', 'true'], { encoding: 'utf8', timeout: 3000 });
    if (r2.status === 0) { _timeoutVariant = 'busybox'; return 'busybox'; }
  } catch (_) {}
  _timeoutVariant = 'none';
  return 'none';
}

// ── Command availability ──────────────────────────────────────────────────────

function isCommandAvailable(cmd) {
  try {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3000 });
    return r.status !== 127 && r.error?.code !== 'ENOENT';
  } catch (_) {
    return false;
  }
}

// ── Process execution ─────────────────────────────────────────────────────────

const MAX_BUFFER = 200 * 1024; // 200 KB per stream

/**
 * Run a command and collect all output.
 * Returns { code, signal, stdout, stderr, durationMs }
 */
function runCommand({ cmd, args = [], cwd, env = {}, input = null, timeoutMs = 30000, baselineEnv = {} }) {
  return new Promise(async (resolve) => {
    const start = Date.now();
    const mergedEnv = { ...process.env, ...baselineEnv, ...env };

    // Check if we should use RTK
    const wrapper = getSpawnWrapper();
    if (wrapper && !args.includes('-c') && !cmd.includes('bash') && !cmd.includes('sh')) {
      try {
        console.log(`[RTK] Using RTK for: ${cmd}`);
        const result = await wrapper.execute(cmd, args, { cwd, env: mergedEnv, timeout: timeoutMs });
        const durationMs = Date.now() - start;
        resolve({
          code: result.exitCode,
          signal: null,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs
        });
        return;
      } catch (error) {
        console.log(`[RTK] Fallback to native: ${error.message}`);
        // Fall through to native execution
      }
    }

    let proc;
    try {
      proc = spawn(cmd, args, { cwd, env: mergedEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ code: 1, signal: null, stdout: '', stderr: err.message, durationMs: 0 });
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          try { proc.kill('SIGKILL'); } catch (_) {}
        }, timeoutMs)
      : null;

    proc.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_BUFFER) stdout += chunk.toString('utf8');
    });
    proc.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_BUFFER) stderr += chunk.toString('utf8');
    });

    if (input !== null) {
      try { proc.stdin.write(input); proc.stdin.end(); } catch (_) {}
    } else {
      try { proc.stdin.end(); } catch (_) {}
    }

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, signal: null, stdout, stderr: err.message, durationMs: Date.now() - start });
    });

    proc.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (timedOut) stderr += `\n[contextfs] Command timed out after ${timeoutMs}ms`;
      resolve({ code: timedOut ? 124 : (code ?? 1), signal, stdout, stderr, durationMs });
    });
  });
}

/**
 * Run a command with streaming output.
 * Calls onChunk({ chunk, stream, seq }) for each data event.
 * Returns { code, signal, stdout, stderr, durationMs }
 */
function runCommandStreaming({ cmd, args = [], cwd, env = {}, input = null, timeoutMs = 30000, baselineEnv = {}, onChunk }) {
  return new Promise(async (resolve) => {
    const start = Date.now();
    const mergedEnv = { ...process.env, ...baselineEnv, ...env };
    let seq = 0;

    // Check if we should use RTK (but not for shell commands with -c)
    const wrapper = getSpawnWrapper();
    if (wrapper && !args.includes('-c') && !cmd.includes('bash') && !cmd.includes('sh')) {
      try {
        console.log(`[RTK] Using RTK for: ${cmd}`);
        const result = await wrapper.execute(cmd, args, { cwd, env: mergedEnv, timeout: timeoutMs });
        const durationMs = Date.now() - start;

        // Emit chunks for streaming compatibility
        if (typeof onChunk === 'function') {
          if (result.stdout) {
            onChunk({ chunk: result.stdout, stream: 'stdout', seq: seq++ });
          }
          if (result.stderr) {
            onChunk({ chunk: result.stderr, stream: 'stderr', seq: seq++ });
          }
        }

        resolve({
          code: result.exitCode,
          signal: null,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs
        });
        return;
      } catch (error) {
        console.log(`[RTK] Fallback to native: ${error.message}`);
        // Fall through to native execution
      }
    }

    let proc;
    try {
      proc = spawn(cmd, args, { cwd, env: mergedEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ code: 1, signal: null, stdout: '', stderr: err.message, durationMs: 0 });
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          try { proc.kill('SIGKILL'); } catch (_) {}
        }, timeoutMs)
      : null;

    proc.stdout.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      if (stdout.length < MAX_BUFFER) stdout += str;
      if (typeof onChunk === 'function') onChunk({ chunk: str, stream: 'stdout', seq: seq++ });
    });

    proc.stderr.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      if (stderr.length < MAX_BUFFER) stderr += str;
      if (typeof onChunk === 'function') onChunk({ chunk: str, stream: 'stderr', seq: seq++ });
    });

    if (input !== null) {
      try { proc.stdin.write(input); proc.stdin.end(); } catch (_) {}
    } else {
      try { proc.stdin.end(); } catch (_) {}
    }

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, signal: null, stdout, stderr: err.message, durationMs: Date.now() - start });
    });

    proc.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (timedOut) stderr += `\n[contextfs] Command timed out after ${timeoutMs}ms`;
      resolve({ code: timedOut ? 124 : (code ?? 1), signal, stdout, stderr, durationMs });
    });
  });
}

module.exports = { runCommand, runCommandStreaming, isCommandAvailable, getTimeoutVariant, isContainerEnvironment };
