/**
 * RTK Configuration Module
 * 
 * Parses CONTEXTFS_RTK_ENABLED with proper boolean handling,
 * implements auto-detect logic, and provides a clean API
 * for checking RTK enablement.
 * 
 * @module RTKConfig
 */

'use strict';

/**
 * Cached configuration object to avoid re-parsing
 * @private
 */
let cachedConfig = null;

/**
 * RTK Configuration class with static methods for parsing
 * and detecting RTK availability.
 */
class RTKConfig {
  /**
   * Parse a string value as a boolean.
   * 
   * Truthy values (return true):
   *   - "true", "TRUE", "True"
   *   - "1"
   *   - "yes", "YES", "Yes"
   *   - "on", "ON", "On"
   * 
   * Falsy values (return false):
   *   - "false", "FALSE", "False"
   *   - "0"
   *   - "no", "NO", "No"
   *   - "off", "OFF", "Off"
   *   - "" (empty string)
   * 
   * Invalid/unset values (return undefined):
   *   - undefined, null
   *   - Any other string
   * 
   * @param {*} value - The value to parse
   * @returns {boolean|undefined} - Parsed boolean or undefined for invalid
   */
  static parseBoolean(value) {
    if (value === undefined || value === null) {
      return undefined;
    }

    const normalized = String(value).toLowerCase().trim();

    // Truthy values
    if (normalized === 'true' || normalized === '1' || 
        normalized === 'yes' || normalized === 'on') {
      return true;
    }

    // Falsy values
    if (normalized === 'false' || normalized === '0' || 
        normalized === 'no' || normalized === 'off' || normalized === '') {
      return false;
    }

    // Invalid value - triggers auto-detect
    return undefined;
  }

  /**
   * Detect RTK availability based on CONTEXTFS_RTK_STATUS environment variable.
   * 
   * @returns {boolean} - True if RTK is available (status === 'enabled')
   */
  static detectRTKAvailability() {
    const status = process.env.CONTEXTFS_RTK_STATUS;
    return status === 'enabled';
  }

  /**
   * Get the RTK configuration object.
   * Caches the result on first call.
   * 
   * Configuration object contains:
   *   - enabled: boolean (final resolved value)
   *   - autoDetected: boolean (true if auto-detect was used)
   *   - binaryPath: string (from env or default "rtk")
   *   - timeout: number (from env or default 30000)
   *   - teeOnError: boolean (from env, default true)
   *   - containerStatus: string (CONTEXTFS_RTK_STATUS value)
   * 
   * @returns {Object} - Configuration object
   */
  static getConfig() {
    if (cachedConfig) {
      return cachedConfig;
    }

    const enabledValue = process.env.CONTEXTFS_RTK_ENABLED;
    const parsedValue = this.parseBoolean(enabledValue);

    let enabled;
    let autoDetected = false;

    if (parsedValue === undefined) {
      // Invalid or unset - use auto-detect
      if (enabledValue !== undefined) {
        console.warn(`[RTK-Config] Invalid CONTEXTFS_RTK_ENABLED value '${enabledValue}', using auto-detect`);
      }
      enabled = this.detectRTKAvailability();
      autoDetected = true;
    } else {
      // Explicit value provided
      enabled = parsedValue;
    }

    // Parse timeout with default
    let timeout = 30000;
    if (process.env.CONTEXTFS_RTK_TIMEOUT) {
      const parsedTimeout = parseInt(process.env.CONTEXTFS_RTK_TIMEOUT, 10);
      if (!isNaN(parsedTimeout)) {
        timeout = parsedTimeout;
      }
    }

    // Parse teeOnError with default
    let teeOnError = true;
    if (process.env.CONTEXTFS_RTK_TEE_ON_ERROR !== undefined) {
      const parsedTee = this.parseBoolean(process.env.CONTEXTFS_RTK_TEE_ON_ERROR);
      if (parsedTee !== undefined) {
        teeOnError = parsedTee;
      }
    }

    cachedConfig = {
      enabled,
      autoDetected,
      binaryPath: process.env.CONTEXTFS_RTK_PATH || 'rtk',
      timeout,
      teeOnError,
      containerStatus: process.env.CONTEXTFS_RTK_STATUS
    };

    return cachedConfig;
  }

  /**
   * Validate and log the configuration.
   * Returns the same object as getConfig() but logs it first.
   * 
   * @returns {Object} - Configuration object
   */
  static validate() {
    const config = this.getConfig();
    console.log('[RTK-Config] Configuration:', config);
    return config;
  }

  /**
   * Clear the cached configuration.
   * Useful for testing or when environment changes.
   * @private
   */
  static _clearCache() {
    cachedConfig = null;
  }
}

module.exports = { RTKConfig };
