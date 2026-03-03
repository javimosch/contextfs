'use strict';

const { runToolLoop, buildInitialHistory, MAX_TOOL_ITERATIONS, SYSTEM_PROMPT } = require('../chat/tool-loop');
const { LlmClient } = require('../chat/llm-client');

// ── buildInitialHistory ───────────────────────────────────────────────────────
describe('buildInitialHistory', () => {
  test('returns array with system message', () => {
    const h = buildInitialHistory();
    expect(h).toHaveLength(1);
    expect(h[0].role).toBe('system');
    expect(h[0].content).toBe(SYSTEM_PROMPT);
  });

  test('each call returns a fresh array', () => {
    const h1 = buildInitialHistory();
    const h2 = buildInitialHistory();
    h1.push({ role: 'user', content: 'hi' });
    expect(h2).toHaveLength(1);
  });
});

// ── runToolLoop — no tool calls ───────────────────────────────────────────────
describe('runToolLoop — no tool calls', () => {
  function makeMocks(content) {
    const llm = { complete: jest.fn().mockResolvedValue({ message: { role: 'assistant', content }, finish_reason: 'stop' }) };
    const mcpClient = { callTool: jest.fn() };
    return { llm, mcpClient };
  }

  test('returns assistant text when no tool calls', async () => {
    const { llm, mcpClient } = makeMocks('Hello world');
    const history = buildInitialHistory();
    const result = await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'hi' });
    expect(result.response).toBe('Hello world');
  });

  test('adds user message to history', async () => {
    const { llm, mcpClient } = makeMocks('ok');
    const history = buildInitialHistory();
    await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'test input' });
    expect(history.some(m => m.role === 'user' && m.content === 'test input')).toBe(true);
  });

  test('adds assistant message to history', async () => {
    const { llm, mcpClient } = makeMocks('response text');
    const history = buildInitialHistory();
    await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'hi' });
    expect(history.some(m => m.role === 'assistant' && m.content === 'response text')).toBe(true);
  });

  test('llm.complete is called with full history including user message', async () => {
    const { llm, mcpClient } = makeMocks('ok');
    const history = buildInitialHistory();
    await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'my question' });
    const callArgs = llm.complete.mock.calls[0][0];
    expect(callArgs.messages.some(m => m.content === 'my question')).toBe(true);
  });
});

// ── runToolLoop — with tool calls ─────────────────────────────────────────────
describe('runToolLoop — with tool calls', () => {
  function makeToolCallResponse(toolName, args, responseContent) {
    return {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_001',
          type: 'function',
          function: {
            name: LlmClient.mcpToolsToOpenAi([{ name: toolName, description: '', inputSchema: { type: 'object' } }])[0].function.name,
            arguments: JSON.stringify(args),
          },
        }],
      },
      finish_reason: 'tool_calls',
    };
  }

  test('calls mcpClient.callTool with correct name and args', async () => {
    const toolCallResponse = makeToolCallResponse('contextfs.list', { path: '.' }, 'result');
    const finalResponse = { message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' };

    const llm = { complete: jest.fn().mockResolvedValueOnce(toolCallResponse).mockResolvedValueOnce(finalResponse) };
    const mcpClient = {
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"entries":[]}' }] }),
    };

    const history = buildInitialHistory();
    const result = await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'list files' });

    expect(mcpClient.callTool).toHaveBeenCalledWith('contextfs.list', { path: '.' }, expect.any(Number));
    expect(result.response).toBe('Done');
  });

  test('adds tool result messages to history', async () => {
    const toolCallResponse = makeToolCallResponse('contextfs.read', { path: 'file.md' });
    const finalResponse = { message: { role: 'assistant', content: 'Read done' }, finish_reason: 'stop' };

    const llm = { complete: jest.fn().mockResolvedValueOnce(toolCallResponse).mockResolvedValueOnce(finalResponse) };
    const mcpClient = {
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'file content' }] }),
    };

    const history = buildInitialHistory();
    await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'read file' });

    const toolMessages = history.filter(m => m.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toBe('file content');
    expect(toolMessages[0].tool_call_id).toBe('call_001');
  });

  test('handles tool call error gracefully', async () => {
    const toolCallResponse = makeToolCallResponse('contextfs.read', { path: 'missing.md' });
    const finalResponse = { message: { role: 'assistant', content: 'Error handled' }, finish_reason: 'stop' };

    const llm = { complete: jest.fn().mockResolvedValueOnce(toolCallResponse).mockResolvedValueOnce(finalResponse) };
    const mcpClient = { callTool: jest.fn().mockRejectedValue(new Error('File not found')) };

    const history = buildInitialHistory();
    const onToolResult = jest.fn();
    const result = await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'read missing', onToolResult });

    expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ error: 'File not found' }));
    expect(result.response).toBe('Error handled');
  });

  test('fires onToolCall callback', async () => {
    const toolCallResponse = makeToolCallResponse('contextfs.list', { path: '.' });
    const finalResponse = { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' };

    const llm = { complete: jest.fn().mockResolvedValueOnce(toolCallResponse).mockResolvedValueOnce(finalResponse) };
    const mcpClient = { callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '[]' }] }) };

    const onToolCall = jest.fn();
    const history = buildInitialHistory();
    await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'go', onToolCall });

    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({
      name: 'contextfs.list',
      args: { path: '.' },
    }));
  });

  test('stops after MAX_TOOL_ITERATIONS and summarizes', async () => {
    // Every LLM call returns a tool_call (never stops)
    const toolCallResponse = makeToolCallResponse('contextfs.list', { path: '.' });
    const summaryResponse = { message: { role: 'assistant', content: 'Summary done' }, finish_reason: 'stop' };

    const complete = jest.fn();
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      complete.mockResolvedValueOnce(toolCallResponse);
    }
    complete.mockResolvedValueOnce(summaryResponse); // final summary call

    const llm = { complete };
    const mcpClient = { callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }) };

    const history = buildInitialHistory();
    const result = await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'loop forever' });

    expect(result.response).toBe('Summary done');
    // complete was called MAX_TOOL_ITERATIONS times + 1 summary
    expect(complete).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
  });

  test('handles invalid JSON in tool_call arguments gracefully', async () => {
    const response = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_bad',
          type: 'function',
          function: { name: 'contextfs__list', arguments: '{invalid json' },
        }],
      },
      finish_reason: 'tool_calls',
    };
    const finalResponse = { message: { role: 'assistant', content: 'handled' }, finish_reason: 'stop' };

    const llm = { complete: jest.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(finalResponse) };
    const mcpClient = { callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '[]' }] }) };

    const history = buildInitialHistory();
    const result = await runToolLoop({ llm, mcpClient, openAiTools: [], history, userMessage: 'go' });
    // Should not throw — callTool called with {} as fallback
    expect(mcpClient.callTool).toHaveBeenCalledWith('contextfs.list', {}, expect.any(Number));
    expect(result.response).toBe('handled');
  });
});
