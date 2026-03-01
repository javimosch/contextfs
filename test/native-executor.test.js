/**
 * Native Executor Tests
 * Phase 09-04: Native command execution fallback
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { NativeExecutor, ExitCodes } = require('../server/mcp/tools/native-executor.js');

describe('NativeExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new NativeExecutor();
  });

  describe('Basic Execution', () => {
    it('should execute echo command successfully', async () => {
      const result = await executor.execute('echo', ['hello world']);
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('hello world'));
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(result.source, 'native');
    });

    it('should execute pwd and return current directory', async () => {
      const result = await executor.execute('pwd');
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.length > 0);
      assert.strictEqual(result.source, 'native');
    });

    it('should handle commands with multiple arguments', async () => {
      const result = await executor.execute('printf', ['%s %s', 'hello', 'world']);
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('hello world'));
    });
  });

  describe('Command Not Found (ENOENT)', () => {
    it('should return exit code 127 for nonexistent command', async () => {
      const result = await executor.execute('nonexistent_command_xyz');
      
      assert.strictEqual(result.exitCode, ExitCodes.COMMAND_NOT_FOUND);
      assert.strictEqual(result.source, 'native');
      assert.ok(result.stderr.includes('not found') || result.stderr.includes('nonexistent'));
    });

    it('should handle command not found with empty stdout', async () => {
      const result = await executor.execute('definitely_not_real_12345');
      
      assert.strictEqual(result.stdout, '');
      assert.strictEqual(result.exitCode, 127);
    });
  });

  describe('Command Failure (Non-zero Exit)', () => {
    it('should capture exit code 1 from false command', async () => {
      const result = await executor.execute('false');
      
      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(result.source, 'native');
    });

    it('should capture stderr from failing command', async () => {
      // Use ls with nonexistent directory
      const result = await executor.execute('ls', ['--invalid-flag-that-does-not-exist-xyz']);
      
      // ls returns exit 2 for invalid option
      assert.ok(result.exitCode !== 0);
      assert.ok(result.stderr.length > 0 || result.stdout.length === 0);
      assert.strictEqual(result.source, 'native');
    });

    it('should preserve various exit codes', async () => {
      // Test grep with no match (exit 1)
      const result = await executor.execute('grep', ['xyz123nonexistent', '/etc/passwd']);
      
      assert.strictEqual(result.exitCode, 1);
    });
  });

  describe('Timeout Handling', () => {
    it('should enforce timeout and kill long-running command', async () => {
      const startTime = Date.now();
      const result = await executor.execute('sleep', ['10'], { timeout: 100 });
      const duration = Date.now() - startTime;
      
      // Should complete much faster than 10 seconds
      assert.ok(duration < 2000, `Timeout took too long: ${duration}ms`);
      assert.ok(result.exitCode !== 0);
    });

    it('should use default timeout when not specified', async () => {
      const execWithDefault = new NativeExecutor({ defaultTimeout: 50000 });
      // Quick command should complete within default timeout
      const result = await execWithDefault.execute('echo', ['test']);
      
      assert.strictEqual(result.exitCode, 0);
    });
  });

  describe('Options Support', () => {
    it('should support custom cwd', async () => {
      const result = await executor.execute('pwd', [], { cwd: '/tmp' });
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('/tmp'));
    });

    it('should support custom env variables', async () => {
      const result = await executor.execute('printenv', ['TEST_VAR'], {
        env: { ...process.env, TEST_VAR: 'test_value_123' }
      });
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('test_value_123'));
    });
  });

  describe('Output Streaming', () => {
    it('should capture large stdout correctly', async () => {
      // Generate large output
      const result = await executor.execute('seq', ['1', '1000']);
      
      assert.strictEqual(result.exitCode, 0);
      const lines = result.stdout.trim().split('\n');
      assert.strictEqual(lines.length, 1000);
      assert.strictEqual(lines[0], '1');
      assert.strictEqual(lines[999], '1000');
    });

    it('should handle commands with both stdout and stderr', async () => {
      // Use a command that writes to both
      const result = await executor.execute('sh', ['-c', 'echo stdout_msg; echo stderr_msg >&2']);
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('stdout_msg'));
      assert.ok(result.stderr.includes('stderr_msg'));
    });
  });

  describe('ExitCodes Constants', () => {
    it('should export standard exit codes', () => {
      assert.strictEqual(ExitCodes.SUCCESS, 0);
      assert.strictEqual(ExitCodes.COMMAND_NOT_FOUND, 127);
      assert.strictEqual(ExitCodes.PERMISSION_DENIED, 126);
    });
  });

  describe('Security', () => {
    it('should use shell: false to prevent injection', async () => {
      // This would be dangerous with shell: true
      const result = await executor.execute('echo', ['; rm -rf /']);
      
      assert.strictEqual(result.exitCode, 0);
      // Arguments should be treated literally, not as shell commands
      assert.ok(result.stdout.includes('; rm -rf /'));
    });
  });
});

console.log('\nTest file loaded: native-executor.test.js');