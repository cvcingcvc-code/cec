// Gorgon Workbench — V3 Phase A (gap 1): native reminder scheduling.
//
// BRIDGE MODULE: connects the platform-pure data layer (remindAt on the
// task record) to the REAL Capacitor LocalNotifications plugin. Runs ONLY
// inside the Android shell; on web it degrades to "unsupported" honestly.
//
// WHY FIRE-AND-FORGET: a notification failure must NEVER block the data
// write (remindAt is already saved when this runs). Every scheduling call
// catches its own errors and reports them through a status object the UI
// can show — never a thrown error up the stack.
//
// Notification IDs: derived from the task id via a stable hash so re-saves
// UPDATE the same notification instead of piling up duplicates (Android
// notification ids are 32-bit ints; hash is masked to 31 bits, avoiding
// the reserved sign bit).
//
// Permission model (charter: "需要请求用户授权"):
//   * checkPermissions() / requestPermissions() — the REAL plugin APIs.
//   * Web/no-plugin: permission is "unsupported"; the UI shows an honest
//     hint instead of a fake granted state.
//
// This module NEVER touches localStorage and NEVER imports React.

const NOTIF_PREFIX = "gorgon-reminder-";

/** True when the REAL LocalNotifications plugin bridge is available. */
export function hasLocalNotifications() {
  try {
    const cap = globalThis.window && globalThis.window.Capacitor;
    const L = cap && cap.Plugins && cap.Plugins.LocalNotifications;
    return !!(L && typeof L.schedule === "function");
  } catch (e) {
    return false;
  }
}

/** Stable 31-bit hash of a task id → notification id (dedupes re-saves). */
export function notificationIdFor(taskId) {
  const s = String(taskId || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 2147483647;
}

/**
 * Check current notification permission via the REAL plugin API.
 * Returns { value: "granted" | "denied" | "prompt" | "unsupported" }.
 */
export async function checkPermission() {
  if (!hasLocalNotifications()) return { value: "unsupported" };
  try {
    const L = globalThis.window.Capacitor.Plugins.LocalNotifications;
    const st = await L.checkPermissions();
    return { value: (st && st.display) || "prompt" };
  } catch (e) {
    return { value: "unsupported", error: String((e && e.message) || e) };
  }
}

/**
 * Request notification permission (user gesture required by Android).
 * Returns { value: "granted" | "denied" | "prompt" | "unsupported" }.
 */
export async function requestPermission() {
  if (!hasLocalNotifications()) return { value: "unsupported" };
  try {
    const L = globalThis.window.Capacitor.Plugins.LocalNotifications;
    const st = await L.requestPermissions();
    return { value: (st && st.display) || "prompt" };
  } catch (e) {
    return { value: "unsupported", error: String((e && e.message) || e) };
  }
}

/**
 * Schedule (or reschedule) the reminder notification for ONE task.
 * Fire-and-forget: never throws. Returns a status object:
 *   { scheduled: true, notificationId } |
 *   { scheduled: false, reason: "cleared" | "past" | "unsupported" | "permission-denied" | "error", error? }
 *
 * A null remindAt CANCELS any pending notification for the task.
 */
export async function scheduleReminder(task) {
  if (!task || typeof task !== "object") {
    return { scheduled: false, reason: "error", error: "no-task" };
  }
  const notifId = notificationIdFor(task.id);

  // Clear path: the user removed the reminder.
  if (!task.remindAt) {
    if (hasLocalNotifications()) {
      try {
        const L = globalThis.window.Capacitor.Plugins.LocalNotifications;
        await L.cancel({ notifications: [{ id: String(notifId) }] });
      } catch (e) { /* nothing to cancel or cancel failed — both fine */ }
    }
    return { scheduled: false, reason: "cleared" };
  }

  const due = Date.parse(task.remindAt);
  if (!Number.isFinite(due)) {
    return { scheduled: false, reason: "error", error: "invalid-remindAt" };
  }
  // Do not schedule notifications in the past — Android would fire them
  // immediately. The data layer keeps the past value (补录场景), but the
  // notification is skipped honestly.
  if (due <= Date.now()) {
    return { scheduled: false, reason: "past" };
  }
  if (!hasLocalNotifications()) {
    return { scheduled: false, reason: "unsupported" };
  }

  try {
    const L = globalThis.window.Capacitor.Plugins.LocalNotifications;
    // Honest permission check first — schedule only when granted.
    const perm = await L.checkPermissions();
    if ((perm && perm.display) !== "granted") {
      return { scheduled: false, reason: "permission-denied" };
    }
    await L.schedule({
      notifications: [{
        id: notifId,
        title: task.title || "任务提醒",
        body: `提醒：${task.title || "任务"}` + (task.scheduledDate ? `（计划 ${task.scheduledDate}）` : ""),
        schedule: { at: new Date(due), allowWhileIdle: true },
      }],
    });
    return { scheduled: true, notificationId: notifId };
  } catch (e) {
    return { scheduled: false, reason: "error", error: String((e && e.message) || e) };
  }
}

/**
 * Cancel the reminder notification for ONE task. Fire-and-forget.
 */
export async function cancelReminder(taskId) {
  if (!hasLocalNotifications()) return { cancelled: false, reason: "unsupported" };
  try {
    const L = globalThis.window.Capacitor.Plugins.LocalNotifications;
    await L.cancel({ notifications: [{ id: String(notificationIdFor(taskId)) }] });
    return { cancelled: true };
  } catch (e) {
    return { cancelled: false, reason: "error", error: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------------------
// V2.5: hackathon deadline alerts (favorited activities).
//
// Same bridge pattern as task reminders: fire-and-forget, honest permission
// handling, never in the past. Notification ids derive from the alert key
// (activityId:deadlineIso:offsetHours) so a changed deadline re-arms under a
// new id and an unchanged deadline reuses its id (cancel-on-reschedule).
// ---------------------------------------------------------------------------

/**
 * Schedule ONE deadline alert. Fire-and-forget, never throws.
 * Returns { scheduled: true, notificationId } |
 *         { scheduled: false, reason } — reason: past|unsupported|permission-denied|error.
 */
export async function scheduleDeadlineAlert(alert) {
  if (!alert || typeof alert !== "object" || !alert.fireAtIso) {
    return { scheduled: false, reason: "error", error: "no-alert" };
  }
  const fire = Date.parse(alert.fireAtIso);
  if (!Number.isFinite(fire)) {
    return { scheduled: false, reason: "error", error: "invalid-fireAtIso" };
  }
  if (fire <= Date.now()) {
    return { scheduled: false, reason: "past" };
  }
  if (!hasLocalNotifications()) {
    return { scheduled: false, reason: "unsupported" };
  }
  const notifId = notificationIdFor(alert.key || alert.activityId || "deadline");
  try {
    const L = globalThis.window.Capacitor.Plugins.LocalNotifications;
    const perm = await L.checkPermissions();
    if ((perm && perm.display) !== "granted") {
      return { scheduled: false, reason: "permission-denied" };
    }
    await L.schedule({
      notifications: [{
        id: notifId,
        title: "报名截止提醒",
        body: String(alert.body || `${alert.title || "收藏的活动"}报名即将截止`),
        schedule: { at: new Date(fire), allowWhileIdle: true },
      }],
    });
    return { scheduled: true, notificationId: notifId };
  } catch (e) {
    return { scheduled: false, reason: "error", error: String((e && e.message) || e) };
  }
}

/**
 * Cancel the deadline alert for ONE alert key. Fire-and-forget.
 */
export async function cancelDeadlineAlert(alertKey) {
  if (!hasLocalNotifications()) return { cancelled: false, reason: "unsupported" };
  try {
    const L = globalThis.window.Capacitor.Plugins.LocalNotifications;
    await L.cancel({ notifications: [{ id: String(notificationIdFor(alertKey)) }] });
    return { cancelled: true };
  } catch (e) {
    return { cancelled: false, reason: "error", error: String((e && e.message) || e) };
  }
}
