/**
 * Error Classifier Module
 * 
 * Three-tier error classification system for RTK execution.
 * Determines when fallback to native execution is appropriate.
 * 
 * @module ErrorClassifier
 */

'use strict';

/**
 * Error classification tiers
 * @readonly
 * @enum {number}
 */
const ErrorTiers = {
  SPAWN_EXECUTION: 1,
  RTK_PROCESSING: 2,
  COMMAND_ERROR: 3
};

/**
 * Error type definitions with fallback decisions
 * @readonly
 */
const ErrorTypes = {
  // Tier 1: Spawn/Execution Errors (fallback: true)
  BINARY_NOT_FOUND: { tier: 1, fallback: true, message: 'RTK binary not found in PATH' },
  PERMISSION_DENIED: { tier: 1, fallback: true, message: 'Permission denied executing RTK binary' },
  TIMEOUT: { tier: 1, fallback: true, message: 'RTK execution timed out' },
  SIGNAL_TERMINATED: { tier: 1, fallback: true, message: 'RTK process terminated by signal' },
  
  // Tier 2: RTK Processing Errors (fallback: true)
  RTK_INVALID_OPTION: { tier: 2, fallback: true, message: 'RTK does not recognize an option' },
  RTK_INVALID_ARGUMENT: { tier: 2, fallback: true, message: 'RTK received an invalid argument' },
  RTK_PANIC: { tier: 2, fallback: true, message: 'RTK encountered an internal panic' },
  RTK_INTERNAL_ERROR: { tier: 2, fallback: true, message: 'RTK internal error occurred' },
  
  // Tier 3: Target Command Errors (fallback: false)
  COMMAND_ERROR: { tier: 3, fallback: false, message: 'Command execution failed' },
  UNKNOWN_ERROR: { tier: 3, fallback: false, message: 'Unknown error occurred' }
};

/**
 * Regex patterns for detecting RTK processing errors in stderr
 * @readonly
 */
const RTK_ERROR_PATTERNS = [
  { pattern: /rtk:.*unrecognized.*option/i, type: 'RTK_INVALID_OPTION' },
  { pattern: /rtk:.*invalid.*argument/i, type: 'RTK_INVALID_ARGUMENT' },
  { pattern: /RTK.*panic/i, type: 'RTK_PANIC' },
  { pattern: /RTK.*internal.*error/i, type: 'RTK_INTERNAL_ERROR' }
];

/**
 * Classifies errors into three tiers to determine fallback appropriateness
 */
class ErrorClassifier {
  /**
   * Classify an error based on error code and stderr output
   * 
   * @param {Error|null} error - The error object from spawn or execution
   * @param {string} stderr - stderr output from the process
   * @returns {Object} Classification result with tier, type, fallback, message
   */
  static classify(error, stderr = '') {
    // Handle null/undefined error
    if (!error) {
      return {
        tier: 3,
        type: 'COMMAND_ERROR',
        fallback: false,
        message: 'Command execution failed'
      };
    }

    // Tier 1: Check spawn error codes (check signal first, then code)
    if (error.code || error.signal) {
      const tier1Result = this._classifySpawnError(error.code, error.signal);
      if (tier1Result) {
        return tier1Result;
      }
    }

    // Tier 2: Check stderr for RTK processing errors
    const stderrStr = String(stderr || '');
    const tier2Result = this._classifyRTKProcessingError(stderrStr);
    if (tier2Result) {
      return tier2Result;
    }

    // Tier 3: Default to command error (no fallback)
    return {
      tier: 3,
      type: 'COMMAND_ERROR',
      fallback: false,
      message: 'Target command failed with non-zero exit code'
    };
  }

  /**
   * Check if stderr contains RTK processing error patterns
   * 
   * @param {string} stderr - stderr output
   * @returns {boolean} True if RTK processing error detected
   */
  static isRTKProcessingError(stderr) {
    if (!stderr) return false;
    const stderrStr = String(stderr);
    return RTK_ERROR_PATTERNS.some(({ pattern }) => pattern.test(stderrStr));
  }

  /**
   * Classify spawn error codes (Tier 1)
   * @private
   */
  static _classifySpawnError(code, signal) {
    // Signal termination takes precedence
    if (signal) {
      return {
        tier: 1,
        type: 'SIGNAL_TERMINATED',
        fallback: true,
        message: `RTK process terminated by signal: ${signal}`
      };
    }

    switch (code) {
      case 'ENOENT':
        return {
          tier: 1,
          type: 'BINARY_NOT_FOUND',
          fallback: true,
          message: 'RTK binary not found at expected location'
        };
      case 'EACCES':
        return {
          tier: 1,
          type: 'PERMISSION_DENIED',
          fallback: true,
          message: 'permission denied when executing RTK binary'
        };
      case 'ETIMEDOUT':
        return {
          tier: 1,
          type: 'TIMEOUT',
          fallback: true,
          message: 'RTK execution timeout'
        };
      default:
        return null;
    }
  }

  /**
   * Classify RTK processing errors from stderr (Tier 2)
   * @private
   */
  static _classifyRTKProcessingError(stderr) {
    for (const { pattern, type } of RTK_ERROR_PATTERNS) {
      if (pattern.test(stderr)) {
        const errorType = ErrorTypes[type];
        return {
          tier: 2,
          type: type,
          fallback: errorType.fallback,
          message: errorType.message
        };
      }
    }
    return null;
  }
}

module.exports = { ErrorClassifier, ErrorTiers, ErrorTypes };