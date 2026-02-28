'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { runFsTool } = require('../client/command-runner');
const { validateParams } = require('../shared/protocol');
const { runCommandStreaming } = require('../client/spawn');

const LOCAL_WS_CLIENT_ID = 'local';

/**
 * createLocalAdapter — in-process tool execution adapter.
 *
 * Implements the same dispatch() interface as createWsHandler(), so MCP server
 * and API router can use it transparently in --local mode without any WS clients.
 *
 * Tool calls are executed synchronously in-process via runFsTool().
 * Results are emitted on the process event bus (contextfs:response) exactly
 * as the WS handler does, so all existing waiters in mcp-server.js and
 * api-router.js work unchanged.
 *
 * @param {object} opts
 * @param {string}  opts.workspaceRoot — root path for tool execution
 * @param {boolean} opts.insecure      — whether bash_script_once is allowed
 * @param {object}  opts.registry      — Registry instance (for VC validation)
 * @param {object}  opts.scheduler     — Scheduler instance (for VC assignment)
 */
function createLocalAdapter({ workspaceRoot, insecure = false, registry, scheduler }) {
  // Per-VC active workspace roots (mirrors message-handler.js vcWorkspaces map)
  const vcWorkspaces = new Map();

  function getWorkspaceRoot(virtualClientId) {
    return vcWorkspaces.get(virtualClientId) || workspaceRoot;
  }

  /**
   * dispatch() — same signature as wsHandler.dispatch().
   * Executes the tool in-process and emits contextfs:response.
   * Returns { dispatched: true, wsClientId: 'local' } immediately.
   */
  function dispatch({ virtualClientId, requestId, tool, params, timeoutMs }) {
    // Validate VC exists
    if (registry && !registry.getVirtualClient(virtualClientId)) {
      return { dispatched: false, error: `Virtual client not found: ${virtualClientId}` };
    }

    // Execute asynchronously so callers that await contextfs:response work correctly
    setImmediate(async () => {
      let response;
      try {
        const root = getWorkspaceRoot(virtualClientId);

        // Build onChunk callback if streaming requested
        const wantsStream = params?.stream === true;
        let seq = 0;
        const onChunk = wantsStream
          ? ({ chunk, stream: streamName }) => {
              process.emit('contextfs:stream_chunk', { requestId, virtualClientId, chunk, stream: streamName, seq: seq++ });
            }
          : null;

        if (tool === 'contextfs.use_workspace') {
          response = await runFsTool(tool, params || {}, root, { insecure });
          if (response.ok) {
            // Build workspace path using same logic as message-handler.js
            let newRoot;
            if (params.workspaceId) {
              newRoot = path.join(workspaceRoot, virtualClientId, params.workspaceId);
            } else if (params.rootPath) {
              newRoot = params.rootPath;
            } else {
              newRoot = path.join(workspaceRoot, params.name || 'default');
            }
            if (!fs.existsSync(newRoot)) fs.mkdirSync(newRoot, { recursive: true });
            vcWorkspaces.set(virtualClientId, newRoot);
            response.result.activePath = newRoot;
          }
        } else if (tool && tool.startsWith('contextfs.')) {
          response = await runFsTool(tool, params || {}, root, { insecure, onChunk });
        } else {
          response = { ok: false, error: `Unknown tool: ${tool}` };
        }
      } catch (err) {
        response = { ok: false, error: err.message || String(err) };
      }

      process.emit('contextfs:response', {
        requestId,
        virtualClientId,
        status: response.ok ? 'ok' : 'error',
        result: response.ok ? response.result : undefined,
        error: response.ok ? undefined : response.error,
      });
    });

    return { dispatched: true, wsClientId: LOCAL_WS_CLIENT_ID };
  }

  /**
   * Stub methods to satisfy the wsHandler interface used by server/index.js.
   * In local mode these are no-ops.
   */
  function handleOpen() {}
  function handleClose() {}
  function handleMessage() {}
  function sendToWsClient() {}

  const connections = new Map(); // always empty in local mode

  return { dispatch, handleOpen, handleClose, handleMessage, sendToWsClient, connections };
}

/**
 * createLocalOnlyRegistry — minimal in-memory registry for --local mode.
 *
 * In --local mode we don't need JSON persistence (no WS clients to track),
 * but we still need VC + workspace CRUD for the API and MCP layers.
 * This wraps the real Registry but disables WS client methods.
 */
function createLocalOnlyRegistry(homeDir) {
  const { Registry } = require('./registry');
  const reg = new Registry(homeDir);
  reg.load();

  // Override WS client methods to be no-ops in local mode
  const noopWsc = { id: LOCAL_WS_CLIENT_ID, name: 'local', status: 'online',
    apiKey: 'local', createdAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString(),
    capability: { cpuLoad: os.loadavg(), freeMemMb: Math.round(os.freemem()/1024/1024),
      totalMemMb: Math.round(os.totalmem()/1024/1024), cpuCount: os.cpus().length, vcCount: 0 } };

  const origListWsClients = reg.listWsClients.bind(reg);
  reg.listWsClients = () => [noopWsc];
  reg.getWsClient = (id) => id === LOCAL_WS_CLIENT_ID ? noopWsc : null;
  reg.isConnected = (id) => id === LOCAL_WS_CLIENT_ID;
  reg.listConnectedWsClientIds = () => [LOCAL_WS_CLIENT_ID];

  return reg;
}

/**
 * createLocalOnlyScheduler — always assigns to LOCAL_WS_CLIENT_ID.
 */
function createLocalOnlyScheduler(registry) {
  return {
    assign(virtualClientId) {
      const vc = registry.getVirtualClient(virtualClientId);
      if (!vc) return null;
      // Always assign to local in local mode
      if (vc.assignedWsClientId !== LOCAL_WS_CLIENT_ID) {
        registry.assignVirtualClientToWs(virtualClientId, LOCAL_WS_CLIENT_ID);
      }
      return LOCAL_WS_CLIENT_ID;
    },
    getAssignment(virtualClientId) {
      return LOCAL_WS_CLIENT_ID;
    },
    releaseAssignmentsFor() { return []; },
  };
}

module.exports = { createLocalAdapter, createLocalOnlyRegistry, createLocalOnlyScheduler, LOCAL_WS_CLIENT_ID };
