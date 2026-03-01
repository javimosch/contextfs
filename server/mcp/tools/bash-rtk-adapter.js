/**
 * Bash RTK Adapter Module
 *
 * Adapter to enable RTK for bash_script_once tool by parsing scripts
 * and routing simple commands through RTK while preserving complex
 * commands (pipes, redirects, conditionals) for shell execution.
 *
 * @module BashRTKAdapter
 */

'use strict';

const { spawn } = require('child_process');

/**
 * BashRTKAdapter class for script execution with RTK routing
 */
class BashRTKAdapter {
  /**
   * Create a new BashRTKAdapter instance
   * @param {Object} dependencies - Dependency injection
   * @param {Object} dependencies.spawnWrapper - SpawnWrapper instance for RTK execution
   */
  constructor(dependencies = {}) {
    this.spawnWrapper = dependencies.spawnWrapper;
    this.rtkExecutor = dependencies.rtkExecutor;
    
    // RTK-supported commands
    this.rtkCommands = new Set([
      'ls', 'grep', 'rg', 'git', 'cat', 'head', 'tail', 
      'wc', 'find', 'sort', 'uniq'
    ]);
    
    // Shell metacharacters that indicate complex commands
    this.complexPatterns = [
      /\|/,           // Pipe
      />/,            // Redirect output
      /</,            // Redirect input
      /&&/,           // AND conditional
      /\|\|/,         // OR conditional
      /\$\(/,          // Command substitution
      /`/,            // Backtick substitution
      /;/,            // Command separator (when not at end)
      /&$/,           // Background process
      /&[^&]/,        // Background process in middle
    ];
  }

  /**
   * Parse a script into individual commands
   * @param {string} script - Shell script content
   * @returns {Array<{type: string, command: string, args: string[], line: string, lineNumber: number}>}
   */
  parseScript(script) {
    const lines = script.split('\n');
    const commands = [];
    let nativeBypassNext = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;
      
      // Skip empty lines
      if (!line) {
        continue;
      }
      
      // Check for standalone native: bypass comment
      if (line.startsWith('# native:')) {
        nativeBypassNext = true;
        continue;
      }
      
      // Skip other comments
      if (line.startsWith('#')) {
        continue;
      }
      
      // Parse the command line
      const parsed = this.parseCommandLine(line);
      
      // Check for inline native: comment
      if (line.includes('# native:')) {
        nativeBypassNext = true;
      }
      
      if (nativeBypassNext || !this.shouldUseRTKForLine(line, parsed)) {
        commands.push({
          type: 'complex',
          command: parsed.command,
          args: parsed.args,
          line,
          lineNumber,
          reason: nativeBypassNext ? 'native bypass comment' : (parsed.reason || 'complex command')
        });
        nativeBypassNext = false;
      } else {
        commands.push({
          type: 'simple',
          command: parsed.command,
          args: parsed.args,
          line,
          lineNumber
        });
      }
    }
    
    return commands;
  }

  /**
   * Parse a single command line into command and arguments
   * @param {string} line - Command line
   * @returns {{command: string|null, args: string[], reason: string|null}}
   */
  parseCommandLine(line) {
    // Remove leading/trailing whitespace
    line = line.trim();
    
    if (!line) {
      return { command: null, args: [], reason: null };
    }
    
    // Split by whitespace, respecting quotes
    const tokens = this.tokenize(line);
    
    if (tokens.length === 0) {
      return { command: null, args: [], reason: null };
    }
    
    const command = tokens[0];
    const args = tokens.slice(1);
    
    return { command, args, reason: null };
  }

  /**
   * Tokenize a command line respecting quotes
   * @param {string} line - Command line
   * @returns {string[]}
   */
  tokenize(line) {
    const tokens = [];
    let current = '';
    let inQuote = null;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      // Handle quotes
      if (char === '"' || char === "'") {
        if (inQuote === null) {
          inQuote = char;
          continue;
        } else if (inQuote === char) {
          inQuote = null;
          continue;
        }
      }
      
      // Handle whitespace outside quotes
      if (inQuote === null && /\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }
      
      current += char;
    }
    
    if (current) {
      tokens.push(current);
    }
    
    return tokens;
  }

  /**
   * Determine if RTK should be used for a command line
   * @param {string} line - Command line
   * @param {Object} parsed - Parsed command info
   * @returns {boolean}
   */
  shouldUseRTKForLine(line, parsed) {
    // Check for complex patterns
    for (const pattern of this.complexPatterns) {
      if (pattern.test(line)) {
        return false;
      }
    }
    
    // Check if command is supported by RTK
    if (!parsed.command) {
      return false;
    }
    
    if (!this.rtkCommands.has(parsed.command)) {
      return false;
    }
    
    // Check if spawn wrapper is available
    if (!this.spawnWrapper) {
      return false;
    }
    
    // Check if RTK supports this specific command/args combination
    if (this.rtkExecutor && !this.rtkExecutor.isSupportedCommand(parsed.command, parsed.args)) {
      return false;
    }
    
    return true;
  }

  /**
   * Execute a script with RTK routing for simple commands
   * @param {string} script - Shell script content
   * @param {Object} options - Execution options
   * @param {string} options.cwd - Working directory
   * @param {Object} options.env - Environment variables
   * @param {number} options.timeout - Timeout in milliseconds
   * @param {Function} options.shellExecutor - Function to execute complex commands via shell
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, results: Array}>}
   */
  async executeScript(script, options = {}) {
    const {
      cwd = process.cwd(),
      env = process.env,
      timeout = 30000,
      shellExecutor = null
    } = options;
    
    // Parse script into commands
    const commands = this.parseScript(script);
    
    if (commands.length === 0) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        results: []
      };
    }
    
    // Group consecutive commands of the same type
    const groups = this.groupCommands(commands);
    
    // Execute each group
    const results = [];
    let combinedStdout = '';
    let combinedStderr = '';
    
    for (const group of groups) {
      const groupResult = await this.executeGroup(group, {
        cwd,
        env,
        timeout,
        shellExecutor
      });
      
      results.push(groupResult);
      
      if (groupResult.stdout) {
        combinedStdout += groupResult.stdout + '\n';
      }
      if (groupResult.stderr) {
        combinedStderr += groupResult.stderr + '\n';
      }
      
      // Stop on first non-zero exit code (shell semantics)
      if (groupResult.exitCode !== 0) {
        return {
          stdout: combinedStdout.trim(),
          stderr: combinedStderr.trim(),
          exitCode: groupResult.exitCode,
          results,
          failedAt: group.commands[0]?.lineNumber,
          failedCommand: groupResult.failedCommand || group.commands[0]
        };
      }
    }
    
    return {
      stdout: combinedStdout.trim(),
      stderr: combinedStderr.trim(),
      exitCode: 0,
      results
    };
  }

  /**
   * Group consecutive commands by execution type
   * @param {Array} commands - Parsed commands
   * @returns {Array<{type: string, commands: Array}>}
   */
  groupCommands(commands) {
    const groups = [];
    let currentGroup = null;
    
    for (const cmd of commands) {
      if (!currentGroup || currentGroup.type !== cmd.type) {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          type: cmd.type,
          commands: [cmd]
        };
      } else {
        currentGroup.commands.push(cmd);
      }
    }
    
    if (currentGroup) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  /**
   * Execute a group of commands
   * @param {Object} group - Command group
   * @param {Object} options - Execution options
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, commands: Array}>}
   */
  async executeGroup(group, options) {
    const { cwd, env, timeout, shellExecutor } = options;
    
    if (group.type === 'simple') {
      // Execute simple commands sequentially through RTK
      return this.executeSimpleGroup(group.commands, { cwd, env, timeout });
    } else {
      // Execute complex commands through shell
      return this.executeComplexGroup(group.commands, { cwd, env, timeout, shellExecutor });
    }
  }

  /**
   * Execute a group of simple commands through RTK
   * @param {Array} commands - Simple commands
   * @param {Object} options - Execution options
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, commands: Array}>}
   */
  async executeSimpleGroup(commands, options) {
    const { cwd, env, timeout } = options;
    
    const outputs = [];
    const errors = [];
    
    for (const cmd of commands) {
      try {
        const result = await this.spawnWrapper.execute(cmd.command, cmd.args, {
          cwd,
          env,
          timeout
        });
        
        if (result.stdout) outputs.push(result.stdout);
        if (result.stderr) errors.push(result.stderr);
        
        // Check exit code
        if (result.exitCode !== 0) {
          return {
            stdout: outputs.join('\n'),
            stderr: errors.join('\n'),
            exitCode: result.exitCode,
            commands,
            failedCommand: cmd
          };
        }
      } catch (error) {
        return {
          stdout: outputs.join('\n'),
          stderr: error.message,
          exitCode: 1,
          commands,
          failedCommand: cmd,
          error
        };
      }
    }
    
    return {
      stdout: outputs.join('\n'),
      stderr: errors.join('\n'),
      exitCode: 0,
      commands
    };
  }

  /**
   * Execute a group of complex commands through shell
   * @param {Array} commands - Complex commands
   * @param {Object} options - Execution options
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number, commands: Array}>}
   */
  async executeComplexGroup(commands, options) {
    const { cwd, env, timeout, shellExecutor } = options;
    
    // Combine commands into a script
    const script = commands.map(cmd => cmd.line).join('\n');
    
    // Use provided shell executor or default to spawn
    if (shellExecutor) {
      return shellExecutor(script, { cwd, env, timeout, commands });
    }
    
    // Default shell execution
    return new Promise((resolve, reject) => {
      const stdoutChunks = [];
      const stderrChunks = [];
      
      const child = spawn('sh', ['-c', script], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
      
      // Set up timeout
      let timeoutId = null;
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
        }, timeout);
      }
      
      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      });
      
      child.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code ?? 0,
          commands
        });
      });
    });
  }

  /**
   * Check if a script can benefit from RTK routing
   * @param {string} script - Shell script content
   * @returns {boolean}
   */
  canUseRTK(script) {
    const commands = this.parseScript(script);
    return commands.some(cmd => cmd.type === 'simple');
  }

  /**
   * Get statistics about script composition
   * @param {string} script - Shell script content
   * @returns {{total: number, simple: number, complex: number, rtkEligible: boolean}}
   */
  getScriptStats(script) {
    const commands = this.parseScript(script);
    const simple = commands.filter(cmd => cmd.type === 'simple').length;
    const complex = commands.filter(cmd => cmd.type === 'complex').length;
    
    return {
      total: commands.length,
      simple,
      complex,
      rtkEligible: simple > 0
    };
  }
}

module.exports = { BashRTKAdapter };
