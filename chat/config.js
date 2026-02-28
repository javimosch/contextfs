'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');

const CONTEXTFS_HOME = path.join(os.homedir(), '.contextfs');
const CONFIG_PATH = path.join(CONTEXTFS_HOME, 'chat-config.json');

const DEFAULTS = {
  model: 'google/gemini-2.5-flash-preview',
  maxTokens: 4096,
  temperature: 0.7,
  baseUrl: 'https://openrouter.ai/api/v1',
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
 * Generate a new Virtual Client ID.
 */
function generateVcId() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Generate a new Virtual Client API key.
 */
function generateVcKey() {
  return 'cfs_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Bootstrap: ensure we have an OpenRouter API key.
 * - Check OPENROUTER_API_KEY env first.
 * - Then check config file.
 * - If missing, prompt the user and persist.
 * 
 * When spawn is true and VC credentials are missing, auto-provision them
 * instead of prompting (for MCP stdio mode).
 * 
 * Returns { apiKey, model, maxTokens, temperature, vcId, vcKey }
 */
async function bootstrapConfig({ model, maxTokens, temperature, vcId: vcIdArg, vcKey: vcKeyArg, baseUrl: baseUrlArg, spawn = false } = {}) {
  const config = loadConfig();

  // API key resolution order: env → config → prompt
  let apiKey = process.env.OPENROUTER_API_KEY || config.apiKey || '';

  if (!apiKey) {
    process.stderr.write('\n[Chat] No API key found.\n');
    process.stderr.write('[Chat] Get an API key from your provider (default: https://openrouter.ai/keys)\n\n');

    try {
      apiKey = await prompt('Enter your API key: ', { silent: true });
    } catch (_) {
      apiKey = await prompt('Enter your API key: ');
    }

    if (!apiKey) {
      throw new Error('API key is required. Set OPENROUTER_API_KEY or enter it when prompted.');
    }

    config.apiKey = apiKey;
    saveConfig(config);
    process.stderr.write(`[Chat] API key saved to ${CONFIG_PATH}\n`);
  }

  // VC credentials resolution order: arg → env → config → auto-generate (if spawn) → prompt
  let vcId = vcIdArg || process.env.CONTEXTFS_VC_ID || config.vcId || '';
  let vcKey = vcKeyArg || process.env.CONTEXTFS_VC_KEY || config.vcKey || '';

  let needsSave = false;

  if (!vcId) {
    if (spawn) {
      // Auto-provision for --spawn mode (stdio MCP)
      vcId = generateVcId();
      process.stderr.write(`[Chat] Auto-provisioned Virtual Client ID: ${vcId}\n`);
    } else {
      process.stderr.write('\n[Chat] No Virtual Client ID (vcId) found.\n');
      vcId = await prompt('Enter your Virtual Client ID: ');
    }
    if (vcId) {
      config.vcId = vcId;
      needsSave = true;
    }
  }

  if (!vcKey) {
    if (spawn) {
      // Auto-provision for --spawn mode (stdio MCP)
      vcKey = generateVcKey();
      process.stderr.write(`[Chat] Auto-provisioned Virtual Client Key: ${vcKey.slice(0, 8)}...\n`);
    } else {
      process.stderr.write('\n[Chat] No Virtual Client Key (vcKey) found.\n');
      vcKey = await prompt('Enter your Virtual Client Key: ');
    }
    if (vcKey) {
      config.vcKey = vcKey;
      needsSave = true;
    }
  }

  if (needsSave) {
    saveConfig(config);
    process.stderr.write(`[Chat] VC credentials saved to ${CONFIG_PATH}\n`);
  }

  // Interactive setup for model and baseUrl when in spawn mode
  if (spawn) {
    if (!config.model && !model) {
      const defaultModel = DEFAULTS.model;
      const modelInput = await prompt(`Enter model name [${defaultModel}]: `);
      config.model = modelInput || defaultModel;
      needsSave = true;
    }

    if (!config.baseUrl && !baseUrlArg) {
      const defaultBaseUrl = DEFAULTS.baseUrl;
      const baseUrlInput = await prompt(`Enter API base URL [${defaultBaseUrl}]: `);
      config.baseUrl = baseUrlInput || defaultBaseUrl;
      needsSave = true;
    }
  }

  if (needsSave) {
    saveConfig(config);
    process.stderr.write(`[Chat] Configuration saved to ${CONFIG_PATH}\n`);
  }

  const resolvedModel = model || config.model || DEFAULTS.model;
  const resolvedMaxTokens = maxTokens || config.maxTokens || DEFAULTS.maxTokens;
  const resolvedTemp = temperature !== undefined ? temperature : (config.temperature ?? DEFAULTS.temperature);
  const resolvedBaseUrl = baseUrlArg || config.baseUrl || DEFAULTS.baseUrl;

  return {
    apiKey,
    vcId,
    vcKey,
    model: resolvedModel,
    maxTokens: resolvedMaxTokens,
    temperature: resolvedTemp,
    baseUrl: resolvedBaseUrl,
    configPath: CONFIG_PATH,
  };
}

module.exports = { bootstrapConfig, loadConfig, saveConfig, mergeConfig, validateConfigKeys, prompt, CONFIG_PATH, CONTEXTFS_HOME };

/**
 * Supported config keys.
 */
const SUPPORTED_KEYS = ['model', 'maxTokens', 'temperature', 'apiKey', 'vcId', 'vcKey', 'baseUrl'];

/**
 * Validate config keys.
 * Returns { valid: boolean, errors: string[] }
 */
function validateConfigKeys(updates) {
  const errors = [];
  for (const key of Object.keys(updates)) {
    if (!SUPPORTED_KEYS.includes(key)) {
      errors.push(`Unsupported config key: ${key}. Supported: ${SUPPORTED_KEYS.join(', ')}`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Deep merge updates into existing config and save.
 * Returns the merged config.
 * Throws if any keys are unsupported.
 */
function mergeConfig(updates) {
  const validation = validateConfigKeys(updates);
  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }
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
