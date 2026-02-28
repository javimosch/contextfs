'use strict';

const https = require('https');
const http = require('http');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/**
 * LlmClient — OpenRouter chat completions with tool_calls support.
 *
 * Compatible with any OpenAI-format API endpoint.
 */
class LlmClient {
  constructor({ apiKey, model, maxTokens = 4096, temperature = 0.7, baseUrl = OPENROUTER_BASE } = {}) {
    if (!apiKey) throw new Error('LlmClient: apiKey is required');
    if (!model) throw new Error('LlmClient: model is required');
    this._apiKey = apiKey;
    this._model = model;
    this._maxTokens = maxTokens;
    this._temperature = temperature;
    this._baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Send a chat completion request.
   *
   * @param {Array} messages  — OpenAI-format message array
   * @param {Array} tools     — Optional array of tool definitions (OpenAI tool_calls format)
   * @returns {object}        — { message, usage, finish_reason }
   *   message: { role, content, tool_calls? }
   */
  async complete({ messages, tools = [] }) {
    const body = {
      model: this._model,
      messages,
      max_tokens: this._maxTokens,
      temperature: this._temperature,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const data = await this._post('/chat/completions', body);

    if (!data.choices || !data.choices[0]) {
      throw new Error(`LLM API returned unexpected response: ${JSON.stringify(data)}`);
    }

    const choice = data.choices[0];
    return {
      message: choice.message,
      usage: data.usage || null,
      finish_reason: choice.finish_reason,
    };
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _post(endpoint, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const url = new URL(`${this._baseUrl}${endpoint}`);
      const transport = url.protocol === 'https:' ? https : http;

      const opts = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': `Bearer ${this._apiKey}`,
          'HTTP-Referer': 'https://github.com/contextfs',
          'X-Title': 'contextfs-chat',
        },
      };

      const req = transport.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const errMsg = parsed?.error?.message || parsed?.message || `HTTP ${res.statusCode}`;
              reject(new Error(`OpenRouter API error: ${errMsg}`));
            } else {
              resolve(parsed);
            }
          } catch (_) {
            reject(new Error(`Failed to parse API response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(60000, () => {
        req.destroy();
        reject(new Error('LLM API request timed out'));
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Convert MCP tool definitions to OpenAI tool_calls format.
   */
  static mcpToolsToOpenAi(mcpTools) {
    return mcpTools.map(t => ({
      type: 'function',
      function: {
        name: t.name.replace(/\./g, '__'), // OpenAI doesn't allow dots in function names
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  /**
   * Convert OpenAI function name back to MCP tool name.
   */
  static openAiNameToMcp(name) {
    return name.replace(/__/g, '.');
  }
}

module.exports = { LlmClient };
