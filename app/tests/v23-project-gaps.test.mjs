// V2.3 Phase 6 (项目统一) — gap tests for the project dashboard.
//
// 用户验收：一个项目页能看到 目标→任务→活动→笔记→复盘 的完整故事线。
// 审计结论（全部本机核实）：
//   * ProjectDetailScreen 已有：header(目标/来源) + 关联活动(DEMO 徽标/
//     来源链接) + 出行准备 + 关联任务 + 日程 + 走访地点 + 进度记录 + 复盘
//     + 归档 —— 故事线完整；
//   * getProjectBundle 已聚合 project/tasks/notes/places/review/
//     registrations/progress（progress 含项目侧 + 任务侧，时间倒序）；
//   * 缺口：① 无进度百分比（任务完成率）；② 无跨模块统一时间线
//     （任务 timeline 事件 + 进度记录分开展示，无单一故事线视图）。
//
// 本文件覆盖纯视图助手层（lib/project-view.js 新文件）：
//   G-1  projectProgressPercent：任务完成率（completed/total，0 任务 → null）
//   G-2  projectTimeline：跨模块统一时间线（任务事件 + 进度记录 + 笔记，
//        时间倒序合并，每条带来源标签）

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
import { projectProgressPercent, projectTimeline } from "../src/lib/project-view.js";

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  P.reset();
  O.reset();
  Repo.resetTaskStorage();
});

/* ── G-1: 进度百分比 ──────────────────────────────────────────────────── */

test("P6 G-1: projectProgressPercent — completed/total, 0 tasks -> null", () => {
  assert.equal(projectProgressPercent([]), null);
  assert.equal(projectProgressPercent([{ status: "completed" }]), 100);
  assert.equal(projectProgressPercent([{ status: "ready" }]), 0);
  assert.equal(projectProgressPercent([
    { status: "completed" }, { status: "completed" }, { status: "ready" }, { status: "running" },
  ]), 50);
  assert.equal(projectProgressPercent(null), null);
});

/* ── G-2: 跨模块统一时间线 ────────────────────────────────────────────── */

test("P6 G-2: projectTimeline merges task events + progress + notes, newest first", () => {
  const proj = WB.createProject({ title: "时间线测试项目", goal: "验证统一时间线" });
  const tasks = WB.addTask("时间线任务 A", { projectId: proj.id });
  const task = tasks[0];
  WB.setTaskPriority(task.id, "high");          // task timeline event
  WB.addProgress({                              // progress entry (object input)
    subjectType: "project", subjectId: proj.id,
    subjectTitle: "时间线测试项目",
    kind: "milestone", text: "项目启动",
  });
  WB.addNote({ text: "时间线笔记", projectId: proj.id }); // note

  const { getTask } = WB;
  const timeline = projectTimeline({
    tasks: WB.getTasks().filter((t) => t.projectId === proj.id),
    progress: WB.getProgress({ subjectType: "project", subjectId: proj.id })
      .concat(WB.getProgress({ subjectType: "task" }).filter((e) =>
        WB.getTasks().some((t) => t.id === e.subjectId && t.projectId === proj.id))),
    notes: WB.getNotes({ projectId: proj.id }),
    taskById: (id) => getTask(id),
  });

  // 三种来源都在
  const kinds = new Set(timeline.map((e) => e.source));
  assert.ok(kinds.has("task"), "task timeline events must be in the merged timeline");
  assert.ok(kinds.has("progress"), "progress entries must be in the merged timeline");
  assert.ok(kinds.has("note"), "notes must be in the merged timeline");

  // 时间倒序
  for (let i = 1; i < timeline.length; i++) {
    assert.ok(String(timeline[i - 1].at) >= String(timeline[i].at), "newest first");
  }

  // 每条有可读标签
  for (const e of timeline) {
    assert.ok(typeof e.label === "string" && e.label.length > 0);
  }
});

test("P6 G-2b: projectTimeline handles empty bundle honestly", () => {
  assert.deepEqual(projectTimeline({ tasks: [], progress: [], notes: [] }), []);
  assert.deepEqual(projectTimeline(null), []);
});
