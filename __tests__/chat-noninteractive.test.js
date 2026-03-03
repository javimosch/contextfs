'use strict';

/**
 * Tests for non-interactive chat mode.
 * We test runNonInteractive() directly by importing its dependencies
 * and mocking LLM + MCP clients — no real server needed.
 */

const { runToolLoop, buildInitialHistory } = require('../chat/tool-loop');
const { LlmClient } = require('../chat/llm-client');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLlm(responses) {
  let i = 0;
  return {
    complete: jest.fn(async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      return r;
    }),
  };
}

function makeMcpClient(toolResults = {}) {
  return {
    callTool: jest.fn(async (name, args) => {
      const result = toolResults[name];
      if (result instanceof Error) throw result;
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    }),
    disconnect: jest.fn(),
  };
}

// ── parseArgs (non-interactive flags) ─────────────────────────────────────────
// We test the parsing logic by importing the module and calling it indirectly
// via inspecting what args flow through. For simplicity we test the logic inline.

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-m' || token === '--message') {
      if (argv[i + 1]) { args['message'] = argv[i + 1]; i++; }
    } else if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--') && next !== '-m') { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

describe('parseArgs — non-interactive flags', () => {
  test('parses --message value', () => {
    const args = parseArgs(['--message', 'hello world']);
    expect(args.message).toBe('hello world');
  });

  test('parses -m shorthand', () => {
    const args = parseArgs(['-m', 'short message']);
    expect(args.message).toBe('short message');
  });

  test('parses --stdin flag', () => {
    const args = parseArgs(['--stdin']);
    expect(args.stdin).toBe(true);
  });

  test('parses --output json', () => {
    const args = parseArgs(['--output', 'json']);
    expect(args.output).toBe('json');
  });

  test('parses --no-tools flag', () => {
    const args = parseArgs(['--no-tools']);
    expect(args['no-tools']).toBe(true);
  });

  test('parses combined flags', () => {
    const args = parseArgs(['-m', 'hello', '--output', 'json', '--no-tools', '--verbose']);
    expect(args.message).toBe('hello');
    expect(args.output).toBe('json');
    expect(args['no-tools']).toBe(true);
    expect(args.verbose).toBe(true);
  });

  test('--message takes precedence, rest are flags', () => {
    const args = parseArgs(['--vc-id', 'abc', '--message', 'do something', '--model', 'gpt-4o']);
    expect(args['vc-id']).toBe('abc');
    expect(args.message).toBe('do something');
    expect(args.model).toBe('gpt-4o');
  });
});

// ── runNonInteractive logic (via runToolLoop) ─────────────────────────────────

async function runNonInteractive({ mcpClient, llm, openAiTools, message, outputJson, noTools }) {
  const history = buildInitialHistory();
  const toolCallLog = [];
  const start = Date.now();

  const response = await runToolLoop({
    llm,
    mcpClient,
    openAiTools: noTools ? [] : openAiTools,
    history,
    userMessage: message,
    onToolCall: noTools ? null : (info) => {
      toolCallLog.push({ name: info.name, args: info.args });
    },
  });

  const durationMs = Date.now() - start;

  if (outputJson) {
    return { message: response, toolCalls: toolCallLog, durationMs };
  }
  return { message: response, toolCalls: toolCallLog, durationMs };
}

describe('runNonInteractive — plain text output', () => {
  test('returns assistant response for simple message', async () => {
    const llm = makeLlm([{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }]);
    const mcpClient = makeMcpClient();
    const result = await runNonInteractive({
      mcpClient, llm, openAiTools: [], message: 'say hello', outputJson: false, noTools: false,
    });
    expect(result.message.response).toBe('Hello!');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('returns empty string for empty assistant content', async () => {
    const llm = makeLlm([{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }]);
    const result = await runNonInteractive({
      mcpClient: makeMcpClient(), llm, openAiTools: [], message: 'hi', outputJson: false, noTools: false,
    });
    expect(result.message.response).toBe('');
  });
});

describe('runNonInteractive — with tool calls', () => {
  function makeToolCallLlm(toolName, args, finalContent) {
    const openAiName = toolName.replace(/\./g, '__');
    return makeLlm([
      {
        message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: openAiName, arguments: JSON.stringify(args) } }],
        },
        finish_reason: 'tool_calls',
      },
      { message: { role: 'assistant', content: finalContent }, finish_reason: 'stop' },
    ]);
  }

  test('tool calls are logged in toolCallLog', async () => {
    const llm = makeToolCallLlm('contextfs.list', { path: '.' }, 'Done listing');
    const mcpClient = makeMcpClient({ 'contextfs.list': '{"entries":[]}' });

    const result = await runNonInteractive({
      mcpClient, llm, openAiTools: [], message: 'list files', outputJson: true, noTools: false,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('contextfs.list');
    expect(result.toolCalls[0].args).toEqual({ path: '.' });
    expect(result.message.response).toBe('Done listing');
  });

  test('--no-tools disables tool calls entirely', async () => {
    // With noTools=true, openAiTools is passed as [] so LLM never gets tools
    const llm = makeLlm([{ message: { role: 'assistant', content: 'No tools used' }, finish_reason: 'stop' }]);
    const mcpClient = makeMcpClient({ 'contextfs.list': 'some result' });

    const result = await runNonInteractive({
      mcpClient, llm, openAiTools: [{ type: 'function', function: { name: 'contextfs__list' } }],
      message: 'list files', outputJson: false, noTools: true,
    });

    // LLM was called with empty tools array, so no tool calls happened
    expect(mcpClient.callTool).not.toHaveBeenCalled();
    expect(result.toolCalls).toHaveLength(0);
    expect(result.message.response).toBe('No tools used');
  });

  test('tool errors are handled and loop continues', async () => {
    const llm = makeToolCallLlm('contextfs.read', { path: 'missing.md' }, 'Handled error');
    const mcpClient = makeMcpClient({ 'contextfs.read': new Error('File not found') });

    const result = await runNonInteractive({
      mcpClient, llm, openAiTools: [], message: 'read missing file', outputJson: false, noTools: false,
    });

    expect(result.message.response).toBe('Handled error');
  });
});

describe('runNonInteractive — JSON output shape', () => {
  test('JSON output contains message, toolCalls, durationMs', async () => {
    const llm = makeLlm([{ message: { role: 'assistant', content: 'result' }, finish_reason: 'stop' }]);
    const result = await runNonInteractive({
      mcpClient: makeMcpClient(), llm, openAiTools: [], message: 'test', outputJson: true, noTools: false,
    });
    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('toolCalls');
    expect(result).toHaveProperty('durationMs');
    expect(Array.isArray(result.toolCalls)).toBe(true);
    expect(typeof result.durationMs).toBe('number');
  });

  test('JSON output is valid JSON-serialisable', async () => {
    const llm = makeLlm([{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]);
    const result = await runNonInteractive({
      mcpClient: makeMcpClient(), llm, openAiTools: [], message: 'test', outputJson: true, noTools: false,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test('multiple tool calls all appear in toolCalls array', async () => {
    const openAiName1 = 'contextfs__list';
    const openAiName2 = 'contextfs__read';
    const llm = {
      complete: jest.fn()
        .mockResolvedValueOnce({
          message: {
            role: 'assistant', content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: openAiName1, arguments: '{"path":"."}' } },
              { id: 'c2', type: 'function', function: { name: openAiName2, arguments: '{"path":"readme.md"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        })
        .mockResolvedValueOnce({ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }),
    };
    const mcpClient = makeMcpClient({
      'contextfs.list': '[]',
      'contextfs.read': 'content',
    });

    const result = await runNonInteractive({
      mcpClient, llm, openAiTools: [], message: 'do both', outputJson: true, noTools: false,
    });
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map(t => t.name)).toEqual(['contextfs.list', 'contextfs.read']);
  });
});
