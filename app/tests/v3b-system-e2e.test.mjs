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

const { spawn, execFileSync } = await import("node:child_process");
const { setTimeout: sleep } = await import("node:timers/promises");
const fs = await import("node:fs");
const net = await import("node:net");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", ".."); // app/tests -> repo root
const WORK = path.join(REPO, "work");
const BRANCH = execFileSync("git", ["branch", "--show-current"], { cwd: REPO, encoding: "utf8" }).trim();

let GW = null;
let TOKEN = "";
let PORT = null;
let STATE_DIR = null;

async function pickPort() {
  // The gateway does not accept port 0. Ask the OS for a free ephemeral
  // port, then verify this child actually listens before polling its API.
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close((err) => err ? reject(err) : resolve()));
  assert.notEqual(port, 8765, "test never uses the user's gateway port");
  return port;
}

async function startGateway() {
  PORT = await pickPort();
  fs.mkdirSync(WORK, { recursive: true });
  STATE_DIR = fs.mkdtempSync(path.join(WORK, "gw-system-e2e-"));
  GW = spawn(process.execPath, [path.join(REPO, "scripts", "agent-gateway.mjs"), "--port", String(PORT)], {
    cwd: REPO,
    env: {
      ...process.env,
      GORGON_GATEWAY_STATE_DIR: STATE_DIR,
      GORGON_GATEWAY_EXTRA_EXECUTORS: "",
      GORGON_GATEWAY_EXTRA_EXECUTORS_FILE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let listening = false;
  let stdout = "";
  let stderr = "";
  let spawnError = null;
  GW.on("error", (err) => { spawnError = err; });
  GW.stdout.on("data", (data) => {
    stdout += data;
    listening = stdout.includes(`listening on 127.0.0.1:${PORT}`);
  });
  GW.stderr.on("data", (data) => { stderr += data; });
  // wait for health
  for (let i = 0; i < 40; i++) {
    if (spawnError) throw spawnError;
    if (GW.exitCode !== null) throw new Error(`gateway exited: ${GW.exitCode}: ${stderr}`);
    try {
      if (!listening) { await sleep(250); continue; }
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) {
        const j = await r.json();
        if (j.ok) return j;
      }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("gateway did not start: " + stderr);
}

async function stopGateway() {
  if (GW) {
    const child = GW;
    GW = null;
    if (child.pid && child.exitCode === null) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      if (process.platform === "win32") {
        // Include the gateway's own version-probe/git children in cleanup.
        // V3H: taskkill fails when the child already exited on its own
        // (exit race between the last poll and this cleanup) — that race
        // means the process is gone, which is exactly what cleanup wants,
        // so a taskkill failure here is non-fatal (flaky hook fix).
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } catch {
          /* child already exited — nothing to kill */
        }
      } else {
        child.kill("SIGKILL");
      }
      await closed;
    }
  }
  if (STATE_DIR) {
    assert.ok(STATE_DIR.startsWith(WORK + path.sep), "cleanup stays inside this worktree's work directory");
    fs.rmSync(STATE_DIR, { recursive: true, force: true });
    STATE_DIR = null;
  }
  TOKEN = "";
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
  t.after(() => stopGateway());
  const h = await startGateway();
  assert.equal(h.ok, true);

  // read the pairing token from the gateway state dir (as the phone user pastes it)
  const tokenPath = path.join(STATE_DIR, "token.json");
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
  assert.ok(BRANCH && String(run.result.output).includes(BRANCH), "output contains this worktree's real branch");

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
  t.after(() => stopGateway());
  await startGateway();
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/executors`, {
    headers: { "X-Gorgon-Token": "not-the-real-token-aaaaaaaaaaaaaaaa" },
  });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.ok, false);
});
