import test from "node:test";
import assert from "node:assert/strict";
import { workbuddyAdapter } from "../../scripts/agent-adapters/workbuddy-adapter.mjs";

test("V3L submitTask rejects unsupported operations with BLOCKED, never simulates", async () => {
  const r = await workbuddyAdapter.submitTask({ operation: "send_message", params: { text: "hi" } });
  assert.equal(r.ok, false);
  assert.equal(r.status, "BLOCKED_UNSUPPORTED_OPERATION");
  assert.match(r.error, /send_message/);
  assert.match(r.error, /只读/);
});

test("V3L submitTask rejects empty operation", async () => {
  const r = await workbuddyAdapter.submitTask({});
  assert.equal(r.ok, false);
  assert.equal(r.status, "BLOCKED_UNSUPPORTED_OPERATION");
});

test("V3L SUBMIT_OPERATIONS allowlist is read-only: no send/write verbs", () => {
  const ops = Object.keys(workbuddyAdapter.SUBMIT_OPERATIONS);
  assert.ok(ops.includes("read_accounts"));
  assert.ok(ops.includes("read_profile"));
  assert.ok(ops.includes("list_cloud_agents"));
  assert.ok(ops.includes("describe_ipc"));
  for (const op of ops) {
    assert.doesNotMatch(op, /send|write|create|delete|update|post|cancel|submit/i, `operation ${op} must be read-only by name`);
  }
});
