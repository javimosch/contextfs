'use strict';

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');

const { Registry } = require('./registry');
const { Scheduler } = require('./scheduler');
const { createWsHandler } = require('./ws-handler');
const { createApiRouter } = require('./api-router');
const { createMcpServer } = require('./mcp/mcp-server');
const { startStdioTransport } = require('./mcp/stdio-transport');
const { mountSseTransport } = require('./mcp/sse-transport');
const { createLocalAdapter, createLocalOnlyRegistry, createLocalOnlyScheduler } = require('./local-adapter');

// ── Parse CLI args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(3); // skip 'node', 'contextfs.js', 'server'

// Handle --help early
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
contextfs server — Start the ContextFS server

Usage:
  contextfs server [options]

Options:
  --port <port>       Port to listen on (default: 3010, env: PORT)
  --local             Local mode: tools run in-process, no WS clients
  --mcp [transport]   Enable MCP server (stdio or sse)
  --vc-id <id>        Virtual client ID for stdio MCP
  --vc-key <key>      Virtual client API key for stdio MCP
  --insecure          Enable bash_script_once tool
  --verbose           Enable verbose logging

MCP Transport:
  --mcp               Use stdio transport (requires --vc-id and --vc-key)
  --mcp sse           Use SSE transport (credentials per-connection)

Examples:
  contextfs server
  contextfs server --port 3010 --insecure
  contextfs server --mcp --vc-id vc1 --vc-key secret
  contextfs server --mcp sse
`);
  process.exit(0);
}

function getArg(name, defaultVal) {
  const idx = argv.indexOf(`--${name}`);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  if (idx !== -1) return true;
  return process.env[name.toUpperCase().replace(/-/g, '_')] || defaultVal;
}

const PORT = parseInt(getArg('port', process.env.PORT || '3010'), 10);
const INSECURE = argv.includes('--insecure') || process.env.CONTEXTFS_INSECURE === '1';
const VERBOSE = argv.includes('--verbose') || process.env.VERBOSE === '1';
const CONTEXTFS_HOME = path.join(os.homedir(), '.contextfs');

// Local mode flag
const LOCAL_MODE = argv.includes('--local') || process.env.CONTEXTFS_LOCAL === '1';

// --cwd override for local mode workspace root
const CWD_ARG = getArg('cwd', '');

// MCP flags
const MCP_IDX = argv.indexOf('--mcp');
const MCP_ENABLED = MCP_IDX !== -1;
// transport: next token after --mcp if it's 'sse', else 'stdio'
const MCP_TRANSPORT = (MCP_ENABLED && argv[MCP_IDX + 1] === 'sse') ? 'sse' : 'stdio';
// stdio-only: single VC session credentials (SSE resolves them per-connection)
const MCP_VC_ID = getArg('vc-id', process.env.CONTEXTFS_VC_ID || '');
const MCP_VC_KEY = getArg('vc-key', process.env.CONTEXTFS_VC_KEY || '');

// ── Ensure home directory exists ──────────────────────────────────────────────
if (!fs.existsSync(CONTEXTFS_HOME)) {
  fs.mkdirSync(CONTEXTFS_HOME, { recursive: true });
}
const workspacesDir = path.join(CONTEXTFS_HOME, 'workspaces');
if (!fs.existsSync(workspacesDir)) {
  fs.mkdirSync(workspacesDir, { recursive: true });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const registry = LOCAL_MODE
  ? createLocalOnlyRegistry(CONTEXTFS_HOME)
  : (() => { const r = new Registry(CONTEXTFS_HOME); r.load(); return r; })();

const scheduler = LOCAL_MODE
  ? createLocalOnlyScheduler(registry)
  : new Scheduler(registry);

// In local mode, wsHandler is replaced by the local adapter (same interface)
// --cwd overrides the default local workspace root
const localWorkspaceRoot = LOCAL_MODE && CWD_ARG
  ? path.resolve(CWD_ARG)
  : path.join(CONTEXTFS_HOME, 'workspaces', 'local');
const wsHandler = LOCAL_MODE
  ? createLocalAdapter({ workspaceRoot: localWorkspaceRoot, insecure: INSECURE, registry, scheduler })
  : createWsHandler({ registry, scheduler });

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'healthy' });
});

// Dashboard — serve static files
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// Root → redirect to dashboard (only for non-upgrade requests)
app.get('/', (req, res, next) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    return next();
  }
  res.redirect('/dashboard/');
});

// Dashboard index for any /dashboard/* path (SPA fallback)
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

// REST API
const apiRouter = createApiRouter({ registry, wsHandler });
app.use('/api', apiRouter);

// MCP SSE transport (mounted early so it's available before server.listen callback)
if (MCP_ENABLED && MCP_TRANSPORT === 'sse') {
  mountSseTransport(app, ({ sessionId, vcId, vcKey }) => {
    // Each SSE connection gets its own MCP server instance with its own VC identity.
    // VC credentials come from the SSE request (?vcId=&vcKey= or headers).
    return createMcpServer({
      registry,
      wsHandler,
      virtualClientId: vcId,
      virtualClientApiKey: vcKey,
      insecure: INSECURE,
    });
  }, { verbose: VERBOSE });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ ok: false, error: err.message });
});

// ── HTTP + WS server ──────────────────────────────────────────────────────────
const server = http.createServer(app);

// WebSocket server - only created in normal (non-local) mode
let wss = null;
if (!LOCAL_MODE) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    if (VERBOSE) console.log(`[WS] New connection from ${req.socket.remoteAddress}`);
    wsHandler.handleOpen(ws);

    ws.on('message', (rawMsg) => {
      wsHandler.handleMessage(ws, rawMsg);
    });

    ws.on('close', () => {
      wsHandler.handleClose(ws);
    });

    ws.on('error', (err) => {
      if (VERBOSE) console.error('[WS] Socket error:', err.message);
      wsHandler.handleClose(ws);
    });
  });
}

// Ensure local workspace root exists
if (LOCAL_MODE && !fs.existsSync(localWorkspaceRoot)) {
  fs.mkdirSync(localWorkspaceRoot, { recursive: true });
}

server.listen(PORT, () => {
  console.log(`[ContextFS] Server listening on http://localhost:${PORT}`);
  if (LOCAL_MODE) {
    console.log(`[ContextFS] Mode: LOCAL (no WS clients accepted — tools run in-process)`);
    console.log(`[ContextFS] Local workspace root: ${localWorkspaceRoot}`);
  } else {
    console.log(`[ContextFS] WebSocket endpoint: ws://localhost:${PORT}`);
  }
  console.log(`[ContextFS] Home directory: ${CONTEXTFS_HOME}`);
  if (INSECURE) console.warn('[ContextFS] WARNING: --insecure mode enabled (bash_script_once allowed)');

  if (MCP_ENABLED) {
    if (MCP_TRANSPORT === 'stdio') {
      // stdio is single-session — VC credentials must be provided upfront
      if (!MCP_VC_ID || !MCP_VC_KEY) {
        console.error('[ContextFS] ERROR: --mcp stdio requires --vc-id and --vc-key (or CONTEXTFS_VC_ID / CONTEXTFS_VC_KEY)');
        process.exit(1);
      }
      console.log(`[ContextFS] MCP server starting (stdio transport) for VC: ${MCP_VC_ID}`);
      // Ensure the virtual client exists in registry (handles auto-provisioned credentials)
      registry.ensureVirtualClient(MCP_VC_ID, MCP_VC_KEY);
      const mcpServer = createMcpServer({
        registry,
        wsHandler,
        virtualClientId: MCP_VC_ID,
        virtualClientApiKey: MCP_VC_KEY,
        insecure: INSECURE,
      });
      startStdioTransport(mcpServer, { verbose: VERBOSE });
    } else {
      // SSE transport: VC credentials are supplied per-connection via ?vcId=&vcKey= or headers
      console.log(`[ContextFS] MCP server mounted (SSE transport) at http://localhost:${PORT}/mcp/sse`);
      console.log(`[ContextFS] MCP SSE: connect with ?vcId=<id>&vcKey=<key> query params or X-VC-ID / Authorization headers`);
      console.log(`[ContextFS] MCP SSE: POST messages to http://localhost:${PORT}/mcp/message?sessionId=<id>`);
    }
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[ContextFS] ${signal} received, shutting down...`);
  if (wss) wss.close();
  server.close(() => {
    console.log('[ContextFS] Server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, registry, scheduler };
