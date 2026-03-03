/**
 * RTK Executor Module
 * 
 * Primary command execution using RTK with automatic fallback to native execution.
 * Implements three-tier error classification to determine when fallback is appropriate.
 * 
 * @module RTKExecutor
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { RTKConfig } = require('../../config/rtk-config.js');
const { ErrorClassifier } = require('./error-classifier.js');
const { NativeExecutor } = require('./native-executor.js');

/**
 * Command allowlist for supported commands and flags
 * Prevents execution of commands with unsupported flags that would fail in RTK
 * @readonly
 */
const ALLOWLIST = {
  'ls': ['-l', '-a', '-la', '-al', '-R', '--color', '-1', '-h', '-lah', '-ltr', '-u'],
  'grep': ['-i', '-v', '-r', '-n', '-E', '-F', '--color', '-l', '-c', '-w', '-u'],
  'rg': ['-i', '-v', '-n', '-l', '-c', '--color', '-w', '-t', '-g', '-A', '-B', '-C', '-u'],
  'git': ['status', 'diff', 'log', 'show', 'branch', 'ls-files', '-u'],
  'cat': ['-u'],
  'head': ['-n', '-u'],
  'tail': ['-n', '-f', '-u'],
  'wc': ['-l', '-w', '-c', '-u'],
  'find': ['-name', '-type', '-exec', '-print', '-maxdepth', '-u'],
  'sort': ['-n', '-r', '-k', '-t', '-u'],
  'uniq': ['-c', '-d', '-u'],
  'docker': ['ps', 'images', '-u'],
  'npm': ['test', '--test', '-t', '--prefix', '-u'],
  'cargo': ['test', '-u'],
  'pytest': ['-v', '-s', '-u'],
  'vitest': ['run', '-u'],
  'jest': ['--ci', '-u'],
  'node': ['--require', '-r', '-u'],
  'read': ['--level', 'minimal', 'default', 'full', '-u'],
  'summarize': ['-u']
};

/**
 * Custom error class for RTK execution failures
 */
class RTKExecutionError extends Error {
  /**
   * Create an RTKExecutionError
   * @param {string} type - Error classification type
   * @param {string} message - Human-readable error message
   * @param {Object} metadata - Additional error context
   * @param {boolean} metadata.shouldFallback - Whether fallback is appropriate
   * @param {number} metadata.exitCode - Exit code from execution
   * @param {string} metadata.stderr - stderr output
   */
  constructor(type, message, metadata = {}) {
    super(message);
    this.name = 'RTKExecutionError';
    this.type = type;
    this.shouldFallback = metadata.shouldFallback || false;
    this.exitCode = metadata.exitCode;
    this.stderr = metadata.stderr;
  }
}

/**
 * RTK command executor with automatic fallback to native execution
 */
class RTKExecutor {
  /**
   * Create a new RTKExecutor instance
   * @param {Object} config - Configuration options
   * @param {Object} config.rtkConfig - RTKConfig instance (optional, loads default if not provided)
   * @param {NativeExecutor} config.nativeExecutor - NativeExecutor instance (optional, creates default)
   */
  constructor(config = {}) {
    this.config = config.rtkConfig || RTKConfig.getConfig();
    this.nativeExecutor = config.nativeExecutor || new NativeExecutor();
    this.errorClassifier = ErrorClassifier;
  }

  /**
   * Execute a command (RTK with fallback to native)
   * 
   * @param {string} command - The command to execute
   * @param {string[]} args - Command arguments
   * @param {Object} options - Execution options
   * @param {string} options.cwd - Working directory
   * @param {Object} options.env - Environment variables
   * @param {number} options.timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Execution result with stdout, stderr, exitCode, source
   */
  async execute(command, args = [], options = {}) {
    // Check if RTK is disabled
    if (!this.config.enabled) {
      return this.nativeExecutor.execute(command, args, options);
    }

    // Check if command is in allowlist
    if (!this.isSupportedCommand(command, args)) {
      return this.nativeExecutor.execute(command, args, options);
    }

    // Special handling for summarize tool
    if (command === 'summarize') {
      try {
        return await this.executeSummarize(args, options);
      } catch (error) {
        if (error instanceof RTKExecutionError && error.shouldFallback) {
          return this.nativeExecutor.execute('cat', args, options);
        }
        throw error;
      }
    }

    // Try RTK first
    try {
      const result = await this.executeRTK(command, args, options);
      return result;
    } catch (error) {
      // Check if this is an RTKExecutionError with fallback enabled
      if (error instanceof RTKExecutionError && error.shouldFallback) {
        console.warn(`[RTK-Executor] Falling back to native execution: ${error.message}`);
        return this.nativeExecutor.execute(command, args, options);
      }
      
      // Re-throw if no fallback or different error type
      throw error;
    }
  }

  /**
   * Execute command via RTK
   * @private
   */
  async executeRTK(command, args, options) {
    const {
      cwd = process.cwd(),
      env = process.env,
      timeout = this.config.timeout
    } = options;

    const rtkArgs = this.mapToRTKArgs(command, args, options);

    return new Promise((resolve, reject) => {
      const stdoutChunks = [];
      const stderrChunks = [];
      let spawnError = null;

      const child = spawn(this.config.binaryPath, rtkArgs, {
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

      child.on('close', async (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId);

        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        // Handle spawn errors (Tier 1)
        if (spawnError) {
          const classification = this.errorClassifier.classify(spawnError, stderr);
          
          if (classification.fallback) {
            reject(new RTKExecutionError(
              classification.type,
              classification.message,
              { shouldFallback: true, exitCode: code, stderr }
            ));
          } else {
            reject(spawnError);
          }
          return;
        }

        // Classify the result
        const exitError = code !== 0 ? { code } : null;
        const classification = this.errorClassifier.classify(exitError, stderr);

        // Save tee output on error if enabled
        if (code !== 0 && this.config.teeOnError) {
          await this.saveTeeOutput(command, args, stdout, stderr, code);
        }

        // Handle non-zero exit
        if (code !== 0) {
          if (classification.fallback && classification.tier !== 3) {
            // Tier 1 or 2 - fallback appropriate
            reject(new RTKExecutionError(
              classification.type,
              classification.message,
              { shouldFallback: true, exitCode: code, stderr }
            ));
          } else {
            // Tier 3 - no fallback, return the error result
            const processedStdout = this.processOutput(stdout, stderr, code, command, args, options);

            resolve({
              stdout: processedStdout,
              stderr,
              exitCode: code,
              source: 'rtk'
            });
          }
          return;
        }

        // Success
        const processedStdout = this.processOutput(stdout, stderr, code, command, args, options);

        resolve({
          stdout: processedStdout,
          stderr,
          exitCode: 0,
          source: 'rtk'
        });
      });
    });
  }

  /**
   * Execute summarize summary tool
   * @private
   */
  async executeSummarize(args, options) {
    const filePath = args[0];
    if (!filePath) {
      throw new Error('File path is required for summarize tool');
    }

    try {
      // 1. Get total line count
      const wcResult = await this.executeRTK('wc', ['-l', filePath], options);
      const lineCountStr = wcResult.stdout.trim().split(/\s+/)[0];
      const lineCount = parseInt(lineCountStr, 10) || 0;

      // 2. Short-circuit for small files (< 10 lines)
      if (lineCount < 10) {
        return this.executeRTK('read', [filePath], options);
      }

      // 3. Get summarize summary using minimal level
      const summarizeResult = await this.executeRTK('read', ['--level', 'minimal', filePath], options);

      // 4. Calculate complexity
      let complexity = 'Low';
      if (lineCount > 500) complexity = 'High';
      else if (lineCount >= 100) complexity = 'Medium';

      // 5. Add header metadata
      const header = [
        `File: ${filePath}`,
        `Lines: ${lineCount}`,
        `Complexity: ${complexity}`,
        '---',
        ''
      ].join('\n');

      return {
        ...summarizeResult,
        stdout: header + summarizeResult.stdout
      };
    } catch (error) {
      // Re-throw if already an RTKExecutionError
      if (error instanceof RTKExecutionError) throw error;

      // Handle other errors
      throw new RTKExecutionError(
        'tool-error',
        `Summarize tool failed: ${error.message}`,
        { shouldFallback: true }
      );
    }
  }

  /**
   * Post-process command output
   * @private
   */
  processOutput(stdout, stderr, code, command, args, options) {
    let result = stdout;

    if (this.isTestCommand(command, args)) {
      result = this.processTestOutput(stdout, stderr, code);
    } else if (command === 'read') {
      result = this.processReadOutput(stdout, stderr, code, args, options);
    }

    // Apply ultra-compact formatting if active
    if (this.config.ultraCompact || options.ultraCompact || args.includes('-u')) {
      result = this.processUltraCompact(result, command, args);
    }

    return result;
  }

  /**
   * Process output for ultra-compact mode
   * @private
   */
  processUltraCompact(stdout, command, args) {
    if (!stdout) return stdout;

    let result = stdout;

    // Specialized formatting for specific commands
    if (command === 'git' && args.includes('log')) {
      const lines = stdout.split('\n');
      result = lines.map(line => {
        const match = line.match(/^([a-f0-9]{7,40})\s+(?:\(.*?\)\s+)?(.*)$/);
        if (match) {
          const hash = match[1].substring(0, 7);
          const msg = match[2].substring(0, 30).trim();
          return `${hash} ${msg}`;
        }
        return line;
      }).join('\n');
    } else if (command === 'ls') {
      const lines = stdout.split('\n');
      result = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        // Match typical ls -l output: -rw-r--r-- 1 user group size date filename
        if (parts.length >= 9 && (parts[0].startsWith('-') || parts[0].startsWith('d'))) {
          const size = parts[4];
          const name = parts.slice(8).join(' ');
          return `${name} ${size}`;
        }
        return line;
      }).join('\n');
    }

    // Aggressive whitespace stripping and empty line filtering
    return result.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  }

  /**
   * Process read output with large file filtering
   * @private
   */
  processReadOutput(stdout, stderr, code, args, options) {
    if (code !== 0 || !options.largeFileFilter) {
      return stdout;
    }

    const lines = stdout.split('\n');
    if (lines.length <= 500) {
      return stdout;
    }

    const first100 = lines.slice(0, 100);
    const last100 = lines.slice(-100);
    const filteredCount = lines.length - 200;

    return [
      ...first100,
      `\n[... ${filteredCount} lines filtered for token efficiency ...]\n`,
      ...last100
    ].join('\n');
  }

  /**
   * Map native command to RTK arguments
   * @private
   */
  mapToRTKArgs(command, args, options = {}) {
    // Map common commands to RTK subcommands
    const commandMappings = {
      'ls': ['ls', ...args],
      'grep': ['grep', ...args],
      'rg': ['grep', ...args], // rg maps to grep in RTK
      'git': ['git', ...args],
      'cat': ['cat', ...args],
      'head': ['head', ...args],
      'tail': ['tail', ...args],
      'wc': ['wc', ...args],
      'find': ['find', ...args],
      'sort': ['sort', ...args],
      'uniq': ['uniq', ...args],
      'docker': ['docker', ...args],
      'npm': ['npm', ...args],
      'cargo': ['cargo', ...args],
      'pytest': ['pytest', ...args],
      'vitest': ['vitest', ...args],
      'jest': ['jest', ...args],
      'node': ['node', ...args],
      'read': ['read', ...args],
      'summarize': ['read', '--level', 'minimal', ...args]
    };

    const rtkArgs = commandMappings[command] || [command, ...args];

    // Add ultra-compact flag if enabled globally or via options
    if (this.config.ultraCompact || options.ultraCompact || args.includes('-u')) {
      if (!rtkArgs.includes('-u')) {
        rtkArgs.push('-u');
      }
    }

    return rtkArgs;
  }

  /**
   * Check if a command with given args is supported
   * @param {string} command - Command name
   * @param {string[]} args - Command arguments
   * @returns {boolean} True if command and all flags are supported
   */
  isSupportedCommand(command, args) {
    // Check if command is in allowlist
    const supportedFlags = ALLOWLIST[command];
    if (!supportedFlags) {
      return false;
    }

    // Special handling for test commands
    if (command === 'npm' || command === 'cargo') {
      if (!args.includes('test')) return false;
    }
    if (command === 'node') {
      const isTest = args.some(arg => arg.includes('test') || arg.includes('spec'));
      if (!isTest) return false;
    }

    // Check each argument
    for (const arg of args) {
      // Skip non-flag arguments (files, patterns, etc.)
      if (!arg.startsWith('-')) {
        continue;
      }

      // Check if flag is supported
      if (!supportedFlags.includes(arg)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Save command output to tee file for debugging
   * @private
   */
  async saveTeeOutput(command, args, stdout, stderr, exitCode) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const teeDir = '/workspace/.rtk/tee';
      const filename = `${timestamp}_${command}.log`;
      const filepath = path.join(teeDir, filename);

      // Ensure directory exists
      await fs.mkdir(teeDir, { recursive: true });

      // Write tee file
      const content = [
        `Command: ${command}`,
        `Args: ${JSON.stringify(args)}`,
        `Exit Code: ${exitCode}`,
        `Timestamp: ${new Date().toISOString()}`,
        '---',
        'STDOUT:',
        stdout,
        '---',
        'STDERR:',
        stderr
      ].join('\n');

      await fs.writeFile(filepath, content, 'utf8');
    } catch (error) {
      // Tee failure should not break execution
      console.warn(`[RTK-Executor] Failed to save tee output: ${error.message}`);
    }
  }

  /**
   * Get the allowlist of supported commands
   * @returns {Object} Allowlist object
   */
  static getAllowlist() {
    return { ...ALLOWLIST };
  }

  /**
   * Check if a command is a test command for post-processing
   * @private
   */
  isTestCommand(command, args) {
    const testCommands = ['npm', 'cargo', 'pytest', 'vitest', 'jest', 'node'];
    if (!testCommands.includes(command)) return false;
    
    if (command === 'npm' || command === 'cargo') {
      return args.includes('test');
    }
    
    if (command === 'node') {
      return args.some(arg => arg.includes('test') || arg.includes('spec'));
    }
    
    return true;
  }

  /**
   * Process test output to limit failures and add summary
   * @private
   */
  processTestOutput(stdout, stderr, exitCode) {
    if (!stdout && !stderr) return stdout;

    // Handle timeouts
    if (exitCode === 124 || exitCode === null) {
      const lines = stdout.split('\n');
      if (lines.length > 50) {
        return `[Timeout - showing last 50 lines]\n...\n` + lines.slice(-50).join('\n');
      }
      return stdout;
    }

    const lines = stdout.split('\n');
    const processedLines = [];
    let failureCount = 0;
    let inFailure = false;
    let failureBuffer = [];
    
    // Look for failure patterns
    for (const line of lines) {
      if (line.includes('FAIL:') || line.startsWith('✖') || line.includes('Failure in')) {
        if (inFailure) {
          if (failureCount <= 5) {
            processedLines.push(...failureBuffer);
          }
          failureBuffer = [];
        }
        
        inFailure = true;
        failureCount++;
        failureBuffer.push(line);
      } else if (inFailure && (line.startsWith('  ') || line.includes('at '))) {
        failureBuffer.push(line);
      } else if (line.trim() === '' && inFailure) {
        failureBuffer.push(line);
      } else {
        if (inFailure) {
          if (failureCount <= 5) {
            processedLines.push(...failureBuffer);
          }
          inFailure = false;
          failureBuffer = [];
        }
        processedLines.push(line);
      }
    }

    if (inFailure && failureCount <= 5) {
      processedLines.push(...failureBuffer);
    }

    let result = processedLines.join('\n');
    
    if (failureCount > 5) {
      result += `\n\n[... ${failureCount - 5} more failures omitted for token efficiency ...]`;
    }

    // Append summary based on output
    const summaryMatch = stdout.match(/(\d+)\s+passed,?\s+(\d+)\s+failed/i);
    if (summaryMatch) {
      result += `\n\nTest Summary: ${summaryMatch[1]} passed, ${summaryMatch[2]} failed`;
    } else if (!result.includes('passed') && !result.includes('failed')) {
      result += `\n\nTest Summary: ${failureCount > 0 ? failureCount : 'No'} failure(s) detected.`;
    }

    return result;
  }
}

module.exports = { RTKExecutor, RTKExecutionError };