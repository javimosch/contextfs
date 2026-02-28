'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createLocalAdapter, createLocalOnlyRegistry, createLocalOnlyScheduler, LOCAL_WS_CLIENT_ID } = require('../server/local-adapter');

function tmpDir() {
  const dir = path.join(os.tmpdir(), `contextfs-local-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function waitForResponse(requestId, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.removeListener('contextfs:response', handler);
      reject(new Error(`Timeout waiting for response: ${requestId}`));
    }, timeoutMs);
    function handler(evt) {
      if (evt.requestId === requestId) {
        clearTimeout(timer);
        process.removeListener('contextfs:response', handler);
        resolve(evt);
      }
    }
    process.on('contextfs:response', handler);
  });
}

// ── createLocalOnlyRegistry ───────────────────────────────────────────────────
describe('createLocalOnlyRegistry', () => {
  let dir, registry;

  beforeEach(() => {
    dir = tmpDir();
    registry = createLocalOnlyRegistry(dir);
  });
  afterEach(() => cleanup(dir));

  test('listWsClients returns synthetic local WS client', () => {
    const clients = registry.listWsClients();
    expect(clients).toHaveLength(1);
    expect(clients[0].id).toBe(LOCAL_WS_CLIENT_ID);
    expect(clients[0].status).toBe('online');
  });

  test('getWsClient("local") returns synthetic client', () => {
    const c = registry.getWsClient(LOCAL_WS_CLIENT_ID);
    expect(c).not.toBeNull();
    expect(c.id).toBe(LOCAL_WS_CLIENT_ID);
  });

  test('getWsClient with unknown id returns null', () => {
    expect(registry.getWsClient('nonexistent')).toBeNull();
  });

  test('isConnected returns true for local', () => {
    expect(registry.isConnected(LOCAL_WS_CLIENT_ID)).toBe(true);
  });

  test('listConnectedWsClientIds returns ["local"]', () => {
    expect(registry.listConnectedWsClientIds()).toEqual([LOCAL_WS_CLIENT_ID]);
  });

  test('virtual client CRUD still works normally', () => {
    const vc = registry.createVirtualClient({ name: 'test-vc' });
    expect(vc.id).toBeTruthy();
    expect(registry.getVirtualClient(vc.id)).not.toBeNull();
    registry.deleteVirtualClient(vc.id);
    expect(registry.getVirtualClient(vc.id)).toBeNull();
  });

  test('workspace CRUD still works normally', () => {
    const vc = registry.createVirtualClient({ name: 'ws-owner' });
    const ws = registry.createWorkspace({ virtualClientId: vc.id, name: 'my-ws' });
    expect(ws.id).toBeTruthy();
    expect(registry.listWorkspaces(vc.id)).toHaveLength(1);
    registry.deleteWorkspace(ws.id);
    expect(registry.listWorkspaces(vc.id)).toHaveLength(0);
  });
});

// ── createLocalOnlyScheduler ──────────────────────────────────────────────────
describe('createLocalOnlyScheduler', () => {
  let dir, registry, scheduler;

  beforeEach(() => {
    dir = tmpDir();
    registry = createLocalOnlyRegistry(dir);
    scheduler = createLocalOnlyScheduler(registry);
  });
  afterEach(() => cleanup(dir));

  test('assign always returns LOCAL_WS_CLIENT_ID', () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    expect(scheduler.assign(vc.id)).toBe(LOCAL_WS_CLIENT_ID);
  });

  test('assign returns null for unknown VC', () => {
    expect(scheduler.assign('nonexistent')).toBeNull();
  });

  test('getAssignment always returns LOCAL_WS_CLIENT_ID', () => {
    expect(scheduler.getAssignment('any-vc')).toBe(LOCAL_WS_CLIENT_ID);
  });

  test('releaseAssignmentsFor returns empty array (no-op)', () => {
    expect(scheduler.releaseAssignmentsFor('any-id')).toEqual([]);
  });

  test('assigns VC to local in registry', () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    scheduler.assign(vc.id);
    expect(registry.getVirtualClient(vc.id).assignedWsClientId).toBe(LOCAL_WS_CLIENT_ID);
  });
});

// ── createLocalAdapter — dispatch ─────────────────────────────────────────────
describe('createLocalAdapter — dispatch', () => {
  let dir, wsRoot, registry, scheduler, adapter;

  beforeEach(() => {
    dir = tmpDir();
    wsRoot = path.join(dir, 'workspaces');
    fs.mkdirSync(wsRoot, { recursive: true });
    registry = createLocalOnlyRegistry(dir);
    scheduler = createLocalOnlyScheduler(registry);
    adapter = createLocalAdapter({ workspaceRoot: wsRoot, insecure: false, registry, scheduler });
  });
  afterEach(() => cleanup(dir));

  test('dispatch returns { dispatched: true, wsClientId: "local" }', () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const result = adapter.dispatch({
      virtualClientId: vc.id,
      requestId: 'req-001',
      tool: 'contextfs.list',
      params: { path: '.' },
    });
    expect(result.dispatched).toBe(true);
    expect(result.wsClientId).toBe(LOCAL_WS_CLIENT_ID);
  });

  test('dispatch returns error for unknown VC', () => {
    const result = adapter.dispatch({
      virtualClientId: 'nonexistent',
      requestId: 'req-002',
      tool: 'contextfs.list',
      params: {},
    });
    expect(result.dispatched).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  test('contextfs.list emits contextfs:response with ok status', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const responsePromise = waitForResponse('req-list');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-list', tool: 'contextfs.list', params: { path: '.' } });
    const evt = await responsePromise;
    expect(evt.status).toBe('ok');
    expect(evt.result.entries).toBeDefined();
    expect(Array.isArray(evt.result.entries)).toBe(true);
  });

  test('contextfs.write then contextfs.read roundtrip', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });

    // Write
    const writePromise = waitForResponse('req-write');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-write', tool: 'contextfs.write', params: { path: 'hello.txt', content: 'Hello, local!' } });
    const writeEvt = await writePromise;
    expect(writeEvt.status).toBe('ok');

    // Read
    const readPromise = waitForResponse('req-read');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-read', tool: 'contextfs.read', params: { path: 'hello.txt' } });
    const readEvt = await readPromise;
    expect(readEvt.status).toBe('ok');
    expect(readEvt.result.content).toBe('Hello, local!');
  });

  test('contextfs.read emits error for missing file', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const responsePromise = waitForResponse('req-missing');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-missing', tool: 'contextfs.read', params: { path: 'nonexistent.txt' } });
    const evt = await responsePromise;
    expect(evt.status).toBe('error');
    expect(evt.error).toMatch(/not found/i);
  });

  test('bash_script_once blocked when insecure=false', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const responsePromise = waitForResponse('req-bash');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-bash', tool: 'contextfs.bash_script_once', params: { script: 'echo hi' } });
    const evt = await responsePromise;
    expect(evt.status).toBe('error');
    expect(evt.error).toMatch(/insecure/i);
  });

  test('bash_script_once allowed when insecure=true', async () => {
    const insecureAdapter = createLocalAdapter({ workspaceRoot: wsRoot, insecure: true, registry, scheduler });
    const vc = registry.createVirtualClient({ name: 'vc' });
    const responsePromise = waitForResponse('req-bash-ok');
    insecureAdapter.dispatch({ virtualClientId: vc.id, requestId: 'req-bash-ok', tool: 'contextfs.bash_script_once', params: { script: 'echo hello_local' } });
    const evt = await responsePromise;
    expect(evt.status).toBe('ok');
    expect(evt.result.stdout.trim()).toBe('hello_local');
  });

  test('unknown tool emits error', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const responsePromise = waitForResponse('req-unknown');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-unknown', tool: 'contextfs.nonexistent', params: {} });
    const evt = await responsePromise;
    expect(evt.status).toBe('error');
  });

  test('contextfs.save_skill and list_skills roundtrip', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });

    const savePromise = waitForResponse('req-save-skill');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-save-skill', tool: 'contextfs.save_skill',
      params: { name: 'my-skill', content: '# My Skill\nDo things.', description: 'test skill', tags: ['test'] } });
    const saveEvt = await savePromise;
    expect(saveEvt.status).toBe('ok');

    const listPromise = waitForResponse('req-list-skills');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-list-skills', tool: 'contextfs.list_skills', params: {} });
    const listEvt = await listPromise;
    expect(listEvt.status).toBe('ok');
    expect(listEvt.result.skills.some(s => s.name === 'my-skill')).toBe(true);
  });

  test('contextfs.save_memory and search_memory roundtrip', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });

    const savePromise = waitForResponse('req-save-mem');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-save-mem', tool: 'contextfs.save_memory',
      params: { title: 'Important note', content: 'Remember to test the local adapter carefully', importance: 'high' } });
    await savePromise;

    const searchPromise = waitForResponse('req-search-mem');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-search-mem', tool: 'contextfs.search_memory',
      params: { query: 'local adapter' } });
    const searchEvt = await searchPromise;
    expect(searchEvt.status).toBe('ok');
    expect(searchEvt.result.matches.length).toBeGreaterThan(0);
  });

  test('stub methods (handleOpen, handleClose, handleMessage) do not throw', () => {
    expect(() => adapter.handleOpen()).not.toThrow();
    expect(() => adapter.handleClose()).not.toThrow();
    expect(() => adapter.handleMessage()).not.toThrow();
    expect(() => adapter.sendToWsClient()).not.toThrow();
  });

  test('connections map is always empty', () => {
    expect(adapter.connections.size).toBe(0);
  });
});

// ── MCP server integration with local adapter ─────────────────────────────────
describe('MCP server + local adapter integration', () => {
  let dir, wsRoot, registry, scheduler, adapter;

  beforeEach(() => {
    dir = tmpDir();
    wsRoot = path.join(dir, 'workspaces');
    fs.mkdirSync(wsRoot, { recursive: true });
    registry = createLocalOnlyRegistry(dir);
    scheduler = createLocalOnlyScheduler(registry);
    adapter = createLocalAdapter({ workspaceRoot: wsRoot, insecure: false, registry, scheduler });
  });
  afterEach(() => cleanup(dir));

  test('MCP tools/call contextfs.list resolves via local adapter', async () => {
    const { createMcpServer } = require('../server/mcp/mcp-server');
    const vc = registry.createVirtualClient({ name: 'mcp-vc' });

    const mcp = createMcpServer({
      registry,
      wsHandler: adapter,
      virtualClientId: vc.id,
      virtualClientApiKey: vc.apiKey,
      insecure: false,
    });

    const res = await mcp.handleMessage({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'contextfs.list', arguments: { path: '.' } },
    });

    expect(res.result).toBeDefined();
    expect(res.result.isError).toBe(false);
    const parsed = JSON.parse(res.result.content[0].text);
    expect(parsed.entries).toBeDefined();
  });

  test('MCP tools/call contextfs.write + read roundtrip via local adapter', async () => {
    const { createMcpServer } = require('../server/mcp/mcp-server');
    const vc = registry.createVirtualClient({ name: 'mcp-rw-vc' });

    const mcp = createMcpServer({
      registry, wsHandler: adapter,
      virtualClientId: vc.id, virtualClientApiKey: vc.apiKey, insecure: false,
    });

    await mcp.handleMessage({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'contextfs.write', arguments: { path: 'test.txt', content: 'local mode works!' } },
    });

    const readRes = await mcp.handleMessage({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'contextfs.read', arguments: { path: 'test.txt' } },
    });

    const content = JSON.parse(readRes.result.content[0].text).content;
    expect(content).toBe('local mode works!');
  });
});
