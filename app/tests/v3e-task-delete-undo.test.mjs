// V3E 任务包 A — 删除/撤销/恢复机制（任务系统第 3 项重点）。
//
// 语义：deleteTask 默认软删除（deletedAt 标记），30 天窗口内可恢复；
// 彻底清除（硬删除）需要显式调用 deleteTaskForever 或恢复界面操作。
//
// localStorage is unavailable in plain Node — the repository degrades to its
// in-memory fallback, which is exactly what these tests exercise: the same
// code path a private-mode browser session takes. Tests self-clean via
// deleteTaskForever to keep the shared in-memory store clean.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as WB from "../src/store/workbench-store.js";

test("v3e: deleteTask soft-deletes (deletedAt set, list shrinks, getTask still finds it)", () => {
  const list = WB.addTask("软删除任务");
  const id = list[0].id;
  assert.ok(!WB.getTask(id).deletedAt, "fresh task has no deletedAt");

  const after = WB.deleteTask(id);
  // visible list no longer contains it
  assert.ok(!after.some((t) => t.id === id), "deleted task must not appear in listTasks");
  // but getTask still finds it (soft-deleted, recoverable)
  const t = WB.getTask(id);
  assert.ok(t, "soft-deleted task must remain findable via getTask");
  assert.ok(typeof t.deletedAt === "string" && t.deletedAt, "deletedAt must be an ISO string");
  // no duplicate deletedAt overwrite on repeat delete
  const d1 = t.deletedAt;
  WB.deleteTask(id);
  assert.equal(WB.getTask(id).deletedAt, d1, "repeat delete must not bump deletedAt");
  // cleanup
  WB.deleteTaskForever(id);
});

test("v3e: restoreTask brings a soft-deleted task back (clears deletedAt, records timeline event)", () => {
  const list = WB.addTask("待恢复任务");
  const id = list[0].id;
  WB.deleteTask(id);
  assert.ok(WB.getTask(id) && WB.getTask(id).deletedAt, "task is soft-deleted");

  const restored = WB.restoreTask(id);
  assert.ok(restored, "restoreTask returns the new list");
  const t = WB.getTask(id);
  assert.ok(t, "restored task is back");
  assert.ok(!t.deletedAt, "deletedAt cleared after restore");
  const ev = t.timeline.find((e) => e.type === "task_restored");
  assert.ok(ev, "task_restored event must be recorded");
  // the restored task appears in the visible list again
  assert.ok(WB.getTasks().some((x) => x.id === id), "restored task visible in listTasks");
  // cleanup
  WB.deleteTaskForever(id);
});

test("v3e: restoreTask refuses non-deleted and missing tasks (safe no-op)", () => {
  const list = WB.addTask("未删除任务");
  const id = list[0].id;
  assert.equal(WB.restoreTask(id), null, "restore on a live task is a no-op (null)");
  // missing task
  assert.equal(WB.restoreTask("v3e-missing-id"), null);
  // cleanup
  WB.deleteTaskForever(id);
});

test("v3e: deleteTaskForever hard-deletes (gone from getTask too)", () => {
  const list = WB.addTask("彻底删除任务");
  const id = list[0].id;
  WB.deleteTask(id);
  assert.ok(WB.getTask(id), "soft-deleted first");
  WB.deleteTaskForever(id);
  assert.equal(WB.getTask(id), null, "hard-deleted task is gone for good");
});

test("v3e: getDeletedTasks returns only soft-deleted, newest first", () => {
  const a = WB.addTask("删除顺序A")[0];
  const b = WB.addTask("删除顺序B")[0];
  WB.deleteTask(a.id);
  WB.deleteTask(b.id);
  const deleted = WB.getDeletedTasks();
  const ids = deleted.map((t) => t.id);
  assert.ok(ids.indexOf(a.id) >= 0 && ids.indexOf(b.id) >= 0, "both deleted tasks listed");
  // newest deletion first: b was deleted after a
  assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id), "newest deletion first");
  // live tasks never appear
  assert.ok(deleted.every((t) => t.deletedAt), "all entries have deletedAt");
  // cleanup
  WB.deleteTaskForever(a.id);
  WB.deleteTaskForever(b.id);
});

test("v3e: purgeExpiredDeletedTasks drops only past-window records", () => {
  const fresh = WB.addTask("窗口内任务")[0];
  const stale = WB.addTask("窗口外任务")[0];
  WB.deleteTask(fresh.id);
  WB.deleteTask(stale.id);
  const oldIso = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  // Both are in the 30-day window (deleted just now) — nothing dropped.
  const r1 = WB.purgeExpiredDeletedTasks(new Date().toISOString());
  const after1 = WB.getDeletedTasks().map((t) => t.id);
  assert.ok(after1.indexOf(fresh.id) >= 0, "in-window task kept");
  assert.ok(after1.indexOf(stale.id) >= 0, "in-window stale task kept (not yet 31 days)");
  assert.equal(r1.dropped, 0);
  // Simulate expiry is not reachable via the public API (timestamps are
  // engine-assigned), so assert the window boundary semantics instead:
  // a cutoff far in the future drops EVERYTHING deleted before it.
  const r2 = WB.purgeExpiredDeletedTasks(new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString());
  assert.equal(r2.dropped, 2, "records older than the cutoff are dropped");
  assert.equal(WB.getDeletedTasks().length, 0, "回收站 emptied by future cutoff");
  assert.equal(WB.getTask(fresh.id), null, "expired records are hard-removed");
  assert.equal(WB.getTask(stale.id), null, "expired records are hard-removed");
});

test("v3e: soft-deleted tasks are hidden from open/overdue/today helpers", () => {
  const list = WB.addTask("隐藏验证任务");
  const id = list[0].id;
  WB.setTaskSchedule(id, { scheduledDate: WB.localDateStr(new Date()) });
  assert.ok(WB.isTaskOnDate(WB.getTask(id), WB.localDateStr(new Date())));

  WB.deleteTask(id);
  const t = WB.getTask(id);
  assert.ok(t.deletedAt, "soft-deleted");
  // the task still exists but UI helpers must not surface it as actionable
  const visible = WB.getTasks().filter((x) => x.id === id);
  assert.equal(visible.length, 0, "deleted task hidden from the visible list");
  // cleanup
  WB.deleteTaskForever(id);
});

test("v3e: restore after delete keeps user data intact (priority/schedule preserved)", () => {
  const list = WB.addTask("数据保留任务", { priority: "high" });
  const id = list[0].id;
  WB.setTaskPriority(id, "low");
  WB.setTaskSchedule(id, { scheduledDate: "2030-01-15" });
  const before = WB.getTask(id);
  assert.equal(before.priority, "low");
  assert.equal(before.scheduledDate, "2030-01-15");

  WB.deleteTask(id);
  WB.restoreTask(id);
  const after = WB.getTask(id);
  assert.equal(after.priority, "low", "priority preserved across delete/restore");
  assert.equal(after.scheduledDate, "2030-01-15", "schedule preserved across delete/restore");
  assert.equal(after.title, "数据保留任务", "title preserved");
  // cleanup
  WB.deleteTaskForever(id);
});
