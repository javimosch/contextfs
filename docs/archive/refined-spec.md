# ContextFS extraction plan
This plan extracts the current Remote FS capability into a standalone `contextfs` library with a new modular server/client architecture and CLI surface matching the requested `npx contextfs ...` commands.

## Scope and target outcomes
- Build a standalone package under `contextfs/` with:
  - `contextfs/client` (new client implementation)
  - `contextfs/client-legacy` (kept as migration fallback)
  - `contextfs/server` (HTTP UI + WS + optional MCP)
- Ship a single CLI entrypoint `contextfs` with subcommands:
  - `server` (default UI+WS)
  - `client` (`--url`, `--cwd`, `--docker`)
  - `chat` (`--mcp-server`, `--model`, OpenRouter key bootstrap)
- Implement MCP tools surface exactly as specified (`contextfs.list`, `contextfs.read`, ... `contextfs.bash_script_once`).
- Model runtime using **two client layers**:
  - **WS client**: process connected to ContextFS server.
  - **Virtual client**: logical tenant used by MCP/chat/external app, hosted by WS clients.
- Support **many virtual clients per WS client** and **many workspaces per virtual client**.
- Server performs **load balancing** to assign virtual clients to WS clients using current CPU/RAM availability.

## Runtime architecture model

### Entities
- **Server**: control plane (UI, scheduler, MCP gateway, metrics, registry).
- **WS client**: execution node (filesystem + command execution capabilities).
- **Virtual client**: isolated logical identity for external consumers (e.g., chat TUI sessions/apps).
- **Workspace**: execution/storage context owned by a virtual client.

### Assignment rules
- One WS client can host multiple virtual clients.
- One virtual client can own multiple workspaces.
- Server is the single authority for:
  - virtual-client creation
  - assignment/reassignment
  - workspace ownership mapping
  - API key lifecycle (optional keys, regeneration)

### Mode behavior
- `contextfs server`:
  - starts HTTP UI + WS listener
  - accepts external WS clients
  - scheduler routes virtual clients across connected WS clients
- `contextfs server --local`:
  - **does not** accept WS clients
  - mounts internal `LocalClientAdapter`
  - all virtual clients execute through local adapter only

## Current-state extraction map (what we will reuse)
1. **Legacy remote-fs client runtime** (base for `client-legacy` and partial reuse)
   - Entry/orchestration: `scripts/remote-fs/main.js`
   - WS lifecycle/reconnect: `scripts/remote-fs/ws-client.js`
   - Message protocol & command execution: `scripts/remote-fs/message-handler.js`
2. **Server-side WS protocol and request/response lifecycle**
   - `src/ws/remote-fs.js`
3. **Command/tool execution contract and safety behavior**
   - `src/services/db-tools/handlers/RemoteFSHandler.js`
4. **Feature contract/documentation baseline**
   - `docs/features/remote-fs.md`
5. **New package seed already present**
   - `contextfs/package.json`
   - `contextfs/client-legacy/*`

## Implementation phases

### Phase 1 — Package and CLI foundation
1. Update `contextfs/package.json`:
   - Define `bin` as `contextfs`.
   - Add dependencies (`ws`, minimal HTTP server stack, MCP SDK choice, optional TUI deps).
2. Add CLI router:
   - `contextfs/bin/contextfs.js`
   - Subcommand parsing: `server`, `client`, `chat`.
3. Add config home layout:
   - `~/.contextfs/`
   - `~/.contextfs/workspaces/`
   - `~/.contextfs/chat-config.json`

### Phase 2 — New `contextfs/client` (non-legacy)
1. Create `contextfs/client/` modules:
   - `main.js`, `ws-client.js`, `message-handler.js`, `command-runner.js`, `spawn.js`, `utils.js`, `identity.js`.
2. Keep behavior parity where needed with `client-legacy`:
   - registration, heartbeat, reconnect, token/auth handling.
3. Add new flags:
   - `--url` required unless env/default available.
   - `--cwd` default `~/.contextfs/workspaces/`.
   - `--docker` launches dockerized client runtime (profile-based command wrapper).
4. Add client capability reporting to server (for scheduling):
   - current CPU load snapshot
   - current RAM usage/available memory snapshot
   - hosted virtual client count
   - hosted workspace count
5. Preserve one-shot script safeguards (size limit, timeout, cleanup).

### Phase 2.1 — Security and filesystem ownership model
1. Implement per-mode workspace root strategy:
   - **non-docker mode (insecure/default dev)**:
     - `~/.contextfs/workspaces/{virtualClientId}/{workspaceId}`
     - guardrails: block absolute escapes, `..` traversal, and dangerous command elevation patterns.
   - **docker mode (more secure)**:
     - virtual client maps to dedicated linux user `vc_{virtualClientId}`
     - workspace path: `/home/vc_{virtualClientId}/workspaces/{workspaceId}`
2. Add path policy utility shared by tools (`list/read/write/bash_script_once`) for deterministic enforcement.
3. Define ownership checks on every operation:
   - workspace must belong to active virtual client
   - virtual client must be assigned to current execution node.

### Phase 3 — New `contextfs/server`
1. Build HTTP + WS server in `contextfs/server`:
   - dashboard UI endpoint (usage metrics + client/virtual-client management).
   - WS endpoint for client registration and request dispatch.
2. Add scheduler/registry modules:
   - ws-client registry
   - virtual-client registry
   - workspace ownership registry
   - assignment engine (cpu/ram-aware).
3. Add `--local` mode:
   - server process self-attaches local adapter.
   - disable WS listener entirely in this mode.
4. Keep protocol compatibility with proven message shapes from remote-fs where practical:
   - `*_register`, `*_heartbeat`, `*_request`, `*_response`, stream chunks, cancel.
5. Add runtime workspace/session manager for MCP session workspace switching.

### Phase 3.1 — Dashboard and management UX
1. Build a new dashboard (Tailwind CDN + DaisyUI CDN + Vue 3 CDN) with:
   - connected WS clients
   - connected virtual clients per WS client
   - active workspaces
   - tool usage
   - tool errors
2. Add virtual-client-focused metrics panel:
   - active workspaces
   - tool usage
   - tool errors
3. Add WS client management table (and local mode equivalent where applicable):
   - name
   - apiKey (optional, regenerable)
   - status
   - last heartbeat
   - last error
4. Add virtual client management table:
   - name
   - apiKey (optional, regenerable)
   - status
   - last heartbeat
   - last error

### Phase 4 — MCP server integration
1. Implement MCP transport modes under `contextfs server --mcp`:
   - default stdio
   - `--mcp sse`
2. Expose tools (exact names):
   - Core FS: `contextfs.list`, `contextfs.read`, `contextfs.write`
   - Agent layer: `contextfs.list_workspaces`, `contextfs.use_workspace`, `contextfs.save_skill`, `contextfs.list_skills`, `contextfs.save_memory`, `contextfs.search_memory`
   - Advanced: `contextfs.bash_script_once`
3. Enforce deterministic, structured JSON responses and parameter validation against provided schemas.
4. Route MCP calls through assignment layer:
   - in normal server mode: execute on assigned WS client
   - in `--local` mode: execute via `LocalClientAdapter` only.

### Phase 5 — Chat TUI for MCP validation
1. Add `contextfs chat --mcp-server ... --model ...`.
2. OpenRouter bootstrap flow:
   - Prompt API key if missing.
   - Persist at `~/.contextfs/chat-config.json`.
3. Minimal loop for MCP tool-augmented test chat.

### Phase 6 — Documentation + migration safety
1. Update/create one consolidated feature doc for ContextFS in `docs/features/` (lowercase/hyphen naming).
2. Add migration notes from `client-legacy` to `client`.
3. Add runbook examples for all required CLI commands.
4. Document security model differences for non-docker vs docker client modes.
5. Document virtual-client and workspace ownership semantics.

### Phase 7 — Container strategy
1. Add bundled Docker assets under `contextfs/`.
2. Provide two images/profiles:
   - `contextfs/client:base`
   - `contextfs/client:full` (git/tree/rg/etc.)
3. Ensure `npx contextfs client --docker` selects profile (default `full`, flag override optional).

## Validation checklist
- `npx contextfs server` starts HTTP UI + WS.
- `npx contextfs client --url ws://localhost:3010` connects and heartbeats.
- `npx contextfs client --docker` starts dockerized client.
- `npx contextfs server --mcp` exposes MCP over stdio.
- `npx contextfs server --mcp sse` exposes MCP over SSE.
- `npx contextfs client --cwd /home/user/.contextfs/workspace` respects working root.
- `npx contextfs server --local` executes tool requests via local adapter and does not expose WS listener.
- `npx contextfs chat --mcp-server ws://localhost:3010 --model google/gemini-2.5-flash-lite` works with OpenRouter key bootstrap.
- All listed MCP tools validate inputs and return structured outputs.
- Virtual-client scheduling balances assignments using CPU/RAM snapshots.
- One WS client can host multiple virtual clients.
- One virtual client can own and operate across multiple workspaces.
- Non-docker workspace path model is enforced under `~/.contextfs/workspaces/{virtualClientId}/{workspaceId}`.
- Docker workspace path model is enforced under `/home/vc_{virtualClientId}/workspaces/{workspaceId}`.
- Guardrails reject path escape patterns (`..`, absolute path escape) and disallowed privilege patterns.

## Confirmed decisions
1. Implementation flow: in-repo first, extraction handled later by user.
2. Dockerized client: bundled Dockerfile/assets inside `contextfs/`.
3. Server UI: new dashboard for metrics and client management.
4. MCP routing: mode-based (`ws` in server mode, local adapter in `--local`).
5. `--local` mode must not accept WS clients.

## Remaining clarifications before implementation
1. Scheduling policy detail: should assignment use a weighted score (cpu%, ram%, hosted-count) with sticky affinity, or strict least-loaded each request?

sticky affinity, avoid switching assigned ws client once assigned

2. API key scope: should WS-client keys and virtual-client keys be optional metadata only for v1, or enforced on every operation for v1?

enforced

3. Docker user provisioning: for `vc_{virtualClientId}`, should user creation be performed by client bootstrap scripts only, or dynamically by runtime when virtual client is first assigned?

by runtime

## Coding guidelines

- < 500 LOC per file (non-negotiable)

## UI Stack

tailwindcdn, daisyuicdn, vue3 cdn (no deps)
iconset of choice (cdn)

