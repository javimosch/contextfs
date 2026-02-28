'use strict';

const crypto = require('crypto');

/**
 * mountSseTransport — mounts MCP-over-SSE endpoints onto an Express app.
 *
 * Protocol:
 *   GET  /mcp/sse        — Client opens SSE stream. VC credentials supplied per-request:
 *                            ?vcId=<id>&vcKey=<key>
 *                          or via headers:
 *                            X-VC-ID: <id>
 *                            Authorization: Bearer <key>
 *                          Server sends "endpoint" event with session-specific POST URL.
 *   POST /mcp/message    — Client sends JSON-RPC messages here (with ?sessionId=<id>).
 *                          Server pushes JSON-RPC responses back over the SSE stream.
 *
 * One MCP server instance is created per SSE connection (per virtual client session).
 * Multiple virtual clients can connect simultaneously with different credentials.
 *
 * @param {object} app             — Express app
 * @param {function} makeMcpServer — factory: ({ sessionId, vcId, vcKey }) → mcpServer instance
 * @param {object} opts
 * @param {string}  opts.basePath  — base path prefix (default: '/mcp')
 * @param {boolean} opts.verbose
 */
function mountSseTransport(app, makeMcpServer, { basePath = '/mcp', verbose = false } = {}) {
  // Map<sessionId, { res: Response, mcpServer, vcId, createdAt }>
  const sessions = new Map();

  // Cleanup stale sessions (no activity for 2 min)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > 120000) {
        try { session.res.end(); } catch (_) {}
        sessions.delete(id);
        if (verbose) process.stderr.write(`[MCP/SSE] Session ${id} expired (vc=${session.vcId})\n`);
      }
    }
  }, 30000);
  cleanupInterval.unref();

  // ── GET /mcp/sse ───────────────────────────────────────────────────────────
  app.get(`${basePath}/sse`, (req, res) => {
    // Resolve VC credentials: query params take priority, then headers
    const vcId = req.query.vcId || req.headers['x-vc-id'] || '';
    const vcKey = req.query.vcKey
      || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
      || '';

    if (!vcId || !vcKey) {
      res.status(401).json({
        error: 'Missing VC credentials. Provide ?vcId=<id>&vcKey=<key> or X-VC-ID / Authorization headers.',
      });
      return;
    }

    const sessionId = crypto.randomBytes(12).toString('hex');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    // Optional streaming mode: ?stream=1 or header X-Stream: 1
    const sessionStreaming = req.query.stream === '1' || req.headers['x-stream'] === '1';

    let mcpServer;
    try {
      mcpServer = makeMcpServer({
        sessionId,
        vcId,
        vcKey,
        streaming: sessionStreaming,
        // When a stream chunk arrives, push it as an MCP notification over SSE
        onStreamChunk: sessionStreaming
          ? (evt) => {
              if (!res.writableEnded) {
                // MCP notification: no id, method = notifications/message
                const notification = {
                  jsonrpc: '2.0',
                  method: 'notifications/message',
                  params: {
                    type: 'stream_chunk',
                    requestId: evt.requestId,
                    chunk: evt.chunk,
                    stream: evt.stream,
                    seq: evt.seq,
                  },
                };
                sendSseEvent(res, 'message', JSON.stringify(notification));
              }
            }
          : null,
      });
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
      return;
    }

    sessions.set(sessionId, {
      res,
      mcpServer,
      vcId,
      streaming: sessionStreaming,
      lastActivity: Date.now(),
    });

    if (verbose) process.stderr.write(`[MCP/SSE] Session opened: ${sessionId} (vc=${vcId})\n`);

    // Send the endpoint event so the client knows where to POST
    const messageUrl = `${basePath}/message?sessionId=${sessionId}`;
    sendSseEvent(res, 'endpoint', messageUrl);

    // Keepalive ping every 15s
    const keepAlive = setInterval(() => {
      if (res.writableEnded) { clearInterval(keepAlive); return; }
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sessions.delete(sessionId);
      if (verbose) process.stderr.write(`[MCP/SSE] Session closed: ${sessionId}\n`);
    });
  });

  // ── POST /mcp/message ──────────────────────────────────────────────────────
  app.post(`${basePath}/message`, async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId query parameter' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    session.lastActivity = Date.now();

    const msg = req.body;
    if (!msg || typeof msg !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    if (verbose) {
      process.stderr.write(`[MCP/SSE] IN [${sessionId}]: ${JSON.stringify(msg)}\n`);
    }

    // Acknowledge receipt immediately
    res.status(202).json({ ok: true });

    let response;
    try {
      response = await session.mcpServer.handleMessage(msg);
    } catch (err) {
      response = {
        jsonrpc: '2.0',
        id: msg?.id ?? null,
        error: { code: -32603, message: err.message || 'Internal error' },
      };
    }

    // Notifications produce no response
    if (response !== null && response !== undefined) {
      if (verbose) {
        process.stderr.write(`[MCP/SSE] OUT [${sessionId}]: ${JSON.stringify(response)}\n`);
      }
      if (!session.res.writableEnded) {
        sendSseEvent(session.res, 'message', JSON.stringify(response));
      }
    }
  });

  // ── GET /mcp/sessions (debug endpoint) ────────────────────────────────────
  app.get(`${basePath}/sessions`, (req, res) => {
    res.json({
      ok: true,
      sessions: Array.from(sessions.keys()).map(id => ({
        id,
        vcId: sessions.get(id).vcId,
        streaming: sessions.get(id).streaming || false,
        lastActivity: new Date(sessions.get(id).lastActivity).toISOString(),
      })),
    });
  });

  function sendSseEvent(res, event, data) {
    res.write(`event: ${event}\ndata: ${data}\n\n`);
  }

  return { sessions };
}

module.exports = { mountSseTransport };
