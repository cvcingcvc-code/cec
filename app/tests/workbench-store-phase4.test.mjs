// Gorgon Phase 4 — workbench-store facade tests (P0-A/B/C).
//
// The facade is what screens call; these tests pin the contract:
//   * scheduling writes go through the state machine + timeline
//   * plan suggestions become PENDING editable todos (never "done")
//   * project lifecycle + bundle assembly reads the REAL stores
//   * note/review facades log events and refuse invalid input

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
const P = await import("../src/store/project-repository.js");
const O = await import("../src/store/opportunity-repository.js");

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  P.reset();
  O.reset(); // opportunity-repository keeps a module-level memory mirror
  Repo.resetTaskStorage();
});

/* ── P0-B: scheduling ───────────────────────────────────────────────── */

test("setTaskSchedule writes dueAt/scheduledDate + timeline event", () => {
  WB.addTask("报名黑客松");
  const id = WB.getTasks()[0].id;
  const t = WB.setTaskSchedule(id, { dueAt: "2026-10-12T18:00:00.000Z", scheduledDate: "2026-10-12" });
  assert.equal(t.dueAt, "2026-10-12T18:00:00.000Z");
  assert.equal(t.scheduledDate, "2026-10-12");
  assert.ok(t.timeline.some((e) => e.type === "task_scheduled"), "timeline records the change");
});

test("setTaskSchedule refuses invalid dates instead of guessing", () => {
  WB.addTask("t");
  const id = WB.getTasks()[0].id;
  assert.equal(WB.setTaskSchedule(id, { dueAt: "garbage" }), null);
  assert.equal(WB.getTasks()[0].dueAt, null, "nothing written on refusal");
});

test("setTaskSchedule clears with explicit null", () => {
  WB.addTask("t", { dueAt: "2026-10-12T18:00:00.000Z" });
  const id = WB.getTasks()[0].id;
  const t = WB.setTaskSchedule(id, { dueAt: null });
  assert.equal(t.dueAt, null);
});

test("getTodayTasks returns only tasks on that local date", () => {
  WB.addTask("today one", { scheduledDate: "2026-10-12" });
  WB.addTask("other day", { scheduledDate: "2026-10-13" });
  WB.addTask("no date");
  const today = WB.getTodayTasks("2026-10-12");
  assert.equal(today.length, 1);
  assert.equal(today[0].title, "today one");
});

test("getOpenTasks excludes completed/failed", () => {
  WB.addTask("open one");
  WB.addTask("done one");
  const doneId = WB.getTasks()[0].id; // newest first
  WB.transitionTask(doneId, "ready");
  WB.transitionTask(doneId, "running");
  WB.transitionTask(doneId, "completed");
  const open = WB.getOpenTasks();
  assert.equal(open.length, 1);
  assert.equal(open[0].title, "open one");
});

/* ── P0-B: plan → editable todos ────────────────────────────────────── */

test("savePlanStepsAsTodos creates PENDING steps, never completed", () => {
  WB.addTask("做计划");
  const id = WB.getTasks()[0].id;
  const t = WB.savePlanStepsAsTodos(id, ["查看候选", "核对时间", "完成报名"]);
  assert.equal(t.steps.length, 3);
  for (const s of t.steps) {
    assert.equal(s.status, "pending", "a suggestion is NEVER auto-done");
    assert.equal(s.metadata.origin, "plan_suggestion");
  }
  assert.ok(t.timeline.some((e) => e.type === "plan_saved_as_todos"));
});

test("savePlanStepsAsTodos skips duplicates on re-run", () => {
  WB.addTask("做计划");
  const id = WB.getTasks()[0].id;
  WB.savePlanStepsAsTodos(id, ["步骤A", "步骤B"]);
  const t = WB.savePlanStepsAsTodos(id, ["步骤A", "步骤B", "步骤C"]);
  assert.equal(t.steps.length, 3, "second run only adds the new step");
});

test("savePlanStepsAsTodos accepts plan-skill result shape", () => {
  WB.addTask("做计划");
  const id = WB.getTasks()[0].id;
  const t = WB.savePlanStepsAsTodos(id, [{ title: "对象步骤" }, "字符串步骤"]);
  assert.deepEqual(t.steps.map((s) => s.title), ["对象步骤", "字符串步骤"]);
});

/* ── P0-A: projects via facade ──────────────────────────────────────── */

test("createProjectFromActivity stores snapshot with demo flag", () => {
  const p = WB.createProjectFromActivity({
    id: "act-1", title: "AI Meetup", dateText: "10月12日",
    venue: "西岸", dataOrigin: "demo",
  });
  assert.equal(p.origin, "activity");
  assert.equal(p.activities[0].isDemo, true);
  assert.ok(WB.getLog().some((e) => e.type === "project_create"));
});

test("linkTaskToProject + getProjectBundle assemble real store data", () => {
  const proj = WB.createProject({ title: "参赛项目", goal: "拿奖" });
  WB.addTask("写 BP");
  const tid = WB.getTasks()[0].id;
  WB.linkTaskToProject(tid, proj.id);
  WB.addNote({ text: "灵感", projectId: proj.id, taskId: tid });
  WB.setProjectReview(proj.id, { outcome: "进了决赛", nextAction: "准备路演" });

  const bundle = WB.getProjectBundle(proj.id);
  assert.equal(bundle.project.id, proj.id);
  assert.equal(bundle.tasks.length, 1);
  assert.equal(bundle.tasks[0].id, tid);
  assert.equal(bundle.notes.length, 1);
  assert.equal(bundle.review.outcome, "进了决赛");
});

test("linkTaskToProject rejects unknown project ids", () => {
  WB.addTask("t");
  const tid = WB.getTasks()[0].id;
  assert.equal(WB.linkTaskToProject(tid, "no-such-project"), null);
  assert.equal(WB.getTasks()[0].projectId, null);
});

test("archiveProject hides the project but keeps its tasks", () => {
  const proj = WB.createProject({ title: "要归档" });
  WB.addTask("t", { projectId: proj.id });
  WB.archiveProject(proj.id);
  assert.equal(WB.getProjects().length, 0);
  assert.equal(WB.getTasks()[0].projectId, proj.id, "task data untouched");
});

test("getHomeData assembles the workbench home payload", () => {
  const proj = WB.createProject({ title: "P" });
  WB.addTask("today", { scheduledDate: WB.localDateStr(new Date()), projectId: proj.id });
  WB.addNote({ text: "note" });
  const home = WB.getHomeData();
  assert.equal(home.todayTasks.length, 1);
  assert.equal(home.projects.length, 1);
  assert.equal(home.recentNotes.length, 1);
  assert.ok(home.recentTasks.length >= 1);
});

/* ── P0-C: notes + review via facade ────────────────────────────────── */

test("addNote links to task timeline and logs", () => {
  WB.addTask("执行任务");
  const tid = WB.getTasks()[0].id;
  const n = WB.addNote({ text: "现场情况", taskId: tid });
  assert.equal(n.taskId, tid);
  const t = WB.getTask(tid);
  assert.ok(t.timeline.some((e) => e.type === "note_linked"));
  assert.ok(WB.getLog().some((e) => e.type === "note_create"));
});

test("updateNote/removeNote round-trip", () => {
  const n = WB.addNote({ text: "初稿" });
  const u = WB.updateNote(n.id, { text: "修订版" });
  assert.equal(u.text, "修订版");
  assert.equal(WB.removeNote(n.id), true);
  assert.equal(WB.getNotes().length, 0);
});

test("setProjectReview keeps previous values on empty upsert", () => {
  WB.setProjectReview("p1", { outcome: "完成", nextAction: "复盘" });
  const r = WB.setProjectReview("p1", { outcome: "" });
  assert.equal(r.outcome, "完成");
  assert.equal(r.nextAction, "复盘");
});
