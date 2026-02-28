'use strict';

const readline = require('readline');
const { bootstrapConfig, loadConfig, mergeConfig } = require('./config');
const { McpSseClient, McpStdioClient } = require('./mcp-client');
const { LlmClient } = require('./llm-client');
const { runToolLoop, buildInitialHistory } = require('./tool-loop');
const { render: renderMarkdown } = require('./markdown-render');

function parseArgs(argv) {
  const args = {};
  // argv starts after 'node contextfs.js chat'
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-m' || token === '--message') {
      if (argv[i + 1]) { args['message'] = argv[i + 1]; i++; }
    } else if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--') && next !== '-m') { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

/**
 * Read all stdin content (for pipe mode).
 */
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.resume();
  });
}

function clearLine() {
  process.stdout.write('\r\x1b[K');
}

function printBanner(model, mcpServer) {
  process.stdout.write('\n');
  process.stdout.write('╔══════════════════════════════════════════════╗\n');
  process.stdout.write('║       contextfs chat TUI  (type /exit)       ║\n');
  process.stdout.write('╚══════════════════════════════════════════════╝\n');
  process.stdout.write(`  Model  : ${model}\n`);
  process.stdout.write(`  Server : ${mcpServer}\n`);
  process.stdout.write('  Commands: /exit  /clear  /tools  /history  /reconnect\n');
  process.stdout.write('            contextfs chat config --help\n');
  process.stdout.write('\n');
}

function printAssistant(text) {
  process.stdout.write('\n\x1b[36m[Assistant]\x1b[0m\n');
  process.stdout.write(renderMarkdown(text.trim()));
  process.stdout.write('\n');
}

function printUsage(model, usage) {
  if (!usage || !usage.total_tokens) return;
  const m = (model || '').toLowerCase();
  let windowSize = 128000;
  if (m.includes('gemini')) windowSize = 1000000;
  else if (m.includes('claude-3')) windowSize = 200000;
  else if (m.includes('gpt-4o')) windowSize = 128000;

  const percent = ((usage.total_tokens / windowSize) * 100).toFixed(2);
  const line = `Tokens: ${usage.total_tokens} / ${windowSize} (${percent}%) [P: ${usage.prompt_tokens} / C: ${usage.completion_tokens}]`;
  process.stdout.write(`  \x1b[90m${line}\x1b[0m\n\n`);
}

function printToolCall(name, args) {
  process.stdout.write(`  \x1b[33m⚙ tool call:\x1b[0m ${name}\n`);
  const preview = JSON.stringify(args);
  if (preview.length < 120) process.stdout.write(`  \x1b[90m${preview}\x1b[0m\n`);
}

function printToolResult(name, result, error) {
  if (error) {
    process.stdout.write(`  \x1b[31m✗ ${name}:\x1b[0m ${error}\n`);
  } else {
    const preview = typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200);
    process.stdout.write(`  \x1b[32m✓ ${name}:\x1b[0m ${preview}${result && result.length > 200 ? '...' : ''}\n`);
  }
}

async function runNonInteractive({ mcpClient, llm, openAiTools, message, outputJson, noTools, timeoutMs, model }) {
  const history = buildInitialHistory();
  const toolCallLog = [];
  const start = Date.now();

  const { response, usage } = await runToolLoop({
    llm,
    mcpClient,
    openAiTools: noTools ? [] : openAiTools,
    history,
    userMessage: message,
    timeoutMs,
    onToolCall: noTools ? null : (info) => {
      toolCallLog.push({ name: info.name, args: info.args });
      if (!outputJson) process.stderr.write(`⚙ ${info.name}\n`);
    },
    onToolResult: noTools ? null : (info) => {
      if (!outputJson && info.error) process.stderr.write(`✗ ${info.name}: ${info.error}\n`);
    },
  });

  const durationMs = Date.now() - start;

  if (outputJson) {
    process.stdout.write(JSON.stringify({
      message: response,
      toolCalls: toolCallLog,
      durationMs,
      usage,
    }) + '\n');
  } else {
    process.stdout.write(renderMarkdown(response) + '\n');
    printUsage(model, usage);
  }
}

async function main() {
  const argv = process.argv.slice(3); // skip node, contextfs.js, 'chat'
  const args = parseArgs(argv);

  // ── Config subcommand ─────────────────────────────────────────────────────────
  if (argv[0] === 'config') {
    const configArgs = argv.slice(1);
    const showHelp = configArgs.includes('--help') || configArgs.length === 0;
    
    if (showHelp) {
      process.stdout.write(`
contextfs chat config — Manage chat configuration

Usage:
  contextfs chat config              Show current config
  contextfs chat config --help       Show this help message
  contextfs chat config --set key=value   Set a config value

Options:
  model         LLM model (e.g., google/gemini-2.5-flash-preview, anthropic/claude-3-5-sonnet)
  maxTokens     Max tokens to generate (default: 4096)
  temperature   Sampling temperature (default: 0.7)
  apiKey        OpenRouter API key
  vcId          Virtual Client ID
  vcKey         Virtual Client Key

Examples:
  contextfs chat config --set model=anthropic/claude-3-5-sonnet
  contextfs chat config --set temperature=0.9
  contextfs chat config --set vcId=my-vc-id --set vcKey=my-key

Config file: ~/.contextfs/chat-config.json
`);
      process.exit(0);
    }

    // Parse --set key=value arguments
    const updates = {};
    for (let i = 0; i < configArgs.length; i++) {
      const token = configArgs[i];
      if (token === '--set') {
        // Handle --set key=value (two tokens)
        if (i + 1 < configArgs.length) {
          const kv = configArgs[i + 1];
          const eqIdx = kv.indexOf('=');
          if (eqIdx > 0) {
            const key = kv.slice(0, eqIdx);
            const value = kv.slice(eqIdx + 1);
            if (value === 'true') updates[key] = true;
            else if (value === 'false') updates[key] = false;
            else if (!isNaN(value)) updates[key] = Number(value);
            else updates[key] = value;
          }
          i++; // skip the value token
        }
      } else if (token.startsWith('--set=')) {
        // Handle --set=key=value (single token)
        const kv = token.slice(6); // remove '--set='
        const eqIdx = kv.indexOf('=');
        if (eqIdx > 0) {
          const key = kv.slice(0, eqIdx);
          const value = kv.slice(eqIdx + 1);
          if (value === 'true') updates[key] = true;
          else if (value === 'false') updates[key] = false;
          else if (!isNaN(value)) updates[key] = Number(value);
          else updates[key] = value;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        const merged = mergeConfig(updates);
        process.stdout.write('Config updated:\n');
        process.stdout.write(JSON.stringify(merged, null, 2) + '\n');
        process.exit(0);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
    }

    // No args, show current config
    const current = loadConfig();
    process.stdout.write('Current config:\n');
    process.stdout.write(JSON.stringify(current, null, 2) + '\n');
    process.exit(0);
  }

  const vcIdArg = args['vc-id'] || process.env.CONTEXTFS_VC_ID || '';
  const vcKeyArg = args['vc-key'] || process.env.CONTEXTFS_VC_KEY || '';
  const modelArg = args['model'] || process.env.CONTEXTFS_MODEL;
  const verbose = args['verbose'] === true || process.env.VERBOSE === '1';
  const insecure = args['insecure'] === true;
  const timeoutMs = parseInt(args['timeout']) || 10000;

  // Bootstrap config (API key, model, vc credentials, etc.)
  let cfg;
  try {
    cfg = await bootstrapConfig({
      model: modelArg,
      vcId: vcIdArg,
      vcKey: vcKeyArg,
    });
  } catch (err) {
    process.stderr.write(`[Chat] Config error: ${err.message}\n`);
    process.exit(1);
  }

  const mcpServer = args['mcp-server']
    || process.env.CONTEXTFS_MCP_SERVER;

  const shouldSpawn = args['spawn'] === true || (!mcpServer && !process.env.CONTEXTFS_MCP_SERVER);

  let mcpClient;
  let serverInfo = '';

  if (shouldSpawn) {
    const binPath = require('path').join(__dirname, '../bin/contextfs.js');
    const spawnArgs = ['server', '--mcp', 'stdio', '--vc-id', cfg.vcId, '--vc-key', cfg.vcKey, '--port', '0'];
    if (verbose) spawnArgs.push('--verbose');
    if (insecure) spawnArgs.push('--insecure');

    mcpClient = new McpStdioClient(process.execPath, [binPath, ...spawnArgs], { verbose, timeoutMs });
    serverInfo = 'spawned (stdio)';
  } else {
    const url = mcpServer || 'http://localhost:3010';
    mcpClient = new McpSseClient(url, { verbose, timeoutMs, vcId: cfg.vcId, vcKey: cfg.vcKey });
    serverInfo = url;
  }

  // Non-interactive flags
  const messageArg = args['message'] || '';
  const useStdin = args['stdin'] === true;
  const outputJson = args['output'] === 'json';
  const noTools = args['no-tools'] === true;

  printBanner(cfg.model, serverInfo);

  // Connect to MCP server
  if (shouldSpawn) {
    process.stdout.write(`Spawning local MCP server...\n`);
  } else {
    process.stdout.write(`Connecting to MCP server at ${serverInfo}...\n`);
  }

  try {
    await mcpClient.connect();
    await mcpClient.initialize();
  } catch (err) {
    process.stderr.write(`[Chat] Failed to connect to MCP server: ${err.message}\n`);
    if (!shouldSpawn) {
      process.stderr.write('[Chat] Make sure contextfs server is running: contextfs server --mcp sse --vc-id <id> --vc-key <key>\n');
    }
    process.exit(1);
  }

  // Load available tools
  let mcpTools = [];
  try {
    mcpTools = await mcpClient.listTools();
    process.stdout.write(`\x1b[32m✓ Connected.\x1b[0m ${mcpTools.length} tools available.\n\n`);
  } catch (err) {
    process.stderr.write(`[Chat] Warning: could not load tools: ${err.message}\n`);
  }

  const openAiTools = LlmClient.mcpToolsToOpenAi(mcpTools);

  // Create LLM client
  const llm = new LlmClient({
    apiKey: cfg.apiKey,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    temperature: cfg.temperature,
  });

  // ── Non-interactive mode ────────────────────────────────────────────────────
  // Triggered by: --message "...", -m "...", --stdin, or piped stdin (non-TTY)
  const stdinMessage = (useStdin || !process.stdin.isTTY) ? await readStdin() : '';
  const singleMessage = messageArg || stdinMessage;

  if (singleMessage) {
    try {
      await runNonInteractive({ mcpClient, llm, openAiTools, message: singleMessage, outputJson, noTools, timeoutMs, model: cfg.model });
    } catch (err) {
      if (outputJson) {
        process.stdout.write(JSON.stringify({ error: err.message }) + '\n');
      } else {
        process.stderr.write(`[Chat] Error: ${err.message}\n`);
      }
      mcpClient.disconnect();
      process.exit(1);
    }
    mcpClient.disconnect();
    process.exit(0);
  }

  const history = buildInitialHistory();

  // Reconnect state tracking
  let isDisconnected = false;
  let isPaused = false;

  // ── Connection status listeners ─────────────────────────────────────────────

  mcpClient.onDisconnected(() => {
    if (!isDisconnected) {
      isDisconnected = true;
      process.stdout.write('\n\x1b[33m[Reconnecting...]\x1b[0m\n');
      if (!isPaused) {
        isPaused = true;
        rl.pause();
      }
    }
  });

  mcpClient.onReconnected(() => {
    if (isDisconnected) {
      isDisconnected = false;
      process.stdout.write('\x1b[32m[Reconnected]\x1b[0m\n');
      if (isPaused) {
        isPaused = false;
        rl.resume();
        rl.prompt();
      }
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[35m[You]\x1b[0m ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    rl.pause();
    const input = line.trim();

    if (!input) { rl.resume(); rl.prompt(); return; }

    // Built-in commands
    if (input === '/exit' || input === '/quit') {
      process.stdout.write('Goodbye!\n');
      mcpClient.disconnect();
      rl.close();
      process.exit(0);
    }

    if (input === '/clear') {
      history.splice(1); // keep system prompt
      process.stdout.write('\x1b[2J\x1b[H');
      printBanner(cfg.model, serverInfo);
      rl.resume(); rl.prompt(); return;
    }

    if (input === '/tools') {
      process.stdout.write('\nAvailable tools:\n');
      for (const t of mcpTools) {
        process.stdout.write(`  \x1b[33m${t.name}\x1b[0m — ${t.description}\n`);
      }
      process.stdout.write('\n');
      rl.resume(); rl.prompt(); return;
    }

    if (input === '/history') {
      process.stdout.write('\nConversation history:\n');
      for (const msg of history) {
        if (msg.role === 'system') continue;
        const prefix = msg.role === 'user' ? '\x1b[35m[You]\x1b[0m' : '\x1b[36m[Assistant]\x1b[0m';
        const content = typeof msg.content === 'string' ? msg.content.slice(0, 100) : '[tool calls]';
        process.stdout.write(`${prefix} ${content}\n`);
      }
      process.stdout.write('\n');
      rl.resume(); rl.prompt(); return;
    }

    if (input === '/reconnect') {
      if (isDisconnected) {
        process.stdout.write('Attempting manual reconnect...\n');
        // Reset reconnect attempts to trigger immediate retry
        mcpClient._reconnectAttempts = 0;
        if (mcpClient._reconnectTimer) {
          clearTimeout(mcpClient._reconnectTimer);
          mcpClient._reconnectTimer = null;
        }
        mcpClient._scheduleReconnect();
      } else {
        process.stdout.write('Already connected. No reconnect needed.\n');
      }
      rl.resume(); rl.prompt(); return;
    }

    // Run agentic tool loop
    process.stdout.write('\x1b[90mThinking...\x1b[0m');
    try {
      const { response, usage } = await runToolLoop({
        llm,
        mcpClient,
        openAiTools,
        history,
        userMessage: input,
        timeoutMs,
        onToolCall: (info) => {
          clearLine();
          printToolCall(info.name, info.args);
          process.stdout.write('\x1b[90mRunning tool...\x1b[0m');
        },
        onToolResult: (info) => {
          clearLine();
          printToolResult(info.name, info.result, info.error);
          process.stdout.write('\x1b[90mThinking...\x1b[0m');
        },
      });
      clearLine();
      printAssistant(response);
      printUsage(cfg.model, usage);
    } catch (err) {
      clearLine();
      // Handle NO_CLIENT error (-32003) with helpful guidance
      if (err.code === -32003) {
        process.stderr.write(`\n\x1b[31m[Error]\x1b[0m No WS client is available for this virtual client.\n`);
        process.stderr.write(`Did you forget to run: contextfs client --url ws://localhost:3010 --ws-client-id <id> --api-key <key>\n\n`);
      } else if (err.message?.includes('Not connected')) {
        process.stderr.write(`\n\x1b[33m[Warning]\x1b[0m Connection lost. Waiting for auto-reconnect or use /reconnect to retry.\n\n`);
      } else {
        process.stderr.write(`\n\x1b[31m[Error]\x1b[0m ${err.message}\n\n`);
      }
    }

    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => {
    mcpClient.disconnect();
    process.stdout.write('\nGoodbye!\n');
    process.exit(0);
  });
}

module.exports = { main };

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[Chat] Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
