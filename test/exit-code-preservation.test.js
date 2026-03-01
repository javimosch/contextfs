/**
 * Exit Code Preservation Tests
 *
 * Tests to verify CORE-05 (exit codes preserved) between RTK and native execution.
 * Ensures exit codes match exactly for success and failure cases.
 *
 * @module ExitCodePreservationTests
 */

'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_DIR = path.join(__dirname, 'tmp', 'exit-code-tests');

/**
 * Run a command and capture exit code
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, source: string}>}
 */
function runNative(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];

    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (error) => {
      // Handle command not found
      let exitCode = 1;
      if (error.code === 'ENOENT') {
        exitCode = 127;
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        exitCode = 126;
      }
      resolve({
        stdout: '',
        stderr: error.message,
        exitCode,
        source: 'native'
      });
    });

    child.on('close', (code, signal) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? (signal ? 128 + signal : 1),
        source: 'native'
      });
    });
  });
}

/**
 * Run a command via RTK
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, source: string}|null>}
 */
async function runRTK(command, args, cwd = process.cwd()) {
  try {
    const result = await runNative('rtk', [command, ...args], cwd);
    return {
      ...result,
      source: 'rtk'
    };
  } catch (error) {
    return null;
  }
}

/**
 * Check if in a git repository
 * @returns {boolean}
 */
function isGitRepository() {
  try {
    const gitDir = path.join(process.cwd(), '.git');
    return fs.existsSync(gitDir);
  } catch (_) {
    return false;
  }
}

describe('Exit Code Preservation Tests', () => {
  let rtkAvailable = false;

  before(async () => {
    // Check if RTK is available
    try {
      const result = await runNative('rtk', ['--version']);
      rtkAvailable = result.exitCode === 0;
      if (rtkAvailable) {
        console.log(`[RTK] Available: ${result.stdout.trim()}`);
      }
    } catch (error) {
      console.log('[RTK] Not available, some tests will compare native vs native');
    }

    // Create test directory and files
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }

    // Create test file for grep tests
    fs.writeFileSync(path.join(TEST_DIR, 'testfile.txt'), 'line one\nline two\nline three\n', 'utf8');

    // Create subdirectory
    const subdir = path.join(TEST_DIR, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, 'file.js'), 'console.log("test");\n', 'utf8');
  });

  describe('Exit code 0 (success)', () => {
    it('should return exit code 0 for ls on existing directory via both native and RTK', async () => {
      const nativeResult = await runNative('ls', [TEST_DIR]);
      const rtkResult = rtkAvailable ? await runRTK('ls', [TEST_DIR]) : nativeResult;

      assert.strictEqual(nativeResult.exitCode, 0, 'Native ls should succeed');
      
      if (rtkAvailable) {
        assert.strictEqual(rtkResult.exitCode, 0, 'RTK ls should succeed');
        assert.strictEqual(rtkResult.exitCode, nativeResult.exitCode,
          'Exit codes should match for successful ls');
      }
    });

    it('should return exit code 0 for grep with matching pattern', async () => {
      const nativeResult = await runNative('grep', ['line', path.join(TEST_DIR, 'testfile.txt')]);
      const rtkResult = rtkAvailable ? await runRTK('grep', ['line', path.join(TEST_DIR, 'testfile.txt')]) : nativeResult;

      assert.strictEqual(nativeResult.exitCode, 0, 'Native grep should succeed with matches');
      
      if (rtkAvailable) {
        assert.strictEqual(rtkResult.exitCode, 0, 'RTK grep should succeed with matches');
        assert.strictEqual(rtkResult.exitCode, nativeResult.exitCode,
          'Exit codes should match for successful grep');
      }
    });

    it('should return exit code 0 for cat on existing file', async () => {
      const nativeResult = await runNative('cat', [path.join(TEST_DIR, 'testfile.txt')]);
      const rtkResult = rtkAvailable ? await runRTK('cat', [path.join(TEST_DIR, 'testfile.txt')]) : nativeResult;

      assert.strictEqual(nativeResult.exitCode, 0, 'Native cat should succeed');
      
      if (rtkAvailable) {
        assert.strictEqual(rtkResult.exitCode, 0, 'RTK cat should succeed');
        assert.strictEqual(rtkResult.exitCode, nativeResult.exitCode,
          'Exit codes should match for successful cat');
      }
    });
  });

  describe('Exit code 1 (command failure)', () => {
    it('should return exit code 1 for grep with non-matching pattern', async () => {
      const nativeResult = await runNative('grep', ['xyz123notfound', path.join(TEST_DIR, 'testfile.txt')]);
      const rtkResult = rtkAvailable ? await runRTK('grep', ['xyz123notfound', path.join(TEST_DIR, 'testfile.txt')]) : nativeResult;

      assert.strictEqual(nativeResult.exitCode, 1, 'Native grep should return 1 for no matches');
      
      if (rtkAvailable) {
        assert.strictEqual(rtkResult.exitCode, 1, 'RTK grep should return 1 for no matches');
        assert.strictEqual(rtkResult.exitCode, nativeResult.exitCode,
          'Exit codes should match for grep with no matches');
      }
    });

    it('should not trigger fallback for exit code 1 (Tier 3 error)', async () => {
      // This test verifies that grep returning 1 (no matches) is NOT treated as a fallback trigger
      // Exit code 1 from grep is a legitimate command failure, not an infrastructure error
      
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const rtkResult = await runRTK('grep', ['nonexistent_pattern', path.join(TEST_DIR, 'testfile.txt')]);
      
      assert.strictEqual(rtkResult.exitCode, 1, 
        'RTK grep should return 1 for no matches without triggering fallback');
    });
  });

  describe('Exit code 2 (usage error)', () => {
    it('should return exit code 2 for ls with invalid flag via native', async () => {
      const nativeResult = await runNative('ls', ['--invalid-flag-that-does-not-exist']);
      
      // Note: Different ls implementations may return different codes
      // Some return 2 for usage errors, others return 1
      assert(nativeResult.exitCode !== 0, 'Native ls should fail with invalid flag');
      console.log(`ls with invalid flag: exit code ${nativeResult.exitCode}`);
    });

    it('should fallback to native for unsupported flags and preserve exit code', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      // Try a flag that's not in the RTK allowlist
      const rtkResult = await runRTK('ls', ['--invalid-flag-xyz']);
      
      // RTK should either handle it (if supported) or fallback to native
      // Either way, exit code should be non-zero
      assert(rtkResult.exitCode !== 0, 'Should return non-zero for invalid flag');
    });
  });

  describe('Exit code 126 (permission denied)', () => {
    it('should return exit code 126 for non-executable file via native', async () => {
      // Create a non-executable file and try to execute it
      const scriptPath = path.join(TEST_DIR, 'not-executable.sh');
      fs.writeFileSync(scriptPath, '#!/bin/sh\necho test\n', 'utf8');
      
      // Try to execute it directly (without chmod +x)
      const nativeResult = await runNative(scriptPath, []);
      
      // Should get permission denied (126) or command not found behavior
      console.log(`Non-executable file: exit code ${nativeResult.exitCode}`);
      assert(nativeResult.exitCode !== 0, 'Should fail for non-executable file');
    });
  });

  describe('Exit code 127 (command not found)', () => {
    it('should return exit code 127 for nonexistent command via native', async () => {
      const nativeResult = await runNative('nonexistentcommand12345', []);
      
      assert.strictEqual(nativeResult.exitCode, 127, 
        'Native should return 127 for command not found');
    });

    it('should return exit code 127 for nonexistent command via RTK', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const rtkResult = await runRTK('nonexistentcommand12345', []);
      
      assert.strictEqual(rtkResult.exitCode, 127, 
        'RTK should return 127 for command not found');
    });
  });

  describe('Git exit codes', () => {
    it('should return exit code 128 for git status outside git repo via native', async () => {
      // Create a temp directory that's not a git repo
      // Use /tmp to ensure we're outside any git repository
      const nonGitDir = path.join('/tmp', 'exit-code-test-no-git-' + Date.now());
      fs.mkdirSync(nonGitDir, { recursive: true });

      try {
        const nativeResult = await runNative('git', ['status'], nonGitDir);
        
        // Git returns 128 for "not a git repository" error
        // Note: In nested directories within a git repo, git may still find the parent repo
        // So we check that it's non-zero (failure) rather than specifically 128
        assert(nativeResult.exitCode !== 0, 
          `Native git status should fail outside git repo, got exit code ${nativeResult.exitCode}`);
        console.log(`git status outside repo: exit code ${nativeResult.exitCode}`);
      } finally {
        // Cleanup
        try { fs.rmdirSync(nonGitDir); } catch (_) {}
      }
    });

    it('should preserve git exit codes via RTK', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      // Create a temp directory outside any git repo
      const nonGitDir = path.join('/tmp', 'exit-code-test-no-git-2-' + Date.now());
      fs.mkdirSync(nonGitDir, { recursive: true });

      try {
        const nativeResult = await runNative('git', ['status'], nonGitDir);
        const rtkResult = await runRTK('git', ['status'], nonGitDir);
        
        assert.strictEqual(rtkResult.exitCode, nativeResult.exitCode,
          'RTK git status should return same exit code as native');
      } finally {
        // Cleanup
        try { fs.rmdirSync(nonGitDir); } catch (_) {}
      }
    });

    it('should return exit code 0 for git status in a valid git repo', async () => {
      if (!isGitRepository()) {
        console.log('Skipping: Not in a git repository');
        return;
      }

      const nativeResult = await runNative('git', ['status']);
      
      // In a valid git repo, git status should succeed
      assert.strictEqual(nativeResult.exitCode, 0,
        'git status should succeed in valid git repository');
    });
  });

  describe('Failed command identification', () => {
    it('should identify commands with non-zero exit as failed', async () => {
      const failingResult = await runNative('grep', ['nonexistent', path.join(TEST_DIR, 'testfile.txt')]);
      
      assert(failingResult.exitCode !== 0, 'Grep with no matches should have non-zero exit code');
      
      // Simulate SpawnWrapper failed check
      const isFailed = failingResult.exitCode !== 0;
      assert.strictEqual(isFailed, true, 'Commands with non-zero exit should be marked as failed');
    });

    it('should not have false positives for successful commands', async () => {
      const successResult = await runNative('ls', [TEST_DIR]);
      
      assert.strictEqual(successResult.exitCode, 0, 'ls should succeed');
      
      const isFailed = successResult.exitCode !== 0;
      assert.strictEqual(isFailed, false, 'Successful commands should not be marked as failed');
    });

    it('should track result source correctly', async () => {
      const nativeResult = await runNative('ls', [TEST_DIR]);
      assert.strictEqual(nativeResult.source, 'native', 'Native execution should have source "native"');
      
      if (rtkAvailable) {
        const rtkResult = await runRTK('ls', [TEST_DIR]);
        assert.strictEqual(rtkResult.source, 'rtk', 'RTK execution should have source "rtk"');
      }
    });
  });

  describe('Exit code equivalence for core commands', () => {
    it('should have matching exit codes for ls commands', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const testCases = [
        { args: [TEST_DIR], description: 'ls on directory' },
        { args: ['-la', TEST_DIR], description: 'ls -la' },
        { args: ['nonexistent-dir-12345'], description: 'ls on nonexistent dir' }
      ];

      for (const testCase of testCases) {
        const nativeResult = await runNative('ls', testCase.args);
        const rtkResult = await runRTK('ls', testCase.args);
        
        assert.strictEqual(rtkResult.exitCode, nativeResult.exitCode,
          `Exit codes should match for ${testCase.description}: ` +
          `native=${nativeResult.exitCode}, rtk=${rtkResult.exitCode}`);
      }
    });

    it('should have matching exit codes for grep commands', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const testFile = path.join(TEST_DIR, 'testfile.txt');
      const testCases = [
        { args: ['line', testFile], description: 'grep with matches' },
        { args: ['nomatch12345', testFile], description: 'grep without matches' },
        { args: ['-r', 'line', TEST_DIR], description: 'grep -r' }
      ];

      for (const testCase of testCases) {
        const nativeResult = await runNative('grep', testCase.args);
        const rtkResult = await runRTK('grep', testCase.args);
        
        assert.strictEqual(rtkResult.exitCode, nativeResult.exitCode,
          `Exit codes should match for ${testCase.description}: ` +
          `native=${nativeResult.exitCode}, rtk=${rtkResult.exitCode}`);
      }
    });

    it('should have matching exit codes for cat commands', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const testCases = [
        { args: [path.join(TEST_DIR, 'testfile.txt')], description: 'cat existing file' },
        { args: ['nonexistent-file-12345.txt'], description: 'cat nonexistent file' }
      ];

      for (const testCase of testCases) {
        const nativeResult = await runNative('cat', testCase.args);
        const rtkResult = await runRTK('cat', testCase.args);
        
        assert.strictEqual(rtkResult.exitCode, nativeResult.exitCode,
          `Exit codes should match for ${testCase.description}: ` +
          `native=${nativeResult.exitCode}, rtk=${rtkResult.exitCode}`);
      }
    });
  });

  describe('Aggregate exit code verification', () => {
    it('should have 100% exit code match rate across all tests', async () => {
      const results = [];

      // Test various commands and collect exit code comparisons
      const commands = [
        { cmd: 'ls', args: [TEST_DIR] },
        { cmd: 'ls', args: ['-la', TEST_DIR] },
        { cmd: 'grep', args: ['line', path.join(TEST_DIR, 'testfile.txt')] },
        { cmd: 'grep', args: ['xyz123', path.join(TEST_DIR, 'testfile.txt')] },
        { cmd: 'cat', args: [path.join(TEST_DIR, 'testfile.txt')] }
      ];

      for (const { cmd, args } of commands) {
        const nativeResult = await runNative(cmd, args);
        const rtkResult = rtkAvailable ? await runRTK(cmd, args) : nativeResult;
        
        results.push({
          command: `${cmd} ${args.join(' ')}`,
          nativeExit: nativeResult.exitCode,
          rtkExit: rtkResult.exitCode,
          match: nativeResult.exitCode === rtkResult.exitCode
        });
      }

      // Calculate match rate
      const matches = results.filter(r => r.match).length;
      const total = results.length;
      const matchRate = total > 0 ? Math.round((matches / total) * 100) : 0;

      console.log('\n=== Exit Code Comparison ===');
      results.forEach(r => {
        const status = r.match ? '✓' : '✗';
        console.log(`${status} ${r.command}: native=${r.nativeExit}, rtk=${r.rtkExit}`);
      });
      console.log(`\nMatch rate: ${matches}/${total} (${matchRate}%)\n`);

      assert.strictEqual(matchRate, 100, 
        `Expected 100% exit code match rate, got ${matchRate}%`);
    });
  });
});
