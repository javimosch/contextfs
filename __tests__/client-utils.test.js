'use strict';

const path = require('path');
const {
  resolveSafePath,
  isComplexShellCommand,
  isCommandAllowed,
  parseArgs,
  requiresStdinWithoutInput,
  safeJsonParse,
  toWebSocketUrl,
} = require('../client/utils');

describe('resolveSafePath', () => {
  const root = '/tmp/workspace';

  test('resolves a simple relative path', () => {
    expect(resolveSafePath(root, 'subdir/file.txt')).toBe('/tmp/workspace/subdir/file.txt');
  });

  test('resolves "." to root', () => {
    expect(resolveSafePath(root, '.')).toBe('/tmp/workspace');
  });

  test('throws on path traversal with ..', () => {
    expect(() => resolveSafePath(root, '../etc/passwd')).toThrow('Path escapes root');
  });

  test('throws on absolute path escape', () => {
    expect(() => resolveSafePath(root, '/etc/passwd')).toThrow('Path escapes root');
  });

  test('allows nested paths inside root', () => {
    const result = resolveSafePath(root, 'a/b/c');
    expect(result).toBe('/tmp/workspace/a/b/c');
  });
});

describe('isComplexShellCommand', () => {
  test('returns true for sh', () => {
    expect(isComplexShellCommand('sh', [])).toBe(true);
  });

  test('returns true for bash', () => {
    expect(isComplexShellCommand('bash', [])).toBe(true);
  });

  test('returns true when args contain pipe |', () => {
    expect(isComplexShellCommand('ls', ['|', 'grep', 'foo'])).toBe(true);
  });

  test('returns true for && in args', () => {
    expect(isComplexShellCommand('echo', ['hello', '&&', 'echo', 'world'])).toBe(true);
  });

  test('returns true for $() subshell in args', () => {
    expect(isComplexShellCommand('echo', ['$(pwd)'])).toBe(true);
  });

  test('returns false for simple command with safe args', () => {
    expect(isComplexShellCommand('ls', ['-la', '/tmp'])).toBe(false);
  });

  test('returns false for grep with regex pattern', () => {
    expect(isComplexShellCommand('grep', ['-r', '(SELECT|INSERT)', '.'])).toBe(false);
  });
});

describe('isCommandAllowed', () => {
  test('exact match', () => {
    expect(isCommandAllowed('ls', ['ls', 'cat', 'grep'])).toBe(true);
  });

  test('wildcard prefix match', () => {
    expect(isCommandAllowed('npm', ['npm*'])).toBe(true);
    expect(isCommandAllowed('npx', ['npm*'])).toBe(false);
  });

  test('returns false when not in list', () => {
    expect(isCommandAllowed('rm', ['ls', 'cat'])).toBe(false);
  });

  test('returns false for empty allowlist', () => {
    expect(isCommandAllowed('ls', [])).toBe(false);
  });

  test('wildcard matches prefix commands', () => {
    expect(isCommandAllowed('git-lfs', ['git*'])).toBe(true);
  });
});

describe('parseArgs', () => {
  test('parses --key value pairs', () => {
    const args = parseArgs(['node', 'script.js', '--url', 'ws://localhost:3010', '--api-key', 'abc']);
    expect(args['url']).toBe('ws://localhost:3010');
    expect(args['api-key']).toBe('abc');
  });

  test('parses boolean flags', () => {
    const args = parseArgs(['node', 'script.js', '--verbose', '--insecure']);
    expect(args['verbose']).toBe(true);
    expect(args['insecure']).toBe(true);
  });

  test('collects positional args in _', () => {
    const args = parseArgs(['node', 'script.js', 'server', '--port', '3010']);
    expect(args._).toContain('server');
    expect(args['port']).toBe('3010');
  });
});

describe('requiresStdinWithoutInput', () => {
  test('cat with no args requires stdin', () => {
    expect(requiresStdinWithoutInput('cat', [])).toBe(true);
  });

  test('cat with a file arg does not require stdin', () => {
    expect(requiresStdinWithoutInput('cat', ['file.txt'])).toBe(false);
  });

  test('sort with no args requires stdin', () => {
    expect(requiresStdinWithoutInput('sort', [])).toBe(true);
  });

  test('ls never requires stdin', () => {
    expect(requiresStdinWithoutInput('ls', [])).toBe(false);
  });

  test('head with filename does not require stdin', () => {
    expect(requiresStdinWithoutInput('head', ['-n', '5', 'file.txt'])).toBe(false);
  });
});

describe('safeJsonParse', () => {
  test('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  test('returns null for invalid JSON', () => {
    expect(safeJsonParse('not-json')).toBeNull();
  });

  test('returns null for undefined', () => {
    expect(safeJsonParse(undefined)).toBeNull();
  });
});

describe('toWebSocketUrl', () => {
  test('converts http to ws', () => {
    expect(toWebSocketUrl('http://localhost:3010')).toBe('ws://localhost:3010/');
  });

  test('converts https to wss', () => {
    expect(toWebSocketUrl('https://example.com')).toBe('wss://example.com/');
  });

  test('leaves ws:// unchanged', () => {
    expect(toWebSocketUrl('ws://localhost:3010')).toBe('ws://localhost:3010/');
  });
});
