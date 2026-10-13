// V3 Phase A (gap 1) — local reminders: remindAt additive field + queries.
//
// Pins down:
//   * createTask accepts remindAt; old records normalize to null (additive).
//   * setTaskReminder facade: valid saves, invalid refused (never guess),
//     null clears, no-op when unchanged, timeline event recorded.
//   * reminder-model pure helpers: normRemindAtOrNull / describeReminder /
//     reminderDueTasks / reminderMode (web probe → unsupported).
//   * native-reminders: notificationIdFor stability + dedupe, schedule
//     fire-and-forget contract (clear/past/unsupported/permission paths).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTask, normalizeTask, transitionTaskState, TASK_STATUS,
} from "../src/workbench/task-model.js";
import {
  normRemindAtOrNull, describeReminder, reminderDueTasks, reminderMode,
  REMINDER_MODE, REMINDER_LEAD_CHOICES,
} from "../src/workbench/reminder-model.js";
import {
  notificationIdFor, hasLocalNotifications, scheduleReminder,
} from "../src/lib/native-reminders.js";

/* ── task-model: additive remindAt field ──────────────────────────── */

test("remindAt: createTask defaults to null", () => {
  const t = createTask("写周报");
  assert.equal(t.remindAt, null);
});

test("remindAt: createTask accepts a valid ISO string", () => {
  const t = createTask("写周报", { remindAt: "2026-10-20T09:00:00+08:00" });
  assert.ok(t.remindAt && t.remindAt.endsWith("Z"));
});

test("remindAt: invalid values degrade to null (never guess)", () => {
  assert.equal(createTask("A", { remindAt: "garbage" }).remindAt, null);
  assert.equal(createTask("B", { remindAt: 42 }).remindAt, null);
  assert.equal(createTask("C", { remindAt: "" }).remindAt, null);
});

test("remindAt: old records normalize to null (additive, no migration)", () => {
  const legacy = { id: "t1", version: 2, title: "旧任务", goal: "旧任务", status: "ready" };
  const n = normalizeTask(legacy);
  assert.equal(n.remindAt, null);
  assert.equal(n.status, "ready"); // untouched
});

test("remindAt: explicit value survives normalize; invalid degrades", () => {
  const ok = normalizeTask({ id: "t2", version: 2, title: "x", goal: "x", status: "ready", remindAt: "2026-10-21T10:00:00Z" });
  assert.equal(ok.remindAt, "2026-10-21T10:00:00.000Z");
  const bad = normalizeTask({ id: "t3", version: 2, title: "y", goal: "y", status: "ready", remindAt: "not-a-date" });
  assert.equal(bad.remindAt, null);
});

test("remindAt: transition preserves remindAt", () => {
  const t = createTask("任务", { remindAt: "2026-10-21T10:00:00Z" });
  const moved = transitionTaskState(t, TASK_STATUS.READY);
  assert.equal(moved.remindAt, "2026-10-21T10:00:00.000Z");
});

/* ── reminder-model pure helpers ──────────────────────────────────── */

test("normRemindAtOrNull: null clears, garbage -> null, valid -> ISO", () => {
  assert.equal(normRemindAtOrNull(null), null);
  assert.equal(normRemindAtOrNull(undefined), null);
  assert.equal(normRemindAtOrNull("garbage"), null);
  assert.equal(normRemindAtOrNull(123), null);
  const iso = normRemindAtOrNull("2026-10-20T09:00:00+08:00");
  assert.equal(iso, "2026-10-20T01:00:00.000Z");
});

test("describeReminder: human CN text; empty for falsy/invalid", () => {
  assert.equal(describeReminder(null), "");
  assert.equal(describeReminder("garbage"), "");
  const s = describeReminder(new Date(2026, 9, 15, 9, 5).toISOString());
  assert.equal(s, "10月15日 09:05");
});

test("reminderDueTasks: open tasks inside window only", () => {
  const now = new Date();
  const mk = (ms) => new Date(now.getTime() + ms).toISOString();
  const tasks = [
    { id: "in-window", status: "ready", remindAt: mk(4 * 60000) },
    { id: "too-late", status: "ready", remindAt: mk(30 * 60000) },
    { id: "completed", status: "completed", remindAt: mk(2 * 60000) },
    { id: "failed", status: "failed", remindAt: mk(2 * 60000) },
    { id: "no-remind", status: "ready" },
    { id: "bad-date", status: "ready", remindAt: "garbage" },
  ];
  const out = reminderDueTasks(tasks, now, 5 * 60000);
  assert.deepEqual(out.map((t) => t.id), ["in-window"]);
});

test("reminderDueTasks: zero window excludes everything future", () => {
  const now = new Date();
  const tasks = [{ id: "x", status: "ready", remindAt: new Date(now.getTime() + 60000).toISOString() }];
  assert.equal(reminderDueTasks(tasks, now, 0).length, 0);
});

test("REMINDER_LEAD_CHOICES: includes at-time and offsets", () => {
  const minutes = REMINDER_LEAD_CHOICES.map((c) => c.minutes);
  assert.ok(minutes.includes(0));
  assert.ok(minutes.includes(60));
});

/* ── native-reminders: id stability + fire-and-forget contract ───── */

test("notificationIdFor: stable and 31-bit safe", () => {
  const a = notificationIdFor("task-abc");
  const b = notificationIdFor("task-abc");
  assert.equal(a, b); // stable → resaves update the same notification
  assert.ok(a >= 0 && a < 2147483647);
  assert.notEqual(notificationIdFor("task-abc"), notificationIdFor("task-other"));
});

test("hasLocalNotifications: false on plain Node (no Capacitor)", () => {
  assert.equal(hasLocalNotifications(), false);
});

test("scheduleReminder: unsupported on plain Node (fire-and-forget, no throw)", async () => {
  const t = { id: "x", title: "任务", remindAt: new Date(Date.now() + 600000).toISOString() };
  const st = await scheduleReminder(t);
  assert.equal(st.scheduled, false);
  assert.equal(st.reason, "unsupported");
});

test("scheduleReminder: past time -> reason 'past' (honest skip)", async () => {
  const t = { id: "x", title: "任务", remindAt: new Date(Date.now() - 600000).toISOString() };
  const st = await scheduleReminder(t);
  assert.equal(st.scheduled, false);
  assert.equal(st.reason, "past");
});

test("scheduleReminder: null remindAt -> reason 'cleared' (cancel path)", async () => {
  const st = await scheduleReminder({ id: "x", title: "任务", remindAt: null });
  assert.equal(st.scheduled, false);
  assert.equal(st.reason, "cleared");
});

test("scheduleReminder: invalid remindAt -> reason 'error'", async () => {
  const st = await scheduleReminder({ id: "x", title: "任务", remindAt: "garbage" });
  assert.equal(st.scheduled, false);
  assert.equal(st.reason, "error");
});

test("scheduleReminder: missing task -> reason 'error'", async () => {
  const st = await scheduleReminder(null);
  assert.equal(st.scheduled, false);
  assert.equal(st.reason, "error");
});

test("reminderMode: unsupported on plain Node (web honesty)", () => {
  assert.equal(reminderMode(), REMINDER_MODE.UNSUPPORTED);
});
