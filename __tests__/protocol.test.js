'use strict';

const { validateParams, TOOLS, MSG } = require('../shared/protocol');

describe('validateParams', () => {
  describe('contextfs.list', () => {
    test('valid empty params', () => {
      expect(validateParams(TOOLS.LIST, {})).toEqual({ valid: true });
    });

    test('valid with all fields', () => {
      expect(validateParams(TOOLS.LIST, {
        path: 'src', recursive: true, depth: 3, filter_glob: '*.js',
      })).toEqual({ valid: true });
    });

    test('rejects unknown fields', () => {
      const result = validateParams(TOOLS.LIST, { unknown_field: true });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unknown_field/i);
    });

    test('rejects wrong type for recursive', () => {
      const result = validateParams(TOOLS.LIST, { recursive: 'yes' });
      expect(result.valid).toBe(false);
    });
  });

  describe('contextfs.read', () => {
    test('valid with required path', () => {
      expect(validateParams(TOOLS.READ, { path: 'file.md' })).toEqual({ valid: true });
    });

    test('fails without required path', () => {
      const result = validateParams(TOOLS.READ, {});
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/path/);
    });

    test('valid with optional line range', () => {
      expect(validateParams(TOOLS.READ, { path: 'file.md', start_line: 1, end_line: 50 })).toEqual({ valid: true });
    });
  });

  describe('contextfs.write', () => {
    test('valid with path and content', () => {
      expect(validateParams(TOOLS.WRITE, { path: 'out.md', content: 'hello' })).toEqual({ valid: true });
    });

    test('fails without content', () => {
      expect(validateParams(TOOLS.WRITE, { path: 'out.md' }).valid).toBe(false);
    });

    test('valid with append mode', () => {
      expect(validateParams(TOOLS.WRITE, { path: 'out.md', content: 'x', mode: 'append' })).toEqual({ valid: true });
    });

    test('rejects invalid mode', () => {
      expect(validateParams(TOOLS.WRITE, { path: 'out.md', content: 'x', mode: 'delete' }).valid).toBe(false);
    });
  });

  describe('contextfs.save_skill', () => {
    test('valid with name and content', () => {
      expect(validateParams(TOOLS.SAVE_SKILL, { name: 'my-skill', content: '# skill' })).toEqual({ valid: true });
    });

    test('fails without name', () => {
      expect(validateParams(TOOLS.SAVE_SKILL, { content: '# skill' }).valid).toBe(false);
    });

    test('valid with tags array', () => {
      expect(validateParams(TOOLS.SAVE_SKILL, { name: 's', content: 'c', tags: ['a', 'b'] })).toEqual({ valid: true });
    });

    test('rejects non-array tags', () => {
      expect(validateParams(TOOLS.SAVE_SKILL, { name: 's', content: 'c', tags: 'tag' }).valid).toBe(false);
    });
  });

  describe('contextfs.save_memory', () => {
    test('valid with content only', () => {
      expect(validateParams(TOOLS.SAVE_MEMORY, { content: 'remember this' })).toEqual({ valid: true });
    });

    test('fails without content', () => {
      expect(validateParams(TOOLS.SAVE_MEMORY, {}).valid).toBe(false);
    });

    test('valid importance values', () => {
      for (const imp of ['low', 'medium', 'high']) {
        expect(validateParams(TOOLS.SAVE_MEMORY, { content: 'x', importance: imp }).valid).toBe(true);
      }
    });

    test('rejects invalid importance', () => {
      expect(validateParams(TOOLS.SAVE_MEMORY, { content: 'x', importance: 'critical' }).valid).toBe(false);
    });
  });

  describe('contextfs.search_memory', () => {
    test('valid with query', () => {
      expect(validateParams(TOOLS.SEARCH_MEMORY, { query: 'hello' })).toEqual({ valid: true });
    });

    test('fails without query', () => {
      expect(validateParams(TOOLS.SEARCH_MEMORY, {}).valid).toBe(false);
    });
  });

  describe('contextfs.bash_script_once', () => {
    test('valid with script', () => {
      expect(validateParams(TOOLS.BASH_SCRIPT_ONCE, { script: 'echo hi' })).toEqual({ valid: true });
    });

    test('fails without script', () => {
      expect(validateParams(TOOLS.BASH_SCRIPT_ONCE, {}).valid).toBe(false);
    });

    test('valid with all options', () => {
      expect(validateParams(TOOLS.BASH_SCRIPT_ONCE, {
        script: 'ls', shell: 'bash', cwd: '.', env: { FOO: 'bar' }, timeoutMs: 5000, debug: true,
      })).toEqual({ valid: true });
    });

    test('rejects invalid shell', () => {
      expect(validateParams(TOOLS.BASH_SCRIPT_ONCE, { script: 'ls', shell: 'zsh' }).valid).toBe(false);
    });
  });

  describe('unknown tool', () => {
    test('returns error for unknown tool name', () => {
      const result = validateParams('contextfs.unknown', {});
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unknown tool/i);
    });
  });
});

describe('Protocol constants', () => {
  test('MSG has all client→server types', () => {
    expect(MSG.C_REGISTER).toBe('contextfs_register');
    expect(MSG.C_HEARTBEAT).toBe('contextfs_heartbeat');
    expect(MSG.C_RESPONSE).toBe('contextfs_response');
    expect(MSG.C_STREAM_CHUNK).toBe('contextfs_stream_chunk');
  });

  test('MSG has all server→client types', () => {
    expect(MSG.S_REGISTER_RESULT).toBe('contextfs_register_result');
    expect(MSG.S_REQUEST).toBe('contextfs_request');
    expect(MSG.S_ASSIGN_VC).toBe('contextfs_assign_virtual_client');
  });

  test('TOOLS has all 10 tool names', () => {
    expect(Object.keys(TOOLS)).toHaveLength(10);
    expect(TOOLS.BASH_SCRIPT_ONCE).toBe('contextfs.bash_script_once');
  });
});
