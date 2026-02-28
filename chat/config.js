'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const CONTEXTFS_HOME = path.join(os.homedir(), '.contextfs');
const CONFIG_PATH = path.join(CONTEXTFS_HOME, 'chat-config.json');

const DEFAULTS = {
  model: 'google/gemini-2.5-flash-preview',
  maxTokens: 4096,
  temperature: 0.7,
};

/**
 * Load config from ~/.contextfs/chat-config.json.
 * Returns {} if missing or invalid.
 */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

/**
 * Persist config to ~/.contextfs/chat-config.json.
 */
function saveConfig(config) {
  if (!fs.existsSync(CONTEXTFS_HOME)) {
    fs.mkdirSync(CONTEXTFS_HOME, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Prompt the user for a value on the terminal.
 * Returns the trimmed string.
 */
function prompt(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: silent ? null : process.stdout,
      terminal: silent,
    });

    if (silent) {
      // For API key input — write question to stderr, hide input
      process.stderr.write(question);
      process.stdin.setRawMode && process.stdin.setRawMode(true);
      let answer = '';
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData = (ch) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0003') {
          process.stdin.setRawMode && process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          process.stderr.write('\n');
          rl.close();
          resolve(answer.trim());
        } else if (ch === '\u007f' || ch === '\b') {
          answer = answer.slice(0, -1);
        } else {
          answer += ch;
        }
      };
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/**
 * Bootstrap: ensure we have an OpenRouter API key.
 * - Check OPENROUTER_API_KEY env first.
 * - Then check config file.
 * - If missing, prompt the user and persist.
 * Returns { apiKey, model, maxTokens, temperature, vcId, vcKey }
 */
async function bootstrapConfig({ model, maxTokens, temperature, vcId: vcIdArg, vcKey: vcKeyArg } = {}) {
  const config = loadConfig();

  // API key resolution order: env → config → prompt
  let apiKey = process.env.OPENROUTER_API_KEY || config.apiKey || '';

  if (!apiKey) {
    process.stderr.write('\n[Chat] No OpenRouter API key found.\n');
    process.stderr.write('[Chat] Get one at https://openrouter.ai/keys\n\n');

    try {
      apiKey = await prompt('Enter your OpenRouter API key: ', { silent: true });
    } catch (_) {
      apiKey = await prompt('Enter your OpenRouter API key: ');
    }

    if (!apiKey) {
      throw new Error('OpenRouter API key is required. Set OPENROUTER_API_KEY or enter it when prompted.');
    }

    config.apiKey = apiKey;
    saveConfig(config);
    process.stderr.write(`[Chat] API key saved to ${CONFIG_PATH}\n`);
  }

  // VC credentials resolution order: arg → env → config → prompt
  let vcId = vcIdArg || process.env.CONTEXTFS_VC_ID || config.vcId || '';
  let vcKey = vcKeyArg || process.env.CONTEXTFS_VC_KEY || config.vcKey || '';

  let needsSave = false;

  if (!vcId) {
    process.stderr.write('\n[Chat] No Virtual Client ID (vcId) found.\n');
    vcId = await prompt('Enter your Virtual Client ID: ');
    if (vcId) {
      config.vcId = vcId;
      needsSave = true;
    }
  }

  if (!vcKey) {
    process.stderr.write('\n[Chat] No Virtual Client Key (vcKey) found.\n');
    vcKey = await prompt('Enter your Virtual Client Key: ');
    if (vcKey) {
      config.vcKey = vcKey;
      needsSave = true;
    }
  }

  if (needsSave) {
    saveConfig(config);
    process.stderr.write(`[Chat] VC credentials saved to ${CONFIG_PATH}\n`);
  }

  const resolvedModel = model || config.model || DEFAULTS.model;
  const resolvedMaxTokens = maxTokens || config.maxTokens || DEFAULTS.maxTokens;
  const resolvedTemp = temperature !== undefined ? temperature : (config.temperature ?? DEFAULTS.temperature);

  return {
    apiKey,
    vcId,
    vcKey,
    model: resolvedModel,
    maxTokens: resolvedMaxTokens,
    temperature: resolvedTemp,
    configPath: CONFIG_PATH,
  };
}

module.exports = { bootstrapConfig, loadConfig, saveConfig, mergeConfig, prompt, CONFIG_PATH, CONTEXTFS_HOME };

/**
 * Deep merge updates into existing config and save.
 * Returns the merged config.
 */
function mergeConfig(updates) {
  const existing = loadConfig();
  const merged = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  saveConfig(merged);
  return merged;
}
