'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { logVerbose, isComplexShellCommand, isCommandAllowed, resolveSafePath, requiresStdinWithoutInput } = require('./utils');
const { getTimeoutVariant, runCommand, runCommandStreaming, isContainerEnvironment } = require('./spawn');
const { validateParams, TOOLS } = require('../shared/protocol');

// Lazy-load RTKExecutor for RTK-enhanced tools
let rtkExecutor = null;
function getRtkExecutor() {
  if (rtkExecutor !== null) return rtkExecutor;
  if (isContainerEnvironment()) {
    try {
      const { RTKExecutor } = require('../server/mcp/tools/rtk-executor');
      rtkExecutor = new RTKExecutor();
    } catch (_) {
      rtkExecutor = false;
    }
  } else {
    rtkExecutor = false;
  }
  return rtkExecutor;
}

const MAX_SEARCH_DEPTH = 5;

// ── FS Tool Implementations ───────────────────────────────────────────────────

function listDir(dirPath, { recursive = false, depth = Infinity, filterGlob = null } = {}, currentDepth = 0) {
  const entries = [];
  let items;
  try { items = fs.readdirSync(dirPath, { withFileTypes: true }); } catch (_) { return entries; }

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    const isDir = item.isDirectory();

    if (filterGlob && !item.isDirectory() && !matchGlob(item.name, filterGlob)) continue;

    const entry = { name: item.name, type: isDir ? 'directory' : 'file', path: fullPath };
    if (!isDir) {
      try { entry.size = fs.statSync(fullPath).size; } catch (_) { entry.size = 0; }
    }
    entries.push(entry);

    if (isDir && recursive && currentDepth < depth - 1) {
      entry.children = listDir(fullPath, { recursive, depth, filterGlob }, currentDepth + 1);
    }
  }
  return entries;
}

function matchGlob(name, pattern) {
  // Simple glob: support *.ext and *name* patterns
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

async function runFsTool(toolName, params, workspaceRoot, { insecure = false, onChunk = null } = {}) {
  const validation = validateParams(toolName, params);
  if (!validation.valid) return { ok: false, error: validation.error };

  try {
    switch (toolName) {
      case TOOLS.LIST: {
        const dirPath = resolveSafePath(workspaceRoot, params.path || '.');
        const entries = listDir(dirPath, {
          recursive: params.recursive || false,
          depth: params.depth || Infinity,
          filterGlob: params.filter_glob || null,
        });
        return { ok: true, result: { path: params.path || '.', entries } };
      }

      case TOOLS.READ: {
        const rtkExec = getRtkExecutor();
        // If RTK is available and no byte/line limits are requested, use RTK for enhanced reading
        if (rtkExec && !params.start_line && !params.end_line && !params.max_bytes) {
          try {
            const result = await rtkExec.execute('read', [params.path], {
              cwd: workspaceRoot,
              largeFileFilter: params.largeFileFilter !== false
            });
            return { ok: true, result: { path: params.path, content: result.stdout } };
          } catch (error) {
            logVerbose(`[RTK] Read failed, falling back to native: ${error.message}`);
          }
        }

        const filePath = resolveSafePath(workspaceRoot, params.path);
        if (!fs.existsSync(filePath)) return { ok: false, error: `File not found: ${params.path}` };
        let content = fs.readFileSync(filePath, 'utf8');
        if (params.max_bytes && content.length > params.max_bytes) {
          content = content.slice(0, params.max_bytes);
        }
        if (params.start_line || params.end_line) {
          const lines = content.split('\n');
          const start = Math.max(0, (params.start_line || 1) - 1);
          const end = params.end_line !== undefined ? params.end_line : lines.length;
          content = lines.slice(start, end).join('\n');
        }
        return { ok: true, result: { path: params.path, content } };
      }

      case TOOLS.SUMMARIZE: {
        const rtkExec = getRtkExecutor();
        if (rtkExec) {
          try {
            const result = await rtkExec.execute('summarize', [params.path], {
              cwd: workspaceRoot
            });
            return { ok: true, result: { path: params.path, content: result.stdout } };
          } catch (error) {
            logVerbose(`[RTK] Summarize tool failed: ${error.message}`);
          }
        }
        // Fallback to basic read if summarize is not available
        return await runFsTool(TOOLS.READ, params, workspaceRoot, { insecure });
      }

      case TOOLS.WRITE: {
        const filePath = resolveSafePath(workspaceRoot, params.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (params.mode === 'append') {
          fs.appendFileSync(filePath, params.content, 'utf8');
        } else {
          fs.writeFileSync(filePath, params.content, 'utf8');
        }
        return { ok: true, result: { path: params.path, mode: params.mode || 'overwrite' } };
      }

      case TOOLS.LIST_WORKSPACES: {
        // Workspaces are managed server-side; client returns its own root info
        return { ok: true, result: { workspaceRoot } };
      }

      case TOOLS.USE_WORKSPACE: {
        // Acknowledged — actual workspace switching handled server-side in session
        return { ok: true, result: { name: params.name } };
      }

      case TOOLS.SAVE_SKILL: {
        const skillsDir = resolveSafePath(workspaceRoot, 'skills');
        if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
        const fileName = params.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.md';
        const filePath = path.join(skillsDir, fileName);
        const frontmatter = [
          '---',
          `name: ${params.name}`,
          params.description ? `description: ${params.description}` : null,
          params.tags?.length ? `tags: [${params.tags.join(', ')}]` : null,
          `savedAt: ${new Date().toISOString()}`,
          '---',
        ].filter(Boolean).join('\n');
        fs.writeFileSync(filePath, `${frontmatter}\n\n${params.content}`, 'utf8');
        return { ok: true, result: { name: params.name, path: `skills/${fileName}` } };
      }

      case TOOLS.LIST_SKILLS: {
        const skillsDir = resolveSafePath(workspaceRoot, 'skills');
        if (!fs.existsSync(skillsDir)) return { ok: true, result: { skills: [] } };
        const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
        const skills = files.map(f => {
          const content = fs.readFileSync(path.join(skillsDir, f), 'utf8');
          const meta = parseFrontmatter(content);
          return { name: meta.name || f.replace('.md', ''), description: meta.description || '', tags: meta.tags || [], file: f };
        });
        const filtered = params.tag
          ? skills.filter(s => Array.isArray(s.tags) && s.tags.includes(params.tag))
          : skills;
        return { ok: true, result: { skills: filtered } };
      }

      case TOOLS.SAVE_MEMORY: {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const memDir = resolveSafePath(workspaceRoot, `memory/${yyyy}/${mm}`);
        if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
        const slug = (params.title || 'entry').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const fileName = `${Date.now()}_${slug}.md`;
        const frontmatter = [
          '---',
          `title: ${params.title || ''}`,
          `importance: ${params.importance || 'medium'}`,
          params.tags?.length ? `tags: [${params.tags.join(', ')}]` : null,
          `savedAt: ${now.toISOString()}`,
          '---',
        ].filter(Boolean).join('\n');
        fs.writeFileSync(path.join(memDir, fileName), `${frontmatter}\n\n${params.content}`, 'utf8');
        return { ok: true, result: { path: `memory/${yyyy}/${mm}/${fileName}` } };
      }

      case TOOLS.SEARCH_MEMORY: {
        const memRoot = resolveSafePath(workspaceRoot, 'memory');
        if (!fs.existsSync(memRoot)) return { ok: true, result: { matches: [] } };
        const limit = params.limit || 10;
        const query = params.query ? params.query.toLowerCase() : null;
        const matches = [];
        searchDir(memRoot, query, matches, limit, 0, MAX_SEARCH_DEPTH);
        return { ok: true, result: { matches } };
      }

      case TOOLS.MEMORY_SUMMARY: {
        const memRoot = resolveSafePath(workspaceRoot, 'memory');
        const summary = scanMemorySummary(memRoot);
        return { ok: true, result: summary };
      }

      case TOOLS.MEMORY_BY_DATE: {
        const year = params.year;
        const month = params.month;
        const importance = params.importance || null;
        const limit = params.limit || 20;
        const result = getMemoriesByDate(workspaceRoot, year, month, importance, limit);
        return { ok: true, result };
      }

      case TOOLS.MEMORY_BY_TAG: {
        const tag = params.tag;
        const importance = params.importance || null;
        const limit = params.limit || 15;
        const result = getMemoriesByTag(workspaceRoot, tag, importance, limit);
        return { ok: true, result };
      }

      case TOOLS.BASH_SCRIPT_ONCE: {
        if (!insecure) {
          return { ok: false, error: 'bash_script_once requires --insecure flag on the client' };
        }
        return await runBashScriptOnce(params, workspaceRoot, { onChunk });
      }

      default:
        return { ok: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function searchDir(dir, query, matches, limit, currentDepth = 0, maxDepth = 5) {
  if (matches.length >= limit || currentDepth >= maxDepth) return;
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const item of items) {
    if (matches.length >= limit) break;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) { searchDir(full, query, matches, limit, currentDepth + 1, maxDepth); continue; }
    if (!item.name.endsWith('.md')) continue;
    try {
      const content = fs.readFileSync(full, 'utf8');
      if (query === null || content.toLowerCase().includes(query)) {
        const meta = parseFrontmatter(content);
        matches.push({
          path: full,
          title: meta.title || item.name,
          preview: content.slice(0, 200),
          importance: meta.importance || 'medium',
          tags: meta.tags || [],
          savedAt: meta.savedAt || null,
        });
      }
    } catch (_) {}
  }
}

function scanMemorySummary(memRoot) {
  const totalCount = 0;
  let earliest = null;
  let latest = null;
  const tags = new Set();
  const importanceDistribution = { low: 0, medium: 0, high: 0 };
  let count = 0;

  // Recursively scan memory directory
  function scanDir(dir, currentDepth = 0) {
    if (!fs.existsSync(dir) || currentDepth >= MAX_SEARCH_DEPTH) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) { scanDir(full, currentDepth + 1); continue; }
      if (!item.name.endsWith('.md')) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const meta = parseFrontmatter(content);
        count++;
        const importance = meta.importance || 'medium';
        if (importance in importanceDistribution) {
          importanceDistribution[importance]++;
        }
        if (meta.tags && Array.isArray(meta.tags)) {
          meta.tags.forEach(t => tags.add(t));
        }
        if (meta.savedAt) {
          const timestamp = new Date(meta.savedAt);
          if (!earliest || timestamp < earliest) earliest = timestamp;
          if (!latest || timestamp > latest) latest = timestamp;
        }
      } catch (_) {}
    }
  }

  scanDir(memRoot);

  return {
    totalCount: count,
    dateRange: {
      earliest: earliest ? earliest.toISOString() : null,
      latest: latest ? latest.toISOString() : null,
    },
    uniqueTags: Array.from(tags).sort(),
    importanceDistribution,
  };
}

function getMemoriesByDate(workspaceRoot, year, month, importance, limit) {
  const entries = [];
  const memRoot = resolveSafePath(workspaceRoot, 'memory');

  // Determine period string for response
  let periodPath;
  let period;
  if (month !== undefined && month !== null) {
    const mm = String(month).padStart(2, '0');
    periodPath = path.join(memRoot, String(year), mm);
    period = `${year}-${mm}`;
  } else {
    periodPath = path.join(memRoot, String(year));
    period = String(year);
  }

  if (!fs.existsSync(periodPath)) {
    return { period, entriesFound: 0, entries: [] };
  }

  // Recursively scan the period directory
  function scanDir(dir) {
    if (entries.length >= limit) return;
    if (!fs.existsSync(dir)) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const item of items) {
      if (entries.length >= limit) break;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) { scanDir(full); continue; }
      if (!item.name.endsWith('.md')) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const meta = parseFrontmatter(content);
        const imp = meta.importance || 'medium';
        if (importance && imp !== importance) continue;
        entries.push({
          path: full,
          title: meta.title || item.name,
          importance: imp,
          tags: meta.tags || [],
          savedAt: meta.savedAt || null,
          preview: content.slice(0, 150),
        });
      } catch (_) {}
    }
  }

  scanDir(periodPath);

  // Sort by savedAt (newest first)
  entries.sort((a, b) => {
    const aDate = a.savedAt ? new Date(a.savedAt).getTime() : 0;
    const bDate = b.savedAt ? new Date(b.savedAt).getTime() : 0;
    return bDate - aDate;
  });

  return { period, entriesFound: entries.length, entries };
}

function getMemoriesByTag(workspaceRoot, tag, importance, limit) {
  const entries = [];
  const memRoot = resolveSafePath(workspaceRoot, 'memory');

  if (!fs.existsSync(memRoot)) {
    return { tag, entriesFound: 0, entries: [] };
  }

  // Recursively scan memory directory
  function scanDir(dir, currentDepth = 0) {
    if (entries.length >= limit || currentDepth >= MAX_SEARCH_DEPTH) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const item of items) {
      if (entries.length >= limit) break;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) { scanDir(full, currentDepth + 1); continue; }
      if (!item.name.endsWith('.md')) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        const meta = parseFrontmatter(content);
        const entryTags = meta.tags || [];
        if (!entryTags.includes(tag)) continue;
        const imp = meta.importance || 'medium';
        if (importance && imp !== importance) continue;
        entries.push({
          path: full,
          title: meta.title || item.name,
          importance: imp,
          tags: entryTags,
          savedAt: meta.savedAt || null,
          preview: content.slice(0, 150),
        });
      } catch (_) {}
    }
  }

  scanDir(memRoot);

  // Sort by savedAt (newest first)
  entries.sort((a, b) => {
    const aDate = a.savedAt ? new Date(a.savedAt).getTime() : 0;
    const bDate = b.savedAt ? new Date(b.savedAt).getTime() : 0;
    return bDate - aDate;
  });

  return { tag, entriesFound: entries.length, entries };
}


function parseFrontmatter(content) {
  const meta = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return meta;
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }
  if (meta.tags) {
    meta.tags = meta.tags.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
  }
  return meta;
}

async function runBashScriptOnce(params, workspaceRoot, { onChunk } = {}) {
  const script = params.script || '';
  if (!script.trim()) return { ok: false, error: 'Missing script content' };
  if (Buffer.byteLength(script, 'utf8') > 512 * 1024) {
    return { ok: false, error: 'Script exceeds 512KB limit' };
  }

  const shell = params.shell === 'sh' ? 'sh' : 'bash';
  const cwdSafe = resolveSafePath(workspaceRoot, params.cwd || '.');
  const cmdEnv = params.env && typeof params.env === 'object' ? params.env : {};
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 30000;
  const tmpFile = path.join(os.tmpdir(), `contextfs-script-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.sh`);
  const streaming = params.stream === true && typeof onChunk === 'function';

  try {
    fs.writeFileSync(tmpFile, script, { mode: 0o700 });
    if (streaming) {
      const result = await runCommandStreaming({
        cmd: shell, args: [tmpFile], cwd: cwdSafe, env: cmdEnv, timeoutMs,
        onChunk,
      });
      return { ok: result.code === 0, result: { code: result.code, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, streamed: true } };
    } else {
      const result = await runCommand({ cmd: shell, args: [tmpFile], cwd: cwdSafe, env: cmdEnv, timeoutMs });
      return { ok: result.code === 0, result: { code: result.code, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs } };
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// ── Shell Command Runner (for raw command dispatch) ────────────────────────────

async function runCommands({ commands, allowedCommands, rootPath, timeoutMs = 30000, globalTimeoutMs = null, isStreaming = false, baselineEnv = {}, onChunk }) {
  const results = [];

  for (const c of commands) {
    const cmd = String(c?.cmd || '');
    if (!cmd) { results.push({ ok: false, error: 'Missing cmd' }); continue; }

    if (!isCommandAllowed(cmd, allowedCommands)) {
      results.push({ ok: false, cmd, error: 'Command not allowlisted' });
      continue;
    }

    let effectiveRoot = c?.rootPath || rootPath;
    if (effectiveRoot && !path.isAbsolute(effectiveRoot)) {
      effectiveRoot = path.resolve(process.cwd(), effectiveRoot);
    }

    const cwdSafe = resolveSafePath(effectiveRoot, c?.cwd || '.');
    const cmdEnv = c?.env || {};
    const cmdInput = typeof c?.input === 'string' ? c.input : null;

    if (cmdInput === null && requiresStdinWithoutInput(cmd, c?.args)) {
      results.push({ ok: false, code: 85, signal: null, stdout: '', stderr: 'Command requires stdin input', durationMs: 0 });
      continue;
    }

    let execCmd = cmd;
    let execArgs = Array.isArray(c?.args) ? [...c.args] : [];
    const isComplex = isComplexShellCommand(cmd, execArgs);

    if (isComplex) {
      execCmd = '/bin/sh';
      execArgs = ['-c', [cmd, ...execArgs].join(' ')];
    }

    if (globalTimeoutMs) {
      const timeoutSec = Math.max(1, Math.ceil(globalTimeoutMs / 1000));
      const variant = await getTimeoutVariant();
      if (variant !== 'none') {
        const tArgs = variant === 'gnu'
          ? ['--signal=KILL', `${timeoutSec}s`, execCmd, ...execArgs]
          : ['-s', 'KILL', `${timeoutSec}s`, execCmd, ...execArgs];
        execCmd = 'timeout';
        execArgs = tArgs;
      }
    }

    const runFn = isStreaming ? runCommandStreaming : runCommand;
    const r = await runFn({ cmd: execCmd, args: execArgs, cwd: cwdSafe, env: cmdEnv, input: cmdInput, timeoutMs, baselineEnv, onChunk });
    results.push({ ok: r.code === 0, ...r });
  }

  return results;
}

module.exports = { runFsTool, runCommands };
