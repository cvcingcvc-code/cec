// Gorgon Workbench — V2.5: deadline reminders for favorited hackathons.
//
// GAP CLOSED: V2.4 shipped deadlineCountdown on every card and the detail
// hackathon-facts section, but NOTHING reminded the user before a favorited
// event's registration deadline — the existing reminder system
// (reminder-model.js / native-reminders.js) only covers remindAt on TASK
// records; hackathon deadlines live on ACTIVITY records and never enter it.
//
// Design (additive, mirrors reminder-fire.js semantics):
//   * The user favorites an activity -> App calls syncDeadlineReminders()
//     with the full favorites list; this module computes which deadline
//     alerts to schedule (72h and 24h before registrationDeadline).
//   * Dedup keys `${activityId}:${deadlineIso}:${offsetHours}` — a deadline
//     that fired once never re-fires; a CHANGED deadline re-arms (the key
//     embeds the deadline value).
//   * Honesty rules:
//       - no registrationDeadline (null) -> never scheduled, never guessed
//       - already-past alerts are skipped (never scheduled in the past)
//       - deadline further away than MAX_HORIZON_MS is not pre-scheduled
//         (Android cancels alarms on reboot anyway; the App re-syncs on
//         every favorites change and app start)
//   * PURE MODULE: no DOM, no React, no localStorage, no plugin access.
//     Scheduling itself goes through lib/native-reminders.js bridge fns.

/** Lead offsets before the deadline (hours). 72h = 3 days, 24h = 1 day. */
export const DEADLINE_LEAD_HOURS = [72, 24];

/** Don't pre-schedule alerts further than this horizon (14 days). */
export const MAX_HORIZON_MS = 14 * 24 * 3600 * 1000;

/**
 * Alerts to schedule for one favorited activity.
 * Returns [{ key, activityId, title, deadlineIso, fireAtIso, offsetHours }].
 * Skips: missing/past deadline, past fire times, beyond-horizon fires.
 */
export function deadlineAlertsFor(activity, nowIso) {
  const now = (nowIso ? new Date(nowIso) : new Date()).getTime();
  if (!activity || typeof activity !== "object" || !activity.id) return [];
  const dl = activity.registrationDeadline;
  if (!dl || typeof dl !== "string") return [];
  const deadline = Date.parse(dl);
  if (!Number.isFinite(deadline)) return [];

  const title = activity.title || "活动";
  const out = [];
  for (const h of DEADLINE_LEAD_HOURS) {
    const fire = deadline - h * 3600 * 1000;
    if (fire <= now) continue; // already past — never schedule in the past
    if (fire - now > MAX_HORIZON_MS) continue; // too far out — re-synced later
    out.push({
      key: `${activity.id}:${dl}:${h}`,
      activityId: activity.id,
      title,
      deadlineIso: new Date(deadline).toISOString(),
      fireAtIso: new Date(fire).toISOString(),
      offsetHours: h,
    });
  }
  return out;
}

/**
 * Full sync computation: given the favorited activities (views) and the
 * set of already-fired keys, return the alerts that should be scheduled
 * now. Pure — the caller (App) does the actual plugin scheduling.
 */
export function planDeadlineAlerts(favorites, nowIso, { firedKeys = [] } = {}) {
  const fired = firedKeys instanceof Set ? firedKeys : new Set(firedKeys || []);
  const out = [];
  const seen = new Set();
  for (const a of favorites || []) {
    for (const alert of deadlineAlertsFor(a, nowIso)) {
      if (fired.has(alert.key)) continue; // already scheduled/fired
      if (seen.has(alert.key)) continue; // dedupe same activity twice
      seen.add(alert.key);
      out.push(alert);
    }
  }
  return out;
}

/** Human label for one alert: 「"xx"将于10月26日 23:59截止报名」. */
export function describeAlert(alert) {
  if (!alert || !alert.deadlineIso) return "";
  const t = Date.parse(alert.deadlineIso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const lead = alert.offsetHours >= 72 ? "3天" : alert.offsetHours >= 24 ? "1天" : `${alert.offsetHours}小时`;
  return `${alert.title || "活动"}报名将于${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}截止（${lead}后）`;
}

/** localStorage key for scheduled-alert dedupe records. */
export const DEADLINE_ALERTS_STORE_KEY = "gorgon_workbench_deadline_alerts";
