// V2.3 Phase 3 (地点管理) — the user-directed acceptance scenario:
//
//   创建地点 → 安排走访 → 关联任务 → 完成访问 → 记录结果 → 再次查看
//
// Runs against the REAL stores (in-memory fallback in plain Node, same as
// v22-life-scenarios.test.mjs). The UI half (PlacesScreen props) is wired
// in App.jsx; this file pins the store-level loop the screen drives.

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
import { searchPlaces, duplicatePlaceName } from "../src/lib/place-view.js";

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  P.reset();
  O.reset();
  Repo.resetTaskStorage();
});

test("验收场景：创建地点 → 安排走访 → 关联任务 → 完成访问 → 记录结果 → 再次查看", () => {
  // ── 1. 创建地点（真实 store 写入 + 活动日志） ──
  const place = WB.upsertPlace({ name: "星尘科技总部", address: "科技园 1 号 3F" });
  assert.ok(place.id);
  assert.equal(place.status, "todo"); // 待走访
  assert.ok(WB.getLog().some((e) => e.type === "place_create" && e.text.includes("星尘科技总部")));

  // 重复提示：同名再次录入时能被识别（创建与否仍是用户的选择）
  assert.equal(duplicatePlaceName(WB.getPlaces(), "星尘科技总部"), place.id);
  assert.equal(duplicatePlaceName(WB.getPlaces(), "星尘科技总部 2 座"), null);

  // ── 2. 安排走访（任务 + 日程：scheduledDate 本地 YYYY-MM-DD） ──
  const tasks = WB.addTask("走访星尘科技前台", {
    scheduledDate: "2026-10-15",
    priority: "high",
  });
  const task = tasks[0];
  assert.equal(task.scheduledDate, "2026-10-15");
  assert.equal(task.priority, "high");

  // ── 3. 关联任务 ↔ 地点（linkTaskToPlace，双向可见） ──
  const linked = WB.linkTaskToPlace(task.id, place.id);
  assert.ok(linked);
  assert.equal(WB.getTask(task.id).placeId, place.id);
  // 地点侧反查（UI 的 tasksByPlace 数据源）
  const places = WB.getPlaces();
  assert.equal(places.find((p) => p.id === place.id).id, place.id);
  const placeTasks = WB.getTasks().filter((t) => t.placeId === place.id);
  assert.equal(placeTasks.length, 1);
  assert.equal(placeTasks[0].title, "走访星尘科技前台");

  // ── 4. 完成访问（记录到访：状态自动流转 todo → revisit/visited） ──
  const v1 = WB.addPlaceVisit(place.id, { note: "前台拒收，需预约", nextPlan: "下周一带材料再来" });
  assert.equal(v1.status, "revisit"); // 有复访计划 → 需复访
  assert.equal(v1.visits.length, 1);

  // ── 5. 记录结果（再次到访 + 笔记关联地点） ──
  const v2 = WB.addPlaceVisit(place.id, { note: "顺利对接，留下材料" });
  assert.equal(v2.status, "visited");
  assert.equal(v2.visits.length, 2);
  const note = WB.addNote({ text: "前台 9:00-18:00，午休拒访；对接人姓陈", placeId: place.id, kind: "text" });
  assert.equal(note.placeId, place.id);

  // ── 6. 再次查看（搜索 / 历史 / 笔记 / 关联任务 全部可回溯） ──
  // 搜索：名称命中
  const hits = searchPlaces(WB.getPlaces(), "星尘");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, place.id);
  // 地址命中
  assert.equal(searchPlaces(WB.getPlaces(), "科技园").length, 1);
  // 空查询 = 全量
  assert.equal(searchPlaces(WB.getPlaces(), "").length, WB.getPlaces().length);

  // 访问历史：2 条，倒序可读，时间真实
  const reread = WB.getPlace(place.id);
  assert.equal(reread.visits.length, 2);
  assert.ok(reread.visits[0].at <= reread.visits[1].at);
  assert.equal(reread.visits[0].note, "前台拒收，需预约");
  assert.equal(reread.visits[1].note, "顺利对接，留下材料");
  // repository 语义：第二次到访无复访计划 → 旧计划清除（状态已走访，旧计划过期）
  assert.equal(reread.nextPlan, null);

  // 地点笔记可回溯
  const placeNotes = WB.getNotes({ placeId: place.id });
  assert.equal(placeNotes.length, 1);
  assert.equal(placeNotes[0].text, "前台 9:00-18:00，午休拒访；对接人姓陈");

  // 关联任务可回溯
  assert.equal(WB.getTask(task.id).placeId, place.id);

  // 活动日志完整覆盖全流程（place_linked 记录在任务时间线，非平面日志）
  const log = WB.getLog();
  assert.ok(log.some((e) => e.type === "place_create"));
  assert.ok(log.some((e) => e.type === "place_visit"));
  assert.ok(WB.getTask(task.id).timeline.some((e) => e.type === "place_linked"));
  assert.ok(log.some((e) => e.type === "note_create"));
});
