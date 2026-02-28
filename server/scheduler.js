'use strict';

/**
 * Scheduler — assigns virtual clients to WS clients using sticky affinity
 * and CPU/RAM-aware load balancing.
 *
 * Scoring formula (lower = better):
 *   score = cpuLoad1m * 0.4 + ramUsedFraction * 0.3 + vcCount * 0.3
 */
class Scheduler {
  constructor(registry) {
    this._registry = registry;
  }

  /**
   * Get or compute the assigned WS client for a virtual client.
   * - If already assigned to a connected WS client → return existing.
   * - Otherwise → pick least-loaded connected WS client.
   * Returns wsClientId or null if no WS clients are connected.
   */
  assign(virtualClientId) {
    const vc = this._registry.getVirtualClient(virtualClientId);
    if (!vc) return null;

    // Sticky affinity: reuse existing assignment if still connected
    if (vc.assignedWsClientId && this._registry.isConnected(vc.assignedWsClientId)) {
      return vc.assignedWsClientId;
    }

    // Need to pick a new WS client
    const connectedIds = this._registry.listConnectedWsClientIds();
    if (connectedIds.length === 0) return null;

    const scored = connectedIds.map(id => {
      const wsc = this._registry.getWsClient(id);
      return { id, score: this._score(wsc) };
    });

    scored.sort((a, b) => a.score - b.score);
    const bestId = scored[0].id;

    // Persist assignment
    this._registry.assignVirtualClientToWs(virtualClientId, bestId);
    return bestId;
  }

  /**
   * Return current assignment without changing it.
   */
  getAssignment(virtualClientId) {
    const vc = this._registry.getVirtualClient(virtualClientId);
    if (!vc) return null;
    return vc.assignedWsClientId || null;
  }

  /**
   * Clear assignment (e.g. when the assigned WS client disconnects).
   * Call this when a WS client goes offline so VCs can be reassigned.
   */
  releaseAssignmentsFor(wsClientId) {
    const vcs = this._registry.listVirtualClients().filter(
      vc => vc.assignedWsClientId === wsClientId,
    );
    for (const vc of vcs) {
      this._registry.assignVirtualClientToWs(vc.id, null);
    }
    return vcs.map(vc => vc.id);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _score(wsClient) {
    if (!wsClient) return Infinity;
    const cap = wsClient.capability || {};
    const cpuLoad1m = Array.isArray(cap.cpuLoad) ? (cap.cpuLoad[0] || 0) : 0;
    const freeMemMb = cap.freeMemMb || 0;
    const totalMemMb = cap.totalMemMb || 1;
    const vcCount = cap.vcCount || 0;

    const ramUsedFraction = totalMemMb > 0 ? (1 - freeMemMb / totalMemMb) : 0;

    // Normalise cpu: divide by number of CPUs if available, cap at 1
    const cpuNorm = Math.min(cpuLoad1m / Math.max(1, cap.cpuCount || 1), 1);

    return cpuNorm * 0.4 + ramUsedFraction * 0.3 + Math.min(vcCount / 10, 1) * 0.3;
  }
}

module.exports = { Scheduler };
