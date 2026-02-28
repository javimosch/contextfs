'use strict';

const { LlmClient } = require('./llm-client');

const MAX_TOOL_ITERATIONS = 10;
const GLOBAL_TIMEOUT_MS = 10000;

const SYSTEM_PROMPT = `You are a helpful AI assistant with access to a contextfs filesystem.

CRITICAL: For ANY question where memory/workspace/tools might have the answer:
1. ALWAYS attempt to use available tools—never assume based only on training data.
2. First check memory (search_memory, discovery tools) for personal notes, identities, preferences.
3. Explore workspace structure (list_directory, search_files) for file-based answers.
4. For file content questions, call read_file before answering.
5. Do NOT guess or rely on training data if tools might know the real answer.

For general knowledge questions where tools cannot help (e.g., "What is photosynthesis?"), use training data directly.

CONCISENESS (while maintaining tool usage):
- Use tools silently without preamble ("I'm now searching..." is unnecessary).
- Do NOT explain tool calls—user knows you have tools available.
- Present results directly and factually (no decorative language).
- For workspace tasks, state what was done in 1-2 sentences; omit tool play-by-play.
- Avoid metadata (tool names, byte counts, durations) unless explicitly asked or essential.

When using tools:
- Present tool results directly—don't summarize or hallucinate.
- If a tool fails, explain the error honestly and suggest alternatives.

### Codebase Exploration Protocol
When exploring a codebase:
1. Read .gitignore first if available to understand ignored patterns
2. Extract ignore patterns: node_modules/, .git/, .planning/, .env, .opencode/, .claude/
3. Pass glob patterns to Glob/Grep tools to exclude ignored files
   - Use glob parameter like: "**/*.js" instead of searching all files
   - This automatically respects gitignore patterns and reduces noise
4. NEVER search inside ignored directories: node_modules, .git, .planning, .env, .opencode, .claude
5. Focus on actual source code to minimize context pollution and token waste`;

/**
 * runToolLoop — single-turn agentic loop.

 *
 * Sends the user message to the LLM, handles tool_calls by routing through
 * the MCP client, re-submits results, and returns the final text response.
 *
 * @param {object} opts
 * @param {LlmClient} opts.llm        — LLM client
 * @param {object}    opts.mcpClient  — McpSseClient instance
 * @param {Array}     opts.openAiTools — Tools in OpenAI format (from LlmClient.mcpToolsToOpenAi)
 * @param {Array}     opts.history    — Full conversation history (mutated in place)
 * @param {string}    opts.userMessage — New user message
 * @param {function}  opts.onThink    — Optional callback(text) for intermediate reasoning
 * @param {function}  opts.onToolCall — Optional callback({ name, args }) before tool execution
 * @param {function}  opts.onToolResult — Optional callback({ name, result, error })
 * @returns {Promise<{ response: string, usage: object }>}  Final assistant text response and cumulative usage
 */
async function runToolLoop({
  llm,
  mcpClient,
  openAiTools,
  history,
  userMessage,
  onThink,
  onToolCall,
  onToolResult,
  timeoutMs = GLOBAL_TIMEOUT_MS,
}) {
  // Add user message to history
  history.push({ role: 'user', content: userMessage });

  const startTime = Date.now();
  let iterations = 0;
  const cumulativeUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_tokens_cost: 0,
    completion_tokens_cost: 0,
    total_cost: 0,
  };

  const accumulateUsage = (usage) => {
    if (!usage) return;
    cumulativeUsage.prompt_tokens += (usage.prompt_tokens || 0);
    cumulativeUsage.completion_tokens += (usage.completion_tokens || 0);
    cumulativeUsage.total_tokens += (usage.total_tokens || 0);
    // Only accumulate cost if present (not all providers support it)
    if (usage.total_cost !== undefined) {
      cumulativeUsage.prompt_tokens_cost += (usage.prompt_tokens_cost || 0);
      cumulativeUsage.completion_tokens_cost += (usage.completion_tokens_cost || 0);
      cumulativeUsage.total_cost += (usage.total_cost || 0);
    }
  };

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      break;
    }

    const { message, usage, finish_reason } = await llm.complete({
      messages: history,
      tools: openAiTools,
    });

    accumulateUsage(usage);

    // Add assistant message to history
    history.push(message);

    // If no tool calls, we're done
    if (finish_reason === 'stop' || !message.tool_calls || message.tool_calls.length === 0) {
      return {
        response: message.content || '',
        usage: cumulativeUsage,
      };
    }

    // Process each tool call
    const toolResults = [];
    for (const toolCall of message.tool_calls) {
      const fnName = toolCall.function.name;
      const mcpName = LlmClient.openAiNameToMcp(fnName);

      let args;
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch (_) {
        args = {};
      }

      if (typeof onToolCall === 'function') {
        onToolCall({ name: mcpName, args, callId: toolCall.id });
      }

      let toolContent;
      try {
        const result = await mcpClient.callTool(mcpName, args, args.timeoutMs || timeoutMs);
        // Extract text content from MCP response
        const text = result.content && result.content[0] ? result.content[0].text : JSON.stringify(result);
        toolContent = text;
        if (typeof onToolResult === 'function') {
          onToolResult({ name: mcpName, result: text, error: null });
        }
      } catch (err) {
        toolContent = JSON.stringify({ error: err.message });
        if (typeof onToolResult === 'function') {
          onToolResult({ name: mcpName, result: null, error: err.message });
        }
      }

      toolResults.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolContent,
      });
    }

    // Add all tool results to history
    history.push(...toolResults);
  }

  // Hit max iterations or timeout — ask LLM to summarize
  const reason = iterations >= MAX_TOOL_ITERATIONS ? 'maximum tool iterations reached' : 'execution timeout reached';
  history.push({
    role: 'user',
    content: `Wait, ${reason}. Please summarize what you have done so far based on the tool results above and provide a final answer.`,
  });
  const { message: summary, usage: summaryUsage } = await llm.complete({ messages: history, tools: [] });
  accumulateUsage(summaryUsage);
  history.push(summary);

  return {
    response: summary.content || '',
    usage: cumulativeUsage,
  };
}

/**
 * buildInitialHistory — returns a fresh history with system prompt.
 */
function buildInitialHistory() {
  return [{ role: 'system', content: SYSTEM_PROMPT }];
}

module.exports = { runToolLoop, buildInitialHistory, MAX_TOOL_ITERATIONS, SYSTEM_PROMPT };
