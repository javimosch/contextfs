'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { JsonStore } = require('./db/json-store');

const CONTEXTFS_HOME = path.join(os.homedir(), '.contextfs');

function generateApiKey() {
  return 'cfs_' + crypto.randomBytes(24).toString('hex');
}

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Registry — source of truth for ws-clients, virtual-clients, workspaces.
 * Backed by JsonStore (swappable with MongoStore later).
 */
class Registry {
  constructor(homeDir = CONTEXTFS_HOME) {
    this._homeDir = homeDir;
    this._wsClients = new JsonStore(path.join(homeDir, 'ws-clients.json'));
    this._virtualClients = new JsonStore(path.join(homeDir, 'virtual-clients.json'));
    this._workspaces = new JsonStore(path.join(homeDir, 'workspaces.json'));
    // In-memory liveness: wsClientId → boolean
    this._connected = new Map();
  }

  load() {
    this._wsClients.load();
    this._virtualClients.load();
    this._workspaces.load();
    return this;
  }

  // ── WS Clients ────────────────────────────────────────────────────────────

  createWsClient({ name, description = '' } = {}) {
    const id = generateId();
    const apiKey = generateApiKey();
    const doc = {
      id,
      name: name || `ws-client-${id.slice(0, 6)}`,
      description,
      apiKey,
      status: 'offline',
      createdAt: nowIso(),
      lastHeartbeat: null,
      lastError: null,
      capability: { cpuLoad: [0, 0, 0], freeMemMb: 0, totalMemMb: 0, vcCount: 0, wsCount: 0 },
    };
    this._wsClients.set(id, doc);
    // Return with apiKey exposed (only time it's returned in full)
    return { ...doc };
  }

  getWsClient(id) {
    return this._wsClients.get(id);
  }

  listWsClients() {
    return this._wsClients.list();
  }

  updateWsClientStatus(id, status) {
    const doc = this._wsClients.get(id);
    if (!doc) return null;
    return this._wsClients.set(id, { ...doc, status });
  }

  updateWsClientHeartbeat(id, capability = null) {
    const doc = this._wsClients.get(id);
    if (!doc) return null;
    const update = { ...doc, lastHeartbeat: nowIso(), status: 'online' };
    if (capability) update.capability = capability;
    return this._wsClients.set(id, update);
  }

  updateWsClientError(id, error) {
    const doc = this._wsClients.get(id);
    if (!doc) return null;
    return this._wsClients.set(id, { ...doc, lastError: error });
  }

  regenWsClientApiKey(id) {
    const doc = this._wsClients.get(id);
    if (!doc) return null;
    const apiKey = generateApiKey();
    return this._wsClients.set(id, { ...doc, apiKey });
  }

  deleteWsClient(id) {
    return this._wsClients.delete(id);
  }

  validateWsClientApiKey(id, apiKey) {
    const doc = this._wsClients.get(id);
    return doc && doc.apiKey === apiKey;
  }

  // ── Virtual Clients ───────────────────────────────────────────────────────

  createVirtualClient({ name, description = '' } = {}) {
    const id = generateId();
    const apiKey = generateApiKey();
    const doc = {
      id,
      name: name || `vc-${id.slice(0, 6)}`,
      description,
      apiKey,
      status: 'idle',
      assignedWsClientId: null,
      activeWorkspaceId: null,
      createdAt: nowIso(),
      lastHeartbeat: null,
      lastError: null,
    };
    this._virtualClients.set(id, doc);
    return { ...doc };
  }

  getVirtualClient(id) {
    return this._virtualClients.get(id);
  }

  listVirtualClients() {
    return this._virtualClients.list();
  }

  assignVirtualClientToWs(virtualClientId, wsClientId) {
    const vc = this._virtualClients.get(virtualClientId);
    if (!vc) return null;
    return this._virtualClients.set(virtualClientId, {
      ...vc,
      assignedWsClientId: wsClientId,
      status: wsClientId ? 'assigned' : 'idle',
    });
  }

  regenVirtualClientApiKey(id) {
    const doc = this._virtualClients.get(id);
    if (!doc) return null;
    return this._virtualClients.set(id, { ...doc, apiKey: generateApiKey() });
  }

  setActiveWorkspace(virtualClientId, workspaceId) {
    const vc = this._virtualClients.get(virtualClientId);
    if (!vc) return null;
    return this._virtualClients.set(virtualClientId, {
      ...vc,
      activeWorkspaceId: workspaceId,
    });
  }

  deleteVirtualClient(id) {
    // Also delete owned workspaces
    const owned = this._workspaces.list().filter(w => w.virtualClientId === id);
    for (const ws of owned) this._workspaces.delete(ws.id);
    return this._virtualClients.delete(id);
  }

  validateVirtualClientApiKey(id, apiKey) {
    const doc = this._virtualClients.get(id);
    return doc && doc.apiKey === apiKey;
  }

  /**
   * Ensure a virtual client exists with the given ID and API key.
   * Creates the client if it doesn't exist (for auto-provisioned credentials).
   * Returns the virtual client document.
   */
  ensureVirtualClient(id, apiKey, { name = '', description = '' } = {}) {
    const existing = this._virtualClients.get(id);
    if (existing) {
      // If exists but key doesn't match, update the key
      if (existing.apiKey !== apiKey) {
        return this._virtualClients.set(id, { ...existing, apiKey });
      }
      return existing;
    }
    // Create new virtual client with specific ID and key
    const doc = {
      id,
      name: name || `vc-${id.slice(0, 6)}`,
      description,
      apiKey,
      status: 'idle',
      assignedWsClientId: null,
      activeWorkspaceId: null,
      createdAt: nowIso(),
      lastHeartbeat: null,
      lastError: null,
    };
    this._virtualClients.set(id, doc);
    return { ...doc };
  }

  // ── Workspaces ────────────────────────────────────────────────────────────

  createWorkspace({ virtualClientId, name, description = '' } = {}) {
    const vc = this._virtualClients.get(virtualClientId);
    if (!vc) throw new Error(`Virtual client not found: ${virtualClientId}`);

    const id = generateId();
    const rootPath = path.join(
      this._homeDir,
      'workspaces',
      virtualClientId,
      id,
    );
    const doc = {
      id,
      name: name || `workspace-${id.slice(0, 6)}`,
      description,
      virtualClientId,
      rootPath,
      createdAt: nowIso(),
    };
    this._workspaces.set(id, doc);
    return { ...doc };
  }

  getWorkspace(id) {
    return this._workspaces.get(id);
  }

  listWorkspaces(virtualClientId) {
    return this._workspaces.list().filter(w => w.virtualClientId === virtualClientId);
  }

  findWorkspaceByName(virtualClientId, name) {
    return this._workspaces.list().find(w => w.virtualClientId === virtualClientId && w.name === name);
  }

  deleteWorkspace(id) {
    return this._workspaces.delete(id);
  }

  // ── Connectivity helpers ──────────────────────────────────────────────────

  setConnected(wsClientId, connected) {
    this._connected.set(wsClientId, connected);
    if (!connected) this.updateWsClientStatus(wsClientId, 'offline');
  }

  isConnected(wsClientId) {
    return this._connected.get(wsClientId) === true;
  }

  listConnectedWsClientIds() {
    const result = [];
    for (const [id, connected] of this._connected) {
      if (connected) result.push(id);
    }
    return result;
  }
}

module.exports = { Registry };
