'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

/**
 * McpStdioClient — connects to a contextfs MCP server by spawning it and communicating via stdio.
 *
 * Protocol:
 *   JSON-RPC 2.0 over stdin/stdout (newline delimited).
 */
class McpStdioClient {
  constructor(command, args = [], { verbose = false, timeoutMs = 30000 } = {}) {
    this._command = command;
    this._args = args;
    this._verbose = verbose;
    this._timeoutMs = timeoutMs;
    this._child = null;
    this._pendingRequests = new Map(); // requestId → { resolve, reject, timer }
    this._nextId = 1;
    this._connected = false;
    this._buffer = '';
    this._onDisconnected = null;
    this._onReconnected = null;
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  connect() {
    return new Promise((resolve, reject) => {
      this._log(`Spawning: ${this._command} ${this._args.join(' ')}`);
      this._child = spawn(this._command, this._args, {
        stdio: ['pipe', 'pipe', 'inherit'],
      });

      this._child.stdout.on('data', (chunk) => this._onData(chunk));
      this._child.on('error', (err) => {
        this._log(`Child process error: ${err.message}`);
        if (!this._connected) reject(err);
        else this._handleDisconnect(`Child process error: ${err.message}`);
      });

      this._child.on('exit', (code, signal) => {
        const msg = `Child process exited with code ${code} signal ${signal}`;
        this._log(msg);
        this._handleDisconnect(msg);
      });

      this._connected = true;
      resolve();
    });
  }

  disconnect() {
    this._connected = false;
    if (this._child) {
      this._child.kill();
      this._child = null;
    }
    // Reject all pending requests
    for (const [id, pending] of this._pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client disconnected'));
    }
    this._pendingRequests.clear();
  }

  // ── MCP Methods ────────────────────────────────────────────────────────────

  async initialize(clientInfo = { name: 'contextfs-chat', version: '1.0.0' }) {
    const result = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo,
      capabilities: { sampling: {} },
    });
    // Send initialized notification (no response expected)
    await this._notify('initialized');
    return result;
  }

  async listTools() {
    const result = await this._request('tools/list');
    return result.tools || [];
  }

  async callTool(name, args = {}, timeoutMs = null) {
    const result = await this._request('tools/call', { name, arguments: args }, timeoutMs);
    return result;
  }

  async ping() {
    return this._request('ping');
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _log(msg) {
    if (this._verbose) process.stderr.write(`[MCP/Stdio Client] ${msg}\n`);
  }

  _onData(chunk) {
    this._buffer += chunk.toString();
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      this._handleMessage(line);
    }
  }

  _handleMessage(line) {
    this._log(`IN: ${line}`);
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;

    const id = msg.id;
    if (id !== undefined && id !== null) {
      const pending = this._pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this._pendingRequests.delete(id);
        if (msg.error) {
          pending.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  async _request(method, params, timeoutMs = null) {
    if (!this._connected) {
      throw new Error('Not connected to MCP server');
    }
    const id = this._nextId++;
    const msg = { jsonrpc: '2.0', id, method };
    if (params !== undefined) msg.params = params;

    return new Promise((resolve, reject) => {
      const actualTimeout = timeoutMs || this._timeoutMs;
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, actualTimeout);

      this._pendingRequests.set(id, { resolve, reject, timer });
      this._write(msg).catch((err) => {
        clearTimeout(timer);
        this._pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  async _notify(method, params) {
    const msg = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    await this._write(msg).catch(() => {});
  }

  _handleDisconnect(reason) {
    if (!this._connected) return;
    this._connected = false;
    this._log(reason);

    // Trigger user callback
    if (this._onDisconnected) {
      try { this._onDisconnected(); } catch (_) {}
    }
  }

  _write(msg) {
    return new Promise((resolve, reject) => {
      if (!this._child || !this._child.stdin.writable) {
        return reject(new Error('Child stdin not writable'));
      }
      const line = JSON.stringify(msg) + '\n';
      this._log(`OUT: ${line.trim()}`);
      this._child.stdin.write(line, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onDisconnected(callback) {
    this._onDisconnected = callback;
  }

  onReconnected(callback) {
    this._onReconnected = callback;
  }
}

/**
 * McpSseClient — connects to a contextfs MCP-over-SSE server.
 *
 * Protocol:
 *   1. GET  <baseUrl>/mcp/sse?vcId=<id>&vcKey=<key>  → opens SSE stream, receives 'endpoint' event
 *   2. POST <baseUrl>/mcp/message?sessionId=<id>      → sends JSON-RPC requests
 *   3. SSE stream delivers JSON-RPC responses as 'message' events
 *
 * Usage:
 *   const client = new McpSseClient('http://localhost:3010', { vcId: '...', vcKey: '...' });
 *   await client.connect();
 *   await client.initialize();
 *   const tools = await client.listTools();
 *   const result = await client.callTool('contextfs.list', { path: '.' });
 *   client.disconnect();
 */
class McpSseClient {
  constructor(baseUrl, { verbose = false, timeoutMs = 30000, vcId = '', vcKey = '' } = {}) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._verbose = verbose;
    this._timeoutMs = timeoutMs;
    this._vcId = vcId;
    this._vcKey = vcKey;
    this._sessionId = null;
    this._sseReq = null;
    this._sseRes = null;
    this._pendingRequests = new Map(); // requestId → { resolve, reject, timer }
    this._nextId = 1;
    this._connected = false;
    this._buffer = '';
    // Reconnect state machine
    this._reconnectAttempts = 0;
    this._reconnectDelay = 1000; // start with 1s
    this._reconnectTimer = null;
    this._maxReconnectDelay = 30000; // 30s max
    this._reconnectJitter = 0.2; // 20% jitter
    this._onDisconnected = null; // callback when reconnect starts
    this._onReconnected = null; // callback when reconnect succeeds
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  connect() {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this._baseUrl}/mcp/sse`);
      if (this._vcId) url.searchParams.set('vcId', this._vcId);
      if (this._vcKey) url.searchParams.set('vcKey', this._vcKey);
      const transport = url.protocol === 'https:' ? https : http;

      const req = transport.get(url.toString(), (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`SSE connect failed: HTTP ${res.statusCode}`));
        }

        this._sseRes = res;
        res.setEncoding('utf8');

        res.on('data', (chunk) => this._onSseData(chunk));
        res.on('end', () => {
          this._handleDisconnect('SSE stream ended');
        });
        res.on('error', (err) => {
          this._handleDisconnect(`SSE stream error: ${err.message}`);
        });
      });

      req.on('error', reject);
      this._sseReq = req;

      // Wait for sessionId before resolving
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for SSE endpoint event'));
      }, this._timeoutMs);

      const origResolve = resolve;
      resolve = (val) => { clearTimeout(timer); origResolve(val); };
      this._pendingConnect = resolve;
      this._pendingConnectReject = () => { clearTimeout(timer); reject(new Error('Connect cancelled')); };
    });
  }

  disconnect() {
    this._connected = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    try { this._sseReq && this._sseReq.destroy(); } catch (_) {}
    // Reject all pending requests
    for (const [id, pending] of this._pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client disconnected'));
    }
    this._pendingRequests.clear();
  }

  // ── MCP Methods ────────────────────────────────────────────────────────────

  async initialize(clientInfo = { name: 'contextfs-chat', version: '1.0.0' }) {
    const result = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo,
      capabilities: { sampling: {} },
    });
    // Send initialized notification (no response expected)
    await this._notify('initialized');
    return result;
  }

  async listTools() {
    const result = await this._request('tools/list');
    return result.tools || [];
  }

  async callTool(name, args = {}, timeoutMs = null) {
    const result = await this._request('tools/call', { name, arguments: args }, timeoutMs);
    return result;
  }

  async ping() {
    return this._request('ping');
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _log(msg) {
    if (this._verbose) process.stderr.write(`[MCP/SSE Client] ${msg}\n`);
  }

  _onSseData(chunk) {
    this._buffer += chunk;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop(); // keep incomplete last line

    let currentEvent = null;
    let currentData = null;

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6).trim();
      } else if (line === '' && currentEvent !== null) {
        this._handleSseEvent(currentEvent, currentData);
        currentEvent = null;
        currentData = null;
      } else if (line.startsWith(': ')) {
        // keepalive comment — ignore
      }
    }
  }

  _handleSseEvent(event, data) {
    this._log(`SSE event: ${event} data: ${data}`);

    if (event === 'endpoint') {
      // data is the message path e.g. /mcp/message?sessionId=abc123
      const match = data && data.match(/sessionId=([a-f0-9]+)/);
      if (match) {
        this._sessionId = match[1];
        this._connected = true;
        this._log(`Session ID: ${this._sessionId}`);
        if (this._pendingConnect) {
          const cb = this._pendingConnect;
          this._pendingConnect = null;
          cb(this._sessionId);
        }
      }
      return;
    }

    if (event === 'message' && data) {
      let msg;
      try { msg = JSON.parse(data); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;

      const id = msg.id;
      if (id !== undefined && id !== null) {
        const pending = this._pendingRequests.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this._pendingRequests.delete(id);
          if (msg.error) {
            pending.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    }
  }

  async _request(method, params, timeoutMs = null) {
    if (!this._connected || !this._sessionId) {
      throw new Error('Not connected to MCP server');
    }
    const id = this._nextId++;
    const msg = { jsonrpc: '2.0', id, method };
    if (params !== undefined) msg.params = params;

    return new Promise((resolve, reject) => {
      const actualTimeout = timeoutMs || this._timeoutMs;
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, actualTimeout);

      this._pendingRequests.set(id, { resolve, reject, timer });
      this._post(msg).catch((err) => {
        clearTimeout(timer);
        this._pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  async _notify(method, params) {
    const msg = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    await this._post(msg).catch(() => {});
  }

  // ── Reconnect State Machine ────────────────────────────────────────────────

  /**
   * Called when SSE stream ends or errors.
   * Triggers automatic reconnect with exponential backoff.
   */
  _handleDisconnect(reason) {
    this._connected = false;
    this._log(reason);

    // Clear pending connect callback if present
    if (this._pendingConnect) {
      this._pendingConnect = null;
    }

    // Trigger user callback
    if (this._onDisconnected) {
      try { this._onDisconnected(); } catch (_) {}
    }

    // Schedule reconnect
    this._scheduleReconnect();
  }

  /**
   * Schedule a reconnect attempt with exponential backoff.
   */
  _scheduleReconnect() {
    if (this._reconnectTimer) return; // already scheduled

    const delayMs = this._calculateBackoffDelay();
    this._reconnectAttempts++;
    this._log(`Scheduling reconnect in ${delayMs}ms (attempt ${this._reconnectAttempts})`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._attemptReconnect();
    }, delayMs);
  }

  /**
   * Calculate exponential backoff delay with jitter.
   */
  _calculateBackoffDelay() {
    let delay = this._reconnectDelay * Math.pow(2, Math.min(this._reconnectAttempts, 4)); // cap at 2^4
    delay = Math.min(delay, this._maxReconnectDelay);
    // Add jitter: ±20%
    const jitter = delay * this._reconnectJitter * (Math.random() - 0.5) * 2;
    return Math.max(100, delay + jitter); // minimum 100ms
  }

  /**
   * Attempt to reconnect by re-initiating SSE connection.
   */
  async _attemptReconnect() {
    this._log(`Attempting reconnect (attempt ${this._reconnectAttempts})...`);
    try {
      // Destroy old connection
      if (this._sseReq) {
        try { this._sseReq.destroy(); } catch (_) {}
      }
      this._sseRes = null;
      this._sseReq = null;
      this._buffer = '';

      // Attempt new connection
      await this.connect();

      // Connection successful, reset backoff
      this._reconnectAttempts = 0;
      this._log('Reconnect successful!');

      // Trigger user callback
      if (this._onReconnected) {
        try { this._onReconnected(); } catch (_) {}
      }
    } catch (err) {
      this._log(`Reconnect attempt ${this._reconnectAttempts} failed: ${err.message}`);
      // Schedule next attempt
      this._scheduleReconnect();
    }
  }

  /**
   * Register callback for when disconnect is detected.
   */
  onDisconnected(callback) {
    this._onDisconnected = callback;
  }

  /**
   * Register callback for when reconnect succeeds.
   */
  onReconnected(callback) {
    this._onReconnected = callback;
  }

  _post(body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const url = new URL(`${this._baseUrl}/mcp/message?sessionId=${this._sessionId}`);
      const transport = url.protocol === 'https:' ? https : http;
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };
      const req = transport.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = { McpSseClient, McpStdioClient };
