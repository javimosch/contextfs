'use strict';

const { Router } = require('express');
const crypto = require('crypto');

/**
 * createApiRouter — REST API for managing ws-clients, virtual-clients, workspaces,
 * and dispatching tool requests.
 */
function createApiRouter({ registry, wsHandler }) {
  const router = Router();
  router.use(require('express').json());

  // ── WS Clients ────────────────────────────────────────────────────────────

  router.get('/ws-clients', (req, res) => {
    const list = registry.listWsClients().map(stripApiKey);
    res.json({ ok: true, data: list });
  });

  router.post('/ws-clients', (req, res) => {
    const { name, description } = req.body || {};
    const doc = registry.createWsClient({ name, description });
    // Return full doc (including apiKey) only on creation
    res.status(201).json({ ok: true, data: doc });
  });

  router.delete('/ws-clients/:id', (req, res) => {
    const deleted = registry.deleteWsClient(req.params.id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  });

  router.post('/ws-clients/:id/regen-key', (req, res) => {
    const doc = registry.regenWsClientApiKey(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: doc });
  });

  // ── Virtual Clients ───────────────────────────────────────────────────────

  router.get('/virtual-clients', (req, res) => {
    const list = registry.listVirtualClients().map(stripApiKey);
    res.json({ ok: true, data: list });
  });

  router.post('/virtual-clients', (req, res) => {
    const { name, description } = req.body || {};
    const doc = registry.createVirtualClient({ name, description });
    res.status(201).json({ ok: true, data: doc });
  });

  router.delete('/virtual-clients/:id', (req, res) => {
    const deleted = registry.deleteVirtualClient(req.params.id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  });

  router.post('/virtual-clients/:id/regen-key', (req, res) => {
    const doc = registry.regenVirtualClientApiKey(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: doc });
  });

  // ── Workspaces ────────────────────────────────────────────────────────────

  router.get('/virtual-clients/:vcId/workspaces', (req, res) => {
    const vc = registry.getVirtualClient(req.params.vcId);
    if (!vc) return res.status(404).json({ ok: false, error: 'Virtual client not found' });
    res.json({ ok: true, data: registry.listWorkspaces(req.params.vcId) });
  });

  router.post('/virtual-clients/:vcId/workspaces', (req, res) => {
    try {
      const { name, description } = req.body || {};
      const doc = registry.createWorkspace({ virtualClientId: req.params.vcId, name, description });
      res.status(201).json({ ok: true, data: doc });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.delete('/virtual-clients/:vcId/workspaces/:wsId', (req, res) => {
    const deleted = registry.deleteWorkspace(req.params.wsId);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  });

  // ── Dispatch ──────────────────────────────────────────────────────────────

  /**
   * POST /api/dispatch
   * Body: { virtualClientId, virtualClientApiKey, tool, params, timeoutMs }
   * Validates VC API key, dispatches to assigned WS client, waits for response.
   */
  router.post('/dispatch', async (req, res) => {
    const { virtualClientId, virtualClientApiKey, tool, params, timeoutMs } = req.body || {};

    if (!virtualClientId || !virtualClientApiKey || !tool) {
      return res.status(400).json({ ok: false, error: 'Missing virtualClientId, virtualClientApiKey, or tool' });
    }

    if (!registry.validateVirtualClientApiKey(virtualClientId, virtualClientApiKey)) {
      return res.status(401).json({ ok: false, error: 'Invalid virtual client API key' });
    }

    const requestId = 'req_' + crypto.randomBytes(8).toString('hex');
    const timeout = typeof timeoutMs === 'number' ? timeoutMs : 30000;

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        process.removeListener('contextfs:response', onResponse);
        resolve({ ok: false, error: 'Request timed out' });
      }, timeout + 5000);

      function onResponse(evt) {
        if (evt.requestId === requestId) {
          clearTimeout(timer);
          process.removeListener('contextfs:response', onResponse);
          resolve(evt.status === 'ok'
            ? { ok: true, result: evt.result }
            : { ok: false, error: evt.error });
        }
      }

      process.on('contextfs:response', onResponse);

      const dispatched = wsHandler.dispatch({ virtualClientId, requestId, tool, params, timeoutMs: timeout });
      if (!dispatched.dispatched) {
        clearTimeout(timer);
        process.removeListener('contextfs:response', onResponse);
        resolve({ ok: false, error: dispatched.error });
      }
    });

    if (!result.ok) {
      return res.status(result.error === 'Request timed out' ? 504 : 502).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, data: result.result });
  });

  // ── Status ────────────────────────────────────────────────────────────────

  router.get('/status', (req, res) => {
    const wsClients = registry.listWsClients();
    const virtualClients = registry.listVirtualClients();
    const workspaces = registry.listWorkspaces
      ? registry._workspaces.list()
      : [];
    res.json({
      ok: true,
      data: {
        wsClients: wsClients.length,
        wsClientsOnline: wsClients.filter(c => c.status === 'online').length,
        virtualClients: virtualClients.length,
        workspaces: workspaces.length,
      },
    });
  });

  return router;
}

function stripApiKey(doc) {
  const { apiKey, ...rest } = doc;
  return rest;
}

module.exports = { createApiRouter };
