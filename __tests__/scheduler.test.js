'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Registry } = require('../server/registry');
const { Scheduler } = require('../server/scheduler');

function tmpDir() {
  const dir = path.join(os.tmpdir(), `contextfs-sched-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeConnectedWsClient(registry, name, capability = {}) {
  const doc = registry.createWsClient({ name });
  const cap = { cpuLoad: [0, 0, 0], freeMemMb: 512, totalMemMb: 1024, cpuCount: 4, vcCount: 0, ...capability };
  registry.updateWsClientHeartbeat(doc.id, cap);
  registry.setConnected(doc.id, true);
  return doc;
}

describe('Scheduler', () => {
  let dir, registry, scheduler;

  beforeEach(() => {
    dir = tmpDir();
    registry = new Registry(dir);
    registry.load();
    scheduler = new Scheduler(registry);
  });

  afterEach(() => cleanup(dir));

  test('assign returns null when no WS clients connected', () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    expect(scheduler.assign(vc.id)).toBeNull();
  });

  test('assign returns null for unknown virtual client', () => {
    expect(scheduler.assign('nonexistent')).toBeNull();
  });

  test('assign picks the only connected WS client', () => {
    const wsc = makeConnectedWsClient(registry, 'node-1');
    const vc = registry.createVirtualClient({ name: 'vc' });
    const assigned = scheduler.assign(vc.id);
    expect(assigned).toBe(wsc.id);
  });

  test('sticky affinity: same WS client returned on second assign', () => {
    makeConnectedWsClient(registry, 'node-1');
    makeConnectedWsClient(registry, 'node-2');
    const vc = registry.createVirtualClient({ name: 'vc' });
    const first = scheduler.assign(vc.id);
    const second = scheduler.assign(vc.id);
    expect(second).toBe(first);
  });

  test('assign picks least-loaded WS client', () => {
    // node-1: high cpu load
    const wsc1 = makeConnectedWsClient(registry, 'node-1', { cpuLoad: [3.0, 2.0, 1.5], freeMemMb: 100, totalMemMb: 1024 });
    // node-2: low cpu load
    const wsc2 = makeConnectedWsClient(registry, 'node-2', { cpuLoad: [0.1, 0.1, 0.1], freeMemMb: 900, totalMemMb: 1024 });
    const vc = registry.createVirtualClient({ name: 'vc' });
    const assigned = scheduler.assign(vc.id);
    expect(assigned).toBe(wsc2.id);
  });

  test('releaseAssignmentsFor clears VC assignments when WS client disconnects', () => {
    const wsc = makeConnectedWsClient(registry, 'node-1');
    const vc1 = registry.createVirtualClient({ name: 'vc1' });
    const vc2 = registry.createVirtualClient({ name: 'vc2' });
    scheduler.assign(vc1.id);
    scheduler.assign(vc2.id);

    const released = scheduler.releaseAssignmentsFor(wsc.id);
    expect(released.sort()).toEqual([vc1.id, vc2.id].sort());

    expect(registry.getVirtualClient(vc1.id).assignedWsClientId).toBeNull();
    expect(registry.getVirtualClient(vc2.id).assignedWsClientId).toBeNull();
  });

  test('reassigns to another WS client after disconnect', () => {
    const wsc1 = makeConnectedWsClient(registry, 'node-1');
    const wsc2 = makeConnectedWsClient(registry, 'node-2');
    const vc = registry.createVirtualClient({ name: 'vc' });

    // Force assignment to wsc1
    registry.assignVirtualClientToWs(vc.id, wsc1.id);

    // Simulate wsc1 disconnect
    registry.setConnected(wsc1.id, false);
    scheduler.releaseAssignmentsFor(wsc1.id);

    // Now assign should pick wsc2
    const reassigned = scheduler.assign(vc.id);
    expect(reassigned).toBe(wsc2.id);
  });

  test('getAssignment returns current assignment without changing it', () => {
    const wsc = makeConnectedWsClient(registry, 'node-1');
    const vc = registry.createVirtualClient({ name: 'vc' });
    scheduler.assign(vc.id);
    expect(scheduler.getAssignment(vc.id)).toBe(wsc.id);
  });

  test('getAssignment returns null for unassigned VC', () => {
    const vc = registry.createVirtualClient({ name: 'vc-unassigned' });
    expect(scheduler.getAssignment(vc.id)).toBeNull();
  });
});
