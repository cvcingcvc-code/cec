// Gorgon — Activity recency model (V3F 任务 B2/B3).
//
// ONE place that decides whether an activity is expired, upcoming, or
// happening today — derived from the device clock, never a hard-coded date.
// Every screen that lists activities routes its rows through this module, so
// "活动时间明确已经结束的，不再出现在'即将开始'" holds everywhere at once.
//
// Design rules (V3F task B):
//   - No hard-coded "now": the caller passes `now` (default = real clock).
//     Unit tests pin the semantics with fixed instants.
//   - A view without ANY usable date (dayKey-only demo rows) is never called
//     expired — it has no time to end. It lands in "日期待定".
//   - Expired activities are not deleted: My Weekend keeps showing what the
//     user saved, grouped under "已结束", with an honest label.

import { parseIso, minutesOf } from "./activity-view.js";

/** Local midnight of the given Date, as a Date. */
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days between two midnights (b - a), calendar-based. */
function dayDiff(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / (24 * 3600 * 1000));
}

/**
 * The activity's end instant, as a Date in local time — or null when the
 * record carries no usable date. `endMinutes` defaults to end-of-day: an
 * event that lists a date but no time is treated as running until midnight,
 * so on its own day it is still "today", and the day after it is expired.
 */
export function endInstantOf(view, ) {
  if (!view) return null;
  // ISO date (canonical pipeline shape / generated data) wins.
  const date = parseIso(view.startDate) || parseIso(view.date);
  if (!date) return null; // no usable date — never called expired
  const endMinutes = view.endMinutes != null
    ? view.endMinutes
    : minutesOf(view.endTime) != null ? minutesOf(view.endTime)
    : 24 * 60;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(),
    Math.floor(endMinutes / 60), endMinutes % 60);
}

/** The activity's start instant, as a Date in local time — or null. */
export function startInstantOf(view) {
  if (!view) return null;
  const date = parseIso(view.startDate) || parseIso(view.date);
  if (!date) return null;
  const startMinutes = view.startMinutes != null ? view.startMinutes
    : minutesOf(view.startTime) != null ? minutesOf(view.startTime) : 0;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(),
    Math.floor(startMinutes / 60), startMinutes % 60);
}

/**
 * true when the activity has fully ended at `now`.
 * A record with no usable date returns false — "日期待定" is not "已结束".
 */
export function isExpired(view, now) {
  const end = endInstantOf(view);
  if (!end) return false;
  const t = now instanceof Date ? now : new Date(now || Date.now());
  return end.getTime() <= t.getTime();
}

/** true when the activity starts today (or is running today). */
export function isToday(view, now) {
  const start = startInstantOf(view);
  if (!start) return false;
  const t = now instanceof Date ? now : new Date(now || Date.now());
  return dayDiff(t, start) === 0;
}

/** true when the activity starts within the next `days` days (inclusive). */
export function inRecencyWindow(view, days, now) {
  const start = startInstantOf(view);
  if (!start) return false;
  const t = now instanceof Date ? now : new Date(now || Date.now());
  const diff = dayDiff(t, start);
  return diff >= 0 && diff <= days;
}

/**
 * Recency group of ONE view, for display grouping.
 *   "today"      — started or starting today
 *   "upcoming"   — starts tomorrow .. +30 days
 *   "expired"    — fully ended
 *   "undated"    — no usable date at all
 */
export function recencyGroupOf(view, now) {
  if (isExpired(view, now)) return "expired";
  if (isToday(view, now)) return "today";
  if (inRecencyWindow(view, 30, now)) return "upcoming";
  if (startInstantOf(view) == null) return "undated";
  // Starts more than 30 days out — still upcoming, not expired.
  return "upcoming";
}

/**
 * Partition a list of views into display groups. Order is stable within each
 * group (input order preserved), groups themselves come back as one object.
 */
export function partitionByRecency(views, now) {
  const out = { today: [], upcoming: [], expired: [], undated: [] };
  for (const v of views || []) {
    out[recencyGroupOf(v, now)].push(v);
  }
  return out;
}

/**
 * The Discover "when" filter, made real:
 *   "今天"     → started or starting today
 *   "未来7天"  → today .. +7 days (expired rows excluded)
 *   "未来30天" → today .. +30 days (expired rows excluded)
 *   "全部"     → everything, expired included but the group is labelled
 * Returns the filtered list of RAW records (the screen's own shape).
 */
export function whenFilter(views, when, now) {
  const t = now instanceof Date ? now : new Date(now || Date.now());
  switch (when) {
    case "今天":
      return (views || []).filter((v) => isToday(v, t) && !isExpired(v, t));
    case "未来7天":
      return (views || []).filter((v) => inRecencyWindow(v, 7, t) && !isExpired(v, t));
    case "未来30天":
      return (views || []).filter((v) => inRecencyWindow(v, 30, t) && !isExpired(v, t));
    case "全部":
    default:
      return views || [];
  }
}

/** "已结束" / "进行中" label for the detail page. */
export function recencyLabel(view, now) {
  const g = recencyGroupOf(view, now);
  if (g === "expired") return "已结束";
  if (g === "today") return "今天";
  return null;
}
