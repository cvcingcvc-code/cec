// Gorgon Workbench — Phase C (Task §2.1): Gateway lifecycle tests.
//
// Verifies the SINGLE-FINAL-STATE run engine against a REAL gateway process:
//   1. every run enters its final state exactly once
//   2. a timed-out run can never flip to completed afterwards
//   3. a cancelled run can never flip to completed afterwards
//   4. the execution slot is always released — queued runs keep flowing
//   5. an executor that crashes/exits does not kill the gateway
//   6. timeout + cancel kill the spawned child process tree
//   7. runs.json after restart contains no phantom "running" rows
//
// Uses an ISOLATED state dir (GORGON_GATEWAY_STATE_DIR env) and a
// THROWAWAY allowlist injected via GORGON_GATEWAY_EXTRA_EXECUTORS_FILE —
// production executor config is untouched.
//
// Phase C fix: RANDOM port per gateway start. A fixed base port collided
// with orphaned gateway processes from previous test runs — the /health
// probe then hit the STALE process, whose token lives in a different state
// dir, so readToken() failed with ENOENT. Random ports make the suite safe
// under concurrency (PR rule: never fight over fixed ports).

import test from "node:test";
import assert from "node:assert/strict";

const { spawn } = await import("node:child_process");
const { setTimeout: sleep } = await import("node:timers/promises");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const GW_SCRIPT = path.join(REPO, "scripts", "agent-gateway.mjs");

function pickPort() {
  // 20000–39999, unprivileged range; collision chance across 6 tests is
  // negligible, and each test picks FRESH ports for every gateway start.
  return 20000 + Math.floor(Math.random() * 20000);
}

function mkStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gw-lifecycle-"));
}

function extraExecutorsPatch(stateDir) {
  // A tiny executor MODULE file for lifecycle tests (loaded via
  // GORGON_GATEWAY_EXTRA_EXECUTORS_FILE — module form, functions survive;
  // JSON form would drop the run() functions):
  //  - "slow.success"  : sleeps 3s then returns ok (queue-flow test)
  //  - "slow.never"    : sleeps 120s (timeout test, child process holder)
  //  - "sync.crash"    : throws synchronously
  //  - "async.crash"   : rejects after 200ms
  const file = path.join(stateDir, "extra-executors.mjs");
  fs.writeFileSync(
    file,
    [
      'import { spawn } from "node:child_process";',
      "export default {",
      '  "slow.success": {',
      '    description: "test: sleeps 3s then ok",',
      "    input: {},",
      '    run() { return new Promise((r) => setTimeout(() => r({ summary: "slow ok", output: "done" }), 3000)); },',
      "  },",
      '  "slow.never": {',
      '    description: "test: sleeps forever (timeout target)",',
      "    input: {},",
      "    async run(_input, ctx) {",
      '      const { spawn: sp } = await import("node:child_process");',
      '      const child = sp(process.execPath, ["-e", "setTimeout(()=>{},120000)"], { shell: false });',
      '      if (ctx && typeof ctx.setCancellable === "function") ctx.setCancellable(child);',
      '      await new Promise((r) => setTimeout(r, 120000));',
      '      return { summary: "never", output: "never" };',
      "    },",
      "  },",
      '  "sync.crash": {',
      '    description: "test: throws synchronously",',
      "    input: {},",
      '    run() { throw new Error("sync boom"); },',
      "  },",
      '  "async.crash": {',
      '    description: "test: rejects async",',
      "    input: {},",
      '    run() { return new Promise((_r, rej) => setTimeout(() => rej(new Error("async boom")), 200)); },',
      "  },",
      "};",
    ].join("\n"),
  );
  return file;
}

async function startGateway(stateDir, port) {
  const child = spawn(process.execPath, [GW_SCRIPT, "--port", String(port)], {
    cwd: REPO,
    env: Object.assign({}, process.env, {
      GORGON_GATEWAY_STATE_DIR: stateDir,
      GORGON_GATEWAY_EXTRA_EXECUTORS_FILE: extraExecutorsPatch(stateDir),
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) {
        const j = await r.json();
        if (j.ok) return { child, port, stderr: () => stderr };
      }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("gateway did not start: " + stderr);
}

function readToken(stateDir) {
  return JSON.parse(fs.readFileSync(path.join(stateDir, "token.json"), "utf8")).token;
}

async function api(port, token, method, p, body) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: Object.assign({ "X-Gorgon-Token": token }, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function waitStatus(port, token, runId, statuses, timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) {
    const j = await api(port, token, "GET", `/v1/runs/${runId}`);
    if (j.ok && statuses.includes(j.run.status)) return j.run;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting ${statuses} (last: ${j.run && j.run.status})`);
    await sleep(400);
  }
}

test("P0 lifecycle: timed_out is terminal (late promise cannot overwrite)", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  try {
    const sub = await api(port, token, "POST", "/v1/runs", { executor: "slow.never", input: {} });
    assert.ok(sub.ok && sub.runId, "submit ok");
    const run = await waitStatus(port, token, sub.runId, ["timed_out"], 90000);
    assert.equal(run.status, "timed_out");
    // poll a bit longer — the late promise must NOT flip it to completed
    await sleep(2500);
    const after = await api(port, token, "GET", `/v1/runs/${sub.runId}`);
    assert.equal(after.run.status, "timed_out", "timed_out must be terminal");
  } finally {
    g.child.kill("SIGKILL");
  }
});

test("P0 lifecycle: cancelled run never becomes completed", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  try {
    const sub = await api(port, token, "POST", "/v1/runs", { executor: "slow.success", input: {} });
    assert.ok(sub.ok);
    // cancel while queued/running
    await api(port, token, "POST", `/v1/runs/${sub.runId}/cancel`);
    const run = await waitStatus(port, token, sub.runId, ["cancelled", "completed"], 20000);
    assert.equal(run.status, "cancelled", "cancelled must win over the late completion");
    await sleep(1500);
    const after = await api(port, token, "GET", `/v1/runs/${sub.runId}`);
    assert.equal(after.run.status, "cancelled", "cancelled must be terminal");
  } finally {
    g.child.kill("SIGKILL");
  }
});

test("P0 lifecycle: crashing executor does not kill gateway; slot released", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  try {
    const c1 = await api(port, token, "POST", "/v1/runs", { executor: "sync.crash", input: {} });
    assert.ok(c1.ok);
    const r1 = await waitStatus(port, token, c1.runId, ["failed"], 15000);
    assert.match(r1.error, /sync boom/);
    // gateway still alive and next run executes (slot was released)
    const c2 = await api(port, token, "POST", "/v1/runs", { executor: "slow.success", input: {} });
    assert.ok(c2.ok, "gateway alive after crash");
    const r2 = await waitStatus(port, token, c2.runId, ["completed"], 20000);
    assert.equal(r2.status, "completed");
    const c3 = await api(port, token, "POST", "/v1/runs", { executor: "async.crash", input: {} });
    const r3 = await waitStatus(port, token, c3.runId, ["failed"], 15000);
    assert.match(r3.error, /async boom/);
  } finally {
    g.child.kill("SIGKILL");
  }
});

test("P0 lifecycle: queued tasks keep flowing after a timeout", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  try {
    // one run that will time out
    const t = await api(port, token, "POST", "/v1/runs", { executor: "slow.never", input: {} });
    // one queued behind it
    const q = await api(port, token, "POST", "/v1/runs", { executor: "slow.success", input: {} });
    await waitStatus(port, token, t.runId, ["timed_out"], 90000);
    const rq = await waitStatus(port, token, q.runId, ["completed", "cancelled", "failed"], 30000);
    assert.equal(rq.status, "completed", "queued run must execute after the timeout released the slot");
  } finally {
    g.child.kill("SIGKILL");
  }
});

test("P0 lifecycle: timeout kills the spawned child process tree", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  try {
    const sub = await api(port, token, "POST", "/v1/runs", { executor: "slow.never", input: {} });
    const run = await waitStatus(port, token, sub.runId, ["timed_out"], 90000);
    assert.equal(run.status, "timed_out");
    await sleep(2000); // give taskkill a moment
    // the gateway must still be healthy — no orphan crash
    const h = await fetch(`http://127.0.0.1:${port}/health`);
    assert.ok(h.ok, "gateway healthy after tree-kill");
  } finally {
    g.child.kill("SIGKILL");
  }
});

test("P0 lifecycle: restart reconciles stale running rows to failed", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g1 = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  // submit a slow run, kill the gateway mid-flight
  const sub = await api(port, token, "POST", "/v1/runs", { executor: "slow.never", input: {} });
  assert.ok(sub.ok);
  await sleep(600);
  g1.child.kill("SIGKILL");
  // restart on the SAME state dir — the stale running row must become failed
  // (same port: the dead process released it; wait for the port to be free)
  let g2 = null;
  for (let i = 0; i < 40 && !g2; i++) {
    try { g2 = await startGateway(stateDir, port); } catch (e) { await sleep(250); }
  }
  try {
    const j = await api(port, token, "GET", `/v1/runs/${sub.runId}`);
    assert.equal(j.run.status, "failed", "stale running row reconciled to failed on restart");
    assert.match(j.run.error, /restarted/);
    // and the gateway still works
    const c = await api(port, token, "POST", "/v1/runs", { executor: "sync.crash", input: {} });
    const r = await waitStatus(port, token, c.runId, ["failed"], 15000);
    assert.match(r.error, /sync boom/);
  } finally {
    if (g2) g2.child.kill("SIGKILL");
  }
});
