// Gorgon Workbench — V3E 任务包 B: in-app reminder firing (pure layer).
//
// GAP CLOSED: reminderDueTasks() existed as a pure query but NOTHING polled
// it — on web (no Capacitor) a saved reminder never surfaced in-app when it
// came due. This module is the pure decision layer the App polls:
//
//   * pickDueReminders(tasks, nowIso, { notifiedIds, graceMs })
//       -> tasks whose remindAt is due NOW and not yet notified
//
// Dedup semantics: every fired task id lands in the notifiedIds set the
// caller persists (localStorage via App). A reminder fires ONCE per
// remindAt value; changing the remindAt re-arms it (the App stores
// `${taskId}:${remindAt}` keys, so a new time fires again).
//
// Honesty rules (§ chartered):
//   * Terminal tasks (completed/failed) never remind.
//   * Reminders further overdue than graceMs (default 6h) are skipped —
//     a 3-day-old popup on app open is noise, not a reminder. The data
//     layer keeps the value; the banner simply does not nag.
//   * Invalid remindAt is skipped, never guessed.
//
// PURE MODULE: no DOM, no React, no localStorage access.

/** Poll interval for the App-level timer (30s — battery-honest). */
export const REMINDER_POLL_MS = 30 * 1000;

/** localStorage key for fired-reminder dedupe records. */
export const NOTIFIED_STORE_KEY = "gorgon_workbench_reminders_notified";

/** Default grace window: how far overdue an in-app reminder still fires. */
export const REMINDER_GRACE_MS = 6 * 3600 * 1000;

/**
 * Tasks whose reminder is due at `nowIso` and not yet notified.
 * Dedupe keys are `${taskId}:${remindAt}` — re-setting the same time
 * does NOT re-fire after it fired once; a NEW time re-arms the reminder.
 */
export function pickDueReminders(tasks, nowIso, { notifiedIds = [], graceMs = REMINDER_GRACE_MS } = {}) {
  const now = nowIso ? new Date(nowIso) : new Date();
  const cur = now.getTime();
  if (!Number.isFinite(cur)) return [];
  const notified = notifiedIds instanceof Set ? notifiedIds : new Set(notifiedIds || []);
  const out = [];
  for (const t of tasks || []) {
    if (!t || typeof t !== "object") continue;
    if (t.status === "completed" || t.status === "failed") continue;
    if (!t.remindAt) continue;
    const due = Date.parse(t.remindAt);
    if (!Number.isFinite(due)) continue;
    // due window: [cur - grace, cur] — fired at-or-after its time, within grace
    if (due > cur) continue; // not yet due
    if (cur - due > graceMs) continue; // too far overdue — skip honestly
    const key = `${t.id}:${t.remindAt}`;
    if (notified.has(key)) continue; // already fired for this exact time
    out.push(t);
  }
  return out;
}

/** Dedupe key for one fired reminder (exported so App and tests agree). */
export function firedKey(taskId, remindAt) {
  return `${String(taskId || "")}:${String(remindAt || "")}`;
}
