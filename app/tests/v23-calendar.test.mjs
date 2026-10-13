// Phase 2 calendar.js tests — G_DATE_PICKER.md G5 checklist (pure layer).
//
// Covers: month boundaries (#1/#2), leap years (#3/#4), cross-year (#5),
// Monday-first grid (#6), conflict detection, day arithmetic, CN labels,
// and the time-slot semantics (scheduledDate local / dueAt UTC ISO).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WEEKDAY_HEADERS, jsDayToColumn, todayStr, parseDay, diffDays, addDays,
  sameDay, formatCN, formatCNTime, formatCNMonth, monthGrid, daysInMonth,
  taskDaySlot, conflictIdsOnDate, findConflictFor, sortTasksForDay,
} from "../src/lib/calendar.js";

/* ── Month grid & boundaries (G5 #1/#2/#3/#4) ─────────────────────── */

test("grid: January back-arrow reaches previous December (boundary)", () => {
  // 2026-01-01 is a Thursday; its Monday-first grid starts 2024-12-29.
  const cells = monthGrid(2026, 1);
  assert.equal(cells.length, 42);
  assert.ok(cells[0].dayStr.startsWith("2025-12"), "leading cells come from Dec 2025");
  assert.equal(cells[0].inMonth, false);
});

test("grid: December forward reaches next January (boundary)", () => {
  const cells = monthGrid(2026, 12);
  const last = cells[41];
  assert.ok(last.dayStr.startsWith("2027-01"), "trailing cells come from Jan 2027");
  assert.equal(last.inMonth, false);
});

test("grid: leap year 2028-02 contains the 29th", () => {
  assert.equal(daysInMonth(2028, 2), 29);
  const cells = monthGrid(2028, 2);
  assert.ok(cells.some((c) => c.dayStr === "2028-02-29" && c.inMonth));
});

test("grid: non-leap 2027-02 has 28 days, no 29th", () => {
  assert.equal(daysInMonth(2027, 2), 28);
  const cells = monthGrid(2027, 2);
  assert.ok(!cells.some((c) => c.dayStr === "2027-02-29"));
});

test("grid: invalid month returns empty (never guess)", () => {
  assert.deepEqual(monthGrid(2026, 0), []);
  assert.deepEqual(monthGrid(2026, 13), []);
  assert.deepEqual(monthGrid("x", 5), []);
});

/* ── Monday-first layout (G5 #6) ──────────────────────────────────── */

test("grid: 2026-10-01 (Thursday) sits in the 四 column", () => {
  const cells = monthGrid(2026, 10);
  const idx = cells.findIndex((c) => c.dayStr === "2026-10-01");
  assert.ok(idx >= 0);
  assert.equal(idx % 7, 3, "Mon=0..Thu=3");
  assert.equal(jsDayToColumn(new Date(2026, 9, 1).getDay()), 3);
  // The grid header for that column is 四.
  assert.equal(WEEKDAY_HEADERS[3], "四");
});

test("grid: first row left side shows previous-month days (weakened)", () => {
  const cells = monthGrid(2026, 10); // Oct 1 2026 is Thursday → 3 leading cells
  assert.equal(cells[0].inMonth, false);
  assert.ok(cells[0].dayStr.startsWith("2026-09"));
});

/* ── Day arithmetic & comparisons ─────────────────────────────────── */

test("dates: addDays / diffDays round-trip across month ends", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29"); // leap
  assert.equal(addDays("2027-02-28", 1), "2027-03-01"); // non-leap
  assert.equal(diffDays("2026-10-01", "2026-10-14"), 13);
  assert.equal(diffDays("2026-10-14", "2026-10-01"), -13);
  assert.equal(diffDays("2026-12-31", "2027-01-01"), 1);
  assert.equal(addDays("bad", 1), null);
  assert.equal(diffDays("bad", "2026-01-01"), null);
});

test("dates: parseDay rejects impossible dates (never guess)", () => {
  assert.equal(parseDay("2026-02-30"), null);
  assert.equal(parseDay("2026-13-01"), null);
  assert.equal(parseDay("2026-10-1"), null); // must be zero-padded
  assert.ok(parseDay("2026-10-14") instanceof Date);
});

test("dates: sameDay only matches identical YYYY-MM-DD", () => {
  assert.equal(sameDay("2026-10-14", "2026-10-14"), true);
  assert.equal(sameDay("2026-10-14", "2026-10-15"), false);
  assert.equal(sameDay(null, "2026-10-14"), false);
});

/* ── Chinese formatting (G5 #14 display side) ─────────────────────── */

test("cn: formatCN renders 2026年10月14日 周三", () => {
  // 2026-10-14 is a Wednesday.
  assert.equal(formatCN("2026-10-14"), "2026年10月14日 周三");
  assert.equal(formatCNTime("2026-10-14", "14:00"), "2026年10月14日 周三 14:00");
  assert.equal(formatCNTime("2026-10-14", null), "2026年10月14日 周三");
  assert.equal(formatCN("bad"), null);
  assert.equal(formatCNMonth(2026, 10), "2026年10月");
});

/* ── Task slots & conflicts (Phase 2 #4) ──────────────────────────── */

test("slots: dueAt UTC ISO maps to LOCAL minutes", () => {
  // Construct a dueAt whose LOCAL time is 18:30.
  const d = new Date(2026, 9, 14, 18, 30);
  const task = { id: "t1", dueAt: d.toISOString() };
  const slot = taskDaySlot(task, "2026-10-14");
  assert.equal(slot.timed, true);
  assert.equal(slot.start, 18 * 60 + 30);
  assert.equal(slot.end, 18 * 60 + 30 + 60);
});

test("slots: date-only task appears but never conflicts", () => {
  const task = { id: "t2", scheduledDate: "2026-10-14", dueAt: null };
  const slot = taskDaySlot(task, "2026-10-14");
  assert.equal(slot.timed, false);
  assert.deepEqual(conflictIdsOnDate([task, { id: "t3", scheduledDate: "2026-10-14", dueAt: null }], "2026-10-14"), {});
});

test("conflicts: overlapping due windows on the same day are flagged", () => {
  const a = { id: "a", dueAt: new Date(2026, 9, 14, 10, 0).toISOString() };
  const b = { id: "b", dueAt: new Date(2026, 9, 14, 10, 30).toISOString() }; // inside a's 60-min window
  const c = { id: "c", dueAt: new Date(2026, 9, 14, 15, 0).toISOString() };  // far away
  const flagged = conflictIdsOnDate([a, b, c], "2026-10-14");
  assert.equal(flagged.a, true);
  assert.equal(flagged.b, true);
  assert.equal(flagged.c, undefined);
  // Different day → no conflict.
  assert.deepEqual(conflictIdsOnDate([a, b], "2026-10-15"), {});
});

test("conflicts: findConflictFor returns the OTHER task (self excluded)", () => {
  const a = { id: "a", dueAt: new Date(2026, 9, 14, 10, 0).toISOString() };
  const b = { id: "b", dueAt: new Date(2026, 9, 14, 10, 30).toISOString() };
  // Rescheduling a to 10:15 hits b; rescheduling b to 10:15 hits a, not itself.
  assert.equal(findConflictFor("a", new Date(2026, 9, 14, 10, 15).toISOString(), [a, b]).id, "b");
  assert.equal(findConflictFor("b", new Date(2026, 9, 14, 10, 15).toISOString(), [a, b]).id, "a");
  // Moving far away → no conflict.
  assert.equal(findConflictFor("a", new Date(2026, 9, 14, 20, 0).toISOString(), [a, b]), null);
  // Invalid input → null.
  assert.equal(findConflictFor("a", null, [a, b]), null);
});

/* ── Day ordering (Phase 2 #6) ────────────────────────────────────── */

test("sort: timed tasks by start, untimed last, stable zh names", () => {
  const t1 = { id: "1", title: "晚上的任务", dueAt: new Date(2026, 9, 14, 20, 0).toISOString() };
  const t2 = { id: "2", title: "早上的任务", dueAt: new Date(2026, 9, 14, 8, 0).toISOString() };
  const t3 = { id: "3", title: "只有日期", scheduledDate: "2026-10-14", dueAt: null };
  const sorted = sortTasksForDay([t1, t2, t3], "2026-10-14");
  assert.deepEqual(sorted.map((t) => t.id), ["2", "1", "3"]);
});

/* ── Timezone semantics (G5 #16) ──────────────────────────────────── */

test("tz: new Date(dueAt) local time == constructed local time (round-trip)", () => {
  const want = new Date(2026, 9, 14, 18, 30);
  const iso = want.toISOString();
  const back = new Date(iso);
  assert.equal(back.getHours(), 18);
  assert.equal(back.getMinutes(), 30);
  assert.equal(todayStr(back), "2026-10-14");
});
