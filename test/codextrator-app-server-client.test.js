"use strict";

const assert = require("assert");
const {
  decideMcpElicitationResponse,
  hasJsonRpcId
} = require("../src/app-server-client.js");

const heartbeatApproval = {
  threadId: "thread-session-04",
  turnId: "turn-session-04",
  serverName: "auralis-codextrator",
  mode: "form",
  message: "Allow the auralis-codextrator MCP server to run tool \"record_heartbeat\"?",
  meta: {
    codex_approval_kind: "mcp_tool_call"
  },
  requestedSchema: {
    type: "object"
  }
};

let decision = decideMcpElicitationResponse(heartbeatApproval, {
  approveCodextratorMcp: true
});
assert.deepStrictEqual(decision, {
  action: "accept",
  content: {}
});

decision = decideMcpElicitationResponse({
  ...heartbeatApproval,
  message: "Allow the auralis-codextrator MCP server to run tool \"unknown_tool\"?"
}, {
  approveCodextratorMcp: true
});
assert.strictEqual(decision, null);

decision = decideMcpElicitationResponse({
  ...heartbeatApproval,
  serverName: "not-codextrator",
  message: "Allow the not-codextrator MCP server to run tool \"record_heartbeat\"?"
}, {
  approveCodextratorMcp: true
});
assert.strictEqual(decision, null);

decision = decideMcpElicitationResponse(heartbeatApproval, {
  approveCodextratorMcp: false
});
assert.strictEqual(decision, null);

decision = decideMcpElicitationResponse({
  ...heartbeatApproval,
  meta: {
    codex_approval_kind: "other"
  }
}, {
  approveCodextratorMcp: true
});
assert.strictEqual(decision, null);

assert.strictEqual(hasJsonRpcId({ id: 0, method: "mcpServer/elicitation/request" }), true);
assert.strictEqual(hasJsonRpcId({ id: 12, method: "mcpServer/elicitation/request" }), true);
assert.strictEqual(hasJsonRpcId({ method: "turn/completed" }), false);

console.log("codextrator-app-server-client.test.js: PASS");
