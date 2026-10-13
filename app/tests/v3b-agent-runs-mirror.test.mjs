// Gorgon Workbench — Phase B3: agent-runs-mirror tests.
//
// The mirror lets TaskDetail show「电脑执行记录」even when the phone is
// offline: pasted/refreshed gateway runs are stored in localStorage (sanitized
// subset, no secrets) and read back per task agentRunIds.

import test from "node:test";
import assert from "node:assert/strict";

// localStorage shim FIRST
const mem = new Map();
if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
}

const { readRunsMirror, readAgentRunsMirror, importRunsMirror, clearRunsMirror } = await import(
  "../src/lib/agent-runs-mirror.js"
);

const RUN_A = {
  runId: "run_aaa",
  executor: "repo.status",
  status: "completed",
  createdAt: "2026-10-13T07:00:00.000Z",
  finishedAt: "2026-10-13T07:00:01.000Z",
  summary: "git status (porcelain+b)",
  result: { summary: "git status (porcelain+b)", output: "## feature/gorgon-opportunity-v2" },
  // pairing-token-like field must be stripped
  token: "should-not-be-stored-1234567890abcdef",
};

test("mirror: import runs.json format ({runs:[...]})", () => {
  const n = importRunsMirror(JSON.stringify({ runs: [RUN_A] }));
  assert.equal(n, 1);
  const all = readRunsMirror();
  assert.equal(all.length, 1);
  assert.equal(all[0].runId, "run_aaa");
  assert.equal(all[0].status, "completed");
  assert.equal(all[0].outputText, "## feature/gorgon-opportunity-v2");
  assert.ok(!("token" in all[0]), "secret-like fields stripped");
  assert.ok(!JSON.stringify(all).includes("should-not-be-stored"), "no secret in stored JSON");
});

test("mirror: import bare array format", () => {
  clearRunsMirror();
  const n = importRunsMirror(JSON.stringify([RUN_A]));
  assert.equal(n, 1);
  assert.equal(readRunsMirror().length, 1);
});

test("mirror: readAgentRunsMirror filters by task agentRunIds", () => {
  clearRunsMirror();
  const runB = { ...RUN_A, runId: "run_bbb", status: "failed", error: "path not allowed" };
  importRunsMirror(JSON.stringify({ runs: [RUN_A, runB] }));
  const linked = readAgentRunsMirror(["run_bbb"]);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].runId, "run_bbb");
  assert.equal(linked[0].error, "path not allowed");
  assert.deepEqual(readAgentRunsMirror([]), [], "empty ids = []");
  assert.deepEqual(readAgentRunsMirror(["run_missing"]), [], "missing id filtered out");
});

test("mirror: upsert never loses old records", () => {
  clearRunsMirror();
  importRunsMirror(JSON.stringify({ runs: [RUN_A] }));
  const runC = { ...RUN_A, runId: "run_ccc" };
  importRunsMirror(JSON.stringify({ runs: [runC] }));
  const all = readRunsMirror();
  const ids = all.map((r) => r.runId).sort();
  assert.deepEqual(ids, ["run_aaa", "run_ccc"], "old record kept, new added");
});

test("mirror: corrupt input returns -1, mirror untouched", () => {
  clearRunsMirror();
  importRunsMirror(JSON.stringify({ runs: [RUN_A] }));
  assert.equal(importRunsMirror("{bad json"), -1);
  assert.equal(importRunsMirror('{"nope": true}'), -1);
  assert.equal(readRunsMirror().length, 1, "mirror unchanged after bad input");
});

test("mirror: sanitize object output (host.stats dict form)", () => {
  clearRunsMirror();
  const hostRun = {
    runId: "run_host",
    executor: "host.stats",
    status: "completed",
    createdAt: "2026-10-13T07:10:00.000Z",
    result: { summary: "host overview", output: { platform: "win32", cpuCount: 12 } },
  };
  importRunsMirror(JSON.stringify({ runs: [hostRun] }));
  const all = readRunsMirror();
  assert.equal(all[0].runId, "run_host");
  assert.ok(all[0].outputText.includes("win32"), "object output serialized to text");
});
