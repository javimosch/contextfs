'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const { parseArgs, toWebSocketUrl, getEnv, logVerbose } = require('./utils');
const { getClientIdentity, getSystemId } = require('./identity');
const { createWsClient } = require('./ws-client');
const { createMessageHandler } = require('./message-handler');

// ============ DOCKER MODE RE-EXEC (must be first) ============
// Detect --docker flag early and re-exec inside container
// This must run BEFORE any async setup to avoid hanging processes
if (process.argv.includes('--docker')) {
  const { spawn } = require('child_process');
  const os = require('os');

  // Filter out --docker from arguments to pass to containerized client
  const filteredArgs = process.argv.slice(3).filter(arg => arg !== '--docker');

  // Determine mount points
  const cwd = process.cwd();
  const homeDir = os.homedir();
  const contextfsHome = path.join(homeDir, '.contextfs');

  // Prepare docker run command
  const dockerArgs = [
    'run',
    '--init',           // Use Docker's init as PID 1 (alternative to tini, but we use tini in image)
    '--rm',             // Remove container after exit
    '-it',              // Interactive + TTY for client interaction
    '-v', `${cwd}:/workspace`,           // Mount current directory
    '-v', `${contextfsHome}:${contextfsHome}`,  // Mount contextfs home for config
    '-w', '/workspace', // Set working directory in container
    'contextfs/client:base',  // Image name (must be built first)
    'node',
    '/app/bin/contextfs.js',
    'client',           // Subcommand
    ...filteredArgs     // All other arguments
  ];

  // Spawn docker run and inherit stdio (streams output directly)
  const child = spawn('docker', dockerArgs, { stdio: 'inherit' });

  // Propagate exit code from container to parent process
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // If docker itself fails to spawn, exit with error
  child.on('error', (err) => {
    console.error('[Client] Failed to spawn Docker container:', err.message);
    console.error('[Client] Ensure Docker is installed and running, and the contextfs/client:base image is built.');
    process.exit(1);
  });

  // Exit early — the spawned process takes over
  // We need to export main even if we return early so require() doesn't fail
  module.exports = { main: async () => {}, processExit: () => {} };
  return;
}
// ============ END DOCKER MODE ============

const CONTEXTFS_HOME = path.join(os.homedir(), '.contextfs');
const DEFAULT_WORKSPACE_ROOT = path.join(CONTEXTFS_HOME, 'workspaces');

function processExit(code) {
  console.log(`[Client] Exiting with code ${code} in 10 seconds...`);
  setTimeout(() => process.exit(code), 10000);
}

async function main() {
  // Skip first two args (node, contextfs.js) and subcommand ('client')
  const rawArgv = ['', '', ...process.argv.slice(3)];
  const args = parseArgs(rawArgv);

  const serverUrl = args['url'] || getEnv('SERVER_URL');
  const wsClientId = args['ws-client-id'] || getEnv('WS_CLIENT_ID');
  const apiKey = args['api-key'] || getEnv('API_KEY');
  const cwdArg = args['cwd'] || getEnv('CWD');
  const insecure = args['insecure'] === true || getEnv('INSECURE') === '1';
  const verbose = args['verbose'] === true || getEnv('VERBOSE') === '1';

  global._contextfsVerbose = verbose;

  if (!serverUrl) {
    process.stderr.write('[Client] Error: --url <wsUrl> is required (or CONTEXTFS_SERVER_URL)\n');
    process.stderr.write('Usage: contextfs client --url ws://localhost:3010 --ws-client-id <id> --api-key <key>\n');
    processExit(1);
    return;
  }

  if (!wsClientId || !apiKey) {
    process.stderr.write('[Client] Error: --ws-client-id and --api-key are required (or CONTEXTFS_WS_CLIENT_ID / CONTEXTFS_API_KEY)\n');
    processExit(1);
    return;
  }

  // Determine workspace root
  let workspaceRoot = cwdArg
    ? path.resolve(cwdArg)
    : path.join(DEFAULT_WORKSPACE_ROOT, wsClientId);

  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    console.log(`[Client] Created workspace root: ${workspaceRoot}`);
  }

  console.log(`[Client] ContextFS Client v1.0.0`);
  console.log(`[Client] Server: ${serverUrl}`);
  console.log(`[Client] WS Client ID: ${wsClientId}`);
  console.log(`[Client] Workspace Root: ${workspaceRoot}`);
  if (insecure) console.warn('[Client] WARNING: --insecure mode enabled (bash_script_once allowed)');

  const systemId = getSystemId();
  let hostname = os.hostname();
  const clientName = getEnv('CLIENT_NAME');
  if (clientName) hostname = clientName;
  else if (fs.existsSync('/.dockerenv')) hostname = `Docker-${systemId.slice(0, 6)}`;

  const clientMeta = {
    hostname,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    systemId,
    identity: getClientIdentity(),
    workspaceRoot,
    insecure,
  };

  const wsUrl = toWebSocketUrl(serverUrl);

  const messageHandler = createMessageHandler({
    wsClientId,
    apiKey,
    workspaceRoot,
    insecure,
    verbose,
    clientMeta,
  });

  const wsClient = createWsClient({
    wsUrl,
    wsClientId,
    apiKey,
    clientMeta,
    onMessage: messageHandler,
    processExit,
  });

  wsClient.connect();
}

module.exports = { main, processExit };

if (require.main === module) {
  main().catch((err) => {
    console.error('[Client] Unhandled error:', err.message);
    process.exit(1);
  });
}
