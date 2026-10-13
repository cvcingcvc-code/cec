// Phase 2 schedule view tests — week/month aggregation, sorting, filters,
// and completion-status sync (V23_ACCEPTANCE_MATRIX A2-1/A2-2).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  weekRange, monthRange, groupTasksByDate, tasksInMonth,
} from "../src/lib/schedule-view.js";

const T = (id, { scheduledDate = null, dueAt = null, status = "ready", title = null } = {}) => ({
  id, title: title || `任务${id}`, goal: title || `目标${id}`, status, scheduledDate, dueAt,
});

const localIso = (y, mo, d, hh = 0, mm = 0) => new Date(y, mo - 1, d, hh, mm).toISOString();

/* ── weekRange / monthRange ───────────────────────────────────────── */

test("week: Monday-first 7-day range containing the anchor", () => {
  // 2026-10-14 is a Wednesday. Week = Mon 10-12 .. Sun 10-18.
  const [start, end] = weekRange("2026-10-14");
  assert.equal(start, "2026-10-12");
  assert.equal(end, "2026-10-18");
});

test("week: Sunday belongs to the week that started the previous Monday", () => {
  const [start, end] = weekRange("2026-10-18"); // Sunday
  assert.equal(start, "2026-10-12");
  assert.equal(end, "2026-10-18");
});

test("week: Monday anchor starts the same week", () => {
  const [start, end] = weekRange("2026-10-12"); // Monday
  assert.equal(start, "2026-10-12");
  assert.equal(end, "2026-10-18");
});

test("week: month boundary — Mon Sep 28 week runs into October", () => {
  const [start, end] = weekRange("2026-09-30"); // Wednesday
  assert.equal(start, "2026-09-28");
  assert.equal(end, "2026-10-04");
});

test("month: first..last day of month", () => {
  const [start, end] = monthRange("2026-10-14");
  assert.equal(start, "2026-10-01");
  assert.equal(end, "2026-10-31");
  const [fs, fe] = monthRange("2028-02-10"); // leap
  assert.equal(fs, "2028-02-01");
  assert.equal(fe, "2028-02-29");
});

test("month: invalid input returns [null, null] (never guess)", () => {
  assert.deepEqual(monthRange("bad"), [null, null]);
  assert.deepEqual(monthRange(null), [null, null]);
});

/* ── groupTasksByDate ─────────────────────────────────────────────── */

test("group: explicit scheduledDate wins; dueAt local date as fallback", () => {
  const tasks = [
    T("a", { scheduledDate: "2026-10-14" }),
    T("b", { dueAt: localIso(2026, 10, 14, 18, 30) }),
    T("c", { dueAt: localIso(2026, 10, 15, 9, 0) }),
    T("d", {}), // no date at all
  ];
  const groups = groupTasksByDate(tasks);
  assert.deepEqual(groups["2026-10-14"].map((t) => t.id).sort(), ["a", "b"]);
  assert.deepEqual(groups["2026-10-15"].map((t) => t.id), ["c"]);
  assert.equal(groups["2026-10-20"], undefined);
});

test("group: dateless tasks land in the _undated bucket", () => {
  const tasks = [T("a", {}), T("b", { scheduledDate: "2026-10-14" })];
  const groups = groupTasksByDate(tasks);
  assert.deepEqual(groups._undated.map((t) => t.id), ["a"]);
  assert.equal(groups["2026-10-14"].length, 1);
});

test("group: completed tasks stay in their day (history view)", () => {
  const tasks = [T("done1", { scheduledDate: "2026-10-14", status: "completed" })];
  const groups = groupTasksByDate(tasks, { includeCompleted: true });
  assert.equal(groups["2026-10-14"].length, 1);
  // excluded by default? No — grouping is date-agnostic; filtering is separate.
  const all = groupTasksByDate(tasks);
  assert.equal(all["2026-10-14"].length, 1);
});

/* ── tasksInMonth ─────────────────────────────────────────────────── */

test("month: tasksInMonth filters by the task's effective local day", () => {
  const tasks = [
    T("in1", { scheduledDate: "2026-10-05" }),
    T("in2", { dueAt: localIso(2026, 10, 20, 12, 0) }),
    T("out", { scheduledDate: "2026-11-01" }),
  ];
  const inMonth = tasksInMonth(tasks, "2026-10-14");
  assert.deepEqual(inMonth.map((t) => t.id).sort(), ["in1", "in2"]);
});
