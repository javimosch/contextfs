'use strict';

const { LlmClient } = require('../chat/llm-client');

describe('LlmClient', () => {
  test('throws if apiKey missing', () => {
    expect(() => new LlmClient({ model: 'gpt-4' })).toThrow(/apiKey/);
  });

  test('throws if model missing', () => {
    expect(() => new LlmClient({ apiKey: 'key' })).toThrow(/model/);
  });

  test('creates instance with valid params', () => {
    const llm = new LlmClient({ apiKey: 'test-key', model: 'gpt-4o' });
    expect(llm).toBeDefined();
  });
});

describe('LlmClient.mcpToolsToOpenAi', () => {
  const mcpTools = [
    {
      name: 'contextfs.list',
      description: 'List files',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    },
    {
      name: 'contextfs.read',
      description: 'Read a file',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    },
    {
      name: 'contextfs.bash_script_once',
      description: 'Run bash',
      inputSchema: { type: 'object', required: ['script'], properties: { script: { type: 'string' } } },
    },
  ];

  test('converts MCP tools to OpenAI format', () => {
    const openAiTools = LlmClient.mcpToolsToOpenAi(mcpTools);
    expect(openAiTools).toHaveLength(3);
    for (const t of openAiTools) {
      expect(t.type).toBe('function');
      expect(t.function.name).toBeDefined();
      expect(t.function.description).toBeDefined();
      expect(t.function.parameters).toBeDefined();
    }
  });

  test('replaces dots with double underscores in function names', () => {
    const openAiTools = LlmClient.mcpToolsToOpenAi(mcpTools);
    for (const t of openAiTools) {
      expect(t.function.name).not.toContain('.');
      expect(t.function.name).toContain('__');
    }
    expect(openAiTools[0].function.name).toBe('contextfs__list');
    expect(openAiTools[2].function.name).toBe('contextfs__bash_script_once');
  });

  test('preserves inputSchema as parameters', () => {
    const openAiTools = LlmClient.mcpToolsToOpenAi(mcpTools);
    expect(openAiTools[0].function.parameters).toEqual(mcpTools[0].inputSchema);
  });

  test('openAiNameToMcp reverses the conversion', () => {
    const openAiTools = LlmClient.mcpToolsToOpenAi(mcpTools);
    for (let i = 0; i < mcpTools.length; i++) {
      expect(LlmClient.openAiNameToMcp(openAiTools[i].function.name)).toBe(mcpTools[i].name);
    }
  });

  test('handles empty tools array', () => {
    expect(LlmClient.mcpToolsToOpenAi([])).toEqual([]);
  });
});

describe('LlmClient HTTP (mock)', () => {
  test('complete() makes POST to /chat/completions and returns parsed response', async () => {
    const mockResponse = {
      choices: [{
        message: { role: 'assistant', content: 'Hello there!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    // Mock the internal _post method
    const llm = new LlmClient({ apiKey: 'test', model: 'test-model', baseUrl: 'http://localhost:9999' });
    llm._post = async (endpoint, body) => {
      expect(endpoint).toBe('/chat/completions');
      expect(body.model).toBe('test-model');
      expect(body.messages).toHaveLength(1);
      return mockResponse;
    };

    const result = await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.message.content).toBe('Hello there!');
    expect(result.finish_reason).toBe('stop');
    expect(result.usage.total_tokens).toBe(15);
  });

  test('complete() includes tools in request when provided', async () => {
    const llm = new LlmClient({ apiKey: 'test', model: 'test-model' });
    llm._post = async (endpoint, body) => {
      expect(body.tools).toHaveLength(1);
      expect(body.tool_choice).toBe('auto');
      return {
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      };
    };

    const tools = [{ type: 'function', function: { name: 'test', description: 'test', parameters: {} } }];
    const result = await llm.complete({
      messages: [{ role: 'user', content: 'hi' }],
      tools,
    });
    expect(result.message.content).toBe('ok');
  });

  test('complete() does not include tools when array is empty', async () => {
    const llm = new LlmClient({ apiKey: 'test', model: 'test-model' });
    llm._post = async (endpoint, body) => {
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
      return {
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      };
    };
    await llm.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
  });

  test('complete() throws on API error response', async () => {
    const llm = new LlmClient({ apiKey: 'test', model: 'test-model' });
    llm._post = async () => { throw new Error('OpenRouter API error: Unauthorized'); };
    await expect(llm.complete({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow('Unauthorized');
  });

  test('complete() throws if choices is empty', async () => {
    const llm = new LlmClient({ apiKey: 'test', model: 'test-model' });
    llm._post = async () => ({ choices: [] });
    await expect(llm.complete({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/unexpected response/i);
  });
});
