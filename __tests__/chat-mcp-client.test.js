'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { Registry } = require('../server/registry');
const { Scheduler } = require('../server/scheduler');
const { createWsHandler } = require('../server/ws-handler');
const { createMcpServer, MCP_PROTOCOL_VERSION } = require('../server/mcp/mcp-server');
const { mountSseTransport } = require('../server/mcp/sse-transport');
const { McpSseClient } = require('../chat/mcp-client');

function tmpDir() {
  const dir = path.join(os.tmpdir(), `contextfs-mcpclient-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

async function makeServer() {
  const dir = tmpDir();
  const registry = new Registry(dir);
  registry.load();
  const scheduler = new Scheduler(registry);
  const wsHandler = createWsHandler({ registry, scheduler });
  const vc = registry.createVirtualClient({ name: 'chat-vc' });

  const app = express();
  app.use(express.json());
  mountSseTransport(app, ({ vcId, vcKey }) => createMcpServer({
    registry, wsHandler,
    virtualClientId: vcId,
    virtualClientApiKey: vcKey,
    insecure: false,
  }));

  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ dir, server, port, vc });
    });
  });
}

function stopServer(ctx) {
  return new Promise(resolve => ctx.server.close(resolve));
}

describe('McpSseClient', () => {
  let ctx;

  beforeEach(async () => { ctx = await makeServer(); });
  afterEach(async () => { await stopServer(ctx); cleanup(ctx.dir); });

  test('connect() opens SSE session and returns sessionId', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    const sessionId = await client.connect();
    expect(sessionId).toMatch(/^[a-f0-9]{24}$/);
    client.disconnect();
  });

  test('connect() fails for wrong server URL', async () => {
    const client = new McpSseClient('http://127.0.0.1:1', { timeoutMs: 500 });
    await expect(client.connect()).rejects.toThrow();
  });

  test('initialize() completes handshake', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    await client.connect();
    const result = await client.initialize();
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe('contextfs');
    client.disconnect();
  });

  test('listTools() returns 14 tool definitions', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    await client.connect();
    await client.initialize();
    const tools = await client.listTools();
    expect(tools).toHaveLength(14);
    expect(tools[0].name).toBeDefined();
    expect(tools[0].description).toBeDefined();
    expect(tools[0].inputSchema).toBeDefined();
    client.disconnect();
  });

  test('callTool() returns error for no WS client (NO_CLIENT)', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    await client.connect();
    await client.initialize();
    // No WS client connected, so dispatch fails
    await expect(client.callTool('contextfs.list', { path: '.' })).rejects.toThrow();
    client.disconnect();
  });

  test('callTool() rejects with invalid params', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    await client.connect();
    await client.initialize();
    // Missing required 'path' param
    await expect(client.callTool('contextfs.read', {})).rejects.toThrow();
    client.disconnect();
  });

  test('callTool() rejects bash_script_once without insecure', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    await client.connect();
    await client.initialize();
    await expect(client.callTool('contextfs.bash_script_once', { script: 'echo hi' })).rejects.toThrow(/insecure/i);
    client.disconnect();
  });

  test('ping() succeeds', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    await client.connect();
    await client.initialize();
    const result = await client.ping();
    expect(result).toEqual({});
    client.disconnect();
  });

  test('multiple sequential requests work correctly', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    await client.connect();
    await client.initialize();

    const tools1 = await client.listTools();
    const tools2 = await client.listTools();
    expect(tools1).toHaveLength(14);
    expect(tools2).toHaveLength(14);

    const ping = await client.ping();
    expect(ping).toEqual({});

    client.disconnect();
  });

  test('disconnect() prevents further requests', async () => {
    const client = new McpSseClient(`http://127.0.0.1:${ctx.port}`, { vcId: ctx.vc.id, vcKey: ctx.vc.apiKey });
    await client.connect();
    await client.initialize();
    client.disconnect();
    await expect(client.listTools()).rejects.toThrow(/not connected/i);
  });
});
