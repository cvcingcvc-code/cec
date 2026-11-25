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
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GW_SCRIPT = path.join(REPO, "scripts", "agent-gateway.mjs");
const TEST_ROOT = path.join(REPO, "work", "gateway-lifecycle");

// WorkBuddy sandbox shim compatibility: the host's node-safe-delete-shim
// may turn a bulk rmSync into SAFE_DELETE_BULK_CONFIRM_REQUIRED (>=50
// deletions in one turn). Scratch state dirs are disposable, so cleanup
// is best-effort here — never a test failure.
function rmSyncBestEffort(target, options) {
  try {
    fs.rmSync(target, options);
  } catch (error) {
    if (String(error && error.message || error).includes("SAFE_DELETE")) return;
    throw error;
  }
}

function pickPort() {
  // 20000–39999, unprivileged range; collision chance across 6 tests is
  // negligible, and each test picks FRESH ports for every gateway start.
  return 20000 + Math.floor(Math.random() * 20000);
}

function mkStateDir() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TEST_ROOT, "state-"));
}

async function stopGateway(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" });
      killer.once("error", resolve);
      killer.once("close", resolve);
    });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
  if (child.exitCode === null) await new Promise((resolve) => child.once("close", resolve));
}

function cleanStateDir(stateDir) {
  const relative = path.relative(TEST_ROOT, stateDir);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  rmSyncBestEffort(stateDir, { recursive: true, force: true });
}

async function childPid(stateDir) {
  const file = path.join(stateDir, "child.pid");
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(file)) return Number(fs.readFileSync(file, "utf8"));
    await sleep(20);
  }
  throw new Error("executor child did not start");
}

async function assertChildExited(pid) {
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await sleep(50);
  }
  assert.fail(`controlled executor child ${pid} did not exit`);
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
      'import fs from "node:fs";',
      'import path from "node:path";',
      "export default {",
      '  "slow.success": {',
      '    description: "test: sleeps 3s then ok",',
      "    input: {},",
      '    run() { return new Promise((r) => setTimeout(() => r({ summary: "slow ok", output: "done" }), 3000)); },',
      "  },",
      '  "slow.late": {',
      '    description: "test: completes after its short timeout", input: {}, timeoutMs: 500,',
      '    run() { return new Promise((r) => setTimeout(() => r({ summary: "late success" }), 1500)); },',
      "  },",
      '  "slow.never": {',
      '    description: "test: sleeps forever (timeout target)",',
      "    input: {},",
      "    timeoutMs: 2000,",
      "    async run(_input, ctx) {",
      '      const { spawn: sp } = await import("node:child_process");',
      '      const child = sp(process.execPath, ["-e", "setTimeout(()=>{},120000)"], { shell: false, windowsHide: true, detached: process.platform !== "win32" });',
      '      if (ctx && typeof ctx.setCancellable === "function") ctx.setCancellable(child);',
      '      fs.writeFileSync(path.join(process.env.GORGON_GATEWAY_STATE_DIR, "child.pid"), String(child.pid));',
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
      NODE_ENV: "test",
      GORGON_GATEWAY_TEST_MODE: "1",
      GORGON_GATEWAY_STATE_DIR: stateDir,
      GORGON_GATEWAY_EXTRA_EXECUTORS_FILE: extraExecutorsPatch(stateDir),
    }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  // Drain stdout without logging the pairing token emitted by the gateway.
  child.stdout.resume();
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
  await stopGateway(child);
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
    const sub = await api(port, token, "POST", "/v1/runs", { executor: "slow.late", input: {} });
    assert.ok(sub.ok && sub.runId, "submit ok");
    const run = await waitStatus(port, token, sub.runId, ["timed_out"], 10000);
    assert.equal(run.status, "timed_out");
    assert.match(run.error, /500ms/, "the executor's shorter timeout must be honored");
    // poll a bit longer — the late promise must NOT flip it to completed
    await sleep(2500);
    const after = await api(port, token, "GET", `/v1/runs/${sub.runId}`);
    assert.equal(after.run.status, "timed_out", "timed_out must be terminal");
  } finally {
    await stopGateway(g.child);
    cleanStateDir(stateDir);
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
    await stopGateway(g.child);
    cleanStateDir(stateDir);
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
    await stopGateway(g.child);
    cleanStateDir(stateDir);
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
    await stopGateway(g.child);
    cleanStateDir(stateDir);
  }
});

test("P0 lifecycle: timeout kills the spawned child process tree", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  try {
    const sub = await api(port, token, "POST", "/v1/runs", { executor: "slow.never", input: {} });
    const pid = await childPid(stateDir);
    const run = await waitStatus(port, token, sub.runId, ["timed_out"], 90000);
    assert.equal(run.status, "timed_out");
    await assertChildExited(pid);
    // the gateway must still be healthy — no orphan crash
    const h = await fetch(`http://127.0.0.1:${port}/health`);
    assert.ok(h.ok, "gateway healthy after tree-kill");
  } finally {
    await stopGateway(g.child);
    cleanStateDir(stateDir);
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
  await stopGateway(g1.child);
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
    if (g2) await stopGateway(g2.child);
    cleanStateDir(stateDir);
  }
});

test("P0 lifecycle: cancel kills a running child before its timeout", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  try {
    const sub = await api(port, token, "POST", "/v1/runs", { executor: "slow.never", input: {} });
    const pid = await childPid(stateDir);
    const running = await api(port, token, "GET", `/v1/runs/${sub.runId}`);
    assert.equal(running.run.status, "running");
    const cancelled = await api(port, token, "POST", `/v1/runs/${sub.runId}/cancel`);
    assert.equal(cancelled.status, "cancelled", "cancel must finalize immediately");
    await assertChildExited(pid);
    const after = await api(port, token, "GET", `/v1/runs/${sub.runId}`);
    assert.equal(after.run.status, "cancelled");
    assert.ok((await fetch(`http://127.0.0.1:${port}/health`)).ok);
  } finally {
    await stopGateway(g.child);
    cleanStateDir(stateDir);
  }
});

test("P0 lifecycle: a late result cannot release another running executor's slot", async () => {
  const port = pickPort();
  const stateDir = mkStateDir();
  const g = await startGateway(stateDir, port);
  const token = readToken(stateDir);
  try {
    const first = await api(port, token, "POST", "/v1/runs", { executor: "slow.late", input: {} });
    const second = await api(port, token, "POST", "/v1/runs", { executor: "slow.success", input: {} });
    await waitStatus(port, token, first.runId, ["timed_out"], 10000);
    const third = await api(port, token, "POST", "/v1/runs", { executor: "sync.crash", input: {} });
    await sleep(1500); // first's late promise has resolved; second is still running
    assert.equal((await api(port, token, "GET", `/v1/runs/${second.runId}`)).run.status, "running");
    assert.equal((await api(port, token, "GET", `/v1/runs/${third.runId}`)).run.status, "queued");
    await waitStatus(port, token, second.runId, ["completed"], 10000);
    await waitStatus(port, token, third.runId, ["failed"], 10000);
  } finally {
    await stopGateway(g.child);
    cleanStateDir(stateDir);
  }
});
