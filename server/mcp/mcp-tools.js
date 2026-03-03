'use strict';

/**
 * MCP tool definitions — all contextfs tools with their JSON Schema inputSchemas.
 * These are returned verbatim in the tools/list response.
 */
const TOOLS = [
  {
    name: 'contextfs.list',
    description: 'List files and directories in the current workspace. Returns structured metadata optimized for LLM consumption.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to workspace root. Defaults to ".".',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to recursively list subdirectories. Default: false.',
        },
        depth: {
          type: 'number',
          description: 'Maximum recursion depth if recursive is true.',
        },
        filter_glob: {
          type: 'string',
          description: 'Optional glob filter (e.g., "*.md").',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds for this tool call.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.read',
    description: 'Read file content with optional line or byte limits to control token usage.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root.',
        },
        start_line: {
          type: 'number',
          description: 'Starting line number (1-based).',
        },
        end_line: {
          type: 'number',
          description: 'Ending line number (inclusive).',
        },
        max_bytes: {
          type: 'number',
          description: 'Maximum number of bytes to return.',
        },
        largeFileFilter: {
          type: 'boolean',
          description: 'Whether to filter large files (>500 lines) showing only start and end sections. Default: true.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds for this tool call.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.smart',
    description: 'Get an intelligent summary of a code file including signatures, docstrings, exports, and complexity metrics. Optimized for token efficiency.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds for this tool call.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.write',
    description: 'Create or modify a file in the workspace.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace root.',
        },
        content: {
          type: 'string',
          description: 'File content to write.',
        },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append'],
          description: 'Write mode. Default: overwrite.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.list_workspaces',
    description: 'List all available workspaces for the current virtual client.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.use_workspace',
    description: 'Switch the active workspace for the current MCP session.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: 'Workspace name to switch to.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.save_skill',
    description: 'Save a reusable skill as a Markdown file under /skills/.',
    inputSchema: {
      type: 'object',
      required: ['name', 'content'],
      properties: {
        name: {
          type: 'string',
          description: 'Skill identifier (used as filename).',
        },
        description: {
          type: 'string',
          description: 'Short summary of what the skill does.',
        },
        content: {
          type: 'string',
          description: 'Markdown content of the skill.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for filtering.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.list_skills',
    description: 'List available skills stored under /skills/.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Optional tag to filter skills by.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.save_memory',
    description: 'Persist a memory entry as a Markdown file under /memory/YYYY/MM/.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        title: {
          type: 'string',
          description: 'Memory title.',
        },
        content: {
          type: 'string',
          description: 'Memory content.',
        },
        importance: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Importance level. Default: medium.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.search_memory',
    description: 'Search memory entries by keyword across all /memory/ files.',
    inputSchema: {
      type: 'object',
      required: [],
      properties: {
        query: {
          type: 'string',
          description: 'Keyword or phrase to search for. If omitted, returns all memory entries.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Default: 10.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds for this tool call.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.memory_summary',
    description: 'Get metadata summary of all memory entries without content: count, date range, unique tags, importance distribution.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.memory_by_date',
    description: 'Retrieve memory entries from a specific year/month with optional importance filter.',
    inputSchema: {
      type: 'object',
      required: ['year'],
      properties: {
        year: {
          type: 'number',
          description: 'Year (e.g., 2026).',
        },
        month: {
          type: 'number',
          description: 'Month 1-12 (optional; if omitted, returns entire year).',
        },
        importance: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Optional filter by importance level.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results. Default: 20.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.memory_by_tag',
    description: 'Find all memory entries with a specific tag, optionally filtered by importance.',
    inputSchema: {
      type: 'object',
      required: ['tag'],
      properties: {
        tag: {
          type: 'string',
          description: 'Tag name to filter by (case-sensitive).',
        },
        importance: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Optional importance filter.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results. Default: 15.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'contextfs.bash_script_once',
    description: 'Execute a one-shot bash/sh script in the workspace. Script is written to a temp file, executed, then deleted. Requires --insecure flag on the server.',
    inputSchema: {
      type: 'object',
      required: ['script'],
      properties: {
        script: {
          type: 'string',
          description: 'Script content to execute. Maximum size: 512KB.',
        },
        cwd: {
          type: 'string',
          description: 'Working directory relative to workspace root. Defaults to ".".',
        },
        shell: {
          type: 'string',
          enum: ['bash', 'sh'],
          description: 'Shell interpreter. Default: bash.',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Optional environment variables for this execution only.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds. Default: 30000.',
        },
        debug: {
          type: 'boolean',
          description: 'Include additional debug metadata in the response.',
        },
      },
      additionalProperties: false,
    },
  },
];

/** Map tool name → tool definition for O(1) lookup */
const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

function getToolDefinition(name) {
  return TOOL_MAP.get(name) || null;
}

function getAllTools() {
  return TOOLS;
}

module.exports = { getAllTools, getToolDefinition, TOOLS };
