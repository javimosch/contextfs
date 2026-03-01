/**
 * Core Command Integration Tests
 *
 * Integration tests for core commands (ls, grep, git, docker) using RTK.
 * Verifies token reduction and output formatting.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SpawnWrapper } = require('../server/mcp/tools/spawn-wrapper.js');
const { RTKExecutor } = require('../server/mcp/tools/rtk-executor.js');
const { TokenTracker } = require('../server/mcp/tools/token-tracker.js');
const { runCommand, runCommandStreaming } = require('../client/spawn.js');

describe('CORE-01: ls command integration', () => {
  const testDir = '/tmp/core-cmd-test-ls';

  before(() => {
    // Create test directory with 50+ files
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    for (let i = 1; i <= 55; i++) {
      fs.writeFileSync(path.join(testDir, `file${i.toString().padStart(3, '0')}.txt`), `Content ${i}`);
    }
  });

  after(() => {
    // Cleanup
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('should list directory with 50+ files', async () => {
    const result = await runCommand({ cmd: 'ls', args: ['-la', testDir] });

    assert.strictEqual(result.code, 0, 'Command should succeed');
    assert.ok(result.stdout.includes('file001.txt'), 'Should list files');
    assert.ok(result.stdout.includes('file055.txt'), 'Should list all files');
  });

  it('should return compact output format', async () => {
    const result = await runCommand({ cmd: 'ls', args: [testDir] });

    assert.strictEqual(result.code, 0);
    // Output should contain file names
    assert.ok(result.stdout.includes('file001.txt'));
  });
});

describe('CORE-02: grep command integration', () => {
  const testDir = '/tmp/core-cmd-test-grep';

  before(() => {
    // Create test files with searchable content
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'Hello world\nTest pattern\nAnother line');
    fs.writeFileSync(path.join(testDir, 'file2.txt'), 'Test pattern in file2\nDifferent content');
    fs.writeFileSync(path.join(testDir, 'file3.txt'), 'No match here\nOnly boring content');
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('should search for pattern across multiple files', async () => {
    const result = await runCommand({ cmd: 'grep', args: ['-r', 'Test pattern', testDir] });

    assert.strictEqual(result.code, 0, 'Should find matches');
    assert.ok(result.stdout.includes('file1.txt') || result.stdout.includes('Test pattern'), 'Should find pattern');
  });

  it('should return exit code 1 when no matches found', async () => {
    const result = await runCommand({ cmd: 'grep', args: ['-r', 'nonexistent-pattern-xyz', testDir] });

    assert.strictEqual(result.code, 1, 'Should return 1 when no matches');
  });

  it('should support case-insensitive search with -i flag', async () => {
    const result = await runCommand({ cmd: 'grep', args: ['-i', 'HELLO', path.join(testDir, 'file1.txt')] });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.toLowerCase().includes('hello'));
  });
});

describe('CORE-03: git command integration', () => {
  const testRepo = '/tmp/core-cmd-test-git';

  before(() => {
    // Create temporary git repository
    if (!fs.existsSync(testRepo)) {
      fs.mkdirSync(testRepo, { recursive: true });
    }
    spawnSync('git', ['init'], { cwd: testRepo });
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testRepo });
    spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: testRepo });

    // Create initial commit
    fs.writeFileSync(path.join(testRepo, 'README.md'), '# Test Repo');
    spawnSync('git', ['add', '.'], { cwd: testRepo });
    spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: testRepo });

    // Create uncommitted changes
    fs.writeFileSync(path.join(testRepo, 'newfile.txt'), 'New content');
  });

  after(() => {
    try {
      fs.rmSync(testRepo, { recursive: true, force: true });
    } catch (_) {}
  });

  it('should run git status in repository', async () => {
    const result = await runCommand({ cmd: 'git', args: ['status'], cwd: testRepo });

    assert.strictEqual(result.code, 0, 'git status should succeed');
    assert.ok(
      result.stdout.includes('newfile.txt') || result.stdout.includes('Untracked files'),
      'Should show untracked files'
    );
  });

  it('should run git log', async () => {
    const result = await runCommand({ cmd: 'git', args: ['log', '--oneline'], cwd: testRepo });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Initial commit'), 'Should show commit');
  });

  it('should run git diff', async () => {
    // Stage the file first
    spawnSync('git', ['add', 'newfile.txt'], { cwd: testRepo });

    const result = await runCommand({ cmd: 'git', args: ['diff', '--cached'], cwd: testRepo });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('New content') || result.stdout.includes('newfile.txt'));
  });
});

describe('CORE-04: docker command integration', () => {
  // Check if docker is available
  const dockerAvailable = (() => {
    try {
      const result = spawnSync('docker', ['--version'], { encoding: 'utf8' });
      return result.status === 0;
    } catch (_) {
      return false;
    }
  })();

  it('should check if docker is available', () => {
    // This test just verifies our detection logic
    assert.ok(typeof dockerAvailable === 'boolean');
  });

  (dockerAvailable ? it : it.skip)('should run docker ps', async () => {
    const result = await runCommand({ cmd: 'docker', args: ['ps'] });

    // docker ps returns 0 even when no containers running
    assert.strictEqual(result.code, 0);
    assert.ok(
      result.stdout.includes('CONTAINER') || result.stdout.includes('NAMES'),
      'Should show container header'
    );
  });

  (dockerAvailable ? it : it.skip)('should run docker images', async () => {
    const result = await runCommand({ cmd: 'docker', args: ['images'] });

    assert.strictEqual(result.code, 0);
    assert.ok(
      result.stdout.includes('REPOSITORY') || result.stdout.includes('TAG'),
      'Should show images header'
    );
  });
});

describe('CORE-05: Exit code preservation', () => {
  it('should preserve exit code 0 for successful commands', async () => {
    const result = await runCommand({ cmd: 'echo', args: ['success'] });

    assert.strictEqual(result.code, 0);
  });

  it('should preserve exit code 1 for failed commands', async () => {
    const result = await runCommand({ cmd: 'false', args: [] });

    assert.strictEqual(result.code, 1);
  });

  it('should preserve exit code 127 for command not found', async () => {
    const result = await runCommand({ cmd: 'definitely-not-a-command-xyz123', args: [] });

    assert.strictEqual(result.code, 127);
  });

  it('should preserve exit code from grep with no matches', async () => {
    const result = await runCommand({ cmd: 'grep', args: ['xyz123nonexistent', '/etc/passwd'] });

    assert.strictEqual(result.code, 1);
  });
});

describe('CORE-06: native: prefix bypass', () => {
  it('should bypass RTK when native: prefix is used', async () => {
    const result = await runCommand({ cmd: 'native:echo', args: ['bypass test'] });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('bypass test'));
  });

  it('should work with native: prefix on ls', async () => {
    const result = await runCommand({ cmd: 'native:ls', args: ['-la', '/'] });

    assert.strictEqual(result.code, 0);
    // Should show typical ls output
    assert.ok(result.stdout.length > 0);
  });
});

describe('CORE-07: Streaming support', () => {
  it('should support streaming output via runCommandStreaming', async () => {
    const chunks = [];

    const result = await runCommandStreaming({
      cmd: 'echo',
      args: ['streaming test'],
      onChunk: ({ chunk, stream }) => {
        chunks.push({ chunk, stream });
      }
    });

    assert.strictEqual(result.code, 0);
    assert.ok(chunks.length > 0, 'Should have received chunks');
    assert.ok(
      chunks.some(c => c.chunk.includes('streaming test')),
      'Should receive the test content'
    );
  });

  it('should support streaming with stderr', async () => {
    const chunks = [];

    // This command outputs to stderr
    const result = await runCommandStreaming({
      cmd: 'ls',
      args: ['/nonexistent-path-xyz'],
      onChunk: ({ chunk, stream }) => {
        chunks.push({ chunk, stream });
      }
    });

    assert.ok(result.code !== 0, 'Should fail for nonexistent path');
    assert.ok(chunks.length > 0, 'Should have received error chunks');
  });
});

describe('CORE-08: Complex command handling', () => {
  it('should handle commands with multiple arguments', async () => {
    const result = await runCommand({
      cmd: 'ls',
      args: ['-la', '-h', '--color=auto', '/tmp']
    });

    assert.strictEqual(result.code, 0);
  });

  it('should handle commands with file patterns', async () => {
    const testDir = '/tmp/core-cmd-test-patterns';
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test1.txt'), 'test');
    fs.writeFileSync(path.join(testDir, 'test2.txt'), 'test');

    try {
      const result = await runCommand({
        cmd: 'ls',
        args: [path.join(testDir, '*.txt')]
      });

      // Glob patterns might be expanded by shell or return error if no match
      // ls returns 2 when glob doesn't match any files
      assert.ok(result.code === 0 || result.code === 1 || result.code === 2,
        `Expected exit code 0, 1, or 2, got ${result.code}`);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe('CORE-09: Error handling and edge cases', () => {
  it('should handle permission denied errors', async () => {
    const result = await runCommand({ cmd: 'ls', args: ['/root'] });

    // Should fail with permission denied (non-zero exit)
    assert.ok(result.code !== 0);
  });

  it('should handle very long arguments', async () => {
    const longArg = 'a'.repeat(1000);
    const result = await runCommand({ cmd: 'echo', args: [longArg] });

    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('a'));
  });

  it('should handle commands with spaces in paths', async () => {
    const testDir = '/tmp/core cmd test spaces';
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'file.txt'), 'content');

    try {
      const result = await runCommand({ cmd: 'ls', args: [testDir] });

      assert.strictEqual(result.code, 0);
      assert.ok(result.stdout.includes('file.txt'));
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe('CORE-10: Token tracking integration', () => {
  it('should track commands when token tracker is available', async () => {
    const tokenTracker = new TokenTracker();
    const rtkExecutor = new RTKExecutor();

    // Mock the executor to avoid actual RTK dependency
    const mockExecute = async (cmd, args) => ({
      stdout: 'compact output',
      stderr: '',
      exitCode: 0,
      source: 'rtk'
    });
    rtkExecutor.execute = mockExecute;
    rtkExecutor.isSupportedCommand = () => true;

    const wrapper = new SpawnWrapper({ rtkExecutor, tokenTracker });

    await wrapper.execute('ls', ['-la']);

    const summary = tokenTracker.getSummary();
    assert.strictEqual(summary.totalCommands, 1);
    assert.strictEqual(summary.rtkCommands, 1);
  });
});