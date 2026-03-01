/**
 * Command Parser Tests
 * 
 * Tests for CommandParser module using Node.js built-in test runner
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CommandParser } = require('../server/mcp/tools/command-parser.js');

describe('CommandParser', () => {
  describe('parse', () => {
    describe('normal commands (no prefix)', () => {
      it('should parse simple command', () => {
        const result = CommandParser.parse('ls');
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, 'ls');
        assert.deepStrictEqual(result.args, []);
      });

      it('should parse command with args', () => {
        const result = CommandParser.parse('ls -la');
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, 'ls');
        assert.deepStrictEqual(result.args, ['-la']);
      });

      it('should parse command with multiple args', () => {
        const result = CommandParser.parse('grep -r pattern dir');
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, 'grep');
        assert.deepStrictEqual(result.args, ['-r', 'pattern', 'dir']);
      });

      it('should normalize extra whitespace', () => {
        const result = CommandParser.parse('ls   -la    /path');
        assert.strictEqual(result.command, 'ls');
        assert.deepStrictEqual(result.args, ['-la', '/path']);
      });
    });

    describe('native: prefix at start', () => {
      it('should detect native: prefix', () => {
        const result = CommandParser.parse('native:ls');
        assert.strictEqual(result.bypass, true);
        assert.strictEqual(result.command, 'ls');
        assert.deepStrictEqual(result.args, []);
      });

      it('should strip native: prefix with args', () => {
        const result = CommandParser.parse('native:ls -la');
        assert.strictEqual(result.bypass, true);
        assert.strictEqual(result.command, 'ls');
        assert.deepStrictEqual(result.args, ['-la']);
      });

      it('should handle native: with complex args', () => {
        const result = CommandParser.parse('native:grep -r pattern /path/to/dir');
        assert.strictEqual(result.bypass, true);
        assert.strictEqual(result.command, 'grep');
        assert.deepStrictEqual(result.args, ['-r', 'pattern', '/path/to/dir']);
      });

      it('should handle native: alone (empty command)', () => {
        const result = CommandParser.parse('native:');
        assert.strictEqual(result.bypass, true);
        assert.strictEqual(result.command, '');
        assert.deepStrictEqual(result.args, []);
      });

      it('should handle native: with only whitespace', () => {
        const result = CommandParser.parse('native:   ');
        assert.strictEqual(result.bypass, true);
        assert.strictEqual(result.command, '');
        assert.deepStrictEqual(result.args, []);
      });
    });

    describe('native: embedded in first arg', () => {
      it('should detect embedded native: prefix', () => {
        const result = CommandParser.parse('bash native:bash -c echo');
        assert.strictEqual(result.bypass, true);
        assert.strictEqual(result.command, 'bash');
        assert.deepStrictEqual(result.args, ['-c', 'echo']);
      });

      it('should handle embedded prefix with complex command', () => {
        const result = CommandParser.parse('sh native:sh -c "echo hello"');
        assert.strictEqual(result.bypass, true);
        assert.strictEqual(result.command, 'sh');
        // Note: quoted strings are still split by space in simple parse
        assert.deepStrictEqual(result.args, ['-c', '"echo', 'hello"']);
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        const result = CommandParser.parse('');
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, '');
        assert.deepStrictEqual(result.args, []);
      });

      it('should handle null', () => {
        const result = CommandParser.parse(null);
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, '');
        assert.deepStrictEqual(result.args, []);
      });

      it('should handle undefined', () => {
        const result = CommandParser.parse(undefined);
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, '');
        assert.deepStrictEqual(result.args, []);
      });

      it('should handle whitespace only', () => {
        const result = CommandParser.parse('   ');
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, '');
        assert.deepStrictEqual(result.args, []);
      });

      it('should not trigger on native: substring in arg', () => {
        // "filename.native.txt" should NOT trigger bypass
        const result = CommandParser.parse('cat filename.native.txt');
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, 'cat');
        assert.deepStrictEqual(result.args, ['filename.native.txt']);
      });

      it('should not trigger on native: in later args', () => {
        const result = CommandParser.parse('grep pattern native:code');
        assert.strictEqual(result.bypass, false);
        assert.strictEqual(result.command, 'grep');
        assert.deepStrictEqual(result.args, ['pattern', 'native:code']);
      });

      it('should trim leading/trailing whitespace', () => {
        const result = CommandParser.parse('  ls -la  ');
        assert.strictEqual(result.command, 'ls');
        assert.deepStrictEqual(result.args, ['-la']);
      });
    });
  });

  describe('formatForLog', () => {
    it('should format simple command', () => {
      const result = CommandParser.formatForLog('ls', []);
      assert.strictEqual(result, 'ls');
    });

    it('should format command with args', () => {
      const result = CommandParser.formatForLog('ls', ['-la', '/path']);
      assert.strictEqual(result, 'ls -la /path');
    });

    it('should quote args with spaces', () => {
      const result = CommandParser.formatForLog('echo', ['hello world']);
      assert.strictEqual(result, 'echo "hello world"');
    });

    it('should handle empty command', () => {
      const result = CommandParser.formatForLog('', []);
      assert.strictEqual(result, '');
    });

    it('should handle null command', () => {
      const result = CommandParser.formatForLog(null, []);
      assert.strictEqual(result, '');
    });
  });

  describe('hasBypassPrefix', () => {
    it('should return true for native: at start', () => {
      assert.strictEqual(CommandParser.hasBypassPrefix('native:ls'), true);
    });

    it('should return true for native: embedded', () => {
      assert.strictEqual(CommandParser.hasBypassPrefix('bash native:bash'), true);
    });

    it('should return false for normal command', () => {
      assert.strictEqual(CommandParser.hasBypassPrefix('ls -la'), false);
    });

    it('should return false for native: substring', () => {
      assert.strictEqual(CommandParser.hasBypassPrefix('file.native.txt'), false);
    });

    it('should return false for empty string', () => {
      assert.strictEqual(CommandParser.hasBypassPrefix(''), false);
    });

    it('should return false for null', () => {
      assert.strictEqual(CommandParser.hasBypassPrefix(null), false);
    });
  });

  describe('stripBypassPrefix', () => {
    it('should strip prefix from start', () => {
      const result = CommandParser.stripBypassPrefix('native:ls -la');
      assert.strictEqual(result, 'ls -la');
    });

    it('should strip prefix from first arg', () => {
      const result = CommandParser.stripBypassPrefix('bash native:bash -c echo');
      assert.strictEqual(result, 'bash -c echo');
    });

    it('should return original if no prefix', () => {
      const result = CommandParser.stripBypassPrefix('ls -la');
      assert.strictEqual(result, 'ls -la');
    });

    it('should handle empty string', () => {
      const result = CommandParser.stripBypassPrefix('');
      assert.strictEqual(result, '');
    });

    it('should normalize whitespace', () => {
      const result = CommandParser.stripBypassPrefix('native:ls   -la');
      assert.strictEqual(result, 'ls -la');
    });
  });

  describe('parseArgs', () => {
    it('should parse simple args', () => {
      const result = CommandParser.parseArgs('-la /path');
      assert.deepStrictEqual(result, ['-la', '/path']);
    });

    it('should handle double quotes', () => {
      const result = CommandParser.parseArgs('-c "echo hello"');
      assert.deepStrictEqual(result, ['-c', 'echo hello']);
    });

    it('should handle single quotes', () => {
      const result = CommandParser.parseArgs("-c 'echo hello'");
      assert.deepStrictEqual(result, ['-c', 'echo hello']);
    });

    it('should handle multiple quoted args', () => {
      const result = CommandParser.parseArgs('"arg one" "arg two"');
      assert.deepStrictEqual(result, ['arg one', 'arg two']);
    });

    it('should handle empty string', () => {
      const result = CommandParser.parseArgs('');
      assert.deepStrictEqual(result, []);
    });

    it('should handle null', () => {
      const result = CommandParser.parseArgs(null);
      assert.deepStrictEqual(result, []);
    });

    it('should handle extra whitespace', () => {
      const result = CommandParser.parseArgs('  -la   /path  ');
      assert.deepStrictEqual(result, ['-la', '/path']);
    });
  });
});
