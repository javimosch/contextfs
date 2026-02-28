'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { logVerbose } = require('./utils');

const CONTEXTFS_HOME = path.join(os.homedir(), '.contextfs');

function getClientIdentity() {
  let username = 'node';
  try {
    const info = os.userInfo();
    if (info && info.username && info.username !== 'unknown') username = info.username;
  } catch (_) {}

  let ip = '127.0.0.1';
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) { ip = iface.address; break; }
      }
      if (ip !== '127.0.0.1') break;
    }
  } catch (_) {}

  return `${username}@${ip}`;
}

/**
 * Generate or load a persistent system identifier.
 * Storage priority: ~/.contextfs/.machine-id → /etc/machine-id → hardware → random
 */
function getSystemId() {
  const persistentPath = path.join(CONTEXTFS_HOME, '.machine-id');

  try {
    if (!fs.existsSync(CONTEXTFS_HOME)) {
      fs.mkdirSync(CONTEXTFS_HOME, { recursive: true });
    }

    if (fs.existsSync(persistentPath) && fs.statSync(persistentPath).size > 0) {
      const id = fs.readFileSync(persistentPath, 'utf8').trim();
      logVerbose(`Using persistent systemId from ${persistentPath}`);
      return id;
    }

    if (fs.existsSync('/etc/machine-id') && fs.statSync('/etc/machine-id').size > 0) {
      const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      logVerbose('Using systemId from /etc/machine-id');
      try { fs.writeFileSync(persistentPath, id); } catch (_) {}
      return id;
    }

    let id = '';
    try {
      const cmd = "(cat /var/lib/dbus/machine-id 2>/dev/null || cat /sys/class/net/eth0/address 2>/dev/null) | head -n1";
      id = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
    } catch (_) {}

    if (!id) {
      id = crypto.randomBytes(16).toString('hex');
      logVerbose('Generated new random systemId');
    }

    try { fs.writeFileSync(persistentPath, id); } catch (_) {}
    return id;
  } catch (_) {
    return `${os.hostname()}-${process.platform}-${process.arch}`;
  }
}

module.exports = { getClientIdentity, getSystemId };
