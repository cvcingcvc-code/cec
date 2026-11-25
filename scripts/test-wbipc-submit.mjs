import { workbuddyAdapter } from "../scripts/agent-adapters/workbuddy-adapter.mjs";

const log = (label, obj) => console.log(`\n=== ${label} ===\n` + JSON.stringify(obj, null, 2).slice(0, 900));

// 1. discover
const d = await workbuddyAdapter.discover();
log("discover", d);

// 2. submitTask: describe_ipc
const r1 = await workbuddyAdapter.submitTask({ operation: "describe_ipc" });
log("submitTask describe_ipc", r1);

// 3. submitTask: read_accounts
const r2 = await workbuddyAdapter.submitTask({ operation: "read_accounts" });
log("submitTask read_accounts", r2);

// 4. submitTask: read_profile
const r3 = await workbuddyAdapter.submitTask({ operation: "read_profile" });
log("submitTask read_profile (excerpt)", { ok: r3.ok, status: r3.status, summary: (r3.summary || r3.error || "").slice(0, 300) });

// 5. submitTask: list_cloud_agents
const r4 = await workbuddyAdapter.submitTask({ operation: "list_cloud_agents" });
log("submitTask list_cloud_agents", r4);

// 6. submitTask: unsupported operation (must BLOCK, not simulate)
const r5 = await workbuddyAdapter.submitTask({ operation: "send_message", params: { text: "hello" } });
log("submitTask send_message (must be BLOCKED)", r5);
if (r5.ok !== false || r5.status !== "BLOCKED_UNSUPPORTED_OPERATION") {
  console.log("\n*** FAIL: unsupported op did not return BLOCKED_UNSUPPORTED_OPERATION ***");
  process.exit(1);
}

// 7. submitTask: missing operation
const r6 = await workbuddyAdapter.submitTask({});
log("submitTask {} (must be BLOCKED)", r6);

console.log("\nALL SUBMIT-TASK CHECKS DONE");
