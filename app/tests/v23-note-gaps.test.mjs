// V2.3 Phase 4 (笔记与录音) — gap tests for notes + audio pointers.
//
// 用户指令：笔记 CRUD/搜索/关联/自动保存/导出 + Android 录音。
// 数据层先行：本文件覆盖 store 层缺口（全局笔记搜索 / 导出形状 /
// audio 指针字段 / 关联过滤），UI 层（笔记中心 + 录音入口）随后接线。
//
// 录音诚实纪律：浏览器 MediaRecorder 存在 ≠ 真机可用 —— Capacitor 录音
// 插件未装（node_modules 只有 core/filesystem/preferences），真机录音
// 标 BLOCKED/NOT_TESTED，数据层只锚定 audio 指针形状（audioPath +
// audioDurationMs），录音文件本体不入 envelope。

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
import { searchNotes, exportNotesText } from "../src/lib/note-view.js";

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  P.reset();
  O.reset();
  Repo.resetTaskStorage();
});

/* ── 全局笔记搜索（lib/note-view.js 纯函数） ──────────────────────────── */

test("P4 G-1: searchNotes matches text case-insensitively", () => {
  const notes = [
    { id: "1", kind: "text", text: "前台 9 点开门" },
    { id: "2", kind: "text", text: "Need to follow up on pricing" },
    { id: "3", kind: "audio", text: "", audioPath: "recordings/a.m4a", audioDurationMs: 45000 },
  ];
  assert.deepEqual(searchNotes(notes, "前台").map((n) => n.id), ["1"]);
  assert.deepEqual(searchNotes(notes, "PRICING").map((n) => n.id), ["2"]);
  // audio 指针也参与搜索（文件名命中）
  assert.deepEqual(searchNotes(notes, "a.m4a").map((n) => n.id), ["3"]);
  // 空查询 = 全量
  assert.deepEqual(searchNotes(notes, "").length, 3);
  // 无命中
  assert.deepEqual(searchNotes(notes, "不存在"), []);
  assert.deepEqual(searchNotes(null, "x"), []);
});

/* ── 导出（纯文本形状，无外部依赖） ────────────────────────────────────── */

test("P4 G-2: exportNotesText renders a readable plain-text digest", () => {
  const notes = [
    { id: "a", kind: "text", text: "第一条笔记", createdAt: "2026-10-13T08:00:00.000Z", updatedAt: "2026-10-13T08:00:00.000Z" },
    { id: "b", kind: "text", text: "第二条笔记", createdAt: "2026-10-12T08:00:00.000Z", updatedAt: "2026-10-12T08:00:00.000Z" },
  ];
  const out = exportNotesText(notes);
  assert.ok(out.includes("第一条笔记"));
  assert.ok(out.includes("第二条笔记"));
  assert.ok(out.includes("2026")); // date rendered
  // oldest first（导出按时间正序读起来自然）
  assert.ok(out.indexOf("第二条笔记") < out.indexOf("第一条笔记"));
  // 空列表有诚实占位
  assert.ok(exportNotesText([]).length > 0);
});

/* ── store 层：audio 指针 + 关联（既有形状锚定） ───────────────────────── */

test("P4 G-3: note audio pointer shape — audioPath + duration kept, kind=audio", () => {
  const n = WB.addNote({
    kind: "audio",
    text: "录音备注：前台说下周再联系",
    audioPath: "recordings/test-1.m4a",
    audioDurationMs: 45000,
  });
  assert.equal(n.kind, "audio");
  assert.equal(n.audioPath, "recordings/test-1.m4a");
  assert.equal(n.audioDurationMs, 45000);

  // text kind normalize：audio 字段清空
  const t = WB.addNote({ kind: "text", text: "纯文本", audioPath: "x.m4a" });
  assert.equal(t.kind, "text");
  assert.equal(t.audioPath, null);
});

test("P4 G-4: notes associate with task and place simultaneously (facade level)", () => {
  const place = WB.upsertPlace({ name: "关联测试地点" });
  const tasks = WB.addTask("关联测试任务");
  const task = tasks[0];

  const n = WB.addNote({ text: "双重关联笔记", placeId: place.id, taskId: task.id });
  assert.equal(n.placeId, place.id);
  assert.equal(n.taskId, task.id);

  // 按地点过滤
  assert.equal(WB.getNotes({ placeId: place.id }).length, 1);
  // 按任务过滤
  assert.equal(WB.getNotes({ taskId: task.id }).length, 1);
  // 任务时间线收到 note_linked 事件
  const tl = WB.getTask(task.id).timeline;
  assert.ok(tl.some((e) => e.type === "note_linked"));

  // cleanup
  WB.removeNote(n.id);
  WB.removePlace(place.id);
});

test("P4 G-5: updateNote edits text and bumps updatedAt", () => {
  const n = WB.addNote({ text: "原始内容" });
  const updated = WB.updateNote(n.id, { text: "修改后内容" });
  assert.equal(updated.text, "修改后内容");
  assert.ok(updated.updatedAt >= n.updatedAt);
  assert.equal(WB.getNotes({})[0].text, "修改后内容");
  WB.removeNote(n.id);
});

test("P4 G-6: removeNote deletes exactly one note", () => {
  const a = WB.addNote({ text: "A" });
  const b = WB.addNote({ text: "B" });
  assert.ok(WB.removeNote(a.id));
  const rest = WB.getNotes({});
  assert.ok(!rest.some((n) => n.id === a.id));
  assert.ok(rest.some((n) => n.id === b.id));
  WB.removeNote(b.id);
});
