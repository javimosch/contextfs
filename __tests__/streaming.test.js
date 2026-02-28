'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function tmpDir() {
  const dir = path.join(os.tmpdir(), `contextfs-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

// ── command-runner streaming ──────────────────────────────────────────────────
describe('runFsTool — bash_script_once streaming', () => {
  const { runFsTool } = require('../client/command-runner');

  let dir;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => cleanup(dir));

  test('non-streaming: returns stdout in result, no onChunk calls', async () => {
    const chunks = [];
    const result = await runFsTool(
      'contextfs.bash_script_once',
      { script: 'echo hello', stream: false },
      dir,
      { insecure: true, onChunk: ({ chunk }) => chunks.push(chunk) },
    );
    // stream: false — onChunk not called even if provided (not passed down)
    expect(result.ok).toBe(true);
    expect(result.result.stdout.trim()).toBe('hello');
    expect(chunks).toHaveLength(0);
  });

  test('streaming: calls onChunk for stdout data', async () => {
    const chunks = [];
    const result = await runFsTool(
      'contextfs.bash_script_once',
      { script: 'echo streaming_output', stream: true },
      dir,
      { insecure: true, onChunk: ({ chunk, stream }) => chunks.push({ chunk, stream }) },
    );
    expect(result.ok).toBe(true);
    expect(result.result.streamed).toBe(true);
    const stdoutChunks = chunks.filter(c => c.stream === 'stdout');
    expect(stdoutChunks.some(c => c.chunk.includes('streaming_output'))).toBe(true);
  });

  test('streaming: stdout and stderr chunks are labeled correctly', async () => {
    const chunks = [];
    await runFsTool(
      'contextfs.bash_script_once',
      { script: 'echo out; echo err >&2', stream: true },
      dir,
      { insecure: true, onChunk: (c) => chunks.push(c) },
    );
    const streams = new Set(chunks.map(c => c.stream));
    expect(streams.has('stdout')).toBe(true);
    expect(streams.has('stderr')).toBe(true);
  });

  test('streaming: not called when insecure=false (tool blocked before execution)', async () => {
    const chunks = [];
    const result = await runFsTool(
      'contextfs.bash_script_once',
      { script: 'echo hi', stream: true },
      dir,
      { insecure: false, onChunk: (c) => chunks.push(c) },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/insecure/i);
    expect(chunks).toHaveLength(0);
  });

  test('streaming: multi-line output produces multiple chunks or one chunk', async () => {
    const chunks = [];
    await runFsTool(
      'contextfs.bash_script_once',
      { script: 'for i in 1 2 3; do echo "line $i"; done', stream: true },
      dir,
      { insecure: true, onChunk: (c) => chunks.push(c) },
    );
    const allOut = chunks.filter(c => c.stream === 'stdout').map(c => c.chunk).join('');
    expect(allOut).toContain('line 1');
    expect(allOut).toContain('line 2');
    expect(allOut).toContain('line 3');
  });
});

// ── local-adapter streaming ───────────────────────────────────────────────────
describe('local-adapter — streaming dispatch', () => {
  const { createLocalAdapter, createLocalOnlyRegistry, createLocalOnlyScheduler } = require('../server/local-adapter');

  let dir, wsRoot, registry, scheduler, adapter;

  beforeEach(() => {
    dir = tmpDir();
    wsRoot = path.join(dir, 'workspaces');
    fs.mkdirSync(wsRoot, { recursive: true });
    registry = createLocalOnlyRegistry(dir);
    scheduler = createLocalOnlyScheduler(registry);
    adapter = createLocalAdapter({ workspaceRoot: wsRoot, insecure: true, registry, scheduler });
  });
  afterEach(() => cleanup(dir));

  function waitForResponse(requestId, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        process.removeListener('contextfs:response', h);
        reject(new Error(`Timeout: ${requestId}`));
      }, timeoutMs);
      function h(evt) {
        if (evt.requestId === requestId) {
          clearTimeout(timer);
          process.removeListener('contextfs:response', h);
          resolve(evt);
        }
      }
      process.on('contextfs:response', h);
    });
  }

  function collectStreamChunks(requestId, timeoutMs = 3000) {
    const chunks = [];
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        process.removeListener('contextfs:stream_chunk', h);
        resolve(chunks);
      }, timeoutMs);
      function h(evt) {
        if (evt.requestId === requestId) chunks.push(evt);
      }
      process.on('contextfs:stream_chunk', h);
      // Stop collecting after response arrives
      process.once('contextfs:response', (evt) => {
        if (evt.requestId === requestId) {
          clearTimeout(timer);
          process.removeListener('contextfs:stream_chunk', h);
          resolve(chunks);
        }
      });
    });
  }

  test('bash_script_once without stream=true emits no stream_chunk events', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const chunks = [];
    const chunkListener = (evt) => { if (evt.requestId === 'req-no-stream') chunks.push(evt); };
    process.on('contextfs:stream_chunk', chunkListener);

    const responsePromise = waitForResponse('req-no-stream');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-no-stream', tool: 'contextfs.bash_script_once', params: { script: 'echo hello' } });
    await responsePromise;

    process.removeListener('contextfs:stream_chunk', chunkListener);
    expect(chunks).toHaveLength(0);
  });

  test('bash_script_once with stream=true emits stream_chunk events', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const chunksPromise = collectStreamChunks('req-stream-1');
    const responsePromise = waitForResponse('req-stream-1');

    adapter.dispatch({
      virtualClientId: vc.id,
      requestId: 'req-stream-1',
      tool: 'contextfs.bash_script_once',
      params: { script: 'echo streamed_hello', stream: true },
    });

    const [evt, chunks] = await Promise.all([responsePromise, chunksPromise]);
    expect(evt.status).toBe('ok');
    expect(evt.result.streamed).toBe(true);
    const allText = chunks.map(c => c.chunk).join('');
    expect(allText).toContain('streamed_hello');
  });

  test('stream_chunk events have correct requestId and seq fields', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const chunksPromise = collectStreamChunks('req-seq-test');
    const responsePromise = waitForResponse('req-seq-test');

    adapter.dispatch({
      virtualClientId: vc.id,
      requestId: 'req-seq-test',
      tool: 'contextfs.bash_script_once',
      params: { script: 'echo a; echo b; echo c', stream: true },
    });

    const [, chunks] = await Promise.all([responsePromise, chunksPromise]);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.requestId).toBe('req-seq-test');
      expect(chunk.virtualClientId).toBe(vc.id);
      expect(typeof chunk.seq).toBe('number');
      expect(['stdout', 'stderr']).toContain(chunk.stream);
    }
  });

  test('non-streaming tools (contextfs.list) emit no stream_chunk events', async () => {
    const vc = registry.createVirtualClient({ name: 'vc' });
    const chunks = [];
    const chunkListener = (evt) => { if (evt.requestId === 'req-list-stream') chunks.push(evt); };
    process.on('contextfs:stream_chunk', chunkListener);

    const responsePromise = waitForResponse('req-list-stream');
    adapter.dispatch({ virtualClientId: vc.id, requestId: 'req-list-stream', tool: 'contextfs.list', params: { path: '.', stream: true } });
    await responsePromise;

    process.removeListener('contextfs:stream_chunk', chunkListener);
    expect(chunks).toHaveLength(0); // list doesn't stream — only bash_script_once does
  });
});

// ── mcp-server streaming capability advertisement ─────────────────────────────
describe('MCP server — streaming capability', () => {
  const { Registry } = require('../server/registry');
  const { createLocalOnlyRegistry, createLocalOnlyScheduler, createLocalAdapter } = require('../server/local-adapter');
  const { createMcpServer, MCP_PROTOCOL_VERSION } = require('../server/mcp/mcp-server');

  let dir, registry, scheduler, adapter, vc;

  beforeEach(() => {
    dir = tmpDir();
    registry = createLocalOnlyRegistry(dir);
    scheduler = createLocalOnlyScheduler(registry);
    const wsRoot = path.join(dir, 'workspaces');
    fs.mkdirSync(wsRoot, { recursive: true });
    adapter = createLocalAdapter({ workspaceRoot: wsRoot, insecure: true, registry, scheduler });
    vc = registry.createVirtualClient({ name: 'mcp-stream-vc' });
  });
  afterEach(() => cleanup(dir));

  test('streaming=false: initialize does not advertise streaming capability', async () => {
    const mcp = createMcpServer({
      registry, wsHandler: adapter, virtualClientId: vc.id, virtualClientApiKey: vc.apiKey,
      insecure: true, streaming: false,
    });
    const res = await mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.result.capabilities.streaming).toBeUndefined();
  });

  test('streaming=true: initialize advertises streaming capability', async () => {
    const mcp = createMcpServer({
      registry, wsHandler: adapter, virtualClientId: vc.id, virtualClientApiKey: vc.apiKey,
      insecure: true, streaming: true,
    });
    const res = await mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.result.capabilities.streaming).toBeDefined();
    expect(res.result.capabilities.streaming.supported).toBe(true);
    expect(res.result.capabilities.streaming.tools).toContain('contextfs.bash_script_once');
  });

  test('streaming=true + _stream=true: bash_script_once calls onStreamChunk', async () => {
    const chunks = [];
    const mcp = createMcpServer({
      registry, wsHandler: adapter, virtualClientId: vc.id, virtualClientApiKey: vc.apiKey,
      insecure: true, streaming: true,
      onStreamChunk: (evt) => chunks.push(evt),
    });

    const res = await mcp.handleMessage({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'contextfs.bash_script_once', arguments: { script: 'echo mcp_streamed', _stream: true } },
    });

    expect(res.result).toBeDefined();
    expect(res.result.isError).toBe(false);
    expect(chunks.some(c => c.chunk.includes('mcp_streamed'))).toBe(true);
  });

  test('streaming=true + _stream=false: bash_script_once does not call onStreamChunk', async () => {
    const chunks = [];
    const mcp = createMcpServer({
      registry, wsHandler: adapter, virtualClientId: vc.id, virtualClientApiKey: vc.apiKey,
      insecure: true, streaming: true,
      onStreamChunk: (evt) => chunks.push(evt),
    });

    const res = await mcp.handleMessage({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'contextfs.bash_script_once', arguments: { script: 'echo no_stream' } },
      // no _stream flag → batch mode
    });

    expect(res.result).toBeDefined();
    // stdout should be in the final result, not in chunks
    const text = JSON.parse(res.result.content[0].text);
    expect(text.stdout.trim()).toBe('no_stream');
    expect(chunks).toHaveLength(0);
  });

  test('streaming=false + _stream=true: _stream flag ignored, no streaming', async () => {
    const chunks = [];
    const mcp = createMcpServer({
      registry, wsHandler: adapter, virtualClientId: vc.id, virtualClientApiKey: vc.apiKey,
      insecure: true, streaming: false, // server-level streaming disabled
      onStreamChunk: (evt) => chunks.push(evt),
    });

    const res = await mcp.handleMessage({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'contextfs.bash_script_once', arguments: { script: 'echo ignored', _stream: true } },
    });

    expect(res.result).toBeDefined();
    expect(chunks).toHaveLength(0); // streaming disabled at server level
  });

  test('_stream flag is stripped from params before dispatch', async () => {
    // Validate that _stream never reaches the tool (no schema validation error)
    const mcp = createMcpServer({
      registry, wsHandler: adapter, virtualClientId: vc.id, virtualClientApiKey: vc.apiKey,
      insecure: true, streaming: true,
    });
    const res = await mcp.handleMessage({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'contextfs.bash_script_once', arguments: { script: 'echo clean', _stream: true } },
    });
    // Should not return INVALID_PARAMS error
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
  });
});
