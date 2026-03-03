/**
 * MCP Tools Registry Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getAllTools, getToolDefinition } = require('../server/mcp/mcp-tools.js');
const { TOOLS, SCHEMAS } = require('../shared/protocol.js');

describe('MCP Tools Registry', () => {
  it('should have contextfs.summarize in the tools list', () => {
    const tools = getAllTools();
    const summarize = tools.find(t => t.name === 'contextfs.summarize');
    assert.ok(summarize, 'contextfs.summarize not found in tools list');
    assert.strictEqual(summarize.description.includes('intelligent summary'), true);
  });

  it('should have largeFileFilter in contextfs.read schema', () => {
    const read = getToolDefinition('contextfs.read');
    assert.ok(read.inputSchema.properties.largeFileFilter, 'largeFileFilter missing from read tool definition');
    
    // Check shared protocol schema too
    assert.ok(SCHEMAS['contextfs.read'].properties.largeFileFilter, 'largeFileFilter missing from shared protocol schema');
  });

  it('should have contextfs.summarize in shared protocol TOOLS', () => {
    assert.strictEqual(TOOLS.SUMMARIZE, 'contextfs.summarize');
    assert.ok(SCHEMAS[TOOLS.SUMMARIZE], 'contextfs.summarize schema missing from shared protocol');
  });
});
