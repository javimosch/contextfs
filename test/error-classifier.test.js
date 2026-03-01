const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ErrorClassifier } = require('../server/mcp/tools/error-classifier');

describe('ErrorClassifier', () => {
  describe('Tier 1: Spawn/Execution Errors (fallback: true)', () => {
    it('should classify ENOENT as BINARY_NOT_FOUND', () => {
      const error = { code: 'ENOENT' };
      const result = ErrorClassifier.classify(error);

      assert.strictEqual(result.tier, 1);
      assert.strictEqual(result.type, 'BINARY_NOT_FOUND');
      assert.strictEqual(result.fallback, true);
      assert.ok(result.message.includes('not found'));
    });

    it('should classify EACCES as PERMISSION_DENIED', () => {
      const error = { code: 'EACCES' };
      const result = ErrorClassifier.classify(error);

      assert.strictEqual(result.tier, 1);
      assert.strictEqual(result.type, 'PERMISSION_DENIED');
      assert.strictEqual(result.fallback, true);
      assert.ok(result.message.includes('permission'));
    });

    it('should classify ETIMEDOUT as TIMEOUT', () => {
      const error = { code: 'ETIMEDOUT' };
      const result = ErrorClassifier.classify(error);

      assert.strictEqual(result.tier, 1);
      assert.strictEqual(result.type, 'TIMEOUT');
      assert.strictEqual(result.fallback, true);
      assert.ok(result.message.includes('timeout'));
    });

    it('should classify signal termination as SIGNAL_TERMINATED', () => {
      const error = { signal: 'SIGTERM' };
      const result = ErrorClassifier.classify(error);

      assert.strictEqual(result.tier, 1);
      assert.strictEqual(result.type, 'SIGNAL_TERMINATED');
      assert.strictEqual(result.fallback, true);
      assert.ok(result.message.includes('signal'));
    });

    it('should classify signal termination with SIGKILL', () => {
      const error = { signal: 'SIGKILL' };
      const result = ErrorClassifier.classify(error);

      assert.strictEqual(result.tier, 1);
      assert.strictEqual(result.type, 'SIGNAL_TERMINATED');
      assert.strictEqual(result.fallback, true);
    });
  });

  describe('Tier 2: RTK Processing Errors (fallback: true)', () => {
    it('should classify unrecognized option error as RTK_INVALID_OPTION', () => {
      const error = {};
      const stderr = 'rtk: unrecognized option "--invalid"';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 2);
      assert.strictEqual(result.type, 'RTK_INVALID_OPTION');
      assert.strictEqual(result.fallback, true);
      assert.ok(result.message.includes('option'));
    });

    it('should classify invalid argument error as RTK_INVALID_ARGUMENT', () => {
      const error = {};
      const stderr = 'rtk: invalid argument for flag -n: expected integer';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 2);
      assert.strictEqual(result.type, 'RTK_INVALID_ARGUMENT');
      assert.strictEqual(result.fallback, true);
      assert.ok(result.message.includes('argument'));
    });

    it('should classify RTK panic as RTK_PANIC', () => {
      const error = {};
      const stderr = 'RTK panic: runtime error: index out of range';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 2);
      assert.strictEqual(result.type, 'RTK_PANIC');
      assert.strictEqual(result.fallback, true);
      assert.ok(result.message.includes('panic'));
    });

    it('should classify RTK internal error as RTK_INTERNAL_ERROR', () => {
      const error = {};
      const stderr = 'RTK internal error: database connection failed';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 2);
      assert.strictEqual(result.type, 'RTK_INTERNAL_ERROR');
      assert.strictEqual(result.fallback, true);
      assert.ok(result.message.includes('internal'));
    });

    it('should match RTK errors case-insensitively', () => {
      const error = {};
      const stderr = 'RTK: Unrecognized OPTION --test';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 2);
      assert.strictEqual(result.type, 'RTK_INVALID_OPTION');
    });

    it('should detect RTK errors with mixed case', () => {
      const error = {};
      const stderr = 'Rtk Internal Error: something went wrong';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 2);
    });
  });

  describe('Tier 3: Target Command Errors (fallback: false)', () => {
    it('should classify non-zero exit as COMMAND_ERROR by default', () => {
      const error = { code: 1 };
      const result = ErrorClassifier.classify(error);

      assert.strictEqual(result.tier, 3);
      assert.strictEqual(result.type, 'COMMAND_ERROR');
      assert.strictEqual(result.fallback, false);
      assert.ok(result.message.includes('command'));
    });

    it('should classify errors with unknown codes as COMMAND_ERROR', () => {
      const error = { code: 'UNKNOWN_ERROR' };
      const result = ErrorClassifier.classify(error);

      assert.strictEqual(result.tier, 3);
      assert.strictEqual(result.type, 'COMMAND_ERROR');
      assert.strictEqual(result.fallback, false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null error gracefully', () => {
      const result = ErrorClassifier.classify(null);

      assert.strictEqual(result.tier, 3);
      assert.strictEqual(result.type, 'COMMAND_ERROR');
      assert.strictEqual(result.fallback, false);
    });

    it('should handle undefined error gracefully', () => {
      const result = ErrorClassifier.classify(undefined);

      assert.strictEqual(result.tier, 3);
      assert.strictEqual(result.type, 'COMMAND_ERROR');
    });

    it('should handle empty stderr for Tier 2 detection', () => {
      const error = {};
      const result = ErrorClassifier.classify(error, '');

      assert.strictEqual(result.tier, 3);
      assert.strictEqual(result.type, 'COMMAND_ERROR');
    });

    it('should handle null stderr', () => {
      const error = {};
      const result = ErrorClassifier.classify(error, null);

      assert.strictEqual(result.tier, 3);
      assert.strictEqual(result.type, 'COMMAND_ERROR');
    });

    it('should prioritize Tier 1 over Tier 2', () => {
      const error = { code: 'ENOENT' };
      const stderr = 'rtk: unrecognized option';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 1);
      assert.strictEqual(result.type, 'BINARY_NOT_FOUND');
    });

    it('should provide isRTKProcessingError helper', () => {
      assert.strictEqual(
        ErrorClassifier.isRTKProcessingError('rtk: unrecognized option'),
        true
      );
      assert.strictEqual(
        ErrorClassifier.isRTKProcessingError('normal command output'),
        false
      );
      assert.strictEqual(
        ErrorClassifier.isRTKProcessingError(''),
        false
      );
      assert.strictEqual(
        ErrorClassifier.isRTKProcessingError(null),
        false
      );
    });
  });

  describe('Classification Rules Order', () => {
    it('should check error codes first', () => {
      const error = { code: 'EACCES', message: 'rtk: invalid argument' };
      const result = ErrorClassifier.classify(error);

      assert.strictEqual(result.tier, 1);
      assert.strictEqual(result.type, 'PERMISSION_DENIED');
    });

    it('should check stderr patterns second', () => {
      const error = { code: 0 };
      const stderr = 'RTK internal error: database failure';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 2);
      assert.strictEqual(result.type, 'RTK_INTERNAL_ERROR');
    });

    it('should default to Tier 3 when no patterns match', () => {
      const error = { code: 0 };
      const stderr = 'Normal output from ls command';
      const result = ErrorClassifier.classify(error, stderr);

      assert.strictEqual(result.tier, 3);
      assert.strictEqual(result.type, 'COMMAND_ERROR');
    });
  });
});
