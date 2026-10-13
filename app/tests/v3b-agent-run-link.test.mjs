// Gorgon Workbench — Phase B3: task ↔ PC agent-run link tests.
//
// Covers the phone↔PC loop closing feature:
//   * linkTaskToAgentRun — additive agentRunIds on the task, idempotent,
//     refuses empty/unknown runIds, records a timeline event.
//   * getTaskAgentRunIds — defensive reads (old records normalize to []).
//   * normalizeTask backward compat — pre-B3 tasks (no agentRunIds) load
//     unchanged with agentRunIds=[].

import test from "node:test";
import assert from "node:assert/strict";

import {
  createTask,
  normalizeTask,
  AGENT_EVENT_TYPES,
} from "../src/workbench/task-model.js";

// ── localStorage shim (pure-node environment) ─────────────────────────
// The repository reads/writes through a small storage shim; provide a
// minimal in-memory localStorage so tests run without a browser.

const mem = new Map();
if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
}

const { linkTaskToAgentRun, getTaskAgentRunIds } = await import(
  "../src/store/workbench-store.js"
);

function freshTask(title) {
  const t = createTask(title || "准备下午的面试");
  // normalize through the repository path so ids/persistence behave the same
  return t;
}

test("B3: linkTaskToAgentRun appends runId + timeline event", () => {
  const t = freshTask("准备下午的面试");
  // write the task into the repo envelope first (link works on stored tasks)
  const { createTaskEntry, getTask } = require_repo();
  // Simulate storage: seed via normalize on a bare object store is complex;
  // instead exercise the pure-model path through the store with a direct
  // createTaskEntry into the real (test-scoped) localStorage.
  const list = createTaskEntry("准备下午的面试");
  const id = list[0].id;
  const linked = linkTaskToAgentRun(id, "run_abc123", { executor: "repo.status", summary: "git status" });
  assert.ok(linked, "link should return the updated task");
  assert.deepEqual(linked.agentRunIds, ["run_abc123"]);
  const ev = linked.timeline.filter((e) => e.type === "agent_run_linked");
  assert.equal(ev.length, 1, "exactly one agent_run_linked event");
  assert.equal(ev[0].metadata.runId, "run_abc123");
  assert.equal(ev[0].metadata.executor, "repo.status");
  const back = getTask(id);
  assert.deepEqual(back.agentRunIds, ["run_abc123"], "persisted task carries the link");
});

test("B3: linkTaskToAgentRun is idempotent (same runId twice = one entry)", () => {
  const { createTaskEntry } = require_repo();
  const list = createTaskEntry("拜访某个地点");
  const id = list[0].id;
  linkTaskToAgentRun(id, "run_dup");
  const once = getTaskAgentRunIds(id);
  assert.deepEqual(once, ["run_dup"]);
  linkTaskToAgentRun(id, "run_dup");
  const twice = getTaskAgentRunIds(id);
  assert.deepEqual(twice, ["run_dup"], "duplicate link must not pile up");
});

test("B3: linkTaskToAgentRun refuses empty runId and missing task", () => {
  const { createTaskEntry } = require_repo();
  const list = createTaskEntry("活动报名");
  const id = list[0].id;
  assert.equal(linkTaskToAgentRun(id, ""), null, "empty runId refused");
  assert.equal(linkTaskToAgentRun(id, null), null, "null runId refused");
  assert.equal(linkTaskToAgentRun("no-such-task", "run_x"), null, "missing task refused");
  assert.deepEqual(getTaskAgentRunIds(id), [], "nothing linked");
});

test("B3: getTaskAgentRunIds defensive reads", () => {
  assert.deepEqual(getTaskAgentRunIds("missing"), []);
});

test("B3: multiple runs can be linked to one task", () => {
  const { createTaskEntry } = require_repo();
  const list = createTaskEntry("电脑协助任务");
  const id = list[0].id;
  linkTaskToAgentRun(id, "run_1", { executor: "repo.status" });
  linkTaskToAgentRun(id, "run_2", { executor: "host.stats" });
  assert.deepEqual(getTaskAgentRunIds(id), ["run_1", "run_2"]);
});

test("B3: normalizeTask backward compat — pre-B3 task loads with agentRunIds=[]", () => {
  const legacy = {
    id: "legacy-1",
    version: 2,
    title: "旧任务",
    goal: "旧任务",
    status: "created",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    // no agentRunIds field at all (pre-B3 record)
  };
  const n = normalizeTask(legacy);
  assert.ok(n, "legacy task normalizes");
  assert.deepEqual(n.agentRunIds, [], "old records normalize to []");
});

test("B3: AGENT_EVENT_TYPES vocabulary is additive and stable", () => {
  assert.deepEqual(AGENT_EVENT_TYPES, ["agent_run_linked"]);
});

// tiny helper: import the repo module lazily (after the shim is installed)
function require_repo() {
  return repo;
}
import * as repo from "../src/store/task-repository.js";
