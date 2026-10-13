// Gorgon Workbench — Phase B3: SYSTEM-LEVEL E2E (PC-side integration).
//
// Simulates the PHONE side of the loop against a REAL gateway instance:
//   1. create a phone task (real workbench-store, real persistence)
//   2. submit a whitelisted run to the real gateway HTTP API
//   3. poll the run until it finishes (real execution on this machine)
//   4. link the run back to the phone task (linkTaskToAgentRun)
//   5. read the task and verify the linked run + result are findable
//   6. mark the task completed through the state machine
//
// This is PC-side integration evidence ONLY. It does NOT prove a physical
// Android device validated the loop (DEVICE_E2E stays NOT_TESTED).

import test from "node:test";
import assert from "node:assert/strict";

// localStorage shim FIRST (store modules read it at import time in some paths)
const mem = new Map();
if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
}

const { spawn } = await import("node:child_process");
const { setTimeout: sleep } = await import("node:timers/promises");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", ".."); // app/tests -> repo root
const PORT = 8801;

let GW = null;
let TOKEN = "";

async function startGateway() {
  GW = spawn("node", [path.join(REPO, "scripts", "agent-gateway.mjs"), "--port", String(PORT)], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // wait for health
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) {
        const j = await r.json();
        if (j.ok) return j;
      }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("gateway did not start");
}

async function stopGateway() {
  if (GW) { GW.kill("SIGKILL"); GW = null; }
}

async function submitRun(executor, input) {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/runs`, {
    method: "POST",
    headers: { "X-Gorgon-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ executor, input: input || {} }),
  });
  const j = await r.json();
  assert.equal(j.ok, true, "submit ok");
  return j.runId;
}

async function waitRun(runId, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/runs/${runId}`, {
      headers: { "X-Gorgon-Token": TOKEN },
    });
    const j = await r.json();
    if (j.ok && (j.run.status === "completed" || j.run.status === "failed" || j.run.status === "timed_out" || j.run.status === "cancelled")) {
      return j.run;
    }
    await sleep(300);
  }
  throw new Error("run did not finish in time");
}

test("B3 SYSTEM E2E: task -> gateway run -> result -> link back -> complete", async (t) => {
  // start the REAL gateway
  const h = await startGateway();
  t.after(() => stopGateway());
  assert.equal(h.ok, true);

  // read the pairing token from the gateway state dir (as the phone user pastes it)
  const fs = await import("node:fs");
  const tokenPath = path.join(REPO, "scripts", ".agent-gateway", "token.json");
  TOKEN = JSON.parse(fs.readFileSync(tokenPath, "utf8")).token;
  assert.ok(TOKEN.length >= 32);

  // 1. create a REAL phone task (workbench-store + task-repository)
  const { addTask, linkTaskToAgentRun, getTask, tryTransitionTask, getTasks } = await import(
    "../src/store/workbench-store.js"
  );
  addTask("检查 Gorgon 仓库当前状态");
  const taskId = getTasks()[0].id;
  assert.ok(taskId);

  // 2. submit a whitelisted run to the REAL gateway
  const runId = await submitRun("repo.status", {});

  // 3. wait for real execution
  const run = await waitRun(runId);
  assert.equal(run.status, "completed", "real run completed");
  assert.ok(run.result && run.result.summary, "real structured result");
  assert.ok(String(run.result.output).includes("feature/gorgon-opportunity-v2"), "output contains real branch");

  // 4. link the run back to the phone task
  const linked = linkTaskToAgentRun(taskId, runId, {
    executor: run.executor,
    summary: run.result.summary,
  });
  assert.ok(linked, "link returns updated task");
  assert.deepEqual(linked.agentRunIds, [runId]);

  // 5. re-read from persistence: the task can find its run record
  const back = getTask(taskId);
  assert.deepEqual(back.agentRunIds, [runId], "persisted link");
  const ev = back.timeline.filter((e) => e.type === "agent_run_linked");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].metadata.runId, runId);
  assert.equal(ev[0].metadata.executor, "repo.status");

  // 6. mark the task completed through the REAL state machine
  //    created -> ready -> running -> completed (legal path)
  assert.ok(tryTransitionTask(taskId, "ready"), "created->ready");
  assert.ok(tryTransitionTask(taskId, "running"), "ready->running");
  assert.ok(tryTransitionTask(taskId, "completed"), "running->completed");
  const done = getTask(taskId);
  assert.equal(done.status, "completed");
  assert.deepEqual(done.agentRunIds, [runId], "link survives completion");
});

test("B3 SYSTEM E2E: gateway rejects bad token over real HTTP", async (t) => {
  await startGateway();
  t.after(() => stopGateway());
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/executors`, {
    headers: { "X-Gorgon-Token": "not-the-real-token-aaaaaaaaaaaaaaaa" },
  });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.ok, false);
});
