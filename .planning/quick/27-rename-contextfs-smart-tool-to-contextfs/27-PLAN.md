---
phase: quick/27-rename-contextfs-smart-tool-to-contextfs
plan: 27
type: execute
wave: 1
depends_on: []
files_modified:
  - shared/protocol.js
  - server/mcp/mcp-tools.js
  - server/mcp/mcp-server.js
  - server/mcp/tools/rtk-executor.js
  - README.md
  - docs/docs.html
  - test/mcp-tools-registry.test.js
  - test/rtk-compact.test.js
  - test/rtk-read.test.js
autonomous: true
requirements:
  - TOOL-RENAME-01
must_haves:
  truths:
    - "The tool contextfs.summarize is available and functional"
    - "The tool contextfs.smart no longer exists"
  artifacts:
    - path: "shared/protocol.js"
      provides: "Updated protocol constants"
    - path: "server/mcp/tools/rtk-executor.js"
      provides: "Renamed summarization logic"
  key_links:
    - from: "shared/protocol.js"
      to: "server/mcp/mcp-tools.js"
      via: "protocol constants"
---

<objective>
Rename the `contextfs.smart` tool to `contextfs.summarize` across the entire codebase for better clarity and alignment with its function.
</objective>

<execution_context>
@./.opencode/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@shared/protocol.js
@server/mcp/mcp-tools.js
@server/mcp/mcp-server.js
@server/mcp/tools/rtk-executor.js
@README.md
@docs/docs.html
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rename tool in Protocol and Registry</name>
  <files>
    - shared/protocol.js
    - server/mcp/mcp-tools.js
    - server/mcp/mcp-server.js
  </files>
  <action>
    1. In `shared/protocol.js`:
       - Rename `TOOLS.SMART` to `TOOLS.SUMMARIZE` and its value to `'contextfs.summarize'`.
       - Update the `SCHEMAS` key from `[TOOLS.SMART]` to `[TOOLS.SUMMARIZE]`.
    2. In `server/mcp/mcp-tools.js`:
       - Update the tool definition `name` from `'contextfs.smart'` to `'contextfs.summarize'`.
    3. In `server/mcp/mcp-server.js`:
       - Verify if any explicit tool handlers or capability advertisements need updating (though grep suggests it's mostly generic dispatch).
  </action>
  <verify>
    node -e "const { TOOLS } = require('./shared/protocol.js'); console.assert(TOOLS.SUMMARIZE === 'contextfs.summarize')"
    node -e "const { getAllTools } = require('./server/mcp/mcp-tools.js'); console.assert(getAllTools().some(t => t.name === 'contextfs.summarize'))"
  </verify>
  <done>
    The tool is registered as 'contextfs.summarize' in the protocol and MCP registry.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update RTKExecutor implementation</name>
  <files>
    - server/mcp/tools/rtk-executor.js
  </files>
  <action>
    1. In `server/mcp/tools/rtk-executor.js`:
       - Rename `'smart'` to `'summarize'` in the `ALLOWLIST` constant.
       - In the `execute` method, change the check for `command === 'smart'` to `command === 'summarize'`.
       - Update the call to `this.executeSmart(args, options)` to `this.executeSummarize(args, options)`.
       - Rename the `executeSmart` method to `executeSummarize`.
       - In `mapToRTKArgs`, update the mapping from `'smart'` to `'summarize'`.
       - Update any internal error messages or logs referencing 'smart tool'.
  </action>
  <verify>
    grep "summarize" server/mcp/tools/rtk-executor.js
    grep -v "smart" server/mcp/tools/rtk-executor.js | grep "summarize"
  </verify>
  <done>
    RTKExecutor logic uses 'summarize' instead of 'smart'.
  </done>
</task>

<task type="auto">
  <name>Task 3: Update Tests and Documentation</name>
  <files>
    - README.md
    - docs/docs.html
    - test/mcp-tools-registry.test.js
    - test/rtk-compact.test.js
    - test/rtk-read.test.js
  </files>
  <action>
    1. Update `README.md` and `docs/docs.html`:
       - Replace all occurrences of `contextfs.smart` with `contextfs.summarize`.
    2. Update `test/mcp-tools-registry.test.js`:
       - Change test descriptions and expectations to use `contextfs.summarize` and `TOOLS.SUMMARIZE`.
    3. Update `test/rtk-compact.test.js`:
       - Update any mock data or strings referencing `contextfs.smart`.
    4. Update `test/rtk-read.test.js`:
       - Rename "Smart Tool Logic" section to "Summarize Tool Logic".
       - Update `mapToRTKArgs` tests to use `'summarize'`.
       - Rename `executeSmart` tests to `executeSummarize`.
    5. Run all tests to ensure they pass.
  </action>
  <verify>
    npm test test/mcp-tools-registry.test.js test/rtk-compact.test.js test/rtk-read.test.js
  </verify>
  <done>
    All documentation and tests are updated and passing.
  </done>
</task>

</tasks>

<success_criteria>
- No occurrences of `contextfs.smart` remain in the active codebase (excluding git logs).
- The `contextfs.summarize` tool is correctly registered and functional.
- Documentation accurately reflects the new tool name.
- All related tests pass.
</success_criteria>

<output>
After completion, create `.planning/quick/27-rename-contextfs-smart-tool-to-contextfs/27-SUMMARY.md`
</output>
