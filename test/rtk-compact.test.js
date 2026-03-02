/**
 * RTK Ultra-Compact Mode Tests
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { RTKExecutor } = require('../server/mcp/tools/rtk-executor.js');

describe('RTKExecutor - Ultra-Compact Mode', () => {
  let executor;

  beforeEach(() => {
    executor = new RTKExecutor();
  });

  describe('git log formatting', () => {
    it('should compress git log output', () => {
      const stdout = '26b028e002c3ebc7527e07d49ae1a1e009fba596 (HEAD -> master) feat(11-02): implement read and smart support\n' +
                     'effdc6b002c3ebc7527e07d49ae1a1e009fba597 Register and wire contextfs.smart\n';
      
      const result = executor.processUltraCompact(stdout, 'git', ['log']);
      
      assert.strictEqual(result.includes('26b028e feat(11-02): implement read a'), true);
      assert.strictEqual(result.includes('effdc6b Register and wire contextfs.s'), true);
    });
  });

  describe('ls formatting', () => {
    it('should compress ls -l output', () => {
      const stdout = '-rw-r--r-- 1 user group  1024 Mar  2 12:00 file1.txt\n' +
                     'drwxr-xr-x 2 user group  4096 Mar  2 12:00 dir1\n';
      
      const result = executor.processUltraCompact(stdout, 'ls', ['-l']);
      
      assert.strictEqual(result.includes('file1.txt 1024'), true);
      assert.strictEqual(result.includes('dir1 4096'), true);
    });
  });

  describe('General stripping', () => {
    it('should strip leading/trailing whitespace and empty lines', () => {
      const stdout = '  line 1  \n\n  line 2  \n';
      const result = executor.processUltraCompact(stdout, 'grep', ['-i', 'test']);
      assert.strictEqual(result, 'line 1\nline 2');
    });
  });

  describe('Flag mapping', () => {
    it('should add -u flag when ultra-compact is active via options', () => {
      const args = executor.mapToRTKArgs('ls', ['-l'], { ultraCompact: true });
      assert.deepStrictEqual(args, ['ls', '-l', '-u']);
    });

    it('should add -u flag when ultra-compact is active globally', () => {
      executor.config.ultraCompact = true;
      const args = executor.mapToRTKArgs('ls', ['-l'], {});
      assert.deepStrictEqual(args, ['ls', '-l', '-u']);
    });
  });
});
