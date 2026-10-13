// Gorgon Workbench — calendar.js (Phase 2, G-1 pure function module).
//
// PURE MODULE: no DOM, no React, no storage. Unit-testable in plain Node.
//
// Contents (per docs/workbench/ui-redesign/G_DATE_PICKER.md G1/G5):
//   * monthGrid(year, month)      — 7×6 grid, Monday-first
//   * sameDay / compareDays       — date comparisons on "YYYY-MM-DD"
//   * addDays / todayStr          — local-date arithmetic
//   * formatCN / formatCNTime     — Chinese labels ("2026年10月14日 周三")
//   * taskMinutes / conflictsOnDate — task conflict detection for one day
//   * sortTasksForDay             — deterministic day ordering
//
// Timezone rules (hard contract, unchanged from the existing app):
//   * scheduledDate is a LOCAL "YYYY-MM-DD" calendar day.
//   * dueAt is a UTC ISO instant; its LOCAL date is derived via Date.
//   * No helper here ever invents a timezone or guesses a missing value.

// ── Weekday vocabulary (Monday-first, 中文习惯) ───────────────────────
export const WEEKDAY_HEADERS = ["一", "二", "三", "四", "五", "六", "日"];
// JS getDay(): 0=Sunday..6=Saturday → Monday-first index.
export const jsDayToColumn = (jsDay) => (jsDay + 6) % 7;

const CN_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// ── Local "YYYY-MM-DD" helpers ────────────────────────────────────────

/** Local-date string of a Date (defaults to now). */
export function todayStr(date) {
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse "YYYY-MM-DD" into a LOCAL Date at midnight; null when invalid. */
export function parseDay(dayStr) {
  if (typeof dayStr !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayStr.trim());
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** Day offset: b - a in whole days (both "YYYY-MM-DD", local). */
export function diffDays(a, b) {
  const da = parseDay(a);
  const db = parseDay(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}

/** Add n days to a "YYYY-MM-DD" string; returns "YYYY-MM-DD" or null. */
export function addDays(dayStr, n) {
  const d = parseDay(dayStr);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/** True when both strings are the same local calendar day. */
export function sameDay(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  return a === b; // canonical "YYYY-MM-DD" compares lexicographically
}

// ── Chinese formatting (G2.5) ─────────────────────────────────────────

/** "2026年10月14日 周三" from a "YYYY-MM-DD" string; null when invalid. */
export function formatCN(dayStr) {
  const d = parseDay(dayStr);
  if (!d) return null;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${CN_WEEKDAYS[d.getDay()]}`;
}

/** "2026年10月14日 周三 14:00" (time optional); null when no valid day. */
export function formatCNTime(dayStr, hhmm) {
  const base = formatCN(dayStr);
  if (!base) return null;
  const t = typeof hhmm === "string" && /^\d{2}:\d{2}$/.test(hhmm) ? ` ${hhmm}` : "";
  return base + t;
}

/** "2026年10月" month title. */
export function formatCNMonth(year, month1based) {
  return `${year}年${month1based}月`;
}

// ── Month grid (G2.1: 7 columns × 6 rows, Monday-first) ──────────────

/**
 * Build one month's grid. Returns 42 cells (6 rows × 7 cols), each:
 *   { dayStr: "YYYY-MM-DD" | null (padding cells keep a real date),
 *     inMonth: boolean, isToday: boolean, jsDay }
 * Leading cells come from the previous month; trailing from the next.
 */
export function monthGrid(year, month1based, todayIso) {
  const y = Number(year);
  const mo = Number(month1based);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return [];
  const first = new Date(y, mo - 1, 1);
  const lead = jsDayToColumn(first.getDay()); // Monday-first offset
  const today = typeof todayIso === "string" ? todayIso : todayStr();
  const cells = [];
  // Start from the Monday on/before the 1st.
  const start = new Date(y, mo - 1, 1 - lead);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dayStr = todayStr(d);
    cells.push({
      dayStr,
      inMonth: d.getMonth() === mo - 1,
      isToday: dayStr === today,
      jsDay: d.getDay(),
    });
  }
  return cells;
}

/** Days in a month (leap-year aware — 2028-02 → 29). */
export function daysInMonth(year, month1based) {
  const y = Number(year);
  const mo = Number(month1based);
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return 0;
  return new Date(y, mo, 0).getDate();
}

// ── Task day slots & conflicts (Phase 2 requirement #4) ───────────────

/**
 * Local [start,end] minutes of ONE task on ONE day, or null when the task
 * has no usable time that day. dueAt is a UTC ISO instant; its LOCAL
 * hour:minute drives the slot (timezone semantics unchanged).
 * A task whose due date is a DIFFERENT local day returns null — it does
 * not belong to `dayStr`. A date-only task on `dayStr` occupies
 * [null,null] — it appears on the day but never conflicts.
 */
export function taskDaySlot(task, dayStr) {
  if (!task || typeof dayStr !== "string") return null;
  const due = task.dueAt ? Date.parse(task.dueAt) : NaN;
  if (!Number.isFinite(due)) {
    // Date-only task: show it only when scheduledDate matches the day.
    return task.scheduledDate === dayStr ? { start: null, end: null, timed: false } : null;
  }
  const d = new Date(due);
  // Day check: the due instant's LOCAL date must be the queried day.
  if (todayStr(d) !== dayStr) return null;
  const minutes = d.getHours() * 60 + d.getMinutes();
  return { start: minutes, end: minutes + 60, timed: true };
}

/**
 * Ids of TIMED tasks whose slots overlap on the given day. Date-only
 * tasks never conflict. Mirrors activity-view.conflictIds semantics.
 */
export function conflictIdsOnDate(tasks, dayStr) {
  const flagged = {};
  if (!Array.isArray(tasks) || typeof dayStr !== "string") return flagged;
  const timed = [];
  for (const t of tasks) {
    const slot = taskDaySlot(t, dayStr);
    if (slot && slot.timed) timed.push({ id: t.id, slot });
  }
  timed.sort((a, b) => a.slot.start - b.slot.start);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      // Each task occupies a 60-minute window from its due time.
      if (timed[i].slot.start < timed[j].slot.end && timed[j].slot.start < timed[i].slot.end) {
        flagged[timed[i].id] = true;
        flagged[timed[j].id] = true;
      }
    }
  }
  return flagged;
}

/**
 * Detect whether setting a task's dueAt would create a conflict with
 * ANOTHER open task on the same local day. Returns the conflicting
 * task or null. Used by the schedule editor's warning line.
 */
export function findConflictFor(taskId, dueIso, tasks) {
  if (!dueIso || !Array.isArray(tasks)) return null;
  const due = Date.parse(dueIso);
  if (!Number.isFinite(due)) return null;
  const d = new Date(due);
  const dayStr = todayStr(d);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const window = { start: minutes, end: minutes + 60 };
  for (const t of tasks) {
    if (!t || t.id === taskId) continue;
    const slot = taskDaySlot(t, dayStr);
    if (!slot || !slot.timed) continue;
    if (window.start < slot.end && slot.start < window.end) return t;
  }
  return null;
}

// ── Day ordering (Phase 2 requirement #6) ─────────────────────────────

/** Deterministic sort for one day's tasks: timed first by start, untimed last. */
export function sortTasksForDay(tasks, dayStr) {
  if (!Array.isArray(tasks)) return [];
  return tasks.slice().sort((a, b) => {
    const sa = taskDaySlot(a, dayStr);
    const sb = taskDaySlot(b, dayStr);
    const ta = sa && sa.timed ? sa.start : Infinity;
    const tb = sb && sb.timed ? sb.start : Infinity;
    if (ta !== tb) return ta - tb;
    return String(a.title || "").localeCompare(String(b.title || ""), "zh");
  });
}
