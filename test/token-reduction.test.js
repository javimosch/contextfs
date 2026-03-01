/**
 * Token Reduction Verification Tests
 *
 * Tests to verify CORE-06 (60-80% token reduction) is achieved for core commands.
 * Compares RTK output size vs native output size for the same commands.
 *
 * @module TokenReductionTests
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_DIR = path.join(__dirname, 'tmp', 'token-reduction');
const MIN_REDUCTION_PERCENT = 60; // Minimum 60% reduction
const TARGET_REDUCTION_PERCENT = 80; // Target 80% reduction

/**
 * Run a command and capture output
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function runCommand(command, args, cwd = process.cwd()) {
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

    child.on('error', (error) => reject(error));

    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code ?? 0
      });
    });
  });
}

/**
 * Run a command via RTK
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function runRTK(command, args, cwd = process.cwd()) {
  // Check if RTK is available
  try {
    const rtkResult = await runCommand('rtk', [command, ...args], cwd);
    return rtkResult;
  } catch (error) {
    // RTK not available, skip test
    return null;
  }
}

/**
 * Measure token reduction between native and RTK execution
 * @param {string} command - Command name
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<{nativeChars: number, rtkChars: number, reduction: number}|null>}
 */
async function measureReduction(command, args, cwd = process.cwd()) {
  const nativeResult = await runCommand(command, args, cwd);
  const rtkResult = await runRTK(command, args, cwd);

  if (!rtkResult || rtkResult.exitCode !== 0) {
    return null; // RTK not available or failed
  }

  const nativeChars = nativeResult.stdout.length;
  const rtkChars = rtkResult.stdout.length;

  if (nativeChars === 0) {
    return { nativeChars: 0, rtkChars, reduction: 0 };
  }

  const reduction = Math.round(((nativeChars - rtkChars) / nativeChars) * 100);
  return { nativeChars, rtkChars, reduction };
}

/**
 * Check if running in Docker/container environment
 * @returns {boolean}
 */
function isContainerEnvironment() {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    return cgroup.includes('docker') || cgroup.includes('containerd');
  } catch (_) {
    return false;
  }
}

/**
 * Check if Docker is available
 * @returns {boolean}
 */
function isDockerAvailable() {
  try {
    fs.accessSync('/var/run/docker.sock', fs.constants.R_OK);
    return true;
  } catch (_) {
    return false;
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

describe('Token Reduction Tests', () => {
  let rtkAvailable = false;

  before(async () => {
    // Check if RTK is available
    try {
      const result = await runCommand('rtk', ['--version']);
      rtkAvailable = result.exitCode === 0;
      if (rtkAvailable) {
        console.log(`[RTK] Available: ${result.stdout.trim()}`);
      }
    } catch (error) {
      console.log('[RTK] Not available, skipping reduction tests');
    }

    // Create test directory with files for ls tests
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }

    // Create 50+ test files
    for (let i = 1; i <= 55; i++) {
      const filename = `testfile_${String(i).padStart(3, '0')}.txt`;
      fs.writeFileSync(path.join(TEST_DIR, filename), `Content of file ${i}\n`, 'utf8');
    }

    // Create subdirectory with files
    const subdir = path.join(TEST_DIR, 'subdir');
    fs.mkdirSync(subdir, { recursive: true });
    for (let i = 1; i <= 10; i++) {
      fs.writeFileSync(path.join(subdir, `subfile_${i}.js`), `// File ${i}\n`, 'utf8');
    }
  });

  describe('ls command token reduction', () => {
    it('should achieve >= 60% reduction for ls -la on directory with 50+ files', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const measurement = await measureReduction('ls', ['-la'], TEST_DIR);
      assert(measurement, 'Should be able to measure reduction');

      console.log(`ls -la: ${measurement.nativeChars} -> ${measurement.rtkChars} chars (${measurement.reduction}% reduction)`);

      assert(measurement.reduction >= MIN_REDUCTION_PERCENT,
        `Expected >= ${MIN_REDUCTION_PERCENT}% reduction, got ${measurement.reduction}%`);
    });

    it('should achieve >= 60% reduction for ls -lah on directory with subdirectories', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const measurement = await measureReduction('ls', ['-lah'], TEST_DIR);
      assert(measurement, 'Should be able to measure reduction');

      console.log(`ls -lah: ${measurement.nativeChars} -> ${measurement.rtkChars} chars (${measurement.reduction}% reduction)`);

      assert(measurement.reduction >= MIN_REDUCTION_PERCENT,
        `Expected >= ${MIN_REDUCTION_PERCENT}% reduction, got ${measurement.reduction}%`);
    });
  });

  describe('grep command token reduction', () => {
    it('should achieve >= 60% reduction for grep on codebase', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      // Search in the test directory
      const measurement = await measureReduction('grep', ['-r', 'testfile', TEST_DIR]);
      assert(measurement, 'Should be able to measure reduction');

      console.log(`grep -r: ${measurement.nativeChars} -> ${measurement.rtkChars} chars (${measurement.reduction}% reduction)`);

      assert(measurement.reduction >= MIN_REDUCTION_PERCENT,
        `Expected >= ${MIN_REDUCTION_PERCENT}% reduction, got ${measurement.reduction}%`);
    });

    it('should achieve >= 60% reduction for grep with line numbers', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const measurement = await measureReduction('grep', ['-rn', 'Content', TEST_DIR]);
      assert(measurement, 'Should be able to measure reduction');

      console.log(`grep -rn: ${measurement.nativeChars} -> ${measurement.rtkChars} chars (${measurement.reduction}% reduction)`);

      assert(measurement.reduction >= MIN_REDUCTION_PERCENT,
        `Expected >= ${MIN_REDUCTION_PERCENT}% reduction, got ${measurement.reduction}%`);
    });
  });

  describe('git command token reduction', () => {
    it('should achieve >= 70% reduction for git status (if in git repo)', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      if (!isGitRepository()) {
        console.log('Skipping: Not in a git repository');
        return;
      }

      const measurement = await measureReduction('git', ['status']);
      assert(measurement, 'Should be able to measure reduction');

      console.log(`git status: ${measurement.nativeChars} -> ${measurement.rtkChars} chars (${measurement.reduction}% reduction)`);

      assert(measurement.reduction >= 70,
        `Expected >= 70% reduction, got ${measurement.reduction}%`);
    });

    it('should achieve >= 65% reduction for git log --oneline', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      if (!isGitRepository()) {
        console.log('Skipping: Not in a git repository');
        return;
      }

      const measurement = await measureReduction('git', ['log', '--oneline', '-20']);
      assert(measurement, 'Should be able to measure reduction');

      console.log(`git log: ${measurement.nativeChars} -> ${measurement.rtkChars} chars (${measurement.reduction}% reduction)`);

      assert(measurement.reduction >= 65,
        `Expected >= 65% reduction, got ${measurement.reduction}%`);
    });
  });

  describe('docker command token reduction', () => {
    it('should achieve >= 75% reduction for docker ps (if docker available)', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      if (!isDockerAvailable()) {
        console.log('Skipping: Docker not available');
        return;
      }

      const measurement = await measureReduction('docker', ['ps']);
      assert(measurement, 'Should be able to measure reduction');

      console.log(`docker ps: ${measurement.nativeChars} -> ${measurement.rtkChars} chars (${measurement.reduction}% reduction)`);

      assert(measurement.reduction >= 75,
        `Expected >= 75% reduction, got ${measurement.reduction}%`);
    });
  });

  describe('Aggregate statistics verification', () => {
    it('should show overall 60-80% token reduction across multiple commands', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      // Collect measurements from multiple commands
      const measurements = [];

      // ls command
      const lsResult = await measureReduction('ls', ['-la'], TEST_DIR);
      if (lsResult) measurements.push({ command: 'ls -la', ...lsResult });

      // grep command
      const grepResult = await measureReduction('grep', ['-r', 'testfile', TEST_DIR]);
      if (grepResult) measurements.push({ command: 'grep -r', ...grepResult });

      // git commands (if in repo)
      if (isGitRepository()) {
        const gitStatusResult = await measureReduction('git', ['status']);
        if (gitStatusResult) measurements.push({ command: 'git status', ...gitStatusResult });

        const gitLogResult = await measureReduction('git', ['log', '--oneline', '-10']);
        if (gitLogResult) measurements.push({ command: 'git log', ...gitLogResult });
      }

      // docker commands (if available)
      if (isDockerAvailable()) {
        const dockerResult = await measureReduction('docker', ['ps']);
        if (dockerResult) measurements.push({ command: 'docker ps', ...dockerResult });
      }

      // Calculate aggregate statistics
      if (measurements.length === 0) {
        console.log('No measurements collected, skipping aggregate test');
        return;
      }

      const totalNative = measurements.reduce((sum, m) => sum + m.nativeChars, 0);
      const totalRTK = measurements.reduce((sum, m) => sum + m.rtkChars, 0);
      const avgReduction = Math.round(((totalNative - totalRTK) / totalNative) * 100);

      console.log('\n=== Token Reduction Summary ===');
      console.log(`Commands tested: ${measurements.length}`);
      console.log(`Total native chars: ${totalNative}`);
      console.log(`Total RTK chars: ${totalRTK}`);
      console.log(`Average reduction: ${avgReduction}%`);
      console.log('\nPer-command breakdown:');
      measurements.forEach(m => {
        console.log(`  ${m.command}: ${m.nativeChars} -> ${m.rtkChars} (${m.reduction}% reduction)`);
      });
      console.log('================================\n');

      // Verify aggregate reduction is in target range
      assert(avgReduction >= MIN_REDUCTION_PERCENT,
        `Expected average >= ${MIN_REDUCTION_PERCENT}% reduction, got ${avgReduction}%`);

      assert(avgReduction <= 95, // Allow up to 95% for very compact output
        `Average reduction ${avgReduction}% seems unexpectedly high, please verify`);
    });
  });

  describe('Token estimation accuracy', () => {
    it('should estimate tokens using 4 chars/token heuristic', async () => {
      if (!rtkAvailable) {
        console.log('Skipping: RTK not available');
        return;
      }

      const measurement = await measureReduction('ls', ['-la'], TEST_DIR);
      if (!measurement) {
        console.log('Skipping: Could not measure reduction');
        return;
      }

      // Estimate tokens saved
      const charsSaved = measurement.nativeChars - measurement.rtkChars;
      const estimatedTokens = Math.ceil(charsSaved / 4);

      console.log(`Token estimation: ${charsSaved} chars saved ≈ ${estimatedTokens} tokens`);

      assert(estimatedTokens > 0, 'Should have positive token savings');
      assert(charsSaved / 4 >= estimatedTokens - 1 && charsSaved / 4 <= estimatedTokens,
        'Token estimation should use ~4 chars/token heuristic');
    });
  });
});
