/**
 * Token Tracker Module
 * 
 * Tracks token reduction metrics from RTK command execution.
 * Calculates character savings and provides periodic reporting.
 * 
 * @module TokenTracker
 */

'use strict';

/**
 * TokenTracker class for tracking and reporting token savings
 */
class TokenTracker {
  /**
   * Create a new TokenTracker instance
   * @param {Object} options - Configuration options
   * @param {number} options.reportInterval - Number of commands between reports (default: 100)
   */
  constructor(options = {}) {
    this.reportInterval = options.reportInterval || 100;
    this.reset();
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.totalCommands = 0;
    this.rtkCommands = 0;
    this.nativeCommands = 0;
    this.totalNativeChars = 0;
    this.totalRTKChars = 0;
    this.totalNativeBaselineChars = 0; // Baseline for RTK comparison
    this.savingsByCommand = new Map();
  }

  /**
   * Estimate token count from character count
   * Uses ~4 characters per token heuristic (rough estimate)
   * 
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    // Rough heuristic: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Record a command execution with savings calculation
   * 
   * @param {string} command - Command name (e.g., 'ls', 'grep')
   * @param {string} source - Execution source ('rtk' or 'native')
   * @param {string} output - Command output
   * @param {number} nativeChars - Expected native character count (for RTK comparison)
   * @returns {Object} Recorded statistics for this execution
   */
  record(command, source, output, nativeChars = 0) {
    this.totalCommands++;
    
    const outputChars = output ? output.length : 0;
    let savings = 0;
    let reductionPercent = 0;
    let tokensSaved = 0;

    if (source === 'rtk') {
      this.rtkCommands++;
      this.totalRTKChars += outputChars;
      
      // Calculate savings if we have native comparison
      if (nativeChars > 0) {
        savings = Math.max(0, nativeChars - outputChars);
        reductionPercent = nativeChars > 0 ? Math.round((savings / nativeChars) * 100) : 0;
        tokensSaved = this.estimateTokens(savings.toString());
        this.totalNativeBaselineChars += nativeChars;
      }
      
      // Track per-command statistics
      if (!this.savingsByCommand.has(command)) {
        this.savingsByCommand.set(command, {
          count: 0,
          totalSavings: 0,
          totalNativeChars: 0,
          totalRTKChars: 0
        });
      }
      
      const cmdStats = this.savingsByCommand.get(command);
      cmdStats.count++;
      cmdStats.totalSavings += savings;
      cmdStats.totalNativeChars += nativeChars;
      cmdStats.totalRTKChars += outputChars;
      
      // Log savings message
      if (savings > 0) {
        console.log(`[RTK] ${command}: saved ${savings} chars (${reductionPercent}% reduction)`);
      } else {
        console.log(`[RTK] ${command}: executed`);
      }
    } else {
      this.nativeCommands++;
      this.totalNativeChars += outputChars;
    }

    // Check if we should report
    this.reportIfNeeded();

    return {
      command,
      source,
      outputChars,
      nativeChars,
      savings,
      reductionPercent,
      tokensSaved
    };
  }

  /**
   * Get aggregated statistics summary
   * @returns {Object} Summary statistics
   */
  getSummary() {
    const totalNativeChars = this.totalNativeChars;
    const totalRTKChars = this.totalRTKChars;
    const totalBaselineChars = this.totalNativeBaselineChars;
    const totalSavings = Math.max(0, totalBaselineChars - totalRTKChars);
    const avgReductionPercent = totalBaselineChars > 0 
      ? Math.round((totalSavings / totalBaselineChars) * 100) 
      : 0;
    
    const rtkUsagePercent = this.totalCommands > 0
      ? Math.round((this.rtkCommands / this.totalCommands) * 100)
      : 0;

    // Convert savingsByCommand Map to plain object
    const perCommandStats = {};
    for (const [cmd, stats] of this.savingsByCommand) {
      const cmdReduction = stats.totalNativeChars > 0
        ? Math.round((stats.totalSavings / stats.totalNativeChars) * 100)
        : 0;
      perCommandStats[cmd] = {
        ...stats,
        avgReductionPercent: cmdReduction
      };
    }

    return {
      totalCommands: this.totalCommands,
      rtkCommands: this.rtkCommands,
      nativeCommands: this.nativeCommands,
      rtkUsagePercent,
      totalNativeChars,
      totalRTKChars,
      totalSavings,
      avgReductionPercent,
      estimatedTokensSaved: this.estimateTokens(totalSavings.toString()),
      perCommandStats
    };
  }

  /**
   * Report aggregate statistics if report interval is reached
   */
  reportIfNeeded() {
    if (this.totalCommands > 0 && this.totalCommands % this.reportInterval === 0) {
      const summary = this.getSummary();
      console.log('\n[RTK] === Token Savings Report ===');
      console.log(`[RTK] Total commands: ${summary.totalCommands}`);
      console.log(`[RTK] RTK usage: ${summary.rtkUsagePercent}% (${summary.rtkCommands} RTK, ${summary.nativeCommands} native)`);
      console.log(`[RTK] Character savings: ${summary.totalSavings} chars (${summary.avgReductionPercent}% avg reduction)`);
      console.log(`[RTK] Estimated tokens saved: ${summary.estimatedTokensSaved}`);
      console.log('[RTK] =============================\n');
    }
  }
}

module.exports = { TokenTracker };
