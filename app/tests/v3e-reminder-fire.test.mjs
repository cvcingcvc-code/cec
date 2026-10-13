// V3E 任务包 B — 应用内提醒触发（in-app reminder firing）。
//
// 缺口：reminderDueTasks 纯查询存在但无 UI 轮询——Web 环境下（无
// Capacitor）提醒保存后到期应用内毫无反应。本轮补齐：
//   * workbench/reminder-fire.js — 纯触发判定层（去重、静默窗口）
//   * App.jsx 轮询（30s）+ 应用内提醒 banner
//
// 纯 Node 测试（无 localStorage 依赖的纯函数层）。

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pickDueReminders, firedKey, NOTIFIED_STORE_KEY, REMINDER_POLL_MS,
} from "../src/workbench/reminder-fire.js";

const mk = (id, remindAt, status = "ready") => ({ id, title: "任务" + id, status, remindAt });

test("v3e: pickDueReminders returns due tasks (remindAt <= now, within grace)", () => {
  const now = new Date();
  const due = new Date(now.getTime() - 60 * 1000).toISOString(); // 1 min ago (due)
  const future = new Date(now.getTime() + 2 * 60 * 1000).toISOString(); // 2 min ahead
  const later = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 h ahead
  const tasks = [mk("a", due), mk("b", future), mk("c", later)];
  const picked = pickDueReminders(tasks, now.toISOString(), { notifiedIds: [] });
  assert.deepEqual(picked.map((t) => t.id), ["a"], "only the due task fires; future ones wait");
});

test("v3e: pickDueReminders dedupes via firedKey (never fires twice)", () => {
  const now = new Date();
  const due = new Date(now.getTime() - 60 * 1000).toISOString();
  const tasks = [mk("a", due)];
  const r1 = pickDueReminders(tasks, now.toISOString(), { notifiedIds: [] });
  assert.equal(r1.length, 1);
  // second poll with the fired key persisted: a must NOT fire again
  const key = firedKey("a", due);
  const r2 = pickDueReminders(tasks, now.toISOString(), { notifiedIds: [key] });
  assert.equal(r2.length, 0, "already-notified task must not re-fire");
  // a NEW remindAt re-arms the reminder
  const due2 = new Date(now.getTime() - 30 * 1000).toISOString();
  const r3 = pickDueReminders([mk("a", due2)], now.toISOString(), { notifiedIds: [key] });
  assert.equal(r3.length, 1, "a new remindAt re-arms the reminder");
});

test("v3e: pickDueReminders skips terminal and reminder-less tasks", () => {
  const now = new Date();
  const due = new Date(now.getTime() - 60 * 1000).toISOString();
  const tasks = [
    mk("done", due, "completed"),
    mk("fail", due, "failed"),
    mk("none", null),
    mk("bad", "garbage"),
    mk("open", due),
  ];
  const picked = pickDueReminders(tasks, now.toISOString(), { notifiedIds: [] });
  assert.deepEqual(picked.map((t) => t.id), ["open"]);
});

test("v3e: pickDueReminders grace window bounds how far overdue still fires", () => {
  const now = new Date();
  // 2 days overdue — beyond a sane in-app grace window, skip honestly
  const ancient = new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString();
  const fresh = new Date(now.getTime() - 60 * 1000).toISOString();
  const tasks = [mk("ancient", ancient), mk("fresh", fresh)];
  const picked = pickDueReminders(
    tasks,
    now.toISOString(),
    { notifiedIds: [], graceMs: 6 * 3600 * 1000 },
  );
  assert.deepEqual(picked.map((t) => t.id), ["fresh"], "beyond-grace reminders are skipped");
});

test("v3e: constants exported for App wiring (poll interval, store key)", () => {
  assert.equal(typeof REMINDER_POLL_MS, "number");
  assert.ok(REMINDER_POLL_MS >= 15000, "poll interval at least 15s (battery-honest)");
  assert.equal(typeof NOTIFIED_STORE_KEY, "string");
  assert.ok(NOTIFIED_STORE_KEY.startsWith("gorgon_"), "namespaced storage key");
});
