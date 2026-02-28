# ContextFS Operator Runbook

Operational guidance for managing a ContextFS cluster.

## Cluster Management

### Adding Workers (WS Clients)
1. Create a new WS client via the Dashboard or API:
   `POST /api/ws-clients {"name": "worker-N"}`
2. Copy the generated `apiKey`.
3. Start the client on the target machine:
   ```bash
   CONTEXTFS_API_KEY=<key> npx contextfs client --url ws://<hub-ip>:3010 --ws-client-id <id>
   ```

### Scaling
ContextFS uses a **Sticky Affinity Scheduler**. Virtual clients remain assigned to the same worker as long as it is healthy. To scale:
- Add more workers to handle more Virtual Clients.
- The hub will automatically balance new assignments based on reported CPU/RAM metrics.

## Security Operations

### API Key Rotation
If a key is compromised:
1. Use the Dashboard or API to regenerate the key:
   `POST /api/ws-clients/:id/regen-key`
2. Update the worker's environment variable and restart it.

### Path Sandboxing
All file operations are guarded by `realpath` validation. If you see "Access denied" errors, it usually means the agent tried to use `../` to escape the workspace. This is expected behavior.

## Troubleshooting

### WebSocket Disconnects
- **Symptoms**: Dashboard shows worker as "Offline".
- **Fix**: Check network connectivity. Workers have automatic reconnect logic, but firewalls might block port 3010.

### "No WS client available"
- **Symptoms**: Chat TUI or MCP calls fail.
- **Fix**: Ensure at least one WS client is registered and connected. In local mode, ensure `--local` flag is set.

### High Resource Usage
- **Symptoms**: Latency in tool execution.
- **Fix**: Check the Dashboard for CPU/RAM spikes on specific nodes. Consider adding more nodes.
