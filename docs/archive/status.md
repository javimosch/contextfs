# ContextFS — Implementation Status

> Last updated: 2026-02-27 (streaming + GSD alignment)

---

## Test suite

**221 / 221 tests passing** across 14 suites (0 failures, 0 skipped).

| Suite | Tests | Description |
|---|---|---|
| `json-store.test.js` | 8 | CRUD, atomic writes, deep copy, persistence across re-instantiation |
| `registry.test.js` | 18 | WS clients, virtual clients, workspaces — CRUD, API key lifecycle |
| `scheduler.test.js` | 8 | Sticky affinity, least-loaded selection, disconnect/reassign |
| `client-utils.test.js` | 22 | resolveSafePath, isComplexShellCommand, isCommandAllowed, parseArgs, stdin detection |
| `protocol.test.js` | 28 | JSON Schema validation for all 10 tools, message type constants |
| `ws-integration.test.js` | 5 | Full server+client WS connect, register, heartbeat, dispatch roundtrip |
| `mcp-server.test.js` | 22 | initialize, tools/list, tools/call, auth enforcement, param validation, dispatch mock |
| `mcp-sse.test.js` | 11 | SSE headers, 401 without creds, wrong key, sessionId, 400/404, 202 ack, response delivery, sessions+vcId, malformed JSON |
| `chat-llm-client.test.js` | 18 | Constructor, mcpToolsToOpenAi, openAiNameToMcp, HTTP mock |
| `chat-tool-loop.test.js` | 10 | buildInitialHistory, no-tool path, tool calls, error handling, MAX_TOOL_ITERATIONS |
| `chat-mcp-client.test.js` | 15 | connect, initialize, listTools, callTool, ping, sequential requests, disconnect |
| `chat-noninteractive.test.js` | 15 | parseArgs flags, plain/JSON output, tool call logging, --no-tools, tool errors, multi-tool |
| `local-adapter.test.js` | 26 | LocalRegistry, LocalScheduler, dispatch roundtrips, bash_script_once gating, MCP integration |
| `streaming.test.js` | 15 | runFsTool bash streaming, onChunk labeling, local-adapter stream_chunk events, MCP capability advertisement, onStreamChunk callback, _stream flag stripping |

---

## Phases

### ✅ Phase 1 — Package + CLI foundation

**Files:**
- `bin/contextfs.js` — CLI router (`server` | `client` | `chat` subcommands) with full help text
- `shared/protocol.js` — Message type constants, 10 tool names, JSON Schema validators
- `package.json` — `bin`, deps (`express`, `ws`), Jest config, author, `files`, `keywords`, `engines`

---

### ✅ Phase 2 — Modular client

**Files (`contextfs/client/`):**
- `utils.js` — `parseArgs`, `resolveSafePath`, `isComplexShellCommand`, `requiresStdinWithoutInput`, `isCommandAllowed`, `toWebSocketUrl`, `safeJsonParse`, `getEnv` (with `CONTEXTFS_` prefix)
- `identity.js` — Persistent `systemId` (`~/.contextfs/.machine-id` → `/etc/machine-id` → hardware → random)
- `spawn.js` — `runCommand`, `runCommandStreaming`, `isCommandAvailable`, `getTimeoutVariant` (gnu/busybox/none), container detection
- `command-runner.js` — All 10 FS tool implementations + raw `runCommands` for shell dispatch
- `message-handler.js` — Incoming WS message routing to tools; per-VC workspace tracking
- `ws-client.js` — WS lifecycle, 10s heartbeat with CPU/RAM capability snapshot, auto-reconnect (10s)
- `main.js` — Entry point: arg parsing, workspace root init, `CONTEXTFS_` env vars, API key enforcement

**Key behaviours:**
- `bash_script_once` gated by `--insecure` flag
- CPU/RAM snapshots (`os.loadavg()`, `os.freemem()`, `os.totalmem()`) sent every heartbeat
- Path traversal prevention via `resolveSafePath()`

---

### ✅ Phase 3 — Server with scheduler/registry

**Files (`contextfs/server/`):**
- `db/json-store.js` — Atomic writes (`.tmp` → rename), MongoDB-swappable interface
- `registry.js` — WS clients, virtual clients, workspaces. `cfs_` prefixed API keys. Workspace paths: `~/.contextfs/workspaces/{vcId}/{wsId}`
- `scheduler.js` — Sticky-affinity. Score: `cpuLoad[0]/cpuCount * 0.4 + ramUsedFraction * 0.3 + vcCount/10 * 0.3`
- `ws-handler.js` — Handles `contextfs_register/heartbeat/response/stream_chunk`. Emits `contextfs:response` process events.
- `api-router.js` — Full REST API (WS clients, virtual clients, workspaces, dispatch, status)
- `index.js` — Express + WebSocketServer (skipped in `--local` mode). Graceful shutdown.

**REST API:**
```
GET/POST/DELETE /api/ws-clients           + POST /api/ws-clients/:id/regen-key
GET/POST/DELETE /api/virtual-clients      + POST /api/virtual-clients/:id/regen-key
GET/POST/DELETE /api/virtual-clients/:vcId/workspaces
POST            /api/dispatch
GET             /api/status
```

**Default port:** 3010

---

### ✅ Phase 4 — MCP server integration (stdio + SSE)

**Files (`contextfs/server/mcp/`):**
- `mcp-tools.js` — All 10 tool definitions with `inputSchema` in MCP/OpenAI format
- `mcp-server.js` — JSON-RPC 2.0: `initialize`, `initialized`, `ping`, `tools/list`, `tools/call`. Auth enforced on every call except `initialize`. Routes through `wsHandler.dispatch()` → `contextfs:response`.
- `stdio-transport.js` — Newline-delimited JSON-RPC on stdin/stdout. Redirects `console.log` → stderr.
- `sse-transport.js` — Multi-tenant SSE transport:
  - `GET /mcp/sse?vcId=<id>&vcKey=<key>` — opens session, 401 if missing creds
  - `POST /mcp/message?sessionId=<id>` — receives JSON-RPC, returns 202, pushes response via SSE
  - `GET /mcp/sessions` — debug endpoint (shows sessionId + vcId + lastActivity)
  - 15s keepalive pings; 2min stale-session GC

**Usage:**
```bash
# stdio (single-tenant, VC creds required at startup)
contextfs server --mcp --vc-id <id> --vc-key <key>

# SSE (multi-tenant, VC creds per-connection)
contextfs server --mcp sse
# Connect: GET http://localhost:3010/mcp/sse?vcId=<id>&vcKey=<key>
```

**Claude Desktop / Cursor (stdio):**
```json
{
  "mcpServers": {
    "contextfs": {
      "command": "npx",
      "args": ["contextfs", "server", "--local", "--mcp", "--vc-id", "<id>", "--vc-key", "<key>"]
    }
  }
}
```

---

### ✅ Streaming tool responses (opt-in)

**Design:** Streaming is opt-in at every layer — not enabled by default. No transport is affected unless explicitly configured.

| Layer | How to opt in | What happens |
|---|---|---|
| Tool call | `params.stream = true` | Client uses `runCommandStreaming`, sends `C_STREAM_CHUNK` WS messages |
| MCP call | `arguments._stream: true` | MCP server subscribes to `contextfs:stream_chunk`, calls `onStreamChunk` |
| SSE session | `?stream=1` on connect | SSE transport pushes `notifications/message` events per chunk |
| Server instance | `streaming: true` in `createMcpServer()` | Enables chunk routing for that MCP instance |

**Files changed:**
- `shared/protocol.js` — Added `stream: boolean` to `bash_script_once` schema
- `client/command-runner.js` — `runBashScriptOnce()` accepts `onChunk`; uses `runCommandStreaming` when `params.stream=true`
- `client/message-handler.js` — Builds `onChunk` → sends `C_STREAM_CHUNK` with `{ requestId, chunk, stream, seq }` when `params.stream=true`
- `server/local-adapter.js` — Builds `onChunk` → emits `contextfs:stream_chunk` process events
- `server/mcp/mcp-server.js` — `createMcpServer({ streaming, onStreamChunk })`: advertises capability in `initialize`; strips `_stream` before schema validation; subscribes to `contextfs:stream_chunk` during streaming calls
- `server/mcp/sse-transport.js` — `?stream=1` enables per-session streaming; pushes `notifications/message` SSE events

**Currently streaming-capable tools:** `contextfs.bash_script_once` (stdout + stderr). Other tools execute atomically and return full results.

**Usage:**
```bash
# Start server with streaming enabled
contextfs server --local --mcp sse --insecure

# Connect MCP client with streaming
GET http://localhost:3010/mcp/sse?vcId=<id>&vcKey=<key>&stream=1

# Per-call opt-in in MCP tools/call:
# { "name": "contextfs.bash_script_once", "arguments": { "script": "make build", "_stream": true } }
# → pushes notifications/message SSE events for each stdout/stderr chunk
# → final message event carries the complete result
```

---

### ✅ Phase 5 — Chat TUI

**Files (`contextfs/chat/`):**
- `config.js` — `~/.contextfs/chat-config.json`. API key: `OPENROUTER_API_KEY` → file → interactive prompt.
- `mcp-client.js` — `McpSseClient`: SSE connect with VC creds, JSON-RPC over SSE, `connect/initialize/listTools/callTool/ping/disconnect`
- `llm-client.js` — OpenRouter-compatible HTTP completions. `mcpToolsToOpenAi()` + `openAiNameToMcp()` bridging.
- `tool-loop.js` — Agentic loop: LLM → tool_calls → MCP → results → LLM. Max 10 iterations, then summarize.
- `main.js` — Interactive REPL + non-interactive mode.

**Interactive REPL:**
```bash
CONTEXTFS_VC_ID=<id> CONTEXTFS_VC_KEY=<key> OPENROUTER_API_KEY=sk-or-... \
  contextfs chat --mcp-server http://localhost:3010
```
Commands: `/exit`, `/clear`, `/tools`, `/history`

**Non-interactive mode (LLMs / agents / CI):**
```bash
# Single message
contextfs chat -m "list all files" --output json

# Pipe from stdin
echo "summarize README" | contextfs chat --stdin

# Disable tools (pure LLM)
contextfs chat -m "what is 2+2?" --no-tools

# JSON output: { message, toolCalls, durationMs }
```
Flags: `--message`/`-m`, `--stdin`, `--output json`, `--no-tools`. Exit code `1` on error.

---

### ✅ Dashboard UI

**Files (`contextfs/server/dashboard/`):**
- `index.html` — Vue 3 + Tailwind CDN + DaisyUI CDN shell. Dark `night` theme, monospace font.
- `app.js` — Full Vue 3 SPA, no build step, auto-refreshes every 5s.

**Panels:**
- **Stats bar** — WS clients online, virtual clients, workspaces, MCP sessions
- **WS Clients** — live status dot, CPU load, RAM %, heartbeat, copy ID, regen key, delete
- **Virtual Clients** — status badge, assigned WS, click row → workspaces, regen key, delete
- **Workspaces** — scoped to selected VC: name, rootPath, created time, delete
- **MCP Sessions** — session ID, vcId, last activity

**Access:** `http://localhost:3010` (auto-redirect to `/dashboard/`)

---

### ✅ Local mode (`--local`)

**Files:**
- `server/local-adapter.js` — Three exports:
  - `createLocalAdapter()` — implements identical `{ dispatch, handleOpen, handleClose, handleMessage, sendToWsClient, connections }` interface as `createWsHandler()`. Calls `runFsTool()` in-process, emits `contextfs:response` process events.
  - `createLocalOnlyRegistry()` — real Registry + synthetic `"local"` WS client (always online). VC/workspace CRUD unchanged.
  - `createLocalOnlyScheduler()` — always assigns to `LOCAL_WS_CLIENT_ID`, no-op release.

**Behaviour:**
- `--local` / `CONTEXTFS_LOCAL=1` skips `WebSocketServer` entirely
- Tools run in the server process — no WS client needed
- All MCP, SSE, REST API, and Dashboard work unchanged
- Workspace root: `~/.contextfs/workspaces/local/`

**Usage:**
```bash
# Simplest possible setup
contextfs server --local --mcp sse

# Create a VC, then chat
curl -X POST http://localhost:3010/api/virtual-clients -d '{"name":"agent"}' | jq .
CONTEXTFS_VC_ID=<id> CONTEXTFS_VC_KEY=<key> OPENROUTER_API_KEY=sk-or-... \
  contextfs chat --mcp-server http://localhost:3010
```

---

### ✅ Phase 6 — Documentation + npx publishing

**Files:**
- `README.md` — Full package README: concepts, quick start (local + remote), full CLI reference, MCP integration (SSE + Claude Desktop config), tools reference, REST API reference, security model, dashboard, data directory layout, environment variables table.
- `package.json` — Updated with `author`, `files`, `keywords`, `engines` (`node>=18`), `repository`. Ready for `npm publish`.

**npx usage (after publish):**
```bash
npx contextfs server --local --mcp sse
npx contextfs client --url ws://... --ws-client-id <id> --api-key <key>
npx contextfs chat -m "hello" --output json
```

---

## What is left

### Phase 7 — Docker container strategy *(not started)*
- Base image: `contextfs/client:base` — minimal Node.js + contextfs client
- Full image: `contextfs/client:full` — adds git, ripgrep, tree, etc.
- Docker Compose profiles (`server`, `client`, `all`)
- `npx contextfs client --docker` mode with profile selection

### Remaining items
- **`list_workspaces` / `use_workspace` server coordination** — workspace switching is tracked per-session client-side; server registry `activeWorkspaceId` persistence + MCP context injection are Phase 5.1 (planned)
- **Production hardening** — rate limiting, request size limits, audit log for tool calls, reverse proxy guide
- **Streaming for non-bash tools** — only `bash_script_once` streams currently; `contextfs.read` could stream large files in future

---

## Full stack quick-start

```bash
# ── Local mode (single machine, no WS client needed) ──────────────────────────

# 1. Start server
node bin/contextfs.js server --local --mcp sse

# 2. Create a virtual client (once)
curl -s -X POST http://localhost:3010/api/virtual-clients \
  -H 'Content-Type: application/json' -d '{"name":"agent"}' | jq .

# 3. Open dashboard
open http://localhost:3010

# 4. Chat (interactive)
CONTEXTFS_VC_ID=<id> CONTEXTFS_VC_KEY=<key> OPENROUTER_API_KEY=sk-or-... \
  node bin/contextfs.js chat --mcp-server http://localhost:3010

# 5. Chat (non-interactive / CI)
CONTEXTFS_VC_ID=<id> CONTEXTFS_VC_KEY=<key> OPENROUTER_API_KEY=sk-or-... \
  node bin/contextfs.js chat -m "list all files" --output json

# ── Remote mode (WS client on a different machine) ────────────────────────────

# 1. Start server
node bin/contextfs.js server --mcp sse

# 2. Create WS client + virtual client
curl -s -X POST http://localhost:3010/api/ws-clients \
  -H 'Content-Type: application/json' -d '{"name":"worker"}' | jq .
curl -s -X POST http://localhost:3010/api/virtual-clients \
  -H 'Content-Type: application/json' -d '{"name":"agent"}' | jq .

# 3. Connect WS client
node bin/contextfs.js client \
  --url ws://localhost:3010 \
  --ws-client-id <wsc-id> \
  --api-key <wsc-key>

# 4. Chat
CONTEXTFS_VC_ID=<vc-id> CONTEXTFS_VC_KEY=<vc-key> OPENROUTER_API_KEY=sk-or-... \
  node bin/contextfs.js chat --mcp-server http://localhost:3010
```
