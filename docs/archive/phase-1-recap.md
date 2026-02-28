What was built

                                  contextfs/ — standalone package (no monorepo deps)

```
contextfs/
├── bin/contextfs.js          # CLI router: server | client subcommands
├── shared/protocol.js        # Message constants, tool names, JSON Schema validation
├── server/
│   ├── db/json-store.js      # Atomic JSON flat-file persistence (MongoDB-swappable interface)
│   ├── registry.js           # WS clients, virtual clients, workspaces — CRUD + API key lifecycle
│   ├── scheduler.js          # Sticky-affinity, CPU/RAM-aware assignment
│   ├── ws-handler.js         # WS message routing (register, heartbeat, response, dispatch)
│   ├── api-router.js         # REST API (CRUD + /api/dispatch endpoint)
│   └── index.js              # Express + WebSocketServer bootstrap on port 3010
├── client/
│   ├── utils.js              # parseArgs, resolveSafePath, isComplexShellCommand, etc.
│   ├── identity.js           # Persistent systemId (~/.contextfs/.machine-id)
│   ├── spawn.js              # runCommand, runCommandStreaming, timeout variant detection
│   ├── command-runner.js     # All 9 FS tools + raw command runner (no opencode)
│   ├── message-handler.js    # Incoming WS message routing to tools
│   ├── ws-client.js          # WS lifecycle, reconnect, heartbeat + CPU/RAM snapshots
│   └── main.js               # Entry point, arg parsing, boot
└── __tests__/
    ├── json-store.test.js    # 8 tests — CRUD, atomic writes, deep copy
    ├── registry.test.js      # 18 tests — ws-clients, virtual-clients, workspaces
    ├── scheduler.test.js     # 8 tests — sticky affinity, least-loaded, reassignment
    ├── client-utils.test.js  # 22 tests — path safety, shell detection, arg parsing
    ├── protocol.test.js      # 28 tests — schema validation for all 9 tools
    └── ws-integration.test.js # 5 tests — full server+client connect/register/dispatch roundtrip
```

                                                    Key behaviours

 • API keys enforced on every WS register message; REST /api/dispatch enforces virtual client key
 • bash_script_once blocked unless --insecure flag is passed to the client
 • Sticky affinity scheduling: VCs stay on their assigned WS client while it's connected; reassigned on disconnect
 • DB wrapper abstraction: JsonStore exposes get/set/delete/list — swap MongoStore later with same interface
 • Capability snapshots: every heartbeat sends cpuLoad, freeMemMb, totalMemMb, cpuCount

                                                        Usage

```bash
# Start server
node bin/contextfs.js server --port 3010

# Create a WS client via REST (get the API key from the response)
curl -X POST http://localhost:3010/api/ws-clients -H 'Content-Type: application/json' -d '{"name":"my-node"}'

# Start client
node bin/contextfs.js client --url ws://localhost:3010 --ws-client-id <id> --api-key <key>
```

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
What would you like to do next? Some natural options:

 • Phase 4 (MCP) — raw stdio/SSE MCP server exposing all 9 tools
 • Dashboard UI — Tailwind/DaisyUI/Vue3 CDN panel for managing clients
 • --local mode — server self-attaches a local adapter without accepting WS clients
 • npx publishing — make it installable globally via npm link or publish
