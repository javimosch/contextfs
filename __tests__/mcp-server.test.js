'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Registry } = require('../server/registry');
const { Scheduler } = require('../server/scheduler');
const { createWsHandler } = require('../server/ws-handler');
const { createMcpServer, MCP_PROTOCOL_VERSION } = require('../server/mcp/mcp-server');
const { getAllTools } = require('../server/mcp/mcp-tools');

function tmpDir() {
  const dir = path.join(os.tmpdir(), `contextfs-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeSetup() {
  const dir = tmpDir();
  const registry = new Registry(dir);
  registry.load();
  const scheduler = new Scheduler(registry);
  const wsHandler = createWsHandler({ registry, scheduler });
  const vc = registry.createVirtualClient({ name: 'mcp-test-vc' });
  const mcp = createMcpServer({
    registry,
    wsHandler,
    virtualClientId: vc.id,
    virtualClientApiKey: vc.apiKey,
    insecure: false,
  });
  return { dir, registry, scheduler, wsHandler, vc, mcp };
}

// ── initialize ────────────────────────────────────────────────────────────────
describe('MCP initialize', () => {
  let ctx;
  afterEach(() => cleanup(ctx.dir));

  test('responds with protocolVersion and capabilities', async () => {
    ctx = makeSetup();
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSION, clientInfo: { name: 'test' } },
    });
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.serverInfo.name).toBe('contextfs');
  });

  test('initialize does not require auth', async () => {
    const dir = tmpDir();
    const registry = new Registry(dir);
    registry.load();
    const scheduler = new Scheduler(registry);
    const wsHandler = createWsHandler({ registry, scheduler });
    const mcp = createMcpServer({
      registry, wsHandler,
      virtualClientId: 'nonexistent',
      virtualClientApiKey: 'bad-key',
      insecure: false,
    });
    const res = await mcp.handleMessage({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
    });
    expect(res.result.serverInfo).toBeDefined();
    cleanup(dir);
  });
});

// ── initialized notification ──────────────────────────────────────────────────
describe('MCP initialized notification', () => {
  let ctx;
  afterEach(() => cleanup(ctx.dir));

  test('returns null (no response for notifications)', async () => {
    ctx = makeSetup();
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', method: 'initialized',
    });
    expect(res).toBeNull();
  });
});

// ── ping ──────────────────────────────────────────────────────────────────────
describe('MCP ping', () => {
  let ctx;
  afterEach(() => cleanup(ctx.dir));

  test('responds with empty result', async () => {
    ctx = makeSetup();
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 2, method: 'ping',
    });
    expect(res.result).toEqual({});
  });
});

// ── tools/list ────────────────────────────────────────────────────────────────
describe('MCP tools/list', () => {
  let ctx;
  afterEach(() => cleanup(ctx.dir));

  test('returns all 10 tool definitions', async () => {
    ctx = makeSetup();
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 3, method: 'tools/list',
    });
    expect(res.result.tools).toHaveLength(10);
    const names = res.result.tools.map(t => t.name);
    expect(names).toContain('contextfs.list');
    expect(names).toContain('contextfs.read');
    expect(names).toContain('contextfs.write');
    expect(names).toContain('contextfs.bash_script_once');
  });

  test('each tool has name, description, inputSchema', async () => {
    ctx = makeSetup();
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 4, method: 'tools/list',
    });
    for (const tool of res.result.tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('requires auth (fails with wrong vc key)', async () => {
    const dir = tmpDir();
    const registry = new Registry(dir);
    registry.load();
    const scheduler = new Scheduler(registry);
    const wsHandler = createWsHandler({ registry, scheduler });
    const vc = registry.createVirtualClient({ name: 'vc' });
    const mcp = createMcpServer({
      registry, wsHandler,
      virtualClientId: vc.id,
      virtualClientApiKey: 'wrong-key',
      insecure: false,
    });
    const res = await mcp.handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32001); // UNAUTHORIZED
    cleanup(dir);
  });
});

// ── tools/call — parameter validation ────────────────────────────────────────
describe('MCP tools/call — parameter validation', () => {
  let ctx;
  beforeEach(() => { ctx = makeSetup(); });
  afterEach(() => cleanup(ctx.dir));

  test('rejects unknown tool name', async () => {
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'contextfs.nonexistent', arguments: {} },
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32601); // METHOD_NOT_FOUND
  });

  test('rejects missing required parameter', async () => {
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 11, method: 'tools/call',
      params: { name: 'contextfs.read', arguments: {} }, // missing path
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32602); // INVALID_PARAMS
    expect(res.error.message).toMatch(/path/);
  });

  test('rejects unknown parameter', async () => {
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 12, method: 'tools/call',
      params: { name: 'contextfs.list', arguments: { unknown_field: true } },
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32602);
  });

  test('rejects bash_script_once when insecure=false', async () => {
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 13, method: 'tools/call',
      params: { name: 'contextfs.bash_script_once', arguments: { script: 'echo hi' } },
    });
    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/insecure/i);
  });

  test('missing method returns method not found', async () => {
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 14, method: 'unknown/method',
    });
    expect(res.error.code).toBe(-32601);
  });

  test('invalid JSON-RPC structure returns invalid request', async () => {
    const res = await ctx.mcp.handleMessage({ something: 'wrong' });
    expect(res.error.code).toBe(-32600);
  });

  test('missing tool name in tools/call returns invalid params', async () => {
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 15, method: 'tools/call',
      params: {},
    });
    expect(res.error.code).toBe(-32602);
  });
});

// ── tools/call — dispatch with mock wsHandler ─────────────────────────────────
describe('MCP tools/call — dispatch', () => {
  let ctx;
  beforeEach(() => { ctx = makeSetup(); });
  afterEach(() => cleanup(ctx.dir));

  test('dispatch returns NO_CLIENT error when no WS client assigned', async () => {
    // No WS clients connected, so dispatch will fail
    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 20, method: 'tools/call',
      params: { name: 'contextfs.list', arguments: { path: '.' } },
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32003); // NO_CLIENT
  });

  test('dispatch succeeds when WS client responds via process event', async () => {
    // Mock: intercept dispatch by emitting contextfs:response immediately
    const originalDispatch = ctx.wsHandler.dispatch;
    ctx.wsHandler.dispatch = ({ requestId, virtualClientId }) => {
      // Emit response asynchronously
      setImmediate(() => {
        process.emit('contextfs:response', {
          requestId,
          virtualClientId,
          status: 'ok',
          result: { entries: [{ name: 'file.txt', type: 'file' }] },
        });
      });
      return { dispatched: true, wsClientId: 'mock-wsc' };
    };

    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 21, method: 'tools/call',
      params: { name: 'contextfs.list', arguments: { path: '.' } },
    });

    ctx.wsHandler.dispatch = originalDispatch;

    expect(res.result).toBeDefined();
    expect(res.result.isError).toBe(false);
    const parsed = JSON.parse(res.result.content[0].text);
    expect(parsed.entries).toHaveLength(1);
  });

  test('dispatch propagates tool error', async () => {
    const originalDispatch = ctx.wsHandler.dispatch;
    ctx.wsHandler.dispatch = ({ requestId, virtualClientId }) => {
      setImmediate(() => {
        process.emit('contextfs:response', {
          requestId,
          virtualClientId,
          status: 'error',
          error: 'File not found',
        });
      });
      return { dispatched: true, wsClientId: 'mock-wsc' };
    };

    const res = await ctx.mcp.handleMessage({
      jsonrpc: '2.0', id: 22, method: 'tools/call',
      params: { name: 'contextfs.read', arguments: { path: 'nonexistent.md' } },
    });

    ctx.wsHandler.dispatch = originalDispatch;
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32002); // TOOL_ERROR
    expect(res.error.message).toMatch(/File not found/);
  });
});

// ── mcp-tools definitions ─────────────────────────────────────────────────────
describe('mcp-tools definitions', () => {
  test('getAllTools returns 10 tools', () => {
    const tools = getAllTools();
    expect(tools).toHaveLength(10);
  });

  test('all tools have required MCP fields', () => {
    for (const tool of getAllTools()) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.startsWith('contextfs.')).toBe(true);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});
