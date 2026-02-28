'use strict';

const path = require('path');
const fs = require('fs');
const { logVerbose, safeJsonParse } = require('./utils');
const { MSG } = require('../shared/protocol');
const { runFsTool, runCommands } = require('./command-runner');

/**
 * createMessageHandler — returns async function(rawMessage, wsCallbacks)
 * wsCallbacks = { send, scheduleHeartbeat, onRegistered, onServerMessage, processExit }
 */
function createMessageHandler({
  wsClientId,
  apiKey,
  workspaceRoot,
  insecure,
  verbose,
  clientMeta,
}) {
  return async function handleMessage(rawMessage, { send, onRegistered, processExit }) {
    const data = safeJsonParse(rawMessage.toString());
    if (!data || typeof data !== 'object') return;
    const { type, payload } = data;

    switch (type) {
      // ── Registration result ───────────────────────────────────────────────
      case MSG.S_REGISTER_RESULT: {
        if (!payload?.success) {
          process.stderr.write(`[Client] Registration failed: ${payload?.error || 'unknown'}\n`);
          processExit(1);
          return;
        }
        logVerbose(`[Client] Registered: wsClientId=${payload.wsClientId}`);
        if (typeof onRegistered === 'function') onRegistered(payload);
        return;
      }

      // ── Virtual client assignment ─────────────────────────────────────────
      case MSG.S_ASSIGN_VC: {
        const vcs = payload?.virtualClients || [];
        for (const vc of vcs) {
          logVerbose(`[Client] Assigned virtual client: ${vc.id} (${vc.name})`);
        }
        return;
      }

      case MSG.S_UNASSIGN_VC: {
        const vcId = payload?.virtualClientId;
        logVerbose(`[Client] Unassigned virtual client: ${vcId}`);
        return;
      }

      // ── Tool / command request ────────────────────────────────────────────
      case MSG.S_REQUEST: {
        const { requestId, virtualClientId, tool, params, timeoutMs } = payload || {};
        if (!requestId) return;

        logVerbose(`[Client] Request: requestId=${requestId} tool=${tool} vcId=${virtualClientId}`);

        // Stateless path resolution
        let root = workspaceRoot;
        if (params?.workspaceId) {
          // Standard registry-aligned subpath: {workspaceRoot}/{vcId}/{wsId}
          root = path.join(workspaceRoot, virtualClientId || 'default', params.workspaceId);
        } else if (params?.rootPath) {
          root = params.rootPath;
        }

        // Ensure directory exists
        if (!fs.existsSync(root)) {
          fs.mkdirSync(root, { recursive: true });
          logVerbose(`[Client] Created directory: ${root}`);
        }

        // Build onChunk callback if client requested streaming (params.stream === true)
        const wantsStream = params?.stream === true;
        let seq = 0;
        const onChunk = wantsStream
          ? ({ chunk, stream: streamName }) => {
              send(MSG.C_STREAM_CHUNK, { requestId, virtualClientId, chunk, stream: streamName, seq: seq++ });
            }
          : null;

        try {
          let response;

          // Handle workspace switching (stateless return of effective path)
          if (tool === 'contextfs.use_workspace') {
            const wsResult = await runFsTool(tool, params, root, { insecure });
            if (wsResult.ok) {
              // Augment result with the effective path
              wsResult.result.activePath = root;
              logVerbose(`[Client] VC ${virtualClientId} using workspace: ${root}`);
            }
            response = wsResult;
          } else if (tool && tool.startsWith('contextfs.')) {
            // FS tool — pass onChunk for streaming-capable tools
            response = await runFsTool(tool, params || {}, root, { insecure, onChunk });
          } else if (tool === '__run_commands__') {
            // Raw command execution (for compatibility)
            const results = await runCommands({
              commands: params?.commands || [],
              allowedCommands: params?.allowedCommands || [],
              rootPath: root,
              timeoutMs: timeoutMs || 30000,
              isStreaming: wantsStream,
              baselineEnv: {},
              onChunk,
            });
            response = { ok: true, result: { results } };
          } else {
            response = { ok: false, error: `Unknown tool: ${tool}` };
          }

          send(MSG.C_RESPONSE, {
            requestId,
            virtualClientId,
            status: response.ok ? 'ok' : 'error',
            result: response.ok ? response.result : undefined,
            error: response.ok ? undefined : response.error,
          });
        } catch (err) {
          send(MSG.C_RESPONSE, {
            requestId,
            virtualClientId,
            status: 'error',
            error: err.message || String(err),
          });
        }
        return;
      }

      default:
        logVerbose(`[Client] Unknown message type: ${type}`);
    }
  };
}

module.exports = { createMessageHandler };
