// Gorgon Workbench — V3 Phase A (Gap 1): local reminders.
//
// PURE MODULE: no DOM, no React, no localStorage access. Persistence for
// reminders is owned by task-repository.js (remindAt lives ON the task
// record — one source of truth). This module provides the pure factories,
// validators and queries that UI + repository call.
//
// Design notes (charter Module A item 4 "set local reminders"):
//   * remindAt is an ADDITIVE field on the task record (ISO string | null).
//     Old records lack it; normalizeTask fills null, so pre-V3 data keeps
//     loading unchanged.
//   * Native notification goes through Capacitor LocalNotifications
//     (Android shell only). Permission uses the REAL plugin API;
//     web/no-plugin environments degrade to "unsupported" — the UI renders
//     honestly (never a fake reminder toggle).
//   * Scheduling semantics: setTaskReminder(taskId, { remindAt }) updates
//     data + timeline event + native schedule, all in the facade; this
//     module only exports pure functions.
//
// Contents:
//   * REMINDER_MODE / reminderMode() — native vs in-app fallback (honesty)
//   * normRemindAtOrNull(v)  — validate ISO string (null clears)
//   * describeReminder(iso)  — "10月15日 09:00" style human text
//   * reminderDueTasks(tasks, now, windowMs) — pure query: open tasks whose
//     remindAt falls inside [now, now + windowMs]

export const REMINDER_MODE = Object.freeze({
  NATIVE: "native",           // LocalNotifications scheduled (Android shell)
  UNSUPPORTED: "unsupported", // no plugin / permission denied -> in-app only
});

/**
 * Platform + permission probe. Reads the REAL Capacitor LocalNotifications
 * plugin; on web/no-plugin returns UNSUPPORTED. Never throws, never guesses.
 */
export function reminderMode() {
  try {
    const cap = globalThis.window && globalThis.window.Capacitor;
    const L = cap && cap.Plugins && cap.Plugins.LocalNotifications;
    if (L && typeof L.schedule === "function") return REMINDER_MODE.NATIVE;
  } catch (e) { /* fall through */ }
  return REMINDER_MODE.UNSUPPORTED;
}

/** Validate an ISO timestamp string; null clears; invalid -> null. */
export function normRemindAtOrNull(v) {
  if (v === null) return null;
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/** "10月15日 09:00" style human text; "" for falsy/invalid. */
export function describeReminder(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/**
 * Quick-pick lead offsets (minutes before remindAt). UI renders these as
 * preset buttons; 0 means "remind exactly at the time".
 */
export const REMINDER_LEAD_CHOICES = [
  { minutes: 0, label: "准时" },
  { minutes: 5, label: "提前5分钟" },
  { minutes: 15, label: "提醒15分钟前" },
  { minutes: 30, label: "提醒30分钟前" },
  { minutes: 60, label: "提前1小时" },
];

/**
 * Pure query: open (non-terminal) tasks with a remindAt inside
 * [now, now + windowMs]. Used by the in-app fallback banner.
 */
export function reminderDueTasks(tasks, now, windowMs) {
  const cur = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  const win = Number(windowMs) > 0 ? Number(windowMs) : 0;
  const out = [];
  for (const t of tasks || []) {
    if (!t || typeof t !== "object") continue;
    if (t.status === "completed" || t.status === "failed") continue;
    if (!t.remindAt) continue;
    const due = Date.parse(t.remindAt);
    if (!Number.isFinite(due)) continue;
    if (due >= cur && due <= cur + win) out.push(t);
  }
  return out;
}
