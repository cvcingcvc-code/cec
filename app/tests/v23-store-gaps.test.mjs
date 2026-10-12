// V2.3 store facade tests — setTaskPriority + failed->retry through the REAL
// persistence layer (V23_ACCEPTANCE_MATRIX A1-6/A1-7 store level).
//
// localStorage is unavailable in plain Node — the repository degrades to its
// in-memory fallback, which is exactly what these tests exercise: the same
// code path a private-mode browser session takes.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as WB from "../src/store/workbench-store.js";

test("store: addTask accepts priority option", () => {
  WB.deleteTask("prio-1"); // ensure clean slate (no-op when missing)
  const t = WB.getTask("prio-1");
  assert.equal(t, null);
  const list = WB.addTask("高优先任务", { priority: "high" });
  const created = list[0];
  assert.equal(created.priority, "high");
  // cleanup
  WB.deleteTask(created.id);
});

test("store: setTaskPriority validates and records a timeline event", () => {
  const list = WB.addTask("优先级流转任务");
  const id = list[0].id;
  // default is normal
  assert.equal(WB.getTask(id).priority, "normal");
  // valid change
  const updated = WB.setTaskPriority(id, "high");
  assert.equal(updated.priority, "high");
  const task = WB.getTask(id);
  const ev = task.timeline.find((e) => e.type === "priority_changed");
  assert.ok(ev, "priority_changed event must be recorded");
  assert.ok(ev.message.includes("普通 → 高"));
  // invalid value refused — task untouched
  const refused = WB.setTaskPriority(id, "urgent");
  assert.equal(refused, null);
  assert.equal(WB.getTask(id).priority, "high");
  // same-value no-op returns the task, no new event
  const eventsBefore = WB.getTask(id).timeline.length;
  const noop = WB.setTaskPriority(id, "high");
  assert.equal(noop.priority, "high");
  assert.equal(WB.getTask(id).timeline.length, eventsBefore);
  WB.deleteTask(id);
});

test("store: failed task can retry via tryTransitionTask (failed -> ready)", () => {
  const list = WB.addTask("会失败然后重试的任务");
  const id = list[0].id;
  WB.tryTransitionTask(id, "ready");
  WB.transitionTask(id, "failed", { failureReason: "接口超时" });
  assert.equal(WB.getTask(id).status, "failed");
  // retry: failed -> ready is now legal
  const retried = WB.tryTransitionTask(id, "ready");
  assert.ok(retried, "failed -> ready must be legal");
  assert.equal(WB.getTask(id).status, "ready");
  // failureReason retained for the history panel
  assert.equal(WB.getTask(id).failureReason, "接口超时");
  // and the retry path can run again: ready -> running
  assert.ok(WB.tryTransitionTask(id, "running"));
  WB.deleteTask(id);
});

test("store: failed -> running stays illegal at facade level", () => {
  const list = WB.addTask("非法重试任务");
  const id = list[0].id;
  WB.tryTransitionTask(id, "ready");
  WB.transitionTask(id, "failed", { failureReason: "x" });
  assert.equal(WB.tryTransitionTask(id, "running"), null);
  assert.equal(WB.getTask(id).status, "failed");
  WB.deleteTask(id);
});
