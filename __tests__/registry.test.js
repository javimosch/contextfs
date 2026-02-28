'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Registry } = require('../server/registry');

function tmpDir() {
  const dir = path.join(os.tmpdir(), `contextfs-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('Registry — WS Clients', () => {
  let dir, registry;

  beforeEach(() => {
    dir = tmpDir();
    registry = new Registry(dir);
    registry.load();
  });

  afterEach(() => cleanup(dir));

  test('createWsClient generates id and apiKey', () => {
    const doc = registry.createWsClient({ name: 'test-node' });
    expect(doc.id).toBeTruthy();
    expect(doc.apiKey).toMatch(/^cfs_/);
    expect(doc.name).toBe('test-node');
    expect(doc.status).toBe('offline');
  });

  test('getWsClient returns created client', () => {
    const created = registry.createWsClient({ name: 'n1' });
    const found = registry.getWsClient(created.id);
    expect(found.id).toBe(created.id);
  });

  test('listWsClients returns all', () => {
    registry.createWsClient({ name: 'a' });
    registry.createWsClient({ name: 'b' });
    expect(registry.listWsClients()).toHaveLength(2);
  });

  test('validateWsClientApiKey works', () => {
    const doc = registry.createWsClient({ name: 'secure' });
    expect(registry.validateWsClientApiKey(doc.id, doc.apiKey)).toBe(true);
    expect(registry.validateWsClientApiKey(doc.id, 'wrong-key')).toBe(false);
  });

  test('regenWsClientApiKey changes the key', () => {
    const doc = registry.createWsClient({ name: 'regen' });
    const oldKey = doc.apiKey;
    const updated = registry.regenWsClientApiKey(doc.id);
    expect(updated.apiKey).not.toBe(oldKey);
    expect(updated.apiKey).toMatch(/^cfs_/);
  });

  test('updateWsClientHeartbeat sets status to online', () => {
    const doc = registry.createWsClient({ name: 'hb' });
    registry.updateWsClientHeartbeat(doc.id, { cpuLoad: [0.1, 0.2, 0.3], freeMemMb: 512, totalMemMb: 1024 });
    const updated = registry.getWsClient(doc.id);
    expect(updated.status).toBe('online');
    expect(updated.lastHeartbeat).toBeTruthy();
    expect(updated.capability.freeMemMb).toBe(512);
  });

  test('deleteWsClient removes the client', () => {
    const doc = registry.createWsClient({ name: 'del' });
    expect(registry.deleteWsClient(doc.id)).toBe(true);
    expect(registry.getWsClient(doc.id)).toBeNull();
  });

  test('setConnected / isConnected tracking', () => {
    const doc = registry.createWsClient({ name: 'live' });
    expect(registry.isConnected(doc.id)).toBe(false);
    registry.setConnected(doc.id, true);
    expect(registry.isConnected(doc.id)).toBe(true);
    registry.setConnected(doc.id, false);
    expect(registry.isConnected(doc.id)).toBe(false);
  });
});

describe('Registry — Virtual Clients', () => {
  let dir, registry;

  beforeEach(() => {
    dir = tmpDir();
    registry = new Registry(dir);
    registry.load();
  });

  afterEach(() => cleanup(dir));

  test('createVirtualClient generates id and apiKey', () => {
    const doc = registry.createVirtualClient({ name: 'agent-1' });
    expect(doc.id).toBeTruthy();
    expect(doc.apiKey).toMatch(/^cfs_/);
    expect(doc.name).toBe('agent-1');
    expect(doc.status).toBe('idle');
    expect(doc.assignedWsClientId).toBeNull();
  });

  test('assignVirtualClientToWs updates assignment', () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const wsc = registry.createWsClient({ name: 'wsc' });
    registry.assignVirtualClientToWs(vc.id, wsc.id);
    const updated = registry.getVirtualClient(vc.id);
    expect(updated.assignedWsClientId).toBe(wsc.id);
    expect(updated.status).toBe('assigned');
  });

  test('deleteVirtualClient also deletes owned workspaces', () => {
    const vc = registry.createVirtualClient({ name: 'vc-del' });
    registry.createWorkspace({ virtualClientId: vc.id, name: 'ws1' });
    registry.createWorkspace({ virtualClientId: vc.id, name: 'ws2' });
    registry.deleteVirtualClient(vc.id);
    expect(registry.listWorkspaces(vc.id)).toHaveLength(0);
  });

  test('validateVirtualClientApiKey works', () => {
    const doc = registry.createVirtualClient({ name: 'vc-auth' });
    expect(registry.validateVirtualClientApiKey(doc.id, doc.apiKey)).toBe(true);
    expect(registry.validateVirtualClientApiKey(doc.id, 'bad')).toBe(false);
  });
});

describe('Registry — Workspaces', () => {
  let dir, registry;

  beforeEach(() => {
    dir = tmpDir();
    registry = new Registry(dir);
    registry.load();
  });

  afterEach(() => cleanup(dir));

  test('createWorkspace returns doc with rootPath', () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const ws = registry.createWorkspace({ virtualClientId: vc.id, name: 'my-workspace' });
    expect(ws.id).toBeTruthy();
    expect(ws.virtualClientId).toBe(vc.id);
    expect(ws.rootPath).toContain(vc.id);
    expect(ws.name).toBe('my-workspace');
  });

  test('listWorkspaces filters by virtualClientId', () => {
    const vc1 = registry.createVirtualClient({ name: 'vc1' });
    const vc2 = registry.createVirtualClient({ name: 'vc2' });
    registry.createWorkspace({ virtualClientId: vc1.id, name: 'ws-a' });
    registry.createWorkspace({ virtualClientId: vc1.id, name: 'ws-b' });
    registry.createWorkspace({ virtualClientId: vc2.id, name: 'ws-c' });
    expect(registry.listWorkspaces(vc1.id)).toHaveLength(2);
    expect(registry.listWorkspaces(vc2.id)).toHaveLength(1);
  });

  test('createWorkspace throws for unknown virtualClientId', () => {
    expect(() => registry.createWorkspace({ virtualClientId: 'nonexistent' })).toThrow();
  });

  test('deleteWorkspace removes it', () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const ws = registry.createWorkspace({ virtualClientId: vc.id, name: 'del-ws' });
    expect(registry.deleteWorkspace(ws.id)).toBe(true);
    expect(registry.getWorkspace(ws.id)).toBeNull();
  });
});
