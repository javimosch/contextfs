# ContextFS v1 Migration Guide

This guide details the transition from early ContextFS prototypes to the stable v1 release.

## Key Changes in v1

### 1. Registry-Backed Workspaces
In v1, workspace context is persisted in the Server's Registry. When an agent calls `contextfs.use_workspace`, the active workspace ID is stored and survives server/client restarts.

**Impact:** You no longer need to pass `workspaceId` to every tool call; the session maintains its active workspace.

### 2. Stateless WS Clients
WS Clients (workers) are now stateless. They resolve paths based on parameters provided by the server. 

**Impact:** Workers can be restarted or replaced without losing logical workspace definitions, as the definitions reside in the central server.

### 3. Unified CLI
All functionality is now bundled under the `contextfs` command.

| Old Command | New Command |
|-------------|-------------|
| `node server.js` | `npx contextfs server` |
| `node client.js` | `npx contextfs client` |
| `node chat.js` | `npx contextfs chat` |

## Environment Variables Update

Ensure your deployment scripts are updated to use the standard GSD-compatible variables:

- `CONTEXTFS_LOCAL=1` replaces `--local` flag in env.
- `CONTEXTFS_INSECURE=1` enables bash script execution.
- `CONTEXTFS_SERVER_URL` for WS clients to find the hub.

## Data Migration

If you are moving from a prototype that stored state in the current directory, v1 defaults to `~/.contextfs/`.

To migrate manually:
1. Stop all processes.
2. Move your `ws-clients.json` and `virtual-clients.json` to `~/.contextfs/`.
3. Move `workspaces/` content to `~/.contextfs/workspaces/`.
4. Restart the server.
