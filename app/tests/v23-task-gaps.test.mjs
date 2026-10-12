// Phase 1 gap tests — priority + retry (V23_ACCEPTANCE_MATRIX A1-6 / A1-7).
//
// Priority: additive `priority` field. Old records normalize to "normal"
// without any migration; valid values are high/normal/low; invalid values
// degrade to "normal" (never guess).
//
// Retry: TRANSITIONS gains failed -> ready ("重新就绪再执行"). This is a
// core-model change, so the tests pin down BOTH the new edge AND the
// still-illegal edges (failed -> running / failed -> completed).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TASK_STATUS, TRANSITIONS, canTransition, transitionTaskState,
  createTask, normalizeTask, InvalidTransitionError,
} from "../src/workbench/task-model.js";

const PRIORITY_VALUES = ["high", "normal", "low"];

/* ── Priority: additive field ─────────────────────────────────────── */

test("priority: createTask defaults to normal", () => {
  const t = createTask("找上海 AI 活动");
  assert.equal(t.priority, "normal");
});

test("priority: createTask accepts explicit high/low", () => {
  assert.equal(createTask("任务A", { priority: "high" }).priority, "high");
  assert.equal(createTask("任务B", { priority: "low" }).priority, "low");
});

test("priority: invalid values degrade to normal (never guess)", () => {
  assert.equal(createTask("任务C", { priority: "urgent" }).priority, "normal");
  assert.equal(createTask("任务D", { priority: 42 }).priority, "normal");
  assert.equal(createTask("任务E", { priority: null }).priority, "normal");
});

test("priority: old records normalize to normal (additive, no migration)", () => {
  const legacy = { id: "t1", version: 2, title: "旧任务", goal: "旧任务", status: "ready" };
  const n = normalizeTask(legacy);
  assert.equal(n.priority, "normal");
  // status/timestamps untouched
  assert.equal(n.status, "ready");
});

test("priority: explicit value survives normalize", () => {
  const legacy = { id: "t2", version: 2, title: "高优先", goal: "高优先", status: "ready", priority: "high" };
  assert.equal(normalizeTask(legacy).priority, "high");
  const bad = { id: "t3", version: 2, title: "坏值", goal: "坏值", status: "ready", priority: "asap" };
  assert.equal(normalizeTask(bad).priority, "normal");
});

test("priority: transition preserves priority field", () => {
  const t = createTask("任务F", { priority: "high" });
  const moved = transitionTaskState(t, TASK_STATUS.READY);
  assert.equal(moved.priority, "high");
});

/* ── Retry: failed -> ready ───────────────────────────────────────── */

test("retry: TRANSITIONS contains failed -> ready", () => {
  assert.ok(TRANSITIONS.failed.includes("ready"), "failed must allow ready");
  assert.ok(canTransition("failed", "ready"));
});

test("retry: failed -> ready keeps failureReason history", () => {
  let t = createTask("会失败的任务");
  t = transitionTaskState(t, TASK_STATUS.READY);
  t = transitionTaskState(t, TASK_STATUS.FAILED, { failureReason: "网络错误" });
  assert.equal(t.failureReason, "网络错误");
  const retried = transitionTaskState(t, TASK_STATUS.READY);
  // failureReason is retained for the history panel; the timeline shows the retry.
  assert.equal(retried.failureReason, "网络错误");
  const lastEvent = retried.timeline[retried.timeline.length - 1];
  assert.equal(lastEvent.type, "status_changed");
  assert.ok(lastEvent.message.includes("failed → ready"));
});

test("retry: failed -> ready clears stale step failures is caller's job", () => {
  // The model must NOT silently rewrite steps — the runner owns them.
  let t = createTask("带失败步骤的任务");
  t = transitionTaskState(t, TASK_STATUS.READY);
  t = transitionTaskState(t, TASK_STATUS.FAILED, { failureReason: "步骤失败" });
  const retried = transitionTaskState(t, "ready");
  assert.equal(retried.steps.length, 0); // untouched by the state machine
});

test("retry: failed -> running / completed stay illegal", () => {
  assert.equal(canTransition("failed", "running"), false);
  assert.equal(canTransition("failed", "completed"), false);
  assert.equal(canTransition("failed", "planning"), false);
  assert.throws(
    () => transitionTaskState({ id: "x", status: "failed", timeline: [] }, "running"),
    InvalidTransitionError,
  );
});

test("retry: failed -> created stays illegal (retry means re-ready, not recreate)", () => {
  assert.equal(canTransition("failed", "created"), false);
});
