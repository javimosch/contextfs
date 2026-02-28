'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const express = require('express');

const { Registry } = require('../server/registry');
const { Scheduler } = require('../server/scheduler');
const { createWsHandler } = require('../server/ws-handler');
const { MSG } = require('../shared/protocol');

function tmpDir() {
  const dir = path.join(os.tmpdir(), `contextfs-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function startServer(registry, scheduler) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const wsHandler = createWsHandler({ registry, scheduler });

  wss.on('connection', (ws) => {
    wsHandler.handleOpen(ws);
    ws.on('message', (msg) => wsHandler.handleMessage(ws, msg));
    ws.on('close', () => wsHandler.handleClose(ws));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, wss, wsHandler, port });
    });
  });
}

function stopServer({ server, wss }) {
  return new Promise((resolve) => {
    wss.close(() => server.close(resolve));
  });
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    ws.on('message', function handler(raw) {
      const data = JSON.parse(raw.toString());
      if (data.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(data.payload);
      }
    });
  });
}

describe('WS Integration', () => {
  let dir, registry, scheduler, serverCtx;

  beforeEach(async () => {
    dir = tmpDir();
    registry = new Registry(dir);
    registry.load();
    scheduler = new Scheduler(registry);
    serverCtx = await startServer(registry, scheduler);
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    cleanup(dir);
  });

  test('client registers successfully with valid apiKey', async () => {
    const { port, wsHandler } = serverCtx;
    const wscDoc = registry.createWsClient({ name: 'test-node' });

    const ws = await wsConnect(`ws://127.0.0.1:${port}`);
    const resultPromise = waitForMessage(ws, MSG.S_REGISTER_RESULT);

    ws.send(JSON.stringify({
      type: MSG.C_REGISTER,
      payload: { wsClientId: wscDoc.id, apiKey: wscDoc.apiKey, meta: { hostname: 'test' } },
    }));

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.wsClientId).toBe(wscDoc.id);
    expect(registry.isConnected(wscDoc.id)).toBe(true);

    ws.close();
  });

  test('client registration fails with wrong apiKey', async () => {
    const { port } = serverCtx;
    const wscDoc = registry.createWsClient({ name: 'secure-node' });

    const ws = await wsConnect(`ws://127.0.0.1:${port}`);
    const resultPromise = waitForMessage(ws, MSG.S_REGISTER_RESULT);

    ws.send(JSON.stringify({
      type: MSG.C_REGISTER,
      payload: { wsClientId: wscDoc.id, apiKey: 'wrong-key', meta: {} },
    }));

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid api key/i);

    ws.close();
  });

  test('client registration fails for unknown wsClientId', async () => {
    const { port } = serverCtx;

    const ws = await wsConnect(`ws://127.0.0.1:${port}`);
    const resultPromise = waitForMessage(ws, MSG.S_REGISTER_RESULT);

    ws.send(JSON.stringify({
      type: MSG.C_REGISTER,
      payload: { wsClientId: 'unknown-id', apiKey: 'any-key', meta: {} },
    }));

    const result = await resultPromise;
    expect(result.success).toBe(false);

    ws.close();
  });

  test('heartbeat updates last heartbeat timestamp', async () => {
    const { port } = serverCtx;
    const wscDoc = registry.createWsClient({ name: 'hb-node' });

    const ws = await wsConnect(`ws://127.0.0.1:${port}`);
    const regPromise = waitForMessage(ws, MSG.S_REGISTER_RESULT);

    ws.send(JSON.stringify({
      type: MSG.C_REGISTER,
      payload: { wsClientId: wscDoc.id, apiKey: wscDoc.apiKey, meta: { hostname: 'hb-node' } },
    }));
    await regPromise;

    ws.send(JSON.stringify({
      type: MSG.C_HEARTBEAT,
      payload: {
        wsClientId: wscDoc.id,
        capability: { cpuLoad: [0.5, 0.3, 0.2], freeMemMb: 800, totalMemMb: 1024, cpuCount: 4 },
      },
    }));

    // Give server a moment to process
    await new Promise(r => setTimeout(r, 100));

    const updated = registry.getWsClient(wscDoc.id);
    expect(updated.lastHeartbeat).toBeTruthy();
    expect(updated.capability.freeMemMb).toBe(800);

    ws.close();
  });

  test('disconnect marks client offline and releases VC assignments', async () => {
    const { port } = serverCtx;
    const wscDoc = registry.createWsClient({ name: 'disc-node' });
    const vc = registry.createVirtualClient({ name: 'vc' });

    const ws = await wsConnect(`ws://127.0.0.1:${port}`);
    const regPromise = waitForMessage(ws, MSG.S_REGISTER_RESULT);

    ws.send(JSON.stringify({
      type: MSG.C_REGISTER,
      payload: { wsClientId: wscDoc.id, apiKey: wscDoc.apiKey, meta: {} },
    }));
    await regPromise;

    // Assign VC to this WS client
    registry.setConnected(wscDoc.id, true);
    scheduler.assign(vc.id); // will assign to wscDoc since it's the only connected one
    expect(registry.getVirtualClient(vc.id).assignedWsClientId).toBe(wscDoc.id);

    // Disconnect
    ws.close();
    await new Promise(r => setTimeout(r, 200));

    expect(registry.isConnected(wscDoc.id)).toBe(false);
    expect(registry.getVirtualClient(vc.id).assignedWsClientId).toBeNull();
  });

  test('dispatch sends S_REQUEST to connected WS client', async () => {
    const { port, wsHandler } = serverCtx;
    const wscDoc = registry.createWsClient({ name: 'dispatch-node' });
    const vc = registry.createVirtualClient({ name: 'vc-dispatch' });

    const ws = await wsConnect(`ws://127.0.0.1:${port}`);
    const regPromise = waitForMessage(ws, MSG.S_REGISTER_RESULT);

    ws.send(JSON.stringify({
      type: MSG.C_REGISTER,
      payload: { wsClientId: wscDoc.id, apiKey: wscDoc.apiKey, meta: {} },
    }));
    await regPromise;

    // Assign VC
    registry.assignVirtualClientToWs(vc.id, wscDoc.id);

    // Expect an S_REQUEST to arrive
    const requestPromise = waitForMessage(ws, MSG.S_REQUEST);

    const result = wsHandler.dispatch({
      virtualClientId: vc.id,
      requestId: 'req-test-001',
      tool: 'contextfs.list',
      params: { path: '.' },
      timeoutMs: 5000,
    });

    expect(result.dispatched).toBe(true);
    const req = await requestPromise;
    expect(req.requestId).toBe('req-test-001');
    expect(req.tool).toBe('contextfs.list');

    ws.close();
  });
});
