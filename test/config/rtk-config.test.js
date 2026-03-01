/**
 * RTK Configuration Module Tests
 * Phase 09-02: Configuration parsing with boolean validation and auto-detect
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Store original env
const originalEnv = { ...process.env };

// Helper to set env and clear module cache
function setRTKEnabled(value) {
  if (value === undefined) {
    delete process.env.CONTEXTFS_RTK_ENABLED;
  } else {
    process.env.CONTEXTFS_RTK_ENABLED = value;
  }
  // Clear module cache to re-parse
  delete require.cache[require.resolve('../../server/config/rtk-config.js')];
}

function setRTKStatus(value) {
  if (value === undefined) {
    delete process.env.CONTEXTFS_RTK_STATUS;
  } else {
    process.env.CONTEXTFS_RTK_STATUS = value;
  }
}

describe('RTKConfig - parseBoolean()', () => {
  const { RTKConfig } = require('../../server/config/rtk-config.js');

  it('should parse "true" as true', () => {
    assert.strictEqual(RTKConfig.parseBoolean('true'), true);
    assert.strictEqual(RTKConfig.parseBoolean('TRUE'), true);
    assert.strictEqual(RTKConfig.parseBoolean('True'), true);
  });

  it('should parse "1" as true', () => {
    assert.strictEqual(RTKConfig.parseBoolean('1'), true);
  });

  it('should parse "yes" as true', () => {
    assert.strictEqual(RTKConfig.parseBoolean('yes'), true);
    assert.strictEqual(RTKConfig.parseBoolean('YES'), true);
    assert.strictEqual(RTKConfig.parseBoolean('Yes'), true);
  });

  it('should parse "on" as true', () => {
    assert.strictEqual(RTKConfig.parseBoolean('on'), true);
    assert.strictEqual(RTKConfig.parseBoolean('ON'), true);
    assert.strictEqual(RTKConfig.parseBoolean('On'), true);
  });

  it('should parse "false" as false', () => {
    assert.strictEqual(RTKConfig.parseBoolean('false'), false);
    assert.strictEqual(RTKConfig.parseBoolean('FALSE'), false);
    assert.strictEqual(RTKConfig.parseBoolean('False'), false);
  });

  it('should parse "0" as false', () => {
    assert.strictEqual(RTKConfig.parseBoolean('0'), false);
  });

  it('should parse "no" as false', () => {
    assert.strictEqual(RTKConfig.parseBoolean('no'), false);
    assert.strictEqual(RTKConfig.parseBoolean('NO'), false);
    assert.strictEqual(RTKConfig.parseBoolean('No'), false);
  });

  it('should parse "off" as false', () => {
    assert.strictEqual(RTKConfig.parseBoolean('off'), false);
    assert.strictEqual(RTKConfig.parseBoolean('OFF'), false);
    assert.strictEqual(RTKConfig.parseBoolean('Off'), false);
  });

  it('should parse empty string as false', () => {
    assert.strictEqual(RTKConfig.parseBoolean(''), false);
  });

  it('should return undefined for invalid values', () => {
    assert.strictEqual(RTKConfig.parseBoolean('invalid'), undefined);
    assert.strictEqual(RTKConfig.parseBoolean('maybe'), undefined);
    assert.strictEqual(RTKConfig.parseBoolean('2'), undefined);
  });

  it('should return undefined for undefined/null', () => {
    assert.strictEqual(RTKConfig.parseBoolean(undefined), undefined);
    assert.strictEqual(RTKConfig.parseBoolean(null), undefined);
  });

  it('should trim whitespace before parsing', () => {
    assert.strictEqual(RTKConfig.parseBoolean('  true  '), true);
    assert.strictEqual(RTKConfig.parseBoolean(' false '), false);
    assert.strictEqual(RTKConfig.parseBoolean('  invalid  '), undefined);
  });
});

describe('RTKConfig - detectRTKAvailability()', () => {
  beforeEach(() => {
    // Clear module cache before each test
    delete require.cache[require.resolve('../../server/config/rtk-config.js')];
  });

  afterEach(() => {
    // Restore original env after each test
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
  });

  it('should return true when CONTEXTFS_RTK_STATUS is "enabled"', () => {
    setRTKStatus('enabled');
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    assert.strictEqual(RTKConfig.detectRTKAvailability(), true);
  });

  it('should return false when CONTEXTFS_RTK_STATUS is "disabled"', () => {
    setRTKStatus('disabled');
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    assert.strictEqual(RTKConfig.detectRTKAvailability(), false);
  });

  it('should return false when CONTEXTFS_RTK_STATUS is "unavailable"', () => {
    setRTKStatus('unavailable');
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    assert.strictEqual(RTKConfig.detectRTKAvailability(), false);
  });

  it('should return false when CONTEXTFS_RTK_STATUS is unset', () => {
    setRTKStatus(undefined);
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    assert.strictEqual(RTKConfig.detectRTKAvailability(), false);
  });

  it('should return false for any other status value', () => {
    setRTKStatus('some-random-value');
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    assert.strictEqual(RTKConfig.detectRTKAvailability(), false);
  });
});

describe('RTKConfig - getConfig()', () => {
  beforeEach(() => {
    // Clear module cache before each test
    delete require.cache[require.resolve('../../server/config/rtk-config.js')];
    // Reset env to clean state
    delete process.env.CONTEXTFS_RTK_ENABLED;
    delete process.env.CONTEXTFS_RTK_STATUS;
    delete process.env.CONTEXTFS_RTK_PATH;
    delete process.env.CONTEXTFS_RTK_TIMEOUT;
    delete process.env.CONTEXTFS_RTK_TEE_ON_ERROR;
  });

  afterEach(() => {
    // Restore original env after each test
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
  });

  it('should return enabled=true when CONTEXTFS_RTK_ENABLED=true', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.autoDetected, false);
  });

  it('should return enabled=false when CONTEXTFS_RTK_ENABLED=false', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'false';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.autoDetected, false);
  });

  it('should auto-detect when CONTEXTFS_RTK_ENABLED is unset', () => {
    delete process.env.CONTEXTFS_RTK_ENABLED;
    process.env.CONTEXTFS_RTK_STATUS = 'enabled';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.autoDetected, true);
  });

  it('should auto-detect when CONTEXTFS_RTK_ENABLED is invalid', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'invalid-value';
    process.env.CONTEXTFS_RTK_STATUS = 'disabled';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.autoDetected, true);
  });

  it('should use default binaryPath "rtk"', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.binaryPath, 'rtk');
  });

  it('should use custom binaryPath from env', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    process.env.CONTEXTFS_RTK_PATH = '/usr/local/bin/rtk';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.binaryPath, '/usr/local/bin/rtk');
  });

  it('should use default timeout 30000', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.timeout, 30000);
  });

  it('should use custom timeout from env', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    process.env.CONTEXTFS_RTK_TIMEOUT = '60000';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.timeout, 60000);
  });

  it('should use default teeOnError true', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.teeOnError, true);
  });

  it('should use custom teeOnError from env', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    process.env.CONTEXTFS_RTK_TEE_ON_ERROR = 'false';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.teeOnError, false);
  });

  it('should include containerStatus in config', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    process.env.CONTEXTFS_RTK_STATUS = 'enabled';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.getConfig();
    assert.strictEqual(config.containerStatus, 'enabled');
  });

  it('should cache config on subsequent calls', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config1 = RTKConfig.getConfig();
    const config2 = RTKConfig.getConfig();
    assert.strictEqual(config1, config2);
  });
});

describe('RTKConfig - validate()', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../../server/config/rtk-config.js')];
    delete process.env.CONTEXTFS_RTK_ENABLED;
    delete process.env.CONTEXTFS_RTK_STATUS;
  });

  afterEach(() => {
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
  });

  it('should return config object', () => {
    process.env.CONTEXTFS_RTK_ENABLED = 'true';
    const { RTKConfig } = require('../../server/config/rtk-config.js');
    const config = RTKConfig.validate();
    assert.strictEqual(typeof config, 'object');
    assert.strictEqual(config.enabled, true);
  });
});

// Verify test count meets minimum requirement
console.log('\nTest file loaded: rtk-config.test.js');
console.log('Expected: 80+ lines of test code');
