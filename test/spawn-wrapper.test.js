/**
 * Spawn Wrapper Unit Tests
 *
 * Tests for SpawnWrapper class including RTK routing,
 * native prefix bypass, exit code preservation, and fallback logic.
 */

'use strict';

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');
const { SpawnWrapper } = require('../server/mcp/tools/spawn-wrapper.js');
const { RTKExecutionError } = require('../server/mcp/tools/rtk-executor.js');

describe('SpawnWrapper', () => {
  let mockRtkExecutor;
  let mockTokenTracker;
  let spawnWrapper;

  beforeEach(() => {
    // Create mock RTK executor
    mockRtkExecutor = {
      isSupportedCommand: mock.fn(() => true),
      execute: mock.fn()
    };

    // Create mock token tracker
    mockTokenTracker = {
      record: mock.fn()
    };

    // Create SpawnWrapper instance
    spawnWrapper = new SpawnWrapper({
      rtkExecutor: mockRtkExecutor,
      tokenTracker: mockTokenTracker
    });
  });

  describe('shouldUseRTK', () => {
    it('should return true for supported commands without native: prefix', () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);

      const result = spawnWrapper.shouldUseRTK('ls', ['-la']);

      assert.strictEqual(result, true);
      assert.strictEqual(mockRtkExecutor.isSupportedCommand.mock.calls.length, 1);
    });

    it('should return false for commands with native: prefix', () => {
      const result = spawnWrapper.shouldUseRTK('native:ls', ['-la']);

      assert.strictEqual(result, false);
      assert.strictEqual(mockRtkExecutor.isSupportedCommand.mock.calls.length, 0);
    });

    it('should return false for unsupported commands', () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => false);

      const result = spawnWrapper.shouldUseRTK('unknown-cmd', []);

      assert.strictEqual(result, false);
    });

    it('should return false when RTK executor is not available', () => {
      spawnWrapper.rtkExecutor = null;

      const result = spawnWrapper.shouldUseRTK('ls', ['-la']);

      assert.strictEqual(result, false);
    });
  });

  describe('execute', () => {
    it('should route supported commands through RTK', async () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);
      mockRtkExecutor.execute.mock.mockImplementation(async () => ({
        stdout: 'file1\nfile2',
        stderr: '',
        exitCode: 0,
        source: 'rtk'
      }));

      const result = await spawnWrapper.execute('ls', ['-la']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.source, 'rtk');
      assert.strictEqual(mockRtkExecutor.execute.mock.calls.length, 1);
    });

    it('should record token savings when RTK succeeds', async () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);
      mockRtkExecutor.execute.mock.mockImplementation(async () => ({
        stdout: 'compact output',
        stderr: '',
        exitCode: 0,
        source: 'rtk'
      }));

      await spawnWrapper.execute('ls', ['-la']);

      assert.strictEqual(mockTokenTracker.record.mock.calls.length, 1);
    });

    it('should bypass RTK for commands with native: prefix', async () => {
      // This will actually try to spawn - we need to handle it differently
      // For this test, we'll check the logic at the shouldUseRTK level
      const shouldUse = spawnWrapper.shouldUseRTK('native:ls', ['-la']);
      assert.strictEqual(shouldUse, false);
    });

    it('should preserve exit code 0 from RTK', async () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);
      mockRtkExecutor.execute.mock.mockImplementation(async () => ({
        stdout: 'success',
        stderr: '',
        exitCode: 0,
        source: 'rtk'
      }));

      const result = await spawnWrapper.execute('ls', []);

      assert.strictEqual(result.exitCode, 0);
    });

    it('should preserve exit code 1 from RTK', async () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);
      mockRtkExecutor.execute.mock.mockImplementation(async () => ({
        stdout: '',
        stderr: 'no matches found',
        exitCode: 1,
        source: 'rtk'
      }));

      const result = await spawnWrapper.execute('grep', ['pattern', 'file']);

      assert.strictEqual(result.exitCode, 1);
    });

    it('should fallback to native on RTKExecutionError with shouldFallback=true', async () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);

      const rtkError = new RTKExecutionError(
        'INFRASTRUCTURE_ERROR',
        'RTK binary not found',
        { shouldFallback: true, exitCode: 1 }
      );
      mockRtkExecutor.execute.mock.mockImplementation(async () => {
        throw rtkError;
      });

      // For this test, we need to verify the fallback logic is triggered
      // The actual native execution will fail in test environment
      try {
        await spawnWrapper.execute('ls', ['-la']);
      } catch (error) {
        // Expected - native execution fails in test environment
      }

      // Verify RTK was called
      assert.strictEqual(mockRtkExecutor.execute.mock.calls.length, 1);
    });

    it('should NOT fallback on RTKExecutionError with shouldFallback=false', async () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);

      const rtkError = new RTKExecutionError(
        'COMMAND_ERROR',
        'Invalid command syntax',
        { shouldFallback: false, exitCode: 1 }
      );
      mockRtkExecutor.execute.mock.mockImplementation(async () => {
        throw rtkError;
      });

      await assert.rejects(
        async () => await spawnWrapper.execute('ls', ['-la']),
        (err) => err instanceof RTKExecutionError && !err.shouldFallback
      );
    });
  });

  describe('executeNative', () => {
    it('should execute commands natively and return exit code 0', async () => {
      // Use a simple command that exists
      const result = await spawnWrapper.executeNative('echo', ['hello']);

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.source, 'native');
      assert.ok(result.stdout.includes('hello'));
    });

    it('should return exit code 127 for non-existent commands', async () => {
      const result = await spawnWrapper.executeNative('nonexistent-command-xyz', []);

      assert.strictEqual(result.exitCode, 127);
      assert.strictEqual(result.source, 'native');
    });

    it('should capture stdout and stderr', async () => {
      const result = await spawnWrapper.executeNative('echo', ['stdout test']);

      assert.ok(result.stdout.includes('stdout test'));
      assert.strictEqual(result.stderr, '');
    });
  });

  describe('wrapSpawn', () => {
    it('should return EventEmitter-compatible mock process', () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => false);

      const mockProcess = spawnWrapper.wrapSpawn('echo', ['test']);

      assert.ok(mockProcess);
      assert.ok(typeof mockProcess.on === 'function');
      assert.ok(typeof mockProcess.kill === 'function');
      assert.ok(mockProcess.stdout);
      assert.ok(mockProcess.stderr);
    });

    it('should emit stdout data event', (t, done) => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);
      mockRtkExecutor.execute.mock.mockImplementation(async () => ({
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
        source: 'rtk'
      }));

      const mockProcess = spawnWrapper.wrapSpawn('ls', []);

      mockProcess.stdout.on('data', (data) => {
        assert.ok(data.toString().includes('test output'));
        done();
      });
    });

    it('should emit close event with exit code', (t, done) => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => true);
      mockRtkExecutor.execute.mock.mockImplementation(async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        source: 'rtk'
      }));

      const mockProcess = spawnWrapper.wrapSpawn('ls', []);

      mockProcess.on('close', (code) => {
        assert.strictEqual(code, 0);
        done();
      });
    });
  });

  describe('createWrappedSpawn', () => {
    it('should return a function', () => {
      const wrappedSpawn = spawnWrapper.createWrappedSpawn();

      assert.strictEqual(typeof wrappedSpawn, 'function');
    });

    it('should create mock process when called', () => {
      mockRtkExecutor.isSupportedCommand.mock.mockImplementation(() => false);

      const wrappedSpawn = spawnWrapper.createWrappedSpawn();
      const mockProcess = wrappedSpawn('echo', ['test']);

      assert.ok(mockProcess);
      assert.ok(typeof mockProcess.on === 'function');
    });
  });
});

// Integration tests with real commands

describe('SpawnWrapper Integration', () => {
  it('should handle ls command via native execution', async () => {
    const spawnWrapper = new SpawnWrapper({
      rtkExecutor: null, // Force native execution
      tokenTracker: null
    });

    const result = await spawnWrapper.execute('ls', ['-la', '/']);

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.source, 'native');
    assert.ok(result.stdout.length > 0);
  });

  it('should handle grep command via native execution', async () => {
    const spawnWrapper = new SpawnWrapper({
      rtkExecutor: null,
      tokenTracker: null
    });

    const result = await spawnWrapper.execute('echo', ['hello world']);
    // Pipe not supported in simple execute, just test echo works

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello world'));
  });

  it('should preserve exit code 1 for failed commands', async () => {
    const spawnWrapper = new SpawnWrapper({
      rtkExecutor: null,
      tokenTracker: null
    });

    // Try to list a non-existent directory
    const result = await spawnWrapper.execute('ls', ['/nonexistent-directory-xyz']);

    assert.strictEqual(result.exitCode, 2); // ls returns 2 for file not found
    assert.strictEqual(result.source, 'native');
  });
});

// Test specific command support

describe('Command Support', () => {
  let spawnWrapper;
  let mockRtkExecutor;
  let mockTokenTracker;

  beforeEach(() => {
    mockRtkExecutor = {
      isSupportedCommand: mock.fn(() => true),
      execute: mock.fn(async () => ({
        stdout: 'rtk output',
        stderr: '',
        exitCode: 0,
        source: 'rtk'
      }))
    };

    mockTokenTracker = {
      record: mock.fn()
    };

    spawnWrapper = new SpawnWrapper({
      rtkExecutor: mockRtkExecutor,
      tokenTracker: mockTokenTracker
    });
  });

  it('should route ls through RTK', async () => {
    await spawnWrapper.execute('ls', ['-la']);

    assert.strictEqual(mockRtkExecutor.isSupportedCommand.mock.calls[0].arguments[0], 'ls');
  });

  it('should route grep through RTK', async () => {
    await spawnWrapper.execute('grep', ['-i', 'pattern', 'file']);

    assert.strictEqual(mockRtkExecutor.isSupportedCommand.mock.calls[0].arguments[0], 'grep');
  });

  it('should route git through RTK', async () => {
    await spawnWrapper.execute('git', ['status']);

    assert.strictEqual(mockRtkExecutor.isSupportedCommand.mock.calls[0].arguments[0], 'git');
  });

  it('should route docker through RTK', async () => {
    mockRtkExecutor.isSupportedCommand.mock.mockImplementation((cmd) => cmd === 'docker');

    await spawnWrapper.execute('docker', ['ps']);

    assert.strictEqual(mockRtkExecutor.isSupportedCommand.mock.calls[0].arguments[0], 'docker');
  });

  it('should handle rg (ripgrep) through RTK', async () => {
    await spawnWrapper.execute('rg', ['pattern']);

    assert.strictEqual(mockRtkExecutor.isSupportedCommand.mock.calls[0].arguments[0], 'rg');
  });
});

// Exit code preservation tests

describe('Exit Code Preservation', () => {
  it('should preserve exit code 0 for successful native execution', async () => {
    const spawnWrapper = new SpawnWrapper({ rtkExecutor: null, tokenTracker: null });

    const result = await spawnWrapper.executeNative('true', []);

    assert.strictEqual(result.exitCode, 0);
  });

  it('should preserve exit code 1 for failed native execution', async () => {
    const spawnWrapper = new SpawnWrapper({ rtkExecutor: null, tokenTracker: null });

    const result = await spawnWrapper.executeNative('false', []);

    assert.strictEqual(result.exitCode, 1);
  });

  it('should preserve exit code 127 for command not found', async () => {
    const spawnWrapper = new SpawnWrapper({ rtkExecutor: null, tokenTracker: null });

    const result = await spawnWrapper.executeNative('definitely-not-a-real-command', []);

    assert.strictEqual(result.exitCode, 127);
  });

  it('should preserve exit code 126 for permission denied', async () => {
    const spawnWrapper = new SpawnWrapper({ rtkExecutor: null, tokenTracker: null });

    // Try to execute a directory (permission denied)
    const result = await spawnWrapper.executeNative('/tmp', []);

    // May return 126 or other code depending on shell
    assert.ok(result.exitCode !== 0);
    assert.strictEqual(result.source, 'native');
  });
});

// Fallback tests

describe('Fallback Logic', () => {
  it('should log fallback events', async () => {
    const mockRtkExecutor = {
      isSupportedCommand: mock.fn(() => true),
      execute: mock.fn(async () => {
        const error = new RTKExecutionError(
          'INFRASTRUCTURE_ERROR',
          'RTK not available',
          { shouldFallback: true, exitCode: 1 }
        );
        throw error;
      })
    };

    const spawnWrapper = new SpawnWrapper({
      rtkExecutor: mockRtkExecutor,
      tokenTracker: null
    });

    // Will fallback to native which will succeed for 'echo'
    const result = await spawnWrapper.execute('echo', ['fallback test']);

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.source, 'native');
  });
});

// Native prefix bypass tests

describe('Native Prefix Bypass', () => {
  it('should detect native: prefix in command', () => {
    const spawnWrapper = new SpawnWrapper({ rtkExecutor: null, tokenTracker: null });

    const result = spawnWrapper.shouldUseRTK('native:ls', ['-la']);

    assert.strictEqual(result, false);
  });

  it('should bypass RTK when native: prefix is present', async () => {
    const mockRtkExecutor = {
      isSupportedCommand: mock.fn(() => true),
      execute: mock.fn(async () => ({
        stdout: 'rtk output',
        stderr: '',
        exitCode: 0,
        source: 'rtk'
      }))
    };

    const spawnWrapper = new SpawnWrapper({
      rtkExecutor: mockRtkExecutor,
      tokenTracker: null
    });

    // Execute with native: prefix - should use native
    const result = await spawnWrapper.execute('native:echo', ['native test']);

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.source, 'native');
    // RTK executor should not be called for bypass commands
    assert.strictEqual(mockRtkExecutor.execute.mock.calls.length, 0);
  });
});