/**
 * Bash RTK Adapter Tests
 *
 * Tests for BashRTKAdapter including:
 * - Simple command identification
 * - Complex command detection (pipes, redirects)
 * - Mixed script execution
 * - Exit code propagation
 * - Comment-based bypass
 *
 * @module BashRTKAdapterTests
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { BashRTKAdapter } = require('../server/mcp/tools/bash-rtk-adapter.js');

describe('BashRTKAdapter', () => {
  let adapter;
  let mockSpawnWrapper;
  let mockRtkExecutor;

  beforeEach(() => {
    // Create mock RTK executor
    mockRtkExecutor = {
      isSupportedCommand: (cmd, args) => {
        const supported = ['ls', 'grep', 'git', 'cat', 'head', 'tail', 'wc', 'find', 'sort', 'uniq'];
        return supported.includes(cmd);
      }
    };

    // Create mock spawn wrapper
    mockSpawnWrapper = {
      execute: async (command, args, options) => ({
        stdout: `RTK output for ${command}`,
        stderr: '',
        exitCode: 0,
        source: 'rtk'
      })
    };

    // Create adapter with mocks
    adapter = new BashRTKAdapter({
      spawnWrapper: mockSpawnWrapper,
      rtkExecutor: mockRtkExecutor
    });
  });

  describe('parseScript', () => {
    it('should parse simple ls command', () => {
      const script = 'ls -la';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'simple');
      assert.strictEqual(commands[0].command, 'ls');
      assert.deepStrictEqual(commands[0].args, ['-la']);
    });

    it('should parse simple grep command', () => {
      const script = 'grep -r "pattern" .';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'simple');
      assert.strictEqual(commands[0].command, 'grep');
      assert.deepStrictEqual(commands[0].args, ['-r', 'pattern', '.']);
    });

    it('should parse multiple simple commands', () => {
      const script = `ls -la
grep pattern file.txt
cat file.txt`;
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 3);
      assert.strictEqual(commands[0].type, 'simple');
      assert.strictEqual(commands[0].command, 'ls');
      assert.strictEqual(commands[1].type, 'simple');
      assert.strictEqual(commands[1].command, 'grep');
      assert.strictEqual(commands[2].type, 'simple');
      assert.strictEqual(commands[2].command, 'cat');
    });

    it('should skip empty lines and comments', () => {
      const script = `
# This is a comment
ls -la

# Another comment
grep pattern file.txt
`;
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 2);
      assert.strictEqual(commands[0].command, 'ls');
      assert.strictEqual(commands[1].command, 'grep');
    });

    it('should track line numbers', () => {
      const script = `ls -la
grep pattern file.txt`;
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands[0].lineNumber, 1);
      assert.strictEqual(commands[1].lineNumber, 2);
    });
  });

  describe('complex command detection', () => {
    it('should detect pipe as complex', () => {
      const script = 'ls | grep test';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
      assert.ok(commands[0].line.includes('|'));
    });

    it('should detect output redirect as complex', () => {
      const script = 'ls > output.txt';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });

    it('should detect input redirect as complex', () => {
      const script = 'cat < input.txt';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });

    it('should detect append redirect as complex', () => {
      const script = 'echo test >> output.txt';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });

    it('should detect AND conditional as complex', () => {
      const script = 'ls && echo done';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });

    it('should detect OR conditional as complex', () => {
      const script = 'ls || echo failed';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });

    it('should detect command substitution as complex', () => {
      const script = 'echo $(date)';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });

    it('should detect backtick substitution as complex', () => {
      const script = 'echo `date`';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });

    it('should detect background process as complex', () => {
      const script = 'sleep 10 &';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });
  });

  describe('unsupported commands', () => {
    it('should mark unsupported commands as complex', () => {
      const script = 'customcommand arg1 arg2';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
      assert.strictEqual(commands[0].command, 'customcommand');
    });

    it('should handle echo command (not in RTK allowlist)', () => {
      const script = 'echo "Hello World"';
      const commands = adapter.parseScript(script);

      // echo is not in the RTK-supported list
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });
  });

  describe('comment-based bypass', () => {
    it('should respect native: comment bypass', () => {
      const script = '# native: ls\nls -la';
      const commands = adapter.parseScript(script);

      // Even though ls is supported, the native: comment marks it as complex
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });

    it('should detect native: suffix comment', () => {
      const script = 'ls -la # native: force native execution';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].type, 'complex');
    });
  });

  describe('tokenization', () => {
    it('should handle quoted arguments', () => {
      const script = 'grep "pattern with spaces" file.txt';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands[0].args[0], 'pattern with spaces');
    });

    it('should handle single quotes', () => {
      const script = "grep 'pattern with spaces' file.txt";
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands[0].args[0], 'pattern with spaces');
    });

    it('should handle mixed quotes', () => {
      const script = `grep "double quoted" 'single quoted' file.txt`;
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands[0].args[0], 'double quoted');
      assert.strictEqual(commands[0].args[1], 'single quoted');
    });
  });

  describe('executeScript', () => {
    it('should execute simple command through RTK', async () => {
      const script = 'ls -la';
      const result = await adapter.executeScript(script);

      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('RTK output for ls'));
    });

    it('should return empty result for empty script', async () => {
      const script = '';
      const result = await adapter.executeScript(script);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, '');
      assert.strictEqual(result.results.length, 0);
    });

    it('should propagate non-zero exit codes', async () => {
      // Override mock to return failure
      mockSpawnWrapper.execute = async () => ({
        stdout: '',
        stderr: 'Command failed',
        exitCode: 1,
        source: 'rtk'
      });

      const script = 'ls -la';
      const result = await adapter.executeScript(script);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Command failed'));
    });

    it('should execute complex commands through shell', async () => {
      const script = 'ls | grep test';
      const result = await adapter.executeScript(script);

      // Complex commands should be executed through shell
      assert.strictEqual(result.exitCode, 0);
    });
  });

  describe('groupCommands', () => {
    it('should group consecutive simple commands', () => {
      const commands = [
        { type: 'simple', command: 'ls' },
        { type: 'simple', command: 'grep' },
        { type: 'complex', command: 'echo' }
      ];

      const groups = adapter.groupCommands(commands);

      assert.strictEqual(groups.length, 2);
      assert.strictEqual(groups[0].type, 'simple');
      assert.strictEqual(groups[0].commands.length, 2);
      assert.strictEqual(groups[1].type, 'complex');
      assert.strictEqual(groups[1].commands.length, 1);
    });

    it('should handle alternating types', () => {
      const commands = [
        { type: 'simple', command: 'ls' },
        { type: 'complex', command: 'echo' },
        { type: 'simple', command: 'grep' }
      ];

      const groups = adapter.groupCommands(commands);

      assert.strictEqual(groups.length, 3);
      assert.strictEqual(groups[0].type, 'simple');
      assert.strictEqual(groups[1].type, 'complex');
      assert.strictEqual(groups[2].type, 'simple');
    });
  });

  describe('exit code propagation', () => {
    it('should stop execution on first failure', async () => {
      let callCount = 0;
      mockSpawnWrapper.execute = async (cmd) => {
        callCount++;
        if (callCount === 2) {
          return { stdout: '', stderr: 'Failed', exitCode: 1, source: 'rtk' };
        }
        return { stdout: `Output ${callCount}`, stderr: '', exitCode: 0, source: 'rtk' };
      };

      const script = `ls -la
grep pattern file.txt
cat file.txt`;
      const result = await adapter.executeScript(script);

      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(callCount, 2); // Only first two commands executed
    });

    it('should report which command failed', async () => {
      mockSpawnWrapper.execute = async (cmd) => {
        if (cmd === 'grep') {
          return { stdout: '', stderr: 'Pattern not found', exitCode: 1, source: 'rtk' };
        }
        return { stdout: 'OK', stderr: '', exitCode: 0, source: 'rtk' };
      };

      const script = `ls -la
grep pattern file.txt`;
      const result = await adapter.executeScript(script);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.failedCommand);
      assert.strictEqual(result.failedCommand.command, 'grep');
    });
  });

  describe('canUseRTK', () => {
    it('should return true for script with simple commands', () => {
      const script = 'ls -la\ngrep pattern file.txt';
      assert.strictEqual(adapter.canUseRTK(script), true);
    });

    it('should return false for script with only complex commands', () => {
      const script = 'ls | grep test\necho done';
      assert.strictEqual(adapter.canUseRTK(script), false);
    });

    it('should return true for mixed script', () => {
      const script = 'ls -la\nls | grep test';
      assert.strictEqual(adapter.canUseRTK(script), true);
    });
  });

  describe('getScriptStats', () => {
    it('should provide correct statistics for simple script', () => {
      const script = 'ls -la\ngrep pattern file.txt';
      const stats = adapter.getScriptStats(script);

      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.simple, 2);
      assert.strictEqual(stats.complex, 0);
      assert.strictEqual(stats.rtkEligible, true);
    });

    it('should provide correct statistics for complex script', () => {
      const script = 'ls | grep test\necho done';
      const stats = adapter.getScriptStats(script);

      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.simple, 0);
      assert.strictEqual(stats.complex, 2);
      assert.strictEqual(stats.rtkEligible, false);
    });

    it('should provide correct statistics for mixed script', () => {
      const script = `ls -la
grep pattern file.txt
cat file.txt | head -5`;
      const stats = adapter.getScriptStats(script);

      assert.strictEqual(stats.total, 3);
      assert.strictEqual(stats.simple, 2);
      assert.strictEqual(stats.complex, 1);
      assert.strictEqual(stats.rtkEligible, true);
    });
  });

  describe('edge cases', () => {
    it('should handle script with only comments', () => {
      const script = '# Comment 1\n# Comment 2';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 0);
    });

    it('should handle script with only whitespace', () => {
      const script = '   \n\t\n   ';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 0);
    });

    it('should handle command with many arguments', () => {
      const script = 'ls -la -h --color=auto -R --sort=time';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands[0].type, 'simple');
      // Note: --color=auto is one argument (not split on =)
      assert.strictEqual(commands[0].args.length, 5);
      assert.deepStrictEqual(commands[0].args, ['-la', '-h', '--color=auto', '-R', '--sort=time']);
    });

    it('should handle path arguments', () => {
      const script = 'ls /path/to/directory';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands[0].type, 'simple');
      assert.strictEqual(commands[0].args[0], '/path/to/directory');
    });
  });

  describe('integration with real commands', () => {
    it('should correctly classify git commands', () => {
      const script = `git status
git log --oneline -5
git diff`;
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands.length, 3);
      commands.forEach(cmd => {
        assert.strictEqual(cmd.type, 'simple');
        assert.strictEqual(cmd.command, 'git');
      });
    });

    it('should handle find commands', () => {
      const script = 'find . -name "*.js" -type f';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands[0].type, 'simple');
      assert.strictEqual(commands[0].command, 'find');
    });

    it('should handle wc commands', () => {
      const script = 'wc -l file.txt';
      const commands = adapter.parseScript(script);

      assert.strictEqual(commands[0].type, 'simple');
      assert.strictEqual(commands[0].command, 'wc');
    });
  });
});
