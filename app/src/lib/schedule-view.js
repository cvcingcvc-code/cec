// Gorgon Workbench — schedule-view.js (Phase 2, pure view-model helpers).
//
// PURE MODULE: no DOM, no React, no storage. Powers the new 周/月 views
// and the month-grid screen. Unit-testable in plain Node.
//
// Timezone rules (unchanged hard contract):
//   * scheduledDate is a LOCAL "YYYY-MM-DD" calendar day and WINS.
//   * dueAt is a UTC ISO instant; its LOCAL date is the fallback day.
//   * Tasks with neither land in the "_undated" bucket.

import { parseDay, todayStr, addDays, diffDays } from "./calendar.js";

/** The date a task belongs to: scheduledDate first, else dueAt's local day. */
export function effectiveDay(task) {
  if (!task) return null;
  if (typeof task.scheduledDate === "string" && task.scheduledDate) return task.scheduledDate;
  if (task.dueAt) {
    const d = new Date(task.dueAt);
    if (!isNaN(d.getTime())) return todayStr(d);
  }
  return null;
}

/**
 * Monday-first 7-day range [start,end] containing the anchor "YYYY-MM-DD".
 * Returns [null, null] for invalid anchors.
 */
export function weekRange(anchorDay) {
  const d = parseDay(anchorDay);
  if (!d) return [null, null];
  const lead = (d.getDay() + 6) % 7; // Monday-first offset
  const start = todayStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - lead));
  return [start, addDays(start, 6)];
}

/** [first, last] "YYYY-MM-DD" of the month containing the anchor. */
export function monthRange(anchorDay) {
  const d = parseDay(anchorDay);
  if (!d) return [null, null];
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [todayStr(first), todayStr(last)];
}

/**
 * Group tasks by their effective local day.
 * Returns { "YYYY-MM-DD": [tasks...], _undated: [tasks...] }.
 * Grouping is date-agnostic — status filtering is the caller's job.
 */
export function groupTasksByDate(tasks, { includeCompleted = true } = {}) {
  const groups = { _undated: [] };
  if (!Array.isArray(tasks)) return groups;
  for (const t of tasks) {
    if (!t) continue;
    if (!includeCompleted && t.status === "completed") continue;
    const day = effectiveDay(t);
    if (!day) { groups._undated.push(t); continue; }
    (groups[day] = groups[day] || []).push(t);
  }
  return groups;
}

/** Tasks whose effective local day falls inside the month of `anchorDay`. */
export function tasksInMonth(tasks, anchorDay) {
  const [start, end] = monthRange(anchorDay);
  if (!start) return [];
  return (Array.isArray(tasks) ? tasks : []).filter((t) => {
    const day = effectiveDay(t);
    return day && day >= start && day <= end;
  });
}

/** Tasks whose effective local day falls inside the week of `anchorDay`. */
export function tasksInWeek(tasks, anchorDay) {
  const [start, end] = weekRange(anchorDay);
  if (!start) return [];
  return (Array.isArray(tasks) ? tasks : []).filter((t) => {
    const day = effectiveDay(t);
    return day && day >= start && day <= end;
  });
}

/**
 * 过期任务提醒 (Phase 2 #5): open tasks whose effective day is strictly
 * before `today` — or whose dueAt instant has already passed while still
 * open. Completed/failed tasks never remind.
 */
export function overdueTaskIds(tasks, nowIso) {
  const now = nowIso ? new Date(nowIso) : new Date();
  const today = todayStr(now);
  const ids = [];
  const OPEN = ["created", "planning", "ready", "running", "review_required"];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t || OPEN.indexOf(t.status) < 0) continue;
    const day = effectiveDay(t);
    if (day && day < today) { ids.push(t.id); continue; }
    if (t.dueAt) {
      const due = new Date(t.dueAt);
      if (!isNaN(due.getTime()) && due < now) ids.push(t.id);
    }
  }
  return ids;
}
