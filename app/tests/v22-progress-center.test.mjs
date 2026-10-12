// Gorgon V2.2 Stage 4 — progress center tests (多项目进度中心).
//
// Pins the facade contract:
//   * getProgressCenterData() derives every summary line from REAL store
//     data — nothing invented, empty states are honest states
//   * job pipeline stage counts (Stage 3) flow through the facade
//   * setJobStage goes through the whitelist (illegal = safe no-op)

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
const P = await import("../src/store/project-repository.js");
const O = await import("../src/store/opportunity-repository.js");
const Repo = await import("../src/store/task-repository.js");
const Prog = await import("../src/store/progress-repository.js");
const Jobs = await import("../src/store/job-repository.js");

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  P.reset();
  O.reset();
  Repo.resetTaskStorage();
  Prog.reset();
  Jobs.reset();
});

test("empty state: getProgressCenterData is honest with no data", () => {
  const d = WB.getProgressCenterData();
  assert.equal(d.projects.length, 0);
  assert.equal(d.jobTotal, 0);
  assert.equal(d.totalOpenTasks, 0);
});

test("statusLine derivation: 还没有任务 / 进行中 / 全部完成", () => {
  // project with no tasks → 还没有任务
  const p1 = WB.createProject({ title: "空项目" });
  // project with open tasks → 进行中
  const p2 = WB.createProject({ title: "进行中项目" });
  WB.addTask("任务1", { projectId: p2.id });
  // project with all tasks completed → 任务全部完成
  const p3 = WB.createProject({ title: "完成项目" });
  WB.addTask("任务2", { projectId: p3.id });
  const tid = WB.getTasks()[0].id;
  WB.transitionTask(tid, "ready");
  WB.transitionTask(tid, "running");
  WB.transitionTask(tid, "completed");

  const d = WB.getProgressCenterData();
  const byId = {};
  for (const row of d.projects) byId[row.project.id] = row;
  assert.equal(byId[p1.id].statusLine, "还没有任务");
  assert.equal(byId[p2.id].statusLine, "进行中 · 1 个任务未完成");
  assert.equal(byId[p3.id].statusLine, "任务全部完成");
  assert.equal(byId[p3.id].completedTasks, 1);
  assert.equal(byId[p3.id].totalTasks, 1);
});

test("latest progress / next scheduled / latest note flow into the summary", () => {
  const p = WB.createProject({ title: "全量项目" });
  WB.addTask("任务A", { projectId: p.id });
  const tid = WB.getTasks()[0].id;
  WB.setTaskSchedule(tid, { scheduledDate: "2026-10-20" });
  WB.addNote({ text: "关键笔记", projectId: p.id });
  WB.addProgress({ subjectType: "project", subjectId: p.id, subjectTitle: p.title, text: "推进了准备" });
  WB.addProgress({ subjectType: "task", subjectId: tid, text: "任务侧推进" });

  const d = WB.getProgressCenterData();
  const row = d.projects.find((r) => r.project.id === p.id);
  assert.ok(row.latestProgress, "latest progress present");
  assert.equal(row.latestProgress.text, "推进了准备");
  assert.equal(row.taskProgressCount, 1, "task-side progress counted");
  assert.ok(row.nextScheduled, "next scheduled present");
  assert.equal(row.nextScheduled.scheduledDate, "2026-10-20");
  assert.ok(row.latestNote, "latest note present");
  assert.equal(row.latestNote.text, "关键笔记");
});

test("job pipeline counts + facade stage transitions flow through", () => {
  const a1 = WB.addJobApplication({ company: "公司A", role: "r1" });
  WB.addJobApplication({ company: "公司B", role: "r2" });
  WB.setJobStage(a1.id, "applied");
  // illegal move: applied → accepted 直接跳过被拒（诚实）
  assert.equal(WB.setJobStage(a1.id, "accepted"), null);
  assert.equal(WB.getJobApplications().find((x) => x.id === a1.id).stage, "applied");

  const d = WB.getProgressCenterData();
  assert.equal(d.jobTotal, 2);
  assert.equal(d.jobCounts.collecting, 1);
  assert.equal(d.jobCounts.applied, 1);
});

test("archived projects are excluded from the progress center", () => {
  const p = WB.createProject({ title: "会归档的项目" });
  WB.addTask("任务", { projectId: p.id });
  WB.archiveProject(p.id);
  const d = WB.getProgressCenterData();
  assert.equal(d.projects.length, 0, "archived project hidden");
  assert.equal(d.totalOpenTasks, 1, "task data untouched by archive");
});
