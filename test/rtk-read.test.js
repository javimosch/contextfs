/**
 * RTK Read and Smart Tool Tests
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { RTKExecutor } = require('../server/mcp/tools/rtk-executor.js');

describe('RTKExecutor - Read & Smart', () => {
  let executor;

  beforeEach(() => {
    executor = new RTKExecutor();
  });

  describe('Read Post-processing', () => {
    it('should not filter files with <= 500 lines', () => {
      const stdout = 'line\n'.repeat(500).trim();
      const result = executor.processReadOutput(stdout, '', 0, ['file.txt'], { largeFileFilter: true });
      assert.strictEqual(result, stdout);
    });

    it('should filter files with > 500 lines', () => {
      const lines = [];
      for (let i = 1; i <= 600; i++) lines.push(`line ${i}`);
      const stdout = lines.join('\n');
      
      const result = executor.processReadOutput(stdout, '', 0, ['file.txt'], { largeFileFilter: true });
      
      const resultLines = result.split('\n').filter(l => l.trim() !== '');
      assert.strictEqual(resultLines[0], 'line 1');
      assert.strictEqual(resultLines[99], 'line 100');
      assert.ok(result.includes('400 lines filtered'));
      // last 100 lines start from 501 to 600
      assert.strictEqual(resultLines[resultLines.length - 100], 'line 501');
      assert.strictEqual(resultLines[resultLines.length - 1], 'line 600');
    });

    it('should not filter if largeFileFilter option is false', () => {
      const stdout = 'line\n'.repeat(600).trim();
      const result = executor.processReadOutput(stdout, '', 0, ['file.txt'], { largeFileFilter: false });
      assert.strictEqual(result, stdout);
    });
  });

  describe('Smart Tool Logic', () => {
    it('should map smart command to read with minimal level', () => {
      const args = executor.mapToRTKArgs('smart', ['file.js']);
      assert.deepStrictEqual(args, ['read', '--level', 'minimal', 'file.js']);
    });
    
    it('should support smart in allowlist', () => {
      assert.strictEqual(executor.isSupportedCommand('smart', ['file.js']), true);
    });

    it('should support read in allowlist with flags', () => {
      assert.strictEqual(executor.isSupportedCommand('read', ['--level', 'minimal', 'file.js']), true);
      assert.strictEqual(executor.isSupportedCommand('read', ['--invalid', 'file.js']), false);
    });
  });

  describe('executeSmart', () => {
    it('should short-circuit for small files', async () => {
      let rtkCalls = [];
      executor.executeRTK = async (cmd, args) => {
        rtkCalls.push({ cmd, args });
        if (cmd === 'wc') return { stdout: '5\n', stderr: '', exitCode: 0 };
        if (cmd === 'read') return { stdout: 'full content', stderr: '', exitCode: 0, source: 'rtk' };
      };

      const result = await executor.executeSmart(['file.js'], {});
      
      assert.strictEqual(result.stdout, 'full content');
      assert.deepStrictEqual(rtkCalls[0], { cmd: 'wc', args: ['-l', 'file.js'] });
      assert.deepStrictEqual(rtkCalls[1], { cmd: 'read', args: ['file.js'] });
    });

    it('should provide summary for large files', async () => {
      executor.executeRTK = async (cmd, args) => {
        if (cmd === 'wc') return { stdout: '200\n', stderr: '', exitCode: 0 };
        if (cmd === 'read') return { stdout: 'signatures content', stderr: '', exitCode: 0, source: 'rtk' };
      };

      const result = await executor.executeSmart(['file.js'], {});
      
      assert.ok(result.stdout.includes('File: file.js'));
      assert.ok(result.stdout.includes('Lines: 200'));
      assert.ok(result.stdout.includes('Complexity: Medium'));
      assert.ok(result.stdout.includes('signatures content'));
    });
  });
});
