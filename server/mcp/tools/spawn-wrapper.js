/**
 * Spawn Wrapper Module
 *
 * Wraps child_process.spawn to route supported commands through RTK.
 * Provides transparent interception with automatic fallback and exit code preservation.
 *
 * @module SpawnWrapper
 */

'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { CommandParser } = require('./command-parser.js');
const { RTKExecutionError } = require('./rtk-executor.js');

/**
 * SpawnWrapper class for transparent spawn interception
 */
class SpawnWrapper {
  /**
   * Create a new SpawnWrapper instance
   * @param {Object} dependencies - Dependency injection
   * @param {Object} dependencies.rtkExecutor - RTKExecutor instance
   * @param {Object} dependencies.tokenTracker - TokenTracker instance
   */
  constructor(dependencies = {}) {
    this.rtkExecutor = dependencies.rtkExecutor;
    this.tokenTracker = dependencies.tokenTracker;
    this.originalSpawn = spawn;
  }

  /**
   * Determine if RTK should be used for a command
   *
   * @param {string} command - Command name
   * @param {string[]} args - Command arguments
   * @returns {boolean} True if RTK should be used
   */
  shouldUseRTK(command, args) {
    // Check if RTK executor is available
    if (!this.rtkExecutor) {
      return false;
    }

    // Check for native: prefix bypass
    const commandLine = `${command} ${args.join(' ')}`.trim();
    const parsed = CommandParser.parse(commandLine);

    if (parsed.bypass) {
      return false;
    }

    // Check if command is supported by RTK
    return this.rtkExecutor.isSupportedCommand(command, args);
  }

  /**
   * Execute a command via RTK or native spawn
   *
   * @param {string} command - Command name
   * @param {string[]} args - Command arguments
   * @param {Object} options - Execution options
   * @param {string} options.cwd - Working directory
   * @param {Object} options.env - Environment variables
   * @param {number} options.timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Execution result with stdout, stderr, exitCode, source
   */
  async execute(command, args = [], options = {}) {
    const {
      cwd = process.cwd(),
      env = process.env,
      timeout = 30000
    } = options || {};

    // Handle native: prefix - strip it before execution
    let actualCommand = command;
    let actualArgs = args;

    if (command.startsWith('native:')) {
      actualCommand = command.slice(7); // Remove "native:" prefix
    }

    // Check if we should use RTK
    if (!this.shouldUseRTK(command, args)) {
      // Use native execution with actual (stripped) command
      return this.executeNative(actualCommand, actualArgs, options);
    }

    // Execute via RTK
    try {
      console.log(`[RTK] Using RTK for: ${command}`);

      const result = await this.rtkExecutor.execute(command, args, options);

      // Record token savings if token tracker is available
      if (this.tokenTracker && result.source === 'rtk') {
        // Estimate native output size (RTK output is already compact)
        // For now, we don't have native comparison, so pass 0
        this.tokenTracker.record(command, 'rtk', result.stdout, 0);
      }

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        source: result.source
      };
    } catch (error) {
      // Check if this is an RTKExecutionError with fallback enabled
      if (error instanceof RTKExecutionError && error.shouldFallback) {
        console.log(`[RTK] Fallback to native: ${error.message}`);
        return this.executeNative(command, args, options);
      }

      // Re-throw if no fallback or different error type
      throw error;
    }
  }

  /**
   * Execute command via native spawn
   * @private
   */
  executeNative(command, args, options = {}) {
    const {
      cwd = process.cwd(),
      env = process.env,
      timeout = 30000
    } = options || {};

    return new Promise((resolve, reject) => {
      const stdoutChunks = [];
      const stderrChunks = [];
      let spawnError = null;

      const child = this.originalSpawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk) => {
        stderrChunks.push(chunk);
      });

      // Set up timeout
      let timeoutId = null;
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
        }, timeout);
      }

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        spawnError = error;
      });

      child.on('close', (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId);

        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        // Handle spawn errors
        if (spawnError) {
          // Determine exit code based on error type
          let exitCode = 1;
          if (spawnError.code === 'ENOENT') {
            exitCode = 127; // Command not found
          } else if (spawnError.code === 'EACCES' || spawnError.code === 'EPERM') {
            exitCode = 126; // Permission denied
          }

          resolve({
            stdout,
            stderr: stderr || spawnError.message,
            exitCode,
            source: 'native'
          });
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
          source: 'native'
        });
      });
    });
  }

  /**
   * Wrap spawn to return an EventEmitter-compatible mock process
   * This provides drop-in replacement for child_process.spawn
   *
   * @param {string} command - Command name
   * @param {string[]} args - Command arguments
   * @param {Object} options - Spawn options
   * @returns {EventEmitter} Mock process with stdout/stderr streams
   */
  wrapSpawn(command, args = [], options = {}) {
    const mockProcess = new EventEmitter();

    // Create mock stdout/stderr streams
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();

    mockProcess.stdout = stdout;
    mockProcess.stderr = stderr;
    mockProcess.stdin = null; // RTK doesn't support stdin interaction

    // Execute and emit events
    this.execute(command, args, options)
      .then((result) => {
        // Emit stdout data
        if (result.stdout) {
          stdout.emit('data', Buffer.from(result.stdout, 'utf8'));
        }

        // Emit stderr data
        if (result.stderr) {
          stderr.emit('data', Buffer.from(result.stderr, 'utf8'));
        }

        // Emit close event with exit code
        mockProcess.emit('close', result.exitCode, null);
        mockProcess.emit('exit', result.exitCode, null);
      })
      .catch((error) => {
        // Emit error
        mockProcess.emit('error', error);

        // Still emit close with error exit code
        mockProcess.emit('close', 1, null);
        mockProcess.emit('exit', 1, null);
      });

    // Add kill method for compatibility
    mockProcess.kill = () => {
      // In this mock, kill is a no-op since execution is already in progress
      return true;
    };

    return mockProcess;
  }

  /**
   * Create a wrapped spawn function that can be used as drop-in replacement
   * for child_process.spawn
   *
   * @returns {Function} Wrapped spawn function
   */
  createWrappedSpawn() {
    return (command, args, options) => {
      return this.wrapSpawn(command, args, options);
    };
  }
}

module.exports = { SpawnWrapper };