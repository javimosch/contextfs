/**
 * Native Executor Module
 * 
 * Fallback command execution using Node.js native child_process.
 * Executes commands directly without RTK when RTK is unavailable or fails.
 * 
 * @module NativeExecutor
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

/**
 * Standard exit codes
 * @readonly
 */
const ExitCodes = {
  SUCCESS: 0,
  COMMAND_NOT_FOUND: 127,
  PERMISSION_DENIED: 126
};

/**
 * Native command executor - fallback when RTK is unavailable
 */
class NativeExecutor {
  /**
   * Create a new NativeExecutor instance
   * @param {Object} options - Default options for execution
   * @param {number} options.defaultTimeout - Default timeout in ms (default: 30000)
   */
  constructor(options = {}) {
    this.defaultTimeout = options.defaultTimeout || 30000;
  }

  /**
   * Execute a command natively (without RTK)
   * 
   * @param {string} command - The command to execute
   * @param {string[]} args - Command arguments (default: [])
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
      timeout = this.defaultTimeout
    } = options;

    return new Promise((resolve) => {
      const stdoutChunks = [];
      const stderrChunks = [];

      // Spawn the process with shell: false for security
      // Command and args passed as array prevents shell injection
      const child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Handle stdout data
      child.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk);
      });

      // Handle stderr data
      child.stderr.on('data', (chunk) => {
        stderrChunks.push(chunk);
      });

      // Set up timeout if specified
      let timeoutId = null;
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
        }, timeout);
      }

      // Handle spawn errors (e.g., command not found)
      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);

        let exitCode;
        let errorMessage = '';

        if (error.code === 'ENOENT') {
          exitCode = ExitCodes.COMMAND_NOT_FOUND;
          errorMessage = `${command}: command not found\n`;
        } else if (error.code === 'EACCES') {
          exitCode = ExitCodes.PERMISSION_DENIED;
          errorMessage = `${command}: permission denied\n`;
        } else {
          exitCode = 1;
          errorMessage = `${command}: ${error.message}\n`;
        }

        resolve({
          stdout: '',
          stderr: errorMessage + Buffer.concat(stderrChunks).toString('utf8'),
          exitCode,
          source: 'native'
        });
      });

      // Handle process completion
      child.on('close', (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId);

        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        // If terminated by signal, use appropriate exit code
        let exitCode = code;
        if (signal) {
          exitCode = 128 + (this._signalToNumber(signal) || 0);
        }

        resolve({
          stdout,
          stderr,
          exitCode: exitCode !== null ? exitCode : 1,
          source: 'native'
        });
      });
    });
  }

  /**
   * Convert signal name to number (for exit code calculation)
   * @private
   */
  _signalToNumber(signal) {
    const signals = {
      'SIGHUP': 1,
      'SIGINT': 2,
      'SIGQUIT': 3,
      'SIGILL': 4,
      'SIGTRAP': 5,
      'SIGABRT': 6,
      'SIGBUS': 7,
      'SIGFPE': 8,
      'SIGKILL': 9,
      'SIGUSR1': 10,
      'SIGSEGV': 11,
      'SIGUSR2': 12,
      'SIGPIPE': 13,
      'SIGALRM': 14,
      'SIGTERM': 15
    };
    return signals[signal] || 0;
  }
}

module.exports = { NativeExecutor, ExitCodes };