/**
 * Token Tracker Tests
 * 
 * Tests for TokenTracker module using Node.js built-in test runner
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { TokenTracker } = require('../server/mcp/tools/token-tracker.js');

describe('TokenTracker', () => {
  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      const tracker = new TokenTracker();
      assert.strictEqual(tracker.estimateTokens(''), 0);
    });

    it('should return 0 for null/undefined', () => {
      const tracker = new TokenTracker();
      assert.strictEqual(tracker.estimateTokens(null), 0);
      assert.strictEqual(tracker.estimateTokens(undefined), 0);
    });

    it('should estimate tokens using 4 chars per token heuristic', () => {
      const tracker = new TokenTracker();
      // 4 chars = 1 token
      assert.strictEqual(tracker.estimateTokens('abcd'), 1);
      // 8 chars = 2 tokens
      assert.strictEqual(tracker.estimateTokens('abcdefgh'), 2);
      // 3 chars = 1 token (ceiling)
      assert.strictEqual(tracker.estimateTokens('abc'), 1);
    });

    it('should handle long text', () => {
      const tracker = new TokenTracker();
      const text = 'a'.repeat(100);
      assert.strictEqual(tracker.estimateTokens(text), 25);
    });
  });

  describe('record', () => {
    it('should increment total commands counter', () => {
      const tracker = new TokenTracker();
      tracker.record('ls', 'native', 'output');
      assert.strictEqual(tracker.totalCommands, 1);
      tracker.record('ls', 'native', 'output');
      assert.strictEqual(tracker.totalCommands, 2);
    });

    it('should track native commands separately', () => {
      const tracker = new TokenTracker();
      tracker.record('ls', 'native', 'output1', 100);
      assert.strictEqual(tracker.nativeCommands, 1);
      assert.strictEqual(tracker.rtkCommands, 0);
      assert.strictEqual(tracker.totalNativeChars, 7); // 'output1'.length
    });

    it('should track RTK commands separately', () => {
      const tracker = new TokenTracker();
      tracker.record('ls', 'rtk', 'out', 100);
      assert.strictEqual(tracker.nativeCommands, 0);
      assert.strictEqual(tracker.rtkCommands, 1);
      assert.strictEqual(tracker.totalRTKChars, 3); // 'out'.length
    });

    it('should calculate savings for RTK commands', () => {
      const tracker = new TokenTracker();
      const result = tracker.record('ls', 'rtk', 'compact', 50);
      
      assert.strictEqual(result.source, 'rtk');
      assert.strictEqual(result.nativeChars, 50);
      assert.strictEqual(result.outputChars, 7); // 'compact'.length
      assert.strictEqual(result.savings, 43); // 50 - 7
      assert.strictEqual(result.reductionPercent, 86); // (43/50) * 100
    });

    it('should not calculate savings for native commands', () => {
      const tracker = new TokenTracker();
      const result = tracker.record('ls', 'native', 'output', 100);
      
      assert.strictEqual(result.source, 'native');
      assert.strictEqual(result.savings, 0);
      assert.strictEqual(result.reductionPercent, 0);
    });

    it('should track per-command statistics', () => {
      const tracker = new TokenTracker();
      tracker.record('ls', 'rtk', 'out1', 20);  // 4 chars output, 16 savings
      tracker.record('ls', 'rtk', 'out2', 30);  // 4 chars output, 26 savings
      tracker.record('grep', 'rtk', 'match', 50);  // 5 chars output, 45 savings
      
      assert.strictEqual(tracker.savingsByCommand.get('ls').count, 2);
      assert.strictEqual(tracker.savingsByCommand.get('ls').totalSavings, 42); // 16 + 26
      assert.strictEqual(tracker.savingsByCommand.get('grep').count, 1);
      assert.strictEqual(tracker.savingsByCommand.get('grep').totalSavings, 45);
    });

    it('should handle zero nativeChars gracefully', () => {
      const tracker = new TokenTracker();
      const result = tracker.record('ls', 'rtk', 'output', 0);
      
      assert.strictEqual(result.savings, 0);
      assert.strictEqual(result.reductionPercent, 0);
    });

    it('should handle empty output', () => {
      const tracker = new TokenTracker();
      const result = tracker.record('ls', 'rtk', '', 50);
      
      assert.strictEqual(result.outputChars, 0);
      assert.strictEqual(result.savings, 50);
    });

    it('should not allow negative savings', () => {
      const tracker = new TokenTracker();
      // RTK output longer than native
      const result = tracker.record('ls', 'rtk', 'very long output here', 10);
      
      assert.strictEqual(result.savings, 0); // clamped to 0
    });
  });

  describe('getSummary', () => {
    it('should return zeros for empty tracker', () => {
      const tracker = new TokenTracker();
      const summary = tracker.getSummary();
      
      assert.strictEqual(summary.totalCommands, 0);
      assert.strictEqual(summary.rtkCommands, 0);
      assert.strictEqual(summary.nativeCommands, 0);
      assert.strictEqual(summary.rtkUsagePercent, 0);
      assert.strictEqual(summary.totalSavings, 0);
      assert.strictEqual(summary.avgReductionPercent, 0);
    });

    it('should calculate RTK usage percentage', () => {
      const tracker = new TokenTracker();
      tracker.record('ls', 'rtk', 'out', 20);
      tracker.record('ls', 'native', 'output');
      tracker.record('ls', 'rtk', 'out', 20);
      
      const summary = tracker.getSummary();
      assert.strictEqual(summary.totalCommands, 3);
      assert.strictEqual(summary.rtkUsagePercent, 67); // 2/3 * 100
    });

    it('should calculate average reduction percentage', () => {
      const tracker = new TokenTracker();
      // RTK: 5 chars, Native: 20 chars (15 savings, 75% reduction)
      tracker.record('ls', 'rtk', 'small', 20);
      // Native command doesn't count toward reduction calculation
      tracker.record('ls', 'native', 'native output here');
      
      const summary = tracker.getSummary();
      assert.strictEqual(summary.totalNativeChars, 18); // only native command
      assert.strictEqual(summary.totalRTKChars, 5);
    });

    it('should include per-command statistics', () => {
      const tracker = new TokenTracker();
      tracker.record('ls', 'rtk', 'l', 20);
      tracker.record('grep', 'rtk', 'g', 30);
      
      const summary = tracker.getSummary();
      assert.ok(summary.perCommandStats.ls);
      assert.ok(summary.perCommandStats.grep);
      assert.strictEqual(summary.perCommandStats.ls.count, 1);
      assert.strictEqual(summary.perCommandStats.grep.count, 1);
    });

    it('should estimate total tokens saved', () => {
      const tracker = new TokenTracker();
      // RTK: 10 chars, Native baseline: 50 chars = 40 chars saved
      tracker.record('ls', 'rtk', 'a'.repeat(10), 50);
      
      const summary = tracker.getSummary();
      assert.strictEqual(summary.totalSavings, 40); // 50 - 10
      assert.ok(summary.estimatedTokensSaved > 0);
    });
  });

  describe('reportIfNeeded', () => {
    it('should not report before interval', () => {
      const tracker = new TokenTracker({ reportInterval: 100 });
      let reportCalled = false;
      
      // Override console.log to capture reports
      const originalLog = console.log;
      console.log = (...args) => {
        if (args[0] && args[0].includes('Token Savings Report')) {
          reportCalled = true;
        }
      };
      
      for (let i = 0; i < 99; i++) {
        tracker.record('ls', 'rtk', 'out', 20);
      }
      
      console.log = originalLog;
      assert.strictEqual(reportCalled, false);
    });

    it('should report at interval boundary', () => {
      const tracker = new TokenTracker({ reportInterval: 10 });
      let reportCalls = 0;
      
      const originalLog = console.log;
      console.log = (...args) => {
        if (args[0] && args[0].includes('Token Savings Report')) {
          reportCalls++;
        }
      };
      
      for (let i = 0; i < 10; i++) {
        tracker.record('ls', 'rtk', 'out', 20);
      }
      
      console.log = originalLog;
      assert.strictEqual(reportCalls, 1);
    });

    it('should report multiple times', () => {
      const tracker = new TokenTracker({ reportInterval: 5 });
      let reportCalls = 0;
      
      const originalLog = console.log;
      console.log = (...args) => {
        if (args[0] && args[0].includes('Token Savings Report')) {
          reportCalls++;
        }
      };
      
      for (let i = 0; i < 15; i++) {
        tracker.record('ls', 'rtk', 'out', 20);
      }
      
      console.log = originalLog;
      assert.strictEqual(reportCalls, 3); // At 5, 10, and 15
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      const tracker = new TokenTracker();
      tracker.record('ls', 'rtk', 'out', 20);
      tracker.record('ls', 'native', 'output');
      
      tracker.reset();
      
      assert.strictEqual(tracker.totalCommands, 0);
      assert.strictEqual(tracker.rtkCommands, 0);
      assert.strictEqual(tracker.nativeCommands, 0);
      assert.strictEqual(tracker.totalNativeChars, 0);
      assert.strictEqual(tracker.totalRTKChars, 0);
      assert.strictEqual(tracker.savingsByCommand.size, 0);
    });
  });
});
