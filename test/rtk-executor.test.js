/**
 * RTK Executor Tests
 * Phase 09-04: RTK execution with fallback logic
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { RTKExecutor, RTKExecutionError } = require('../server/mcp/tools/rtk-executor.js');
const { NativeExecutor } = require('../server/mcp/tools/native-executor.js');
const { ErrorClassifier } = require('../server/mcp/tools/error-classifier.js');
const { RTKConfig } = require('../server/config/rtk-config.js');

// Store original env
const originalEnv = { ...process.env };

describe('RTKExecutor', () => {
  let executor;

  beforeEach(() => {
    // Clear config cache
    if (RTKConfig._clearCache) {
      RTKConfig._clearCache();
    }
    executor = new RTKExecutor();
  });

  afterEach(() => {
    // Restore env
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
  });

  describe('RTK Disabled', () => {
    it('should use native execution when RTK is disabled', async () => {
      process.env.CONTEXTFS_RTK_ENABLED = 'false';
      delete require.cache[require.resolve('../server/config/rtk-config.js')];
      delete require.cache[require.resolve('../server/mcp/tools/rtk-executor.js')];
      
      const { RTKExecutor: FreshRTKExecutor } = require('../server/mcp/tools/rtk-executor.js');
      const freshExecutor = new FreshRTKExecutor();
      
      const result = await freshExecutor.execute('echo', ['test']);
      
      assert.strictEqual(result.source, 'native');
      assert.strictEqual(result.exitCode, 0);
    });
  });

  describe('Command Allowlist', () => {
    it('should execute supported command via RTK when enabled', async () => {
      // This would require actual RTK binary, so we test the allowlist logic
      assert.strictEqual(executor.isSupportedCommand('ls', ['-l']), true);
      assert.strictEqual(executor.isSupportedCommand('ls', ['-la']), true);
    });

    it('should reject unsupported flags', async () => {
      assert.strictEqual(executor.isSupportedCommand('ls', ['--unsupported']), false);
      assert.strictEqual(executor.isSupportedCommand('ls', ['-l', '--invalid']), false);
    });

    it('should reject unsupported commands', async () => {
      assert.strictEqual(executor.isSupportedCommand('rm', ['-rf']), false);
      assert.strictEqual(executor.isSupportedCommand('sudo', ['ls']), false);
    });

    it('should use native execution for unsupported commands', async () => {
      process.env.CONTEXTFS_RTK_ENABLED = 'true';
      
      const result = await executor.execute('rm', ['-rf', '/tmp/test']);
      
      // Should fall back to native since rm is not in allowlist
      assert.strictEqual(result.source, 'native');
    });

    it('should ignore non-flag arguments in allowlist check', async () => {
      // ls with file arguments (not flags) should be supported
      assert.strictEqual(executor.isSupportedCommand('ls', ['-l', '/tmp']), true);
      assert.strictEqual(executor.isSupportedCommand('ls', ['/home', '-a']), true);
    });
  });

  describe('Error Classification Integration', () => {
    it('should classify ENOENT as Tier 1 fallback error', async () => {
      const error = { code: 'ENOENT' };
      const classification = ErrorClassifier.classify(error);
      
      assert.strictEqual(classification.tier, 1);
      assert.strictEqual(classification.fallback, true);
    });

    it('should classify RTK option errors as Tier 2 fallback', async () => {
      const error = {};
      const stderr = 'rtk: unrecognized option --invalid';
      const classification = ErrorClassifier.classify(error, stderr);
      
      assert.strictEqual(classification.tier, 2);
      assert.strictEqual(classification.fallback, true);
    });

    it('should classify command errors as Tier 3 no-fallback', async () => {
      const error = { code: 1 };
      const classification = ErrorClassifier.classify(error);
      
      assert.strictEqual(classification.tier, 3);
      assert.strictEqual(classification.fallback, false);
    });
  });

  describe('RTKExecutionError', () => {
    it('should create error with type and metadata', () => {
      const error = new RTKExecutionError(
        'BINARY_NOT_FOUND',
        'RTK binary not found',
        { shouldFallback: true, exitCode: 1, stderr: 'error output' }
      );
      
      assert.strictEqual(error.name, 'RTKExecutionError');
      assert.strictEqual(error.type, 'BINARY_NOT_FOUND');
      assert.strictEqual(error.shouldFallback, true);
      assert.strictEqual(error.exitCode, 1);
      assert.strictEqual(error.stderr, 'error output');
    });

    it('should default shouldFallback to false', () => {
      const error = new RTKExecutionError('TEST', 'Test message');
      
      assert.strictEqual(error.shouldFallback, false);
    });
  });

  describe('Command Mapping', () => {
    it('should map ls command to RTK ls subcommand', () => {
      const args = executor.mapToRTKArgs('ls', ['-l', '-a']);
      
      assert.deepStrictEqual(args, ['ls', '-l', '-a']);
    });

    it('should map grep to RTK grep subcommand', () => {
      const args = executor.mapToRTKArgs('grep', ['-i', 'pattern']);
      
      assert.deepStrictEqual(args, ['grep', '-i', 'pattern']);
    });

    it('should map rg to RTK grep subcommand', () => {
      const args = executor.mapToRTKArgs('rg', ['-n', 'search']);
      
      assert.deepStrictEqual(args, ['grep', '-n', 'search']);
    });

    it('should map git commands', () => {
      const args = executor.mapToRTKArgs('git', ['status']);
      
      assert.deepStrictEqual(args, ['git', 'status']);
    });

    it('should pass through unknown commands', () => {
      const args = executor.mapToRTKArgs('custom', ['arg1', 'arg2']);
      
      assert.deepStrictEqual(args, ['custom', 'arg1', 'arg2']);
    });
  });

  describe('Exit Code Preservation', () => {
    it('should preserve exit code 0 on success', async () => {
      // When RTK disabled, native execution should preserve exit codes
      process.env.CONTEXTFS_RTK_ENABLED = 'false';
      delete require.cache[require.resolve('../server/config/rtk-config.js')];
      delete require.cache[require.resolve('../server/mcp/tools/rtk-executor.js')];
      
      const { RTKExecutor: FreshExecutor } = require('../server/mcp/tools/rtk-executor.js');
      const exec = new FreshExecutor();
      
      const result = await exec.execute('true');
      
      assert.strictEqual(result.exitCode, 0);
    });

    it('should preserve exit code 1 on failure', async () => {
      process.env.CONTEXTFS_RTK_ENABLED = 'false';
      delete require.cache[require.resolve('../server/config/rtk-config.js')];
      delete require.cache[require.resolve('../server/mcp/tools/rtk-executor.js')];
      
      const { RTKExecutor: FreshExecutor } = require('../server/mcp/tools/rtk-executor.js');
      const exec = new FreshExecutor();
      
      const result = await exec.execute('false');
      
      assert.strictEqual(result.exitCode, 1);
    });
  });

  describe('Allowlist Access', () => {
    it('should provide static method to get allowlist', () => {
      const allowlist = RTKExecutor.getAllowlist();
      
      assert.ok(allowlist.ls);
      assert.ok(allowlist.grep);
      assert.ok(allowlist.git);
      assert.ok(Array.isArray(allowlist.ls));
    });

    it('should return copy of allowlist (not reference)', () => {
      const allowlist1 = RTKExecutor.getAllowlist();
      const allowlist2 = RTKExecutor.getAllowlist();
      
      assert.notStrictEqual(allowlist1, allowlist2);
      assert.deepStrictEqual(allowlist1, allowlist2);
    });
  });

  describe('Constructor Options', () => {
    it('should accept custom nativeExecutor', () => {
      const customNative = new NativeExecutor({ defaultTimeout: 5000 });
      const exec = new RTKExecutor({ nativeExecutor: customNative });
      
      assert.strictEqual(exec.nativeExecutor, customNative);
    });

    it('should create default nativeExecutor if not provided', () => {
      assert.ok(executor.nativeExecutor instanceof NativeExecutor);
    });
  });

  describe('Module Exports', () => {
    it('should export RTKExecutor class', () => {
      assert.strictEqual(typeof RTKExecutor, 'function');
    });

    it('should export RTKExecutionError class', () => {
      assert.strictEqual(typeof RTKExecutionError, 'function');
    });
  });
});

console.log('\nTest file loaded: rtk-executor.test.js');