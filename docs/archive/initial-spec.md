npx contextfs server => UI (http) + ws

npx contextfs client --url ws://localhost:3010

npx contextfs client --docker => starts the docker version

npx contextfs server --mcp => (UI+WS+MCP-server) (defaults to stdio)

npx contextfs server --mcp sse (SSE protocol)

# start client with cwd (defaults to ~/.contextfs/workspaces/)
npx contextfs client --cwd /home/user/.contextfs/workspace

# for lightweight deployments
npx contextfs server --local => act as a client as well

# test chat TUI to test MCP
# uses openrouter provider
# prompts for api-key if missing => stores in ~/.contextfs/chat-config.json
npx contextfs chat --mcp-server ws://localhost:3010 --model google/gemini-2.5-flash-lite


# Exposed MCP tools

Below is a clean MCP-facing spec draft for **ContextFS tools**.

Structured, LLM-friendly, minimal surface.

---

# Core FS

---

## `contextfs.list`

**Description**
List files and directories in the current workspace. Returns structured metadata optimized for LLM consumption (not raw shell output).

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Directory path relative to workspace root. Defaults to \".\"."
    },
    "recursive": {
      "type": "boolean",
      "description": "Whether to recursively list subdirectories. Default: false."
    },
    "depth": {
      "type": "number",
      "description": "Maximum recursion depth if recursive is true."
    },
    "filter_glob": {
      "type": "string",
      "description": "Optional glob filter (e.g., \"*.md\")."
    }
  },
  "additionalProperties": false
}
```

**Example**

```json
{
  "path": "skills",
  "recursive": true,
  "depth": 2,
  "filter_glob": "*.md"
}
```

---

## `contextfs.read`

**Description**
Read file content with optional line or byte limits to control token usage.

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "File path relative to workspace root."
    },
    "start_line": {
      "type": "number",
      "description": "Starting line number (1-based)."
    },
    "end_line": {
      "type": "number",
      "description": "Ending line number (inclusive)."
    },
    "max_bytes": {
      "type": "number",
      "description": "Maximum number of bytes to return."
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

**Example**

```json
{
  "path": "memory/2026/02/entry.md",
  "start_line": 1,
  "end_line": 200
}
```

---

## `contextfs.write`

**Description**
Create or modify a file in the workspace.

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "File path relative to workspace root."
    },
    "content": {
      "type": "string",
      "description": "File content to write."
    },
    "mode": {
      "type": "string",
      "enum": ["overwrite", "append"],
      "description": "Write mode. Default: overwrite."
    }
  },
  "required": ["path", "content"],
  "additionalProperties": false
}
```

**Example**

```json
{
  "path": "notes/todo.md",
  "content": "- Refactor agent planner\n- Add MCP metrics",
  "mode": "overwrite"
}
```

---

# Agent Layer

---

## `contextfs.list_workspaces`

**Description**
List all available workspaces for the current ContextFS server.

**Parameters**

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

**Example**

```json
{}
```

---

## `contextfs.use_workspace`

**Description**
Switch the active workspace for the current MCP session.

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Workspace name."
    }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

**Example**

```json
{
  "name": "agent-alpha"
}
```

---

## `contextfs.save_skill`

**Description**
Save a reusable skill as a Markdown file under `/skills/`.

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Skill identifier."
    },
    "description": {
      "type": "string",
      "description": "Short summary of what the skill does."
    },
    "content": {
      "type": "string",
      "description": "Markdown content of the skill."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional tags."
    }
  },
  "required": ["name", "content"],
  "additionalProperties": false
}
```

**Example**

```json
{
  "name": "write-release-notes",
  "description": "Generate structured release notes from commit history.",
  "content": "# Release Notes Skill\n\nSteps:\n1. Parse commits\n2. Group by feature\n3. Format markdown",
  "tags": ["documentation", "automation"]
}
```

---

## `contextfs.list_skills`

**Description**
List available skills stored under `/skills/`.

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "tag": {
      "type": "string",
      "description": "Optional tag filter."
    }
  },
  "additionalProperties": false
}
```

**Example**

```json
{
  "tag": "automation"
}
```

---

## `contextfs.save_memory`

**Description**
Persist a memory entry as a Markdown file under `/memory/YYYY/MM/`.

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "Memory title."
    },
    "content": {
      "type": "string",
      "description": "Memory content."
    },
    "importance": {
      "type": "string",
      "enum": ["low", "medium", "high"],
      "description": "Importance level."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["content"],
  "additionalProperties": false
}
```

**Example**

```json
{
  "title": "User prefers deterministic tools",
  "content": "Avoid shell when structured FS tools are sufficient.",
  "importance": "high",
  "tags": ["design", "mcp"]
}
```

---

## `contextfs.search_memory`

**Description**
Search memory entries using keyword matching.

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of results."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

**Example**

```json
{
  "query": "deterministic tools",
  "limit": 5
}
```

---

# Advanced

---

## `contextfs.bash_script_once`

**Description**
Execute a one-shot bash/sh script in the remote client working directory. The script is written to a temporary file, executed once, and automatically removed.

**Parameters**

```json
{
  "type": "object",
  "properties": {
    "script": {
      "type": "string",
      "description": "Script content to execute. Maximum size: 512KB."
    },
    "cwd": {
      "type": "string",
      "description": "Working directory relative to workspace root. Defaults to \".\"."
    },
    "shell": {
      "type": "string",
      "enum": ["bash", "sh"],
      "description": "Shell to execute the script with. Default: bash."
    },
    "env": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Optional environment variables for this execution only."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Optional timeout override in milliseconds."
    },
    "debug": {
      "type": "boolean",
      "description": "Include additional debug metadata in the response."
    }
  },
  "required": ["script"],
  "additionalProperties": false
}
```

**Example**

```json
{
  "script": "ls -la skills && echo \"Done\"",
  "cwd": ".",
  "shell": "bash",
  "timeoutMs": 10000
}
```

---

This surface is:

* Minimal
* Deterministic by default
* Powerful when needed
* Agent-native
* MCP-ready

Strong foundation for ContextFS v1.

## one shoot script def example

bash_script_once: {
    category: 'Advanced',
    tags: ['script', 'bash', 'sh', 'experimental'],
    description: 'Execute a one-shot bash/sh script in the remote client cwd. The script is written to a temporary file, executed once, then auto-removed.',
    toolTitle: 'Run One-Shot Script (Remote)',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Script content to execute. Maximum size: 512KB.' },
        cwd: { type: 'string', description: 'Working directory (relative to rootPath). Defaults to ".".' },
        shell: { type: 'string', enum: ['bash', 'sh'], description: 'Shell to execute the script with. Default: bash.' },
        env: {
          type: 'object',
          description: 'Optional environment variables for this script execution only.',
          additionalProperties: { type: 'string' },
        },
        timeoutMs: { type: 'number', description: 'Optional override timeout (ms)' },
        debug: { type: 'boolean', description: 'Include extra debug fields in response when supported' },
      },
      required: ['script'],
      additionalProperties: false,
    },
    render: ({ script, cwd, shell, env }) => [
      {
        cmd: '__remote_fs_script_once__',
        args: [],
        cwd: cwd || '.',
        shell: shell || 'bash',
        script,
        env: env && typeof env === 'object' ? env : {},
      },
    ],
  },