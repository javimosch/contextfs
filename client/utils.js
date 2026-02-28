'use strict';

const path = require('path');

function logVerbose(...msg) {
  if (global._contextfsVerbose) {
    process.stderr.write(`[CONTEXTFS_VERBOSE] ${msg.join(' ')}\n`);
  }
}

/**
 * Get env var with CONTEXTFS_ prefix fallback.
 */
function getEnv(name, defaultValue) {
  const prefixed = `CONTEXTFS_${name}`;
  if (process.env[prefixed] !== undefined) return process.env[prefixed];
  if (process.env[name] !== undefined) return process.env[name];
  return defaultValue;
}

function toWebSocketUrl(baseUrl) {
  const u = new URL(baseUrl);
  if (u.protocol === 'http:') u.protocol = 'ws:';
  if (u.protocol === 'https:') u.protocol = 'wss:';
  return u.toString();
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

/**
 * Resolve a path safely within rootPath — throws if it would escape.
 */
function resolveSafePath(rootPath, relativePath) {
  const root = path.resolve(String(rootPath || '/'));
  const rel = String(relativePath || '');
  const full = path.resolve(root, rel);
  if (full === root) return full;
  if (!full.startsWith(root + path.sep)) {
    throw new Error(`Path escapes root: ${relativePath}`);
  }
  return full;
}

/**
 * Simple CLI argument parser supporting --key value and --flag forms.
 */
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i++; }
    else { args[key] = true; }
  }
  return args;
}

/**
 * Returns true if the command involves shell control tokens or subshell syntax.
 */
function isComplexShellCommand(cmd, args) {
  const argv = Array.isArray(args) ? args.map(String) : [];
  if (['sh', '/bin/sh', 'bash', '/bin/bash'].includes(cmd)) return true;
  const controlTokens = new Set(['|', '||', '&&', ';', '&', '>', '>>', '<', '<<',
    '1>', '1>>', '2>', '2>>', '&>', '|&']);
  if (argv.some(t => controlTokens.has(t))) return true;
  if (argv.some(t => t.includes('$(') || t.includes('`'))) return true;
  return false;
}

/**
 * Returns true if the command would block on stdin without provided input.
 */
function requiresStdinWithoutInput(cmd, args) {
  const stdinSensitive = new Set(['sort', 'head', 'tail', 'uniq', 'cat', 'wc']);
  if (!stdinSensitive.has(cmd)) return false;
  const argv = Array.isArray(args) ? args.map(String) : [];
  const optionsWithValue = {
    head: new Set(['-n', '-c', '--lines', '--bytes']),
    tail: new Set(['-n', '-c', '--lines', '--bytes']),
    sort: new Set(['-k', '-t', '-o', '-S', '-T']),
    uniq: new Set(['-f', '-s', '-w']),
    cat: new Set([]),
    wc: new Set([]),
  };
  const positional = [];
  let skipNext = false;
  let restPositional = false;
  for (const token of argv) {
    if (restPositional) { positional.push(token); continue; }
    if (skipNext) { skipNext = false; continue; }
    if (token === '--') { restPositional = true; continue; }
    if (token.startsWith('-') && token !== '-') {
      if ((optionsWithValue[cmd] || new Set()).has(token)) skipNext = true;
      continue;
    }
    positional.push(token);
  }
  if (positional.length === 0) return true;
  if (positional.includes('-')) return true;
  return false;
}

function isCommandAllowed(cmd, allowedCommands) {
  if (!Array.isArray(allowedCommands)) return false;
  if (allowedCommands.includes(cmd)) return true;
  for (const allowed of allowedCommands) {
    if (allowed.endsWith('*') && cmd.startsWith(allowed.slice(0, -1))) return true;
  }
  return false;
}

module.exports = {
  logVerbose,
  getEnv,
  toWebSocketUrl,
  safeJsonParse,
  resolveSafePath,
  parseArgs,
  isComplexShellCommand,
  requiresStdinWithoutInput,
  isCommandAllowed,
};
