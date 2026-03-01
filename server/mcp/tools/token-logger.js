/**
 * Token Logger Module
 * 
 * Persists token reduction metrics to JSONL files for analysis.
 * Creates daily log files with structured execution data.
 * 
 * @module TokenLogger
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * TokenLogger class for persistent logging of token metrics
 */
class TokenLogger {
  /**
   * Create a new TokenLogger instance
   * @param {Object} options - Configuration options
   * @param {string} options.logDir - Directory for log files (default: '/workspace/.rtk/logs')
   * @param {string} options.session - Session identifier (default: timestamp)
   */
  constructor(options = {}) {
    this.logDir = options.logDir || '/workspace/.rtk/logs';
    this.session = options.session || this.generateSessionId();
  }

  /**
   * Generate a unique session ID
   * @private
   * @returns {string} Session identifier
   */
  generateSessionId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  /**
   * Estimate token count from character count
   * Uses ~4 characters per token heuristic
   * 
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    return Math.ceil(text.length / 4);
  }

  /**
   * Log a command execution with metrics
   * 
   * @param {Object} execution - Execution data
   * @param {string} execution.command - Command name
   * @param {string[]} execution.args - Command arguments
   * @param {string} execution.source - Execution source ('rtk' or 'native')
   * @param {number} execution.nativeChars - Expected native character count
   * @param {number} execution.rtkChars - Actual RTK output character count
   * @param {number} execution.exitCode - Command exit code
   * @param {string} execution.timestamp - ISO timestamp (optional, defaults to now)
   * @returns {Promise<Object>} Logged entry
   */
  async logExecution(execution) {
    const {
      command,
      args = [],
      source,
      nativeChars = 0,
      rtkChars = 0,
      exitCode = 0,
      timestamp = new Date().toISOString()
    } = execution;

    // Calculate metrics
    const charSavings = source === 'rtk' && nativeChars > 0
      ? Math.max(0, nativeChars - rtkChars)
      : 0;
    
    const reductionPercent = source === 'rtk' && nativeChars > 0
      ? Math.round((charSavings / nativeChars) * 100)
      : 0;
    
    const estimatedTokensSaved = charSavings > 0 ? this.estimateTokens(charSavings.toString()) : 0;

    // Build log entry
    const entry = {
      timestamp,
      session: this.session,
      command,
      args,
      source,
      metrics: {
        native_chars: nativeChars,
        rtk_chars: rtkChars,
        char_savings: charSavings,
        reduction_percent: reductionPercent,
        estimated_tokens_saved: estimatedTokensSaved
      },
      exit_code: exitCode
    };

    // Write to daily log file
    await this.writeLogEntry(entry);

    // Console log for RTK commands
    if (source === 'rtk') {
      if (charSavings > 0) {
        console.log(`[RTK] ${command}: saved ${charSavings} chars (${reductionPercent}% reduction)`);
      } else {
        console.log(`[RTK] ${command}: executed`);
      }
    }

    return entry;
  }

  /**
   * Write entry to daily log file
   * @private
   * @param {Object} entry - Log entry
   */
  async writeLogEntry(entry) {
    const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    const filename = `tokens-${date}.jsonl`;
    const filepath = path.join(this.logDir, filename);

    try {
      // Ensure directory exists
      await fs.mkdir(this.logDir, { recursive: true });

      // Append JSONL entry
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(filepath, line, 'utf8');
    } catch (error) {
      // Log failure shouldn't break execution
      console.warn(`[TokenLogger] Failed to write log entry: ${error.message}`);
    }
  }

  /**
   * Get log file path for a specific date
   * @param {string} date - Date in YYYY-MM-DD format (default: today)
   * @returns {string} Full path to log file
   */
  getLogFilePath(date = null) {
    const logDate = date || new Date().toISOString().slice(0, 10);
    const filename = `tokens-${logDate}.jsonl`;
    return path.join(this.logDir, filename);
  }

  /**
   * Read log entries for a specific date
   * @param {string} date - Date in YYYY-MM-DD format (default: today)
   * @returns {Promise<Object[]>} Array of log entries
   */
  async readLogEntries(date = null) {
    const filepath = this.getLogFilePath(date);

    try {
      const content = await fs.readFile(filepath, 'utf8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // File doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Get session statistics from logs
   * @param {string} sessionId - Session ID (default: current session)
   * @returns {Promise<Object>} Session statistics
   */
  async getSessionStats(sessionId = null) {
    const targetSession = sessionId || this.session;
    const entries = await this.readLogEntries();
    
    const sessionEntries = entries.filter(e => e.session === targetSession);
    
    if (sessionEntries.length === 0) {
      return {
        session: targetSession,
        totalCommands: 0,
        rtkCommands: 0,
        nativeCommands: 0,
        totalCharSavings: 0,
        avgReductionPercent: 0
      };
    }

    const rtkCommands = sessionEntries.filter(e => e.source === 'rtk');
    const totalSavings = rtkCommands.reduce((sum, e) => sum + e.metrics.char_savings, 0);
    const avgReduction = rtkCommands.length > 0
      ? Math.round(rtkCommands.reduce((sum, e) => sum + e.metrics.reduction_percent, 0) / rtkCommands.length)
      : 0;

    return {
      session: targetSession,
      totalCommands: sessionEntries.length,
      rtkCommands: rtkCommands.length,
      nativeCommands: sessionEntries.length - rtkCommands.length,
      totalCharSavings: totalSavings,
      avgReductionPercent: avgReduction
    };
  }
}

module.exports = { TokenLogger };
