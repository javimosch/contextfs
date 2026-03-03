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

function tmpDir() {
  const dir = path.join(os.tmpdir(), `contextfs-sse-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function makeServer() {
  const dir = tmpDir();
  const registry = new Registry(dir);
  registry.load();
  const scheduler = new Scheduler(registry);
  const wsHandler = createWsHandler({ registry, scheduler });
  const vc = registry.createVirtualClient({ name: 'sse-vc' });

  const app = express();
  app.use(express.json());

  const { sessions } = mountSseTransport(app, ({ vcId, vcKey }) => createMcpServer({
    registry, wsHandler,
    virtualClientId: vcId,
    virtualClientApiKey: vcKey,
    insecure: false,
  }), { verbose: false });

  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ dir, registry, vc, wsHandler, server, app, sessions, port });
    });
  });
}

function stopServer(ctx) {
  return new Promise(resolve => ctx.server.close(resolve));
}

/** Open an SSE connection with VC credentials and return { sessionId, res, closeStream } */
function openSseSession(port, vcId, vcKey) {
  return new Promise((resolve, reject) => {
    const query = vcId && vcKey ? `?vcId=${vcId}&vcKey=${vcKey}` : '';
    const req = http.get(`http://127.0.0.1:${port}/mcp/sse${query}`, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => reject(new Error(`SSE connect failed: HTTP ${res.statusCode} ${body}`)));
        return;
      }
      let buf = '';
      let resolved = false;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        if (!resolved && buf.includes('event: endpoint')) {
          const match = buf.match(/data: (\/mcp\/message\?sessionId=([a-f0-9]+))/);
          if (match) {
            resolved = true;
            resolve({ sessionId: match[2], res, closeStream: () => req.destroy() });
          }
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

/** POST a JSON-RPC message to the session */
function postMessage(port, sessionId, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/mcp/message?sessionId=${sessionId}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Wait for a specific SSE event on an already-open response stream */
function waitForSseMessage(res, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for SSE message')), timeoutMs);
    let buf = '';
    const handler = (chunk) => {
      buf += chunk;
      // Look for a 'message' event
      const match = buf.match(/event: message\ndata: ({.*})\n/);
      if (match) {
        clearTimeout(timer);
        res.removeListener('data', handler);
        try { resolve(JSON.parse(match[1])); } catch (e) { reject(e); }
      }
    };
    res.on('data', handler);
  });
}

describe('SSE Transport', () => {
  let ctx;

  beforeEach(async () => { ctx = await makeServer(); });
  afterEach(async () => { await stopServer(ctx); cleanup(ctx.dir); });

  test('GET /mcp/sse without VC credentials returns 401', async () => {
    const result = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${ctx.port}/mcp/sse`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    });
    expect(result.status).toBe(401);
  });

  test('GET /mcp/sse with wrong VC key returns SSE then tools/list auth error', async () => {
    // Connection succeeds (auth checked by MCP layer), but tools/list will fail
    const { sessionId, res, closeStream } = await openSseSession(ctx.port, ctx.vc.id, 'wrong-key');
    const msgPromise = waitForSseMessage(res);
    await postMessage(ctx.port, sessionId, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const response = await msgPromise;
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32001); // UNAUTHORIZED
    closeStream();
  });

  test('GET /mcp/sse returns SSE headers with valid credentials', async () => {
    const { res, closeStream } = await openSseSession(ctx.port, ctx.vc.id, ctx.vc.apiKey);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    closeStream();
  });

  test('SSE sends endpoint event with sessionId', async () => {
    const { sessionId, closeStream } = await openSseSession(ctx.port, ctx.vc.id, ctx.vc.apiKey);
    expect(sessionId).toMatch(/^[a-f0-9]{24}$/);
    closeStream();
  });

  test('POST /mcp/message without sessionId returns 400', async () => {
    const result = await postMessage(ctx.port, '', { jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(result.status).toBe(400);
  });

  test('POST /mcp/message with unknown sessionId returns 404', async () => {
    const result = await postMessage(ctx.port, 'deaddead00000000deadbeef', {
      jsonrpc: '2.0', id: 1, method: 'ping',
    });
    expect(result.status).toBe(404);
  });

  test('POST /mcp/message returns 202 for valid session', async () => {
    const { sessionId, closeStream } = await openSseSession(ctx.port, ctx.vc.id, ctx.vc.apiKey);
    const result = await postMessage(ctx.port, sessionId, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSION, clientInfo: { name: 'test' } },
    });
    expect(result.status).toBe(202);
    closeStream();
  });

  test('initialize response is delivered via SSE stream', async () => {
    const { sessionId, res, closeStream } = await openSseSession(ctx.port, ctx.vc.id, ctx.vc.apiKey);

    const msgPromise = waitForSseMessage(res);
    await postMessage(ctx.port, sessionId, {
      jsonrpc: '2.0', id: 2, method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSION, clientInfo: { name: 'test' } },
    });

    const response = await msgPromise;
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(2);
    expect(response.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    closeStream();
  });

  test('tools/list response is delivered via SSE stream', async () => {
    const { sessionId, res, closeStream } = await openSseSession(ctx.port, ctx.vc.id, ctx.vc.apiKey);

    const msgPromise = waitForSseMessage(res);
    await postMessage(ctx.port, sessionId, {
      jsonrpc: '2.0', id: 3, method: 'tools/list',
    });

    const response = await msgPromise;
    expect(response.result.tools).toHaveLength(14);
    closeStream();
  });

  test('notification (initialized) produces no SSE message', async () => {
    const { sessionId, res, closeStream } = await openSseSession(ctx.port, ctx.vc.id, ctx.vc.apiKey);

    await postMessage(ctx.port, sessionId, { jsonrpc: '2.0', method: 'initialized' });

    const noMessage = await Promise.race([
      waitForSseMessage(res, 300).then(() => false).catch(() => true),
      new Promise(r => setTimeout(() => r(true), 350)),
    ]);
    expect(noMessage).toBe(true);
    closeStream();
  });

  test('GET /mcp/sessions lists active sessions with vcId', async () => {
    const { sessionId, closeStream } = await openSseSession(ctx.port, ctx.vc.id, ctx.vc.apiKey);

    const result = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${ctx.port}/mcp/sessions`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    expect(result.ok).toBe(true);
    const session = result.sessions.find(s => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session.vcId).toBe(ctx.vc.id);
    closeStream();
  });

  test('POST /mcp/message with malformed JSON returns 400', async () => {
    const { sessionId, closeStream } = await openSseSession(ctx.port, ctx.vc.id, ctx.vc.apiKey);

    // Send raw malformed JSON directly (bypass postMessage helper which always serializes)
    const result = await new Promise((resolve, reject) => {
      const payload = '{invalid-json';
      const req = http.request({
        hostname: '127.0.0.1',
        port: ctx.port,
        path: `/mcp/message?sessionId=${sessionId}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch (_) { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    // Express body-parser returns 400 for invalid JSON
    expect(result.status).toBe(400);
    closeStream();
  });
});
