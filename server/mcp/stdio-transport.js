'use strict';

/**
 * stdio-transport — MCP over stdio (JSON-RPC 2.0, newline-delimited).
 *
 * Reads newline-delimited JSON from stdin, dispatches to mcpServer.handleMessage(),
 * writes responses to stdout. All server logs must go to stderr to avoid
 * corrupting the JSON-RPC stream.
 *
 * @param {object} mcpServer  — result of createMcpServer()
 * @param {object} opts
 * @param {boolean} opts.verbose
 */
function startStdioTransport(mcpServer, { verbose = false } = {}) {
  // Redirect all console.log to stderr so stdout stays clean for JSON-RPC
  const origLog = console.log;
  console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

  if (verbose) process.stderr.write('[MCP/stdio] Transport started\n');

  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  process.stdin.on('data', async (chunk) => {
    buffer += chunk;

    // Split on newlines — each line is one JSON-RPC message
    const lines = buffer.split('\n');
    buffer = lines.pop(); // last element may be incomplete

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch (_) {
        const response = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        };
        writeResponse(response);
        continue;
      }

      if (verbose) {
        process.stderr.write(`[MCP/stdio] IN: ${JSON.stringify(msg)}\n`);
      }

      let response;
      try {
        response = await mcpServer.handleMessage(msg);
      } catch (err) {
        response = {
          jsonrpc: '2.0',
          id: msg?.id ?? null,
          error: { code: -32603, message: err.message || 'Internal error' },
        };
      }

      // Notifications have no response (null)
      if (response !== null && response !== undefined) {
        if (verbose) {
          process.stderr.write(`[MCP/stdio] OUT: ${JSON.stringify(response)}\n`);
        }
        writeResponse(response);
      }
    }
  });

  process.stdin.on('end', () => {
    // Handle any remaining buffered data
    if (buffer.trim()) {
      process.stderr.write('[MCP/stdio] stdin closed with partial message (ignored)\n');
    }
    if (verbose) process.stderr.write('[MCP/stdio] stdin closed\n');
  });

  process.stdin.on('error', (err) => {
    process.stderr.write(`[MCP/stdio] stdin error: ${err.message}\n`);
  });

  function writeResponse(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }

  return { writeResponse };
}

module.exports = { startStdioTransport };
