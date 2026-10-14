// V3F 任务 C — user activity EXECUTION closure tests.
//
// 用户指令（第四步）：优先修复自建活动执行。
//   点击执行 → 保存执行状态 → 创建或关联任务 → 写入日程 →
//   用户能找到结果 → 退出重启后仍然存在；
//   重复点击不产生重复任务；失败要有明确提示不能假成功。
//
// 本文件覆盖执行闭环（workbench-store.executeUserActivity）：
//   X-1  执行 → 创建任务（goal/source/metadata.activityId 关联）
//   X-2  scheduledDate 只来自真实 ISO 日期（dateText 永不解析为日程声明）
//   X-3  执行状态持久化（executedAt/executionTaskId 存 activity 信封，
//        fresh read = 重启等价语义）
//   X-4  重复点击不产生重复任务（alreadyExecuted + 同一任务返回）
//   X-5  任务进回收站（软删）后允许重新执行（fresh task）
//   X-6  失败路径：无效活动 / 不存在的活动 → ok:false，不写任何数据
//   X-7  执行任务进入日程视图（groupTasksByDate 正确分桶）
//   X-8  活动日志记录执行事件（activity_execute）

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
globalThis.localStorage = makeStorage();

const WB = await import("../src/store/workbench-store.js");
const Repo = await import("../src/store/task-repository.js");
const UA = await import("../src/store/user-activity-repository.js");
const { groupTasksByDate } = await import("../src/lib/schedule-view.js");

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  Repo.resetTaskStorage();
  UA.reset();
});

test("V3F X-1: 执行自建活动 → 创建任务并双向关联（metadata.activityId + executionTaskId）", () => {
  const a = WB.addUserActivity({
    title: "执行闭环测试沙龙",
    startDate: "2026-10-18",
    time: "14:00",
  });
  assert.ok(a && a.id);

  const out = WB.executeUserActivity(a);
  assert.equal(out.ok, true);
  assert.equal(out.alreadyExecuted, false);
  assert.ok(out.task && out.task.id);

  // Task side: linked via metadata.activityId, honest source label.
  // (createTask's convention: the source label lives in the creation
  // timeline event's metadata — same as "建议执行" call sites.)
  assert.equal(out.task.metadata.activityId, a.id);
  assert.equal(out.task.timeline[0].metadata.source, "自建活动");
  assert.equal(out.task.goal, "参加活动：执行闭环测试沙龙");

  // Activity side: execution state persisted.
  const fresh = UA.getActivity(a.id);
  assert.ok(fresh.executedAt, "executedAt written");
  assert.equal(fresh.executionTaskId, out.task.id);
});

test("V3F X-2: scheduledDate 只来自真实 ISO 日期；dateText 永不解析成日程声明", () => {
  // Case 1: real ISO startDate → scheduledDate written.
  const withIso = WB.addUserActivity({
    title: "ISO 日期活动",
    startDate: "2026-10-18",
    dateText: "10月18日 · 周六",
  });
  const out1 = WB.executeUserActivity(withIso);
  assert.equal(out1.ok, true);
  assert.equal(out1.task.scheduledDate, "2026-10-18");

  // Case 2: loose dateText ONLY → NO invented scheduledDate (honest _undated).
  const looseOnly = WB.addUserActivity({
    title: "仅模糊日期活动",
    dateText: "10月25日 · 周日",
  });
  const out2 = WB.executeUserActivity(looseOnly);
  assert.equal(out2.ok, true);
  assert.equal(out2.task.scheduledDate, null, "dateText is display-only, never a schedule claim");
});

test("V3F X-3: 执行状态重启后仍在（fresh read = 重启等价语义）", () => {
  const a = WB.addUserActivity({ title: "重启持久活动", startDate: "2026-10-19" });
  const out = WB.executeUserActivity(a);
  assert.equal(out.ok, true);

  // Simulate cold restart: fresh read straight from the envelope store.
  const fresh = UA.getActivity(a.id);
  assert.equal(fresh.executionTaskId, out.task.id);
  assert.ok(fresh.executedAt);

  // The task side also survives: fresh listTasks finds the live task.
  const live = Repo.listTasks().find((t) => t.metadata && t.metadata.activityId === a.id);
  assert.ok(live, "task survives restart");
  assert.equal(live.id, out.task.id);
});

test("V3F X-4: 重复点击不产生重复任务（alreadyExecuted，同一任务返回）", () => {
  const a = WB.addUserActivity({ title: "防重复活动" });

  const first = WB.executeUserActivity(a);
  assert.equal(first.ok, true);
  assert.equal(first.alreadyExecuted, false);

  const second = WB.executeUserActivity(a);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyExecuted, true, "re-click is honest about already-executed");
  assert.equal(second.task.id, first.task.id, "same task returned, no duplicate");

  // Exactly ONE live task for this activity.
  const live = Repo.listTasks().filter((t) => t.metadata && t.metadata.activityId === a.id);
  assert.equal(live.length, 1);
});

test("V3F X-5: 任务进回收站（软删）后允许重新执行", () => {
  const a = WB.addUserActivity({ title: "回收站重执行活动" });

  const first = WB.executeUserActivity(a);
  assert.equal(first.ok, true);

  // User deletes the task → soft delete (recycle bin), no longer live.
  Repo.deleteTask(first.task.id);
  assert.equal(
    Repo.listTasks().filter((t) => t.metadata && t.metadata.activityId === a.id).length,
    0,
    "soft-deleted task is not live",
  );

  // Re-execution is a fresh request: new task created, activity re-linked.
  const second = WB.executeUserActivity(a);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyExecuted, false, "deleted result → fresh execution allowed");
  assert.notEqual(second.task.id, first.task.id);

  const fresh = UA.getActivity(a.id);
  assert.equal(fresh.executionTaskId, second.task.id, "activity points at the NEW task");
});

test("V3F X-6: 失败路径 — 无效/不存在的活动 ok:false，不写任何数据", () => {
  // Invalid: no id.
  const bad = WB.executeUserActivity(null);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "invalid-activity");

  const noId = WB.executeUserActivity({ title: "无 id 活动" });
  assert.equal(noId.ok, false);

  // Not found: id points at a deleted/unknown activity.
  const ghost = WB.executeUserActivity({ id: "no-such-activity", title: "幽灵活动" });
  assert.equal(ghost.ok, false);
  assert.equal(ghost.reason, "not-found");

  // Nothing written.
  assert.equal(Repo.listTasks().length, 0);
});

test("V3F X-7: 执行任务进入日程视图（groupTasksByDate 正确分桶）", () => {
  const a = WB.addUserActivity({ title: "日程分桶活动", startDate: "2026-10-18" });
  const out = WB.executeUserActivity(a);
  assert.equal(out.ok, true);

  const groups = groupTasksByDate(Repo.listTasks());
  assert.ok(Array.isArray(groups["2026-10-18"]), "task lands on its ISO day");
  assert.equal(groups["2026-10-18"].some((t) => t.id === out.task.id), true);

  // Undated execution: honest _undated bucket, still findable.
  const b = WB.addUserActivity({ title: "无日期执行活动" });
  const outB = WB.executeUserActivity(b);
  assert.equal(outB.ok, true);
  const groups2 = groupTasksByDate(Repo.listTasks());
  assert.equal(groups2._undated.some((t) => t.id === outB.task.id), true);
});

test("V3F X-8: 活动日志记录 activity_execute 事件", () => {
  const a = WB.addUserActivity({ title: "日志轨迹活动" });
  WB.executeUserActivity(a);
  const log = WB.getLog();
  const exec = log.filter((e) => e && e.type === "activity_execute");
  assert.equal(exec.length, 1, "exactly one execute event");
  assert.ok(exec[0].text.includes("日志轨迹活动"), "log mentions the activity");
});
