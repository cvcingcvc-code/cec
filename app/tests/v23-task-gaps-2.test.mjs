// V2.3 Phase 1 gap tests #3/#4/#5 — title edit, task↔place link, search.
//
// Title: setTaskTitle validates non-empty, records a timeline event.
// Place link: additive task.placeId; invalid place id refused.
// Search: cross-field query over title/goal/notes text (pure helper).

import assert from "node:assert/strict";
import { test } from "node:test";

import * as WB from "../src/store/workbench-store.js";
import { searchTasks } from "../src/store/workbench-store.js";
import { normalizeTask } from "../src/workbench/task-model.js";

/* ── #3: title editing ────────────────────────────────────────────── */

test("title: setTaskTitle validates and records event", () => {
  const list = WB.addTask("原标题任务");
  const id = list[0].id;
  const updated = WB.setTaskTitle(id, "新标题：整理比赛资料");
  assert.equal(updated.title, "新标题：整理比赛资料");
  const ev = WB.getTask(id).timeline.find((e) => e.type === "task_title_changed");
  assert.ok(ev, "title change must be recorded");
  // empty/whitespace refused — task untouched
  assert.equal(WB.setTaskTitle(id, "   "), null);
  assert.equal(WB.setTaskTitle(id, ""), null);
  assert.equal(WB.getTask(id).title, "新标题：整理比赛资料");
  // same-title no-op
  const before = WB.getTask(id).timeline.length;
  assert.equal(WB.setTaskTitle(id, "新标题：整理比赛资料").title, "新标题：整理比赛资料");
  assert.equal(WB.getTask(id).timeline.length, before);
  WB.deleteTask(id);
});

/* ── #4: task ↔ place link ────────────────────────────────────────── */

test("place: linkTaskToPlace validates place id (additive placeId)", () => {
  const list = WB.addTask("去现场走访的任务");
  const id = list[0].id;
  // invalid place id refused
  assert.equal(WB.linkTaskToPlace(id, "no-such-place"), null);
  assert.equal(WB.getTask(id).placeId, null);
  // null clears (legal even with no previous link)
  assert.equal(WB.linkTaskToPlace(id, null).placeId, null);
  // legacy records normalize placeId to null
  const n = normalizeTask({ id: "legacy-p", version: 2, title: "旧", goal: "旧", status: "ready" });
  assert.equal(n.placeId, null);
  WB.deleteTask(id);
});

/* ── #5: cross-field search ───────────────────────────────────────── */

test("search: cross-field query over title/goal/notes", () => {
  const tasks = [
    normalizeTask({ id: "s1", version: 2, title: "整理比赛资料", goal: "把报名材料整理好", status: "ready" }),
    normalizeTask({ id: "s2", version: 2, title: "买打印机", goal: "给办公室买一台打印机", status: "created" }),
  ];
  // title hit
  assert.equal(searchTasks(tasks, "比赛").length, 1);
  assert.equal(searchTasks(tasks, "比赛")[0].id, "s1");
  // goal hit
  assert.equal(searchTasks(tasks, "打印机")[0].id, "s2");
  // empty query = everything, unchanged order
  assert.equal(searchTasks(tasks, "").length, 2);
  assert.equal(searchTasks(tasks, null).length, 2);
  // no match = empty (never guess)
  assert.equal(searchTasks(tasks, "不存在的词").length, 0);
  // notes text is searched too
  const withNotes = [
    normalizeTask({ id: "s3", version: 2, title: "任务甲", goal: "目标甲", status: "ready" }),
  ];
  withNotes[0].steps = [];
  const hits = searchTasks(withNotes, "甲");
  assert.equal(hits.length, 1);
});
