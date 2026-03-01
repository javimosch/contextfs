/**
 * Token Logger Tests
 * 
 * Tests for TokenLogger module using Node.js built-in test runner
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const { TokenLogger } = require('../server/mcp/tools/token-logger.js');

describe('TokenLogger', () => {
  const testLogDir = path.join(process.cwd(), 'test', 'tmp', 'logs');

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch (e) {
      // Directory might not exist
    }
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch (e) {
      // Directory might not exist
    }
  });

  describe('constructor', () => {
    it('should use default logDir', () => {
      const logger = new TokenLogger();
      assert.strictEqual(logger.logDir, '/workspace/.rtk/logs');
    });

    it('should accept custom logDir', () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      assert.strictEqual(logger.logDir, testLogDir);
    });

    it('should generate session ID', () => {
      const logger = new TokenLogger();
      assert.ok(logger.session);
      assert.ok(typeof logger.session === 'string');
      assert.ok(logger.session.length > 0);
    });

    it('should accept custom session', () => {
      const logger = new TokenLogger({ session: 'test-session-123' });
      assert.strictEqual(logger.session, 'test-session-123');
    });
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      const logger = new TokenLogger();
      assert.strictEqual(logger.estimateTokens(''), 0);
    });

    it('should return 0 for null/undefined', () => {
      const logger = new TokenLogger();
      assert.strictEqual(logger.estimateTokens(null), 0);
      assert.strictEqual(logger.estimateTokens(undefined), 0);
    });

    it('should estimate tokens using 4 chars per token', () => {
      const logger = new TokenLogger();
      assert.strictEqual(logger.estimateTokens('abcd'), 1);
      assert.strictEqual(logger.estimateTokens('abcdefgh'), 2);
    });
  });

  describe('logExecution', () => {
    it('should create log directory if it does not exist', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      
      await logger.logExecution({
        command: 'ls',
        source: 'native',
        exitCode: 0
      });

      const stats = await fs.stat(testLogDir);
      assert.ok(stats.isDirectory());
    });

    it('should write valid JSONL entry', async () => {
      const logger = new TokenLogger({ logDir: testLogDir, session: 'test-123' });
      
      await logger.logExecution({
        command: 'ls',
        args: ['-la'],
        source: 'rtk',
        nativeChars: 100,
        rtkChars: 25,
        exitCode: 0,
        timestamp: '2026-03-01T12:00:00Z'
      });

      const entries = await logger.readLogEntries('2026-03-01');
      assert.strictEqual(entries.length, 1);
      
      const entry = entries[0];
      assert.strictEqual(entry.command, 'ls');
      assert.deepStrictEqual(entry.args, ['-la']);
      assert.strictEqual(entry.source, 'rtk');
      assert.strictEqual(entry.session, 'test-123');
      assert.strictEqual(entry.exit_code, 0);
    });

    it('should calculate correct metrics', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      
      await logger.logExecution({
        command: 'ls',
        source: 'rtk',
        nativeChars: 100,
        rtkChars: 25,
        exitCode: 0
      });

      const entries = await logger.readLogEntries();
      const entry = entries[0];
      
      assert.strictEqual(entry.metrics.native_chars, 100);
      assert.strictEqual(entry.metrics.rtk_chars, 25);
      assert.strictEqual(entry.metrics.char_savings, 75);
      assert.strictEqual(entry.metrics.reduction_percent, 75);
    });

    it('should handle native commands (no savings)', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      
      await logger.logExecution({
        command: 'ls',
        source: 'native',
        nativeChars: 0,
        rtkChars: 0,
        exitCode: 0
      });

      const entries = await logger.readLogEntries();
      const entry = entries[0];
      
      assert.strictEqual(entry.metrics.char_savings, 0);
      assert.strictEqual(entry.metrics.reduction_percent, 0);
      // Native commands have no savings, so estimated_tokens_saved is 0
      // (calculated from char_savings which is 0 for native)
      assert.strictEqual(entry.metrics.estimated_tokens_saved, 0);
    });

    it('should handle zero nativeChars', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      
      await logger.logExecution({
        command: 'ls',
        source: 'rtk',
        nativeChars: 0,
        rtkChars: 25,
        exitCode: 0
      });

      const entries = await logger.readLogEntries();
      const entry = entries[0];
      
      assert.strictEqual(entry.metrics.char_savings, 0);
      assert.strictEqual(entry.metrics.reduction_percent, 0);
    });

    it('should handle negative savings (RTK longer)', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      
      await logger.logExecution({
        command: 'ls',
        source: 'rtk',
        nativeChars: 10,
        rtkChars: 50,
        exitCode: 0
      });

      const entries = await logger.readLogEntries();
      const entry = entries[0];
      
      assert.strictEqual(entry.metrics.char_savings, 0); // clamped to 0
      assert.strictEqual(entry.metrics.reduction_percent, 0);
    });

    it('should rotate log files by date', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      
      await logger.logExecution({
        command: 'ls',
        source: 'rtk',
        nativeChars: 100,
        rtkChars: 25,
        exitCode: 0,
        timestamp: '2026-03-01T10:00:00Z'
      });

      await logger.logExecution({
        command: 'ls',
        source: 'rtk',
        nativeChars: 100,
        rtkChars: 25,
        exitCode: 0,
        timestamp: '2026-03-02T10:00:00Z'
      });

      const entries1 = await logger.readLogEntries('2026-03-01');
      const entries2 = await logger.readLogEntries('2026-03-02');
      
      assert.strictEqual(entries1.length, 1);
      assert.strictEqual(entries2.length, 1);
    });

    it('should append multiple entries to same file', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      
      await logger.logExecution({
        command: 'ls',
        source: 'rtk',
        nativeChars: 100,
        rtkChars: 25,
        exitCode: 0
      });

      await logger.logExecution({
        command: 'grep',
        source: 'rtk',
        nativeChars: 200,
        rtkChars: 50,
        exitCode: 0
      });

      const entries = await logger.readLogEntries();
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].command, 'ls');
      assert.strictEqual(entries[1].command, 'grep');
    });
  });

  describe('readLogEntries', () => {
    it('should return empty array for missing file', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      const entries = await logger.readLogEntries('2025-01-01');
      assert.deepStrictEqual(entries, []);
    });

    it('should parse all JSONL entries', async () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      
      await logger.logExecution({ command: 'ls', source: 'native', exitCode: 0 });
      await logger.logExecution({ command: 'grep', source: 'native', exitCode: 0 });
      await logger.logExecution({ command: 'cat', source: 'native', exitCode: 0 });

      const entries = await logger.readLogEntries();
      assert.strictEqual(entries.length, 3);
      assert.ok(entries.every(e => typeof e === 'object'));
    });
  });

  describe('getSessionStats', () => {
    it('should return zeros for empty session', async () => {
      const logger = new TokenLogger({ logDir: testLogDir, session: 'empty-session' });
      const stats = await logger.getSessionStats();
      
      assert.strictEqual(stats.totalCommands, 0);
      assert.strictEqual(stats.rtkCommands, 0);
      assert.strictEqual(stats.totalCharSavings, 0);
    });

    it('should calculate session statistics', async () => {
      const logger = new TokenLogger({ logDir: testLogDir, session: 'stats-session' });
      
      await logger.logExecution({
        command: 'ls',
        source: 'rtk',
        nativeChars: 100,
        rtkChars: 25,
        exitCode: 0
      });

      await logger.logExecution({
        command: 'grep',
        source: 'rtk',
        nativeChars: 200,
        rtkChars: 50,
        exitCode: 0
      });

      await logger.logExecution({
        command: 'cat',
        source: 'native',
        exitCode: 0
      });

      const stats = await logger.getSessionStats();
      
      assert.strictEqual(stats.session, 'stats-session');
      assert.strictEqual(stats.totalCommands, 3);
      assert.strictEqual(stats.rtkCommands, 2);
      assert.strictEqual(stats.nativeCommands, 1);
      assert.strictEqual(stats.totalCharSavings, 225); // 75 + 150
    });
  });

  describe('getLogFilePath', () => {
    it('should return path for today by default', () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      const today = new Date().toISOString().slice(0, 10);
      const filepath = logger.getLogFilePath();
      
      assert.ok(filepath.includes(`tokens-${today}.jsonl`));
      assert.ok(filepath.startsWith(testLogDir));
    });

    it('should return path for specific date', () => {
      const logger = new TokenLogger({ logDir: testLogDir });
      const filepath = logger.getLogFilePath('2026-03-15');
      
      assert.ok(filepath.includes('tokens-2026-03-15.jsonl'));
    });
  });
});
