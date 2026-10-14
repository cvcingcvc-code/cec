// V3F 任务 B2/H — activity-recency unit tests.
//
// Pins the ONE rule the task book demands: 活动时间明确已经结束的，
// 不再出现在"即将开始"。All instants are fixed — no hard-coded "now"
// anywhere in the module under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  endInstantOf, startInstantOf, isExpired, isToday, inRecencyWindow,
  recencyGroupOf, partitionByRecency, whenFilter, recencyLabel,
} from "../src/lib/activity-recency.js";

// Fixed baseline: 2026-10-14 12:00 local (the task book's reference date).
const NOW = new Date(2026, 9, 14, 12, 0, 0);

function isoView(startDate, opts = {}) {
  return {
    id: opts.id || "a1",
    startDate,
    startTime: opts.startTime != null ? opts.startTime : "14:00",
    endTime: opts.endTime != null ? opts.endTime : "17:00",
  };
}

test("R1: past activity (ended yesterday evening) is expired", () => {
  const v = isoView("2026-10-13");
  assert.equal(isExpired(v, NOW), true);
});

test("R2: past activity is NOT in the 未来7天/未来30天 window", () => {
  const v = isoView("2026-09-20"); // the September data the user saw
  assert.equal(inRecencyWindow(v, 7, NOW), false);
  assert.equal(inRecencyWindow(v, 30, NOW), false);
  assert.equal(recencyGroupOf(v, NOW), "expired");
});

test("R3: activity running right now (started 10:00, ends 17:00) is not expired", () => {
  const v = isoView("2026-10-14", { startTime: "10:00", endTime: "17:00" });
  assert.equal(isExpired(v, NOW), false);
  assert.equal(recencyGroupOf(v, NOW), "today");
});

test("R4: activity that ended earlier today (09:00-11:00) is expired", () => {
  const v = isoView("2026-10-14", { startTime: "09:00", endTime: "11:00" });
  assert.equal(isExpired(v, NOW), true);
  // ...but it is still "today" for the 当天 grouping? No: expired wins.
  assert.equal(recencyGroupOf(v, NOW), "expired");
});

test("R5: date without time runs until midnight — expired the day after", () => {
  const v = isoView("2026-10-14", { startTime: null, endTime: null });
  assert.equal(isExpired(v, NOW), false); // 12:00 < midnight
  const later = new Date(2026, 9, 15, 0, 30);
  assert.equal(isExpired(v, later), true);
});

test("R6: undated view (dayKey-only demo row) is never expired", () => {
  const v = { id: "demo1", date: "周六 6.20", day: "sat", time: "14:00" };
  assert.equal(isExpired(v, NOW), false);
  assert.equal(recencyGroupOf(v, NOW), "undated");
});

test("R7: endInstantOf prefers endMinutes over endTime string", () => {
  const v = { id: "x", startDate: "2026-10-14", endMinutes: 22 * 60 };
  const end = endInstantOf(v);
  assert.equal(end.getHours(), 22);
  assert.equal(end.getMinutes(), 0);
});

test("R8: startInstantOf derives from startTime", () => {
  const v = isoView("2026-10-14", { startTime: "09:30" });
  const s = startInstantOf(v);
  assert.equal(s.getHours(), 9);
  assert.equal(s.getMinutes(), 30);
});

test("R9: partitionByRecency splits the four groups", () => {
  const views = [
    isoView("2026-10-14", { id: "live", startTime: "10:00", endTime: "20:00" }),
    isoView("2026-10-16", { id: "soon" }),
    isoView("2026-09-20", { id: "old" }),
    { id: "nodate", day: "sat" },
    isoView("2026-11-20", { id: "far" }),
  ];
  const p = partitionByRecency(views, NOW);
  assert.deepEqual(p.today.map((v) => v.id), ["live"]);
  assert.deepEqual(p.upcoming.map((v) => v.id), ["soon", "far"]);
  assert.deepEqual(p.expired.map((v) => v.id), ["old"]);
  assert.deepEqual(p.undated.map((v) => v.id), ["nodate"]);
});

test("R10: whenFilter 今天/未来7天/未来30天/全部 semantics", () => {
  const views = [
    isoView("2026-10-14", { id: "live", startTime: "10:00", endTime: "20:00" }),
    isoView("2026-10-14", { id: "doneToday", startTime: "08:00", endTime: "10:00" }),
    isoView("2026-10-18", { id: "in4" }),
    isoView("2026-10-25", { id: "in11" }),
    isoView("2026-09-20", { id: "old" }),
  ];
  assert.deepEqual(whenFilter(views, "今天", NOW).map((v) => v.id), ["live"]);
  assert.deepEqual(whenFilter(views, "未来7天", NOW).map((v) => v.id), ["live", "in4"]);
  assert.deepEqual(whenFilter(views, "未来30天", NOW).map((v) => v.id), ["live", "in4", "in11"]);
  assert.equal(whenFilter(views, "全部", NOW).length, 5);
});

test("R11: boundary — ends exactly at now counts as expired", () => {
  const v = isoView("2026-10-14", { startTime: "10:00", endTime: "12:00" });
  assert.equal(isExpired(v, NOW), true);
});

test("R12: recencyLabel + isToday on the reference date", () => {
  const live = isoView("2026-10-14", { startTime: "10:00", endTime: "20:00" });
  const old = isoView("2026-09-20");
  assert.equal(recencyLabel(live, NOW), "今天");
  assert.equal(recencyLabel(old, NOW), "已结束");
  assert.equal(isToday(live, NOW), true);
});
