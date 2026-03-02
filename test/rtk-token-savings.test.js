/**
 * RTK Token Savings Verification for Tests
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { RTKExecutor } = require('../server/mcp/tools/rtk-executor.js');

describe('RTK Token Savings for Tests', () => {
  const executor = new RTKExecutor({
    rtkConfig: { enabled: true, binaryPath: 'rtk', timeout: 30000 }
  });

  it('should achieve 85-90% token reduction for a large test suite with many failures', () => {
    // Generate a large test output with 100 failures
    let largeOutput = 'Test Suite Running...\n';
    for (let i = 1; i <= 50; i++) {
      largeOutput += `PASS: test ${i}\n`;
    }
    
    for (let i = 1; i <= 100; i++) {
      largeOutput += `FAIL: failing test ${i}\n`;
      largeOutput += `  at Object.<anonymous> (/path/to/test.js:10:5)\n`;
      largeOutput += `  at Module._compile (node:internal/modules/cjs/loader:1101:14)\n`;
      largeOutput += `  at Object.Module._extensions..js (node:internal/modules/cjs/loader:1153:10)\n`;
      largeOutput += `  at Module.load (node:internal/modules/cjs/loader:981:32)\n`;
      largeOutput += `  at Function.Module._load (node:internal/modules/cjs/loader:822:12)\n`;
      largeOutput += `  at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:81:12)\n`;
      largeOutput += `  at node:internal/main/run_main_module:17:47\n\n`;
    }
    
    largeOutput += 'Test Summary: 50 passed, 100 failed\n';
    
    const nativeChars = largeOutput.length;
    const processedOutput = executor.processTestOutput(largeOutput, '', 1);
    const rtkChars = processedOutput.length;
    
    const reduction = ((nativeChars - rtkChars) / nativeChars) * 100;
    
    console.log(`Native chars: ${nativeChars}`);
    console.log(`RTK chars: ${rtkChars}`);
    console.log(`Reduction: ${reduction.toFixed(2)}%`);
    
    // TEST-05 (85-90% reduction)
    assert.ok(reduction >= 85, `Expected >= 85% reduction, got ${reduction.toFixed(2)}%`);
  });

  it('should achieve high reduction for timeouts', () => {
    let hugeOutput = '';
    for (let i = 1; i <= 1000; i++) {
      hugeOutput += `Infinite loop log line ${i}...\n`;
    }
    
    const nativeChars = hugeOutput.length;
    const processedOutput = executor.processTestOutput(hugeOutput, '', 124); // Timeout
    const rtkChars = processedOutput.length;
    
    const reduction = ((nativeChars - rtkChars) / nativeChars) * 100;
    
    console.log(`Timeout Native chars: ${nativeChars}`);
    console.log(`Timeout RTK chars: ${rtkChars}`);
    console.log(`Timeout Reduction: ${reduction.toFixed(2)}%`);
    
    assert.ok(reduction >= 90, `Expected >= 90% reduction for timeouts, got ${reduction.toFixed(2)}%`);
  });
});
