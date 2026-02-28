'use strict';

const os = require('os');
const WebSocket = require('ws');
const { logVerbose, safeJsonParse } = require('./utils');
const { MSG } = require('../shared/protocol');

const HEARTBEAT_INTERVAL_MS = 10000;
const RECONNECT_DELAY_MS = 10000;

/**
 * createWsClient — manages the WebSocket connection lifecycle.
 * Handles connect, auto-reconnect, heartbeat with capability snapshot,
 * and message routing to the message handler.
 */
function createWsClient({
  wsUrl,
  wsClientId,
  apiKey,
  clientMeta,
  onMessage,
  processExit,
}) {
  let ws = null;
  let heartbeatTimer = null;
  let isRegistered = false;
  let isExiting = false;
  let hasEverConnected = false;

  function log(msg) {
    process.stdout.write(`${new Date().toISOString()} [WsClient] ${msg}\n`);
  }

  function send(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type, payload }));
      } catch (_) {}
    }
  }

  function getCapabilitySnapshot() {
    const cpuLoad = os.loadavg();            // [1m, 5m, 15m]
    const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
    const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
    const cpuCount = os.cpus().length;
    return { cpuLoad, totalMemMb, freeMemMb, cpuCount, vcCount: 0, wsCount: 0 };
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      const capability = getCapabilitySnapshot();
      logVerbose(`[WsClient] Heartbeat: cpu=${capability.cpuLoad[0].toFixed(2)} freeMem=${capability.freeMemMb}MB`);
      send(MSG.C_HEARTBEAT, { wsClientId, capability });
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function scheduleReconnect() {
    if (isExiting) return;
    setTimeout(connect, RECONNECT_DELAY_MS);
  }

  function onRegistered(payload) {
    if (!hasEverConnected) {
      log(`Registered successfully. wsClientId=${payload.wsClientId}`);
      hasEverConnected = true;
    } else {
      log('Reconnected and re-registered.');
    }
    isRegistered = true;
    startHeartbeat();
  }

  function connect() {
    if (isExiting) return;
    log(`Connecting to ${wsUrl}...`);

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      log(`Failed to create WebSocket: ${err.message}`);
      scheduleReconnect();
      return;
    }

    ws.on('open', () => {
      log(`Connected. Registering wsClientId=${wsClientId}...`);
      const capability = getCapabilitySnapshot();
      send(MSG.C_REGISTER, {
        wsClientId,
        apiKey,
        meta: { ...clientMeta, capability },
      });
    });

    ws.on('message', (rawMsg) => {
      if (global._contextfsVerbose) {
        const data = safeJsonParse(rawMsg.toString());
        logVerbose(`[WS-IN] type=${data?.type || 'unknown'} size=${rawMsg.toString().length}`);
      }
      onMessage(rawMsg.toString(), { send, onRegistered, processExit });
    });

    ws.on('close', () => {
      isRegistered = false;
      stopHeartbeat();
      if (isExiting) return;
      if (hasEverConnected) log('Connection lost. Reconnecting in 10s...');
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      logVerbose(`[WsClient] Socket error: ${err.message}`);
      stopHeartbeat();
    });
  }

  function disconnect() {
    isExiting = true;
    stopHeartbeat();
    if (ws) { try { ws.close(); } catch (_) {} }
  }

  return { connect, disconnect, send };
}

module.exports = { createWsClient };
