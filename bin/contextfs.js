#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { CONFIG_PATH, loadConfig } = require('../chat/config.js');

const subcommand = process.argv[2];

function showHelp() {
  console.log(`
contextfs - Context Filesystem for LLM Agents

Usage:
  contextfs                       Start interactive chat (same as: contextfs chat --spawn)
  contextfs server [options]      Start the ContextFS server (HTTP + WebSocket)
  contextfs client [options]      Start a ContextFS client (connects to server)
  contextfs chat [options]        Start an interactive chat session

Server options:
  --port <port>       Port to listen on (default: 3010, env: PORT)
  --local             Local mode: tools run in-process, no WS clients accepted (env: CONTEXTFS_LOCAL=1)
  --mcp [sse]         Enable MCP server (stdio by default, or 'sse' for SSE transport)
                      SSE: VC credentials supplied per-connection (?vcId=&vcKey= or headers)
                      stdio: requires --vc-id and --vc-key (single session)
  --vc-id <id>        Virtual client ID for stdio MCP session (env: CONTEXTFS_VC_ID)
  --vc-key <key>      Virtual client API key for stdio MCP session (env: CONTEXTFS_VC_KEY)
  --insecure          Enable bash_script_once tool (disabled by default)
  --verbose           Enable verbose logging

Client options:
  --url <wsUrl>       Server WebSocket URL (required, env: CONTEXTFS_SERVER_URL)
  --api-key <key>     WS client API key (required, env: CONTEXTFS_API_KEY)
  --docker            Run client inside Docker container (requires contextfs/client:base image)
  --cwd <path>        Workspace root path (default: ~/.contextfs/workspaces/)
  --insecure          Enable bash_script_once execution
  --verbose           Enable verbose logging

Chat options:
  --spawn             Spawn a local server using stdio (no need for separate server process)
  --mcp-server <url>  MCP server base URL (default: http://localhost:3010, env: CONTEXTFS_MCP_SERVER)
  --vc-id <id>        Virtual client ID (env: CONTEXTFS_VC_ID)
  --vc-key <key>      Virtual client API key (env: CONTEXTFS_VC_KEY)
  --model <model>     LLM model to use (env: CONTEXTFS_MODEL)
  --base-url <url>    OpenAI-compatible API base URL (default: https://openrouter.ai/api/v1, env: CONTEXTFS_BASE_URL)
  --message <text>    Non-interactive: send a single message and exit (alias: -m)
  --stdin             Non-interactive: read message from stdin
  --output json       Output raw JSON { message, toolCalls, durationMs } (non-interactive only)
  --no-tools          Disable tool calls (pure LLM mode)
  --timeout <ms>      Global execution timeout for tool loop in ms (default: 10000)
  --insecure          Enable bash_script_once tool in spawned server
  --verbose           Enable verbose logging

Non-interactive examples:
  contextfs chat -m "list all files in the workspace" --output json
  echo "summarize the README" | contextfs chat --stdin
  contextfs chat --message "write hello.txt" --no-tools

Examples:
  contextfs server
  contextfs server --port 3010 --insecure
  contextfs server --mcp --vc-id <id> --vc-key <key>
  contextfs server --mcp sse
  # then connect: GET http://localhost:3010/mcp/sse?vcId=<id>&vcKey=<key>
  contextfs client --url ws://localhost:3010 --ws-client-id <id> --api-key <key>
  contextfs client --url ws://localhost:3010 --ws-client-id <id> --api-key <key> --cwd /data/workspaces
  contextfs client --docker --url ws://localhost:3010 --api-key <key>
  contextfs chat --mcp-server http://localhost:3010 --model google/gemini-2.5-flash-preview
`);
}

// Subcommand-specific help texts
function showChatHelp() {
  console.log(`
contextfs chat — Interactive chat with ContextFS tools

Usage:
  contextfs chat [options]        Start interactive chat
  contextfs chat --spawn          Spawn local MCP server automatically
  contextfs chat -m "message"     Send single message and exit

Options:
  --spawn             Spawn a local server using stdio (no separate server needed)
  --mcp-server <url>  MCP server base URL (default: http://localhost:3010)
  --vc-id <id>        Virtual client ID
  --vc-key <key>      Virtual client API key
  --model <model>     LLM model (env: CONTEXTFS_MODEL)
  --base-url <url>    OpenAI-compatible API base URL
  -m, --message <text>  Send single message and exit
  --stdin             Read message from stdin
  --output json       Output raw JSON (non-interactive only)
  --no-tools          Disable tool calls
  --timeout <ms>      Global tool execution timeout (default: 10000)
  --insecure          Enable bash_script_once tool
  --verbose           Enable verbose logging

Config:
  contextfs chat config           Show current config
  contextfs chat config --help    Show config help

Examples:
  contextfs chat
  contextfs chat --spawn --model google/gemini-2.5-flash-preview
  contextfs chat -m "list files" --output json
  echo "summarize README" | contextfs chat --stdin
`);
}

function showClientHelp() {
  console.log(`
contextfs client — Connect to ContextFS server as a worker

Usage:
  contextfs client --url <wsUrl> --ws-client-id <id> --api-key <key> [options]

Required:
  --url <wsUrl>       Server WebSocket URL (env: CONTEXTFS_SERVER_URL)
  --ws-client-id <id> WS client ID (env: CONTEXTFS_WS_CLIENT_ID)
  --api-key <key>     API key for WS authentication (env: CONTEXTFS_API_KEY)

Options:
  --docker            Run client inside Docker container
  --cwd <path>        Workspace root path (default: ~/.contextfs/workspaces/)
  --insecure          Enable bash_script_once execution
  --verbose           Enable verbose logging

Examples:
  contextfs client --url ws://localhost:3010 --ws-client-id worker1 --api-key secret
  contextfs client --docker --url ws://host.docker.internal:3010 --ws-client-id worker1 --api-key secret
`);
}

function showServerHelp() {
  console.log(`
contextfs server — Start the ContextFS server

Usage:
  contextfs server [options]

Options:
  --port <port>       Port to listen on (default: 3010, env: PORT)
  --local             Local mode: tools run in-process, no WS clients
  --cwd <path>        Workspace root path (local mode only)
  --mcp [transport]   Enable MCP server (stdio or sse)
  --vc-id <id>        Virtual client ID for stdio MCP
  --vc-key <key>      Virtual client API key for stdio MCP
  --insecure          Enable bash_script_once tool
  --verbose           Enable verbose logging

MCP Transport:
  --mcp               Use stdio transport (requires --vc-id and --vc-key)
  --mcp sse           Use SSE transport (credentials per-connection)

Examples:
  contextfs server
  contextfs server --port 3010 --insecure
  contextfs server --local --cwd /data/workspaces
  contextfs server --mcp --vc-id vc1 --vc-key secret
  contextfs server --mcp sse
`);
}

// Handle help flags explicitly
if (subcommand === '--help' || subcommand === '-h') {
  showHelp();
  process.exit(0);
}

// Check for --help or -h in subcommand args
const subcommandArgs = process.argv.slice(3);
const hasHelpFlag = subcommandArgs.includes('--help') || subcommandArgs.includes('-h');

// Default to chat --spawn when no subcommand provided
if (!subcommand) {
  process.argv.splice(2, 0, 'chat', '--spawn');
  require('../chat/main.js').main().catch((err) => {
    console.error('[ERROR]', err.message);
    process.exit(1);
  });
  return;
}

if (subcommand === 'server') {
  if (hasHelpFlag) {
    showServerHelp();
    process.exit(0);
  }
  require('../server/index.js');
} else if (subcommand === 'client') {
  if (hasHelpFlag) {
    showClientHelp();
    process.exit(0);
  }
  require('../client/main.js').main().catch((err) => {
    console.error('[ERROR]', err.message);
    process.exit(1);
  });
} else if (subcommand === 'chat') {
  if (hasHelpFlag) {
    showChatHelp();
    process.exit(0);
  }
  require('../chat/main.js').main().catch((err) => {
    console.error('[ERROR]', err.message);
    process.exit(1);
  });
} else {
  console.error(`Unknown subcommand: ${subcommand}`);
  showHelp();
  process.exit(1);
}
