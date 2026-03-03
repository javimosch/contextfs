'use strict';

// ── Message types: Client → Server ─────────────────────────────────────────
const MSG = {
  // Client → Server
  C_REGISTER:         'contextfs_register',
  C_HEARTBEAT:        'contextfs_heartbeat',
  C_RESPONSE:         'contextfs_response',
  C_STREAM_CHUNK:     'contextfs_stream_chunk',

  // Server → Client
  S_REGISTER_RESULT:  'contextfs_register_result',
  S_REQUEST:          'contextfs_request',
  S_ASSIGN_VC:        'contextfs_assign_virtual_client',
  S_UNASSIGN_VC:      'contextfs_unassign_virtual_client',
};

// ── Tool names ──────────────────────────────────────────────────────────────
const TOOLS = {
  LIST:              'contextfs.list',
  READ:              'contextfs.read',
  WRITE:             'contextfs.write',
  LIST_WORKSPACES:   'contextfs.list_workspaces',
  USE_WORKSPACE:     'contextfs.use_workspace',
  SAVE_SKILL:        'contextfs.save_skill',
  LIST_SKILLS:       'contextfs.list_skills',
  SAVE_MEMORY:       'contextfs.save_memory',
  SEARCH_MEMORY:     'contextfs.search_memory',
  MEMORY_SUMMARY:    'contextfs.memory_summary',
  MEMORY_BY_DATE:    'contextfs.memory_by_date',
  MEMORY_BY_TAG:     'contextfs.memory_by_tag',
  BASH_SCRIPT_ONCE:  'contextfs.bash_script_once',
  SUMMARIZE:         'contextfs.summarize',
};

// ── Parameter schemas (JSON Schema subset) ─────────────────────────────────
const SCHEMAS = {
  [TOOLS.LIST]: {
    type: 'object',
    properties: {
      path:        { type: 'string' },
      recursive:   { type: 'boolean' },
      depth:       { type: 'number' },
      filter_glob: { type: 'string' },
    },
    additionalProperties: false,
  },
  [TOOLS.READ]: {
    type: 'object',
    required: ['path'],
    properties: {
      path:       { type: 'string' },
      start_line: { type: 'number' },
      end_line:   { type: 'number' },
      max_bytes:  { type: 'number' },
      largeFileFilter: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  [TOOLS.SUMMARIZE]: {
    type: 'object',
    required: ['path'],
    properties: {
      path:       { type: 'string' },
    },
    additionalProperties: false,
  },
  [TOOLS.WRITE]: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path:    { type: 'string' },
      content: { type: 'string' },
      mode:    { type: 'string', enum: ['overwrite', 'append'] },
    },
    additionalProperties: false,
  },
  [TOOLS.LIST_WORKSPACES]: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  [TOOLS.USE_WORKSPACE]: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
    },
    additionalProperties: false,
  },
  [TOOLS.SAVE_SKILL]: {
    type: 'object',
    required: ['name', 'content'],
    properties: {
      name:        { type: 'string' },
      description: { type: 'string' },
      content:     { type: 'string' },
      tags:        { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  [TOOLS.LIST_SKILLS]: {
    type: 'object',
    properties: {
      tag: { type: 'string' },
    },
    additionalProperties: false,
  },
  [TOOLS.SAVE_MEMORY]: {
    type: 'object',
    required: ['content'],
    properties: {
      title:      { type: 'string' },
      content:    { type: 'string' },
      importance: { type: 'string', enum: ['low', 'medium', 'high'] },
      tags:       { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  [TOOLS.SEARCH_MEMORY]: {
    type: 'object',
    required: [],
    properties: {
      query: { type: 'string' },
      limit: { type: 'number' },
    },
    additionalProperties: false,
  },
  [TOOLS.MEMORY_SUMMARY]: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  [TOOLS.MEMORY_BY_DATE]: {
    type: 'object',
    required: ['year'],
    properties: {
      year:       { type: 'number' },
      month:      { type: 'number' },
      importance: { type: 'string', enum: ['low', 'medium', 'high'] },
      limit:      { type: 'number' },
    },
    additionalProperties: false,
  },
  [TOOLS.MEMORY_BY_TAG]: {
    type: 'object',
    required: ['tag'],
    properties: {
      tag:        { type: 'string' },
      importance: { type: 'string', enum: ['low', 'medium', 'high'] },
      limit:      { type: 'number' },
    },
    additionalProperties: false,
  },
  [TOOLS.BASH_SCRIPT_ONCE]: {
    type: 'object',
    required: ['script'],
    properties: {
      script:    { type: 'string' },
      cwd:       { type: 'string' },
      shell:     { type: 'string', enum: ['bash', 'sh'] },
      env:       { type: 'object', additionalProperties: { type: 'string' } },
      timeoutMs: { type: 'number' },
      debug:     { type: 'boolean' },
      stream:    { type: 'boolean' }, // opt-in streaming of stdout/stderr chunks
    },
    additionalProperties: false,
  },
};

/**
 * Validate params against a tool schema.
 * Returns { valid: true } or { valid: false, error: string }
 */
function validateParams(toolName, params) {
  const schema = SCHEMAS[toolName];
  if (!schema) return { valid: false, error: `Unknown tool: ${toolName}` };

  const p = params && typeof params === 'object' ? params : {};

  // Check required fields
  if (Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (p[field] === undefined || p[field] === null) {
        return { valid: false, error: `Missing required parameter: ${field}` };
      }
    }
  }

  // Check additionalProperties
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    // workspaceId and timeoutMs are allowed globally for all contextfs tools
    if (toolName.startsWith('contextfs.')) {
      allowed.add('workspaceId');
      allowed.add('timeoutMs');
    }

    for (const key of Object.keys(p)) {
      if (!allowed.has(key)) {
        return { valid: false, error: `Unknown parameter: ${key}` };
      }
    }
  }

  // Type checks on provided fields
  const allProps = { ...(schema.properties || {}) };
  if (toolName.startsWith('contextfs.')) {
    allProps.workspaceId = { type: 'string' };
    allProps.timeoutMs = { type: 'number' };
  }

  for (const [key, propSchema] of Object.entries(allProps)) {
    if (p[key] === undefined || p[key] === null) continue;
    const val = p[key];
    if (propSchema.type === 'string' && typeof val !== 'string') {
      return { valid: false, error: `Parameter "${key}" must be a string` };
    }
    if (propSchema.type === 'number' && typeof val !== 'number') {
      return { valid: false, error: `Parameter "${key}" must be a number` };
    }
    if (propSchema.type === 'boolean' && typeof val !== 'boolean') {
      return { valid: false, error: `Parameter "${key}" must be a boolean` };
    }
    if (propSchema.type === 'array' && !Array.isArray(val)) {
      return { valid: false, error: `Parameter "${key}" must be an array` };
    }
    if (propSchema.enum && !propSchema.enum.includes(val)) {
      return { valid: false, error: `Parameter "${key}" must be one of: ${propSchema.enum.join(', ')}` };
    }
  }

  return { valid: true };
}

module.exports = { MSG, TOOLS, SCHEMAS, validateParams };
