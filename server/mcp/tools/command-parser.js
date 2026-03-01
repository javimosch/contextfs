/**
 * Command Parser Module
 * 
 * Parses command lines and detects native: prefix for bypassing RTK.
 * Handles various command formats and edge cases.
 * 
 * @module CommandParser
 */

'use strict';

/**
 * CommandParser class for parsing and analyzing command lines
 */
class CommandParser {
  /**
   * Parse a command line and detect native: prefix
   * 
   * Supports formats:
   * - "native:ls -la" → bypass: true, command: "ls", args: ["-la"]
   * - "ls native:ls -la" → bypass: true, command: "ls", args: ["-la"]
   * - "ls -la" → bypass: false, command: "ls", args: ["-la"]
   * 
   * @param {string} line - Raw command line
   * @returns {Object} Parsed result with bypass flag, command, and args
   */
  static parse(line) {
    // Handle empty/invalid input
    if (!line || typeof line !== 'string') {
      return { bypass: false, command: '', args: [] };
    }

    // Normalize whitespace
    const normalized = line.trim().replace(/\s+/g, ' ');
    
    if (normalized === '') {
      return { bypass: false, command: '', args: [] };
    }

    // Check for native: prefix at start
    if (normalized.startsWith('native:')) {
      const afterPrefix = normalized.slice(7).trim(); // Remove "native:"
      
      if (afterPrefix === '') {
        return { bypass: true, command: '', args: [] };
      }

      const parts = afterPrefix.split(' ');
      return {
        bypass: true,
        command: parts[0],
        args: parts.slice(1)
      };
    }

    // Check for native: embedded in first or second argument
    // Format: "bash native:bash -c 'cmd'" (second arg has native: prefix)
    const parts = normalized.split(' ');
    
    // Check if second argument starts with native:
    if (parts.length >= 2 && parts[1].startsWith('native:')) {
      const command = parts[1].slice(7); // Remove "native:" prefix
      
      if (command === '') {
        return { bypass: true, command: '', args: [] };
      }

      return {
        bypass: true,
        command: command,
        args: parts.slice(2)
      };
    }

    // Normal command (no bypass)
    return {
      bypass: false,
      command: parts[0],
      args: parts.slice(1)
    };
  }

  /**
   * Format command and args for logging
   * 
   * @param {string} command - Command name
   * @param {string[]} args - Command arguments
   * @returns {string} Formatted command string
   */
  static formatForLog(command, args = []) {
    if (!command) {
      return '';
    }

    if (args.length === 0) {
      return command;
    }

    // Quote arguments that contain spaces
    const formattedArgs = args.map(arg => {
      if (arg.includes(' ')) {
        return `"${arg}"`;
      }
      return arg;
    });

    return `${command} ${formattedArgs.join(' ')}`;
  }

  /**
   * Check if a line contains the native: bypass prefix
   * 
   * @param {string} line - Command line to check
   * @returns {boolean} True if bypass prefix detected
   */
  static hasBypassPrefix(line) {
    if (!line || typeof line !== 'string') {
      return false;
    }

    const normalized = line.trim();
    return normalized.startsWith('native:') || normalized.includes(' native:');
  }

  /**
   * Strip the native: prefix from a command line
   * 
   * @param {string} line - Command line with prefix
   * @returns {string} Command line without prefix
   */
  static stripBypassPrefix(line) {
    if (!line || typeof line !== 'string') {
      return line;
    }

    const normalized = line.trim().replace(/\s+/g, ' ');

    // Handle "native:cmd args"
    if (normalized.startsWith('native:')) {
      return normalized.slice(7).trim();
    }

    // Handle "cmd native:cmd args" (second arg has prefix)
    const parts = normalized.split(' ');
    if (parts.length >= 2 && parts[1].startsWith('native:')) {
      const command = parts[1].slice(7);
      const rest = parts.slice(2);
      return [command, ...rest].join(' ');
    }

    return normalized;
  }

  /**
   * Parse command arguments, respecting quotes
   * 
   * @param {string} argsString - Argument string
   * @returns {string[]} Array of arguments
   */
  static parseArgs(argsString) {
    if (!argsString || typeof argsString !== 'string') {
      return [];
    }

    const args = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < argsString.length; i++) {
      const char = argsString[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = null;
      } else if (char === ' ' && !inQuotes) {
        if (current.length > 0) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.length > 0) {
      args.push(current);
    }

    return args;
  }
}

module.exports = { CommandParser };
