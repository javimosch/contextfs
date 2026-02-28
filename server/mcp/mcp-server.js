'use strict';

const crypto = require('crypto');
const { getAllTools, getToolDefinition } = require('./mcp-tools');
const { validateParams } = require('../../shared/protocol');

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'contextfs', version: '1.0.0' };

/**
 * createMcpServer — JSON-RPC 2.0 dispatcher for the MCP protocol.
 *
 * Call modes:
 *   - Normal mode: routes tool calls through wsHandler.dispatch() to assigned WS client
 *   - Local mode (future): routes through LocalClientAdapter
 *
 * @param {object} opts
 * @param {object} opts.registry         — Registry instance
 * @param {object} opts.wsHandler        — WS handler with dispatch()
 * @param {string} opts.virtualClientId  — Virtual client ID for this MCP session
 * @param {string} opts.virtualClientApiKey — VC API key (enforced on every call)
 * @param {boolean} opts.insecure        — Whether bash_script_once is allowed
 * @param {number}  opts.defaultTimeoutMs — Default tool call timeout
 */
function createMcpServer({
  registry,
  wsHandler,
  virtualClientId,
  virtualClientApiKey,
  insecure = false,
  defaultTimeoutMs = 30000,
  streaming = false,           // opt-in: enable streaming for this server instance
  onStreamChunk = null,        // callback(evt) for each contextfs:stream_chunk event
}) {
  // ── Auth helper ────────────────────────────────────────────────────────────
  function authOk() {
    return registry.validateVirtualClientApiKey(virtualClientId, virtualClientApiKey);
  }

  // ── JSON-RPC response builders ─────────────────────────────────────────────
  function ok(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  function err(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id, error };
  }

  // Standard JSON-RPC error codes
  const E = {
    PARSE_ERROR:      { code: -32700, message: 'Parse error' },
    INVALID_REQUEST:  { code: -32600, message: 'Invalid Request' },
    METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
    INVALID_PARAMS:   { code: -32602, message: 'Invalid params' },
    INTERNAL_ERROR:   { code: -32603, message: 'Internal error' },
    // MCP-specific
    UNAUTHORIZED:     { code: -32001, message: 'Unauthorized' },
    TOOL_ERROR:       { code: -32002, message: 'Tool execution error' },
    NO_CLIENT:        { code: -32003, message: 'No WS client available' },
    TIMEOUT:          { code: -32004, message: 'Tool call timed out' },
  };

  // ── Tool dispatch ──────────────────────────────────────────────────────────
  async function callTool(name, params, { wantStream = false } = {}) {
    const requestId = 'mcp_' + crypto.randomBytes(8).toString('hex');
    const timeoutMs = defaultTimeoutMs;
    // Inject stream flag into params when streaming is enabled for this call
    const callParams = (streaming && wantStream)
      ? { ...params, stream: true }
      : params;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        process.removeListener('contextfs:response', onResponse);
        if (streaming && wantStream) process.removeListener('contextfs:stream_chunk', onChunk);
        resolve({ ok: false, errorCode: E.TIMEOUT.code, errorMessage: E.TIMEOUT.message });
      }, timeoutMs + 5000);

      function onChunk(evt) {
        if (evt.requestId === requestId && typeof onStreamChunk === 'function') {
          onStreamChunk(evt);
        }
      }

      function onResponse(evt) {
        if (evt.requestId === requestId) {
          clearTimeout(timer);
          process.removeListener('contextfs:response', onResponse);
          if (streaming && wantStream) process.removeListener('contextfs:stream_chunk', onChunk);
          if (evt.status === 'ok') {
            resolve({ ok: true, result: evt.result });
          } else {
            resolve({ ok: false, errorCode: E.TOOL_ERROR.code, errorMessage: evt.error || 'Tool failed' });
          }
        }
      }

      if (streaming && wantStream) process.on('contextfs:stream_chunk', onChunk);
      process.on('contextfs:response', onResponse);

      const dispatched = wsHandler.dispatch({
        virtualClientId,
        requestId,
        tool: name,
        params: callParams,
        timeoutMs,
      });

      if (!dispatched.dispatched) {
        clearTimeout(timer);
        process.removeListener('contextfs:response', onResponse);
        if (streaming && wantStream) process.removeListener('contextfs:stream_chunk', onChunk);
        const enhancedMessage = `${dispatched.error} — No WS client is available for this virtual client. Connect a WS client using: contextfs client --url ws://localhost:3010 --ws-client-id <id> --api-key <key>`;
        resolve({ ok: false, errorCode: E.NO_CLIENT.code, errorMessage: enhancedMessage });
      }
    });
  }

  // ── Method handlers ────────────────────────────────────────────────────────

  async function handleInitialize(id, params) {
    // Respond with server capabilities
    return ok(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        // Advertise streaming support as an extension capability
        ...(streaming ? { streaming: { supported: true, tools: ['contextfs.bash_script_once'] } } : {}),
      },
      serverInfo: SERVER_INFO,
    });
  }

  async function handleToolsList(id, params) {
    return ok(id, { tools: getAllTools() });
  }

  async function handleToolsCall(id, params) {
    const { name, arguments: toolArgs } = params || {};

    if (!name || typeof name !== 'string') {
      return err(id, E.INVALID_PARAMS.code, 'Missing tool name');
    }

    const toolDef = getToolDefinition(name);
    if (!toolDef) {
      return err(id, E.METHOD_NOT_FOUND.code, `Unknown tool: ${name}`);
    }

    // Strip internal _stream flag BEFORE validation (not part of tool schema)
    let callParams = { ...(toolArgs || {}) };
    const wantStream = streaming && callParams._stream === true;
    delete callParams._stream;

    // Validate params against shared schema
    const validation = validateParams(name, callParams);
    if (!validation.valid) {
      return err(id, E.INVALID_PARAMS.code, validation.error);
    }

    // bash_script_once requires --insecure
    if (name === 'contextfs.bash_script_once' && !insecure) {
      return err(id, E.TOOL_ERROR.code, 'bash_script_once requires the server to be started with --insecure');
    }

    const vc = registry.getVirtualClient(virtualClientId);
    if (!vc) {
      return err(id, E.UNAUTHORIZED.code, 'Virtual client not found');
    }

    if (name === 'contextfs.list_workspaces') {
      const list = registry.listWorkspaces(virtualClientId);
      const activeWs = vc.activeWorkspaceId ? registry.getWorkspace(vc.activeWorkspaceId) : null;
      return ok(id, {
        content: [{
          type: 'text',
          text: JSON.stringify({ 
            workspaces: list,
            activeWorkspace: activeWs ? activeWs.name : null,
            activeWorkspaceId: vc.activeWorkspaceId,
          }, null, 2),
        }],
        isError: false,
      });
    }

    if (name === 'contextfs.use_workspace') {
      const wsName = callParams.name;
      let ws = registry.findWorkspaceByName(virtualClientId, wsName);
      
      // Auto-create workspace if it doesn't exist (ensures sync between LLM and Registry)
      if (!ws) {
        try {
          ws = registry.createWorkspace({ virtualClientId, name: wsName });
        } catch (e) {
          return err(id, E.TOOL_ERROR.code, `Failed to create workspace: ${e.message}`);
        }
      }
      
      registry.setActiveWorkspace(virtualClientId, ws.id);
      // Pass workspace ID to client so it can resolve the correct subpath
      callParams.workspaceId = ws.id;
    }

    // Auto-inject active workspace ID for all other tools if not already set
    if (!callParams.workspaceId && vc.activeWorkspaceId) {
      callParams.workspaceId = vc.activeWorkspaceId;
    }

    const result = await callTool(name, callParams, { wantStream });

    if (!result.ok) {
      return err(id, result.errorCode, result.errorMessage);
    }

    // MCP tools/call response: content array with text
    return ok(id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.result, null, 2),
        },
      ],
      isError: false,
    });
  }

  async function handlePing(id) {
    return ok(id, {});
  }

  // ── Main dispatch ──────────────────────────────────────────────────────────

  /**
   * Handle a single JSON-RPC message (already parsed).
   * Returns a response object or null (for notifications).
   */
  async function handleMessage(msg) {
    // Validate basic JSON-RPC structure
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || !msg.method) {
      return err(msg?.id ?? null, E.INVALID_REQUEST.code, E.INVALID_REQUEST.message);
    }

    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    // Enforce auth on all calls except initialize
    if (method !== 'initialize' && !authOk()) {
      if (isNotification) return null;
      return err(id, E.UNAUTHORIZED.code, E.UNAUTHORIZED.message);
    }

    try {
      switch (method) {
        case 'initialize':
          if (isNotification) return null;
          return await handleInitialize(id, params);

        case 'initialized':
          // Notification — no response
          return null;

        case 'ping':
          if (isNotification) return null;
          return await handlePing(id);

        case 'tools/list':
          if (isNotification) return null;
          return await handleToolsList(id, params);

        case 'tools/call':
          if (isNotification) return null;
          return await handleToolsCall(id, params);

        default:
          if (isNotification) return null;
          return err(id, E.METHOD_NOT_FOUND.code, `Method not found: ${method}`);
      }
    } catch (e) {
      if (isNotification) return null;
      return err(id ?? null, E.INTERNAL_ERROR.code, e.message || 'Internal error');
    }
  }

  return { handleMessage };
}

module.exports = { createMcpServer, MCP_PROTOCOL_VERSION, SERVER_INFO };
