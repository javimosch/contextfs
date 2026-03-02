/**
 * RTK Test Output Post-processing Tests
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { RTKExecutor } = require('../server/mcp/tools/rtk-executor.js');

describe('RTKExecutor Test Output Processing', () => {
  let executor;

  beforeEach(() => {
    executor = new RTKExecutor({
      rtkConfig: { enabled: true, binaryPath: 'rtk', timeout: 30000 }
    });
  });

  describe('isTestCommand', () => {
    it('should identify npm test as test command', () => {
      assert.strictEqual(executor.isTestCommand('npm', ['test']), true);
      assert.strictEqual(executor.isTestCommand('npm', ['run', 'test']), true);
    });

    it('should identify cargo test as test command', () => {
      assert.strictEqual(executor.isTestCommand('cargo', ['test']), true);
    });

    it('should identify node with test file as test command', () => {
      assert.strictEqual(executor.isTestCommand('node', ['test/app.test.js']), true);
      assert.strictEqual(executor.isTestCommand('node', ['app.js']), false);
    });

    it('should identify pytest, vitest, jest as test commands', () => {
      assert.strictEqual(executor.isTestCommand('pytest', []), true);
      assert.strictEqual(executor.isTestCommand('vitest', []), true);
      assert.strictEqual(executor.isTestCommand('jest', []), true);
    });
  });

  describe('processTestOutput', () => {
    it('should limit failures to 5', () => {
      const input = `
FAIL: test 1
  at stack trace 1
FAIL: test 2
  at stack trace 2
FAIL: test 3
  at stack trace 3
FAIL: test 4
  at stack trace 4
FAIL: test 5
  at stack trace 5
FAIL: test 6
  at stack trace 6
10 passed, 6 failed
`;
      const output = executor.processTestOutput(input, '', 1);
      
      assert.ok(output.includes('FAIL: test 1'));
      assert.ok(output.includes('FAIL: test 5'));
      assert.ok(!output.includes('FAIL: test 6'));
      assert.ok(output.includes('1 more failures omitted'));
      assert.ok(output.includes('Test Summary: 10 passed, 6 failed'));
    });

    it('should handle timeout by showing last 50 lines', () => {
      let largeOutput = '';
      for (let i = 1; i <= 100; i++) {
        largeOutput += `Line ${i}\n`;
      }
      
      const output = executor.processTestOutput(largeOutput, '', 124);
      
      assert.ok(output.includes('[Timeout - showing last 50 lines]'));
      assert.ok(!output.includes('Line 1\n'));
      assert.ok(output.includes('Line 100'));
    });

    it('should preserve full stack traces for included failures', () => {
      const input = `
FAIL: test 1
  at line 10
  at line 11
  at line 12
Test Summary: 0 passed, 1 failed
`;
      const output = executor.processTestOutput(input, '', 1);
      
      assert.ok(output.includes('at line 10'));
      assert.ok(output.includes('at line 11'));
      assert.ok(output.includes('at line 12'));
    });
  });

  describe('isSupportedCommand', () => {
    it('should allow npm test but not npm install', () => {
      assert.strictEqual(executor.isSupportedCommand('npm', ['test']), true);
      assert.strictEqual(executor.isSupportedCommand('npm', ['install']), false);
    });

    it('should allow node test but not node app', () => {
      assert.strictEqual(executor.isSupportedCommand('node', ['test/app.test.js']), true);
      assert.strictEqual(executor.isSupportedCommand('node', ['app.js']), false);
    });
  });
});
