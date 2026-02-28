'use strict';

const { MSG } = require('../shared/protocol');

/**
 * createWsHandler — returns a handler for incoming WS messages from clients.
 * Manages live ws connection map and dispatches messages to registry/scheduler.
 */
function createWsHandler({ registry, scheduler }) {
  // Map<wsClientId, WebSocket>
  const connections = new Map();

  function send(ws, type, payload) {
    try {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({ type, payload }));
      }
    } catch (_) {}
  }

  function sendToWsClient(wsClientId, type, payload) {
    const ws = connections.get(wsClientId);
    if (ws) send(ws, type, payload);
  }

  /**
   * Dispatch a tool request to the WS client assigned to a virtual client.
   * Returns { dispatched: boolean, wsClientId, error? }
   */
  function dispatch({ virtualClientId, requestId, tool, params, timeoutMs }) {
    const wsClientId = scheduler.assign(virtualClientId);
    if (!wsClientId) {
      return { dispatched: false, error: 'No WS client available for virtual client' };
    }
    sendToWsClient(wsClientId, MSG.S_REQUEST, {
      requestId,
      virtualClientId,
      tool,
      params,
      timeoutMs: timeoutMs || 30000,
    });
    return { dispatched: true, wsClientId };
  }

  function handleOpen(ws) {
    // ws is identified after registration
    ws._contextfsClientId = null;
  }

  function handleClose(ws) {
    const id = ws._contextfsClientId;
    if (!id) return;
    connections.delete(id);
    registry.setConnected(id, false);
    // Release virtual client assignments
    const released = scheduler.releaseAssignmentsFor(id);
    if (released.length > 0) {
      console.log(`[WS] Client ${id} disconnected. Released VCs: ${released.join(', ')}`);
    } else {
      console.log(`[WS] Client ${id} disconnected.`);
    }
  }

  function handleMessage(ws, rawMsg) {
    let data;
    try {
      data = JSON.parse(rawMsg.toString());
    } catch (_) {
      return;
    }

    const { type, payload } = data || {};
    if (!type || !payload) return;

    switch (type) {
      case MSG.C_REGISTER:
        return _handleRegister(ws, payload);
      case MSG.C_HEARTBEAT:
        return _handleHeartbeat(ws, payload);
      case MSG.C_RESPONSE:
        return _handleResponse(ws, payload);
      case MSG.C_STREAM_CHUNK:
        return _handleStreamChunk(ws, payload);
      default:
        // Unknown type — ignore
    }
  }

  // ── Private handlers ──────────────────────────────────────────────────────

  function _handleRegister(ws, payload) {
    const { wsClientId, apiKey, meta } = payload || {};

    if (!wsClientId || !apiKey) {
      send(ws, MSG.S_REGISTER_RESULT, { success: false, error: 'Missing wsClientId or apiKey' });
      return;
    }

    if (!registry.getWsClient(wsClientId)) {
      send(ws, MSG.S_REGISTER_RESULT, { success: false, error: 'Unknown wsClientId' });
      return;
    }

    if (!registry.validateWsClientApiKey(wsClientId, apiKey)) {
      send(ws, MSG.S_REGISTER_RESULT, { success: false, error: 'Invalid API key' });
      return;
    }

    ws._contextfsClientId = wsClientId;
    connections.set(wsClientId, ws);
    registry.setConnected(wsClientId, true);
    registry.updateWsClientHeartbeat(wsClientId, meta?.capability || null);

    console.log(`[WS] Client registered: ${wsClientId} (${meta?.hostname || 'unknown'})`);
    send(ws, MSG.S_REGISTER_RESULT, { success: true, wsClientId });

    // Notify about existing VC assignments for this WS client
    const vcs = registry.listVirtualClients().filter(
      vc => vc.assignedWsClientId === wsClientId,
    );
    if (vcs.length > 0) {
      send(ws, MSG.S_ASSIGN_VC, { virtualClients: vcs.map(vc => ({ id: vc.id, name: vc.name })) });
    }
  }

  function _handleHeartbeat(ws, payload) {
    const { wsClientId, capability } = payload || {};
    if (!wsClientId || !ws._contextfsClientId || ws._contextfsClientId !== wsClientId) return;
    registry.updateWsClientHeartbeat(wsClientId, capability || null);
  }

  function _handleResponse(ws, payload) {
    const { requestId, virtualClientId, status, result, error } = payload || {};
    if (!requestId) return;
    // Emit on the global event bus so pending dispatch waiters can resolve
    ws._contextfsClientId && process.emit('contextfs:response', { requestId, virtualClientId, status, result, error });
  }

  function _handleStreamChunk(ws, payload) {
    const { requestId, chunk, stream, seq } = payload || {};
    if (!requestId) return;
    process.emit('contextfs:stream_chunk', { requestId, chunk, stream, seq });
  }

  return { handleOpen, handleClose, handleMessage, dispatch, sendToWsClient, connections };
}

module.exports = { createWsHandler };
