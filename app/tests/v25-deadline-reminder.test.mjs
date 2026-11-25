// V2.5 — deadline-reminder pure logic tests.
// Pins: alert derivation (72h/24h), dedupe keys, honesty rules
// (no deadline -> never guessed; past -> skipped; horizon clamp),
// planDeadlineAlerts delta semantics (fired keys skipped, changed
// deadline re-arms).

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEADLINE_LEAD_HOURS,
  MAX_HORIZON_MS,
  deadlineAlertsFor,
  planDeadlineAlerts,
  describeAlert,
  DEADLINE_ALERTS_STORE_KEY,
} from "../src/workbench/deadline-reminder.js";

const NOW = new Date("2026-10-23T12:00:00+08:00");
const NOW_ISO = NOW.toISOString();

function act(id, deadlineIso, title = "测试活动") {
  return { id, title, registrationDeadline: deadlineIso };
}

test("exports: lead offsets are 72h and 24h", () => {
  assert.deepEqual(DEADLINE_LEAD_HOURS, [72, 24]);
});

test("exports: horizon is 14 days", () => {
  assert.equal(MAX_HORIZON_MS, 14 * 24 * 3600 * 1000);
});

test("deadlineAlertsFor: derives 2 alerts (72h + 24h) for a valid future deadline", () => {
  const dl = "2026-10-30T23:59:00+08:00"; // 7.5 days out
  const alerts = deadlineAlertsFor(act("a1", dl), NOW_ISO);
  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.map((a) => a.offsetHours).sort((a, b) => b - a), [72, 24]);
  // 72h alert fires 3 days before the deadline
  const a72 = alerts.find((a) => a.offsetHours === 72);
  assert.equal(new Date(a72.fireAtIso).getTime(), Date.parse(dl) - 72 * 3600 * 1000);
});

test("deadlineAlertsFor: dedupe key embeds id + deadline + offset", () => {
  const dl = "2026-10-30T23:59:00+08:00";
  const alerts = deadlineAlertsFor(act("a1", dl), NOW_ISO);
  for (const a of alerts) {
    assert.equal(a.key, `a1:${dl}:${a.offsetHours}`);
  }
});

test("honesty: no registrationDeadline -> zero alerts, never guessed", () => {
  assert.deepEqual(deadlineAlertsFor({ id: "a2", title: "x" }, NOW_ISO), []);
  assert.deepEqual(deadlineAlertsFor(act("a2", null), NOW_ISO), []);
});

test("honesty: invalid deadline string -> zero alerts", () => {
  assert.deepEqual(deadlineAlertsFor(act("a2", "not-a-date"), NOW_ISO), []);
});

test("honesty: deadline already passed -> zero alerts", () => {
  const dl = "2026-10-20T23:59:00+08:00"; // 3 days ago
  assert.deepEqual(deadlineAlertsFor(act("a3", dl), NOW_ISO), []);
});

test("honesty: fire time already in the past (deadline < 24h out) -> only future alert", () => {
  const dl = new Date(NOW.getTime() + 12 * 3600 * 1000).toISOString(); // 12h out
  const alerts = deadlineAlertsFor(act("a4", dl), NOW_ISO);
  // both 72h and 24h fire times are already past -> zero
  assert.deepEqual(alerts, []);
});

test("honesty: fire time beyond horizon is skipped (no far-future pre-schedule)", () => {
  const dl = new Date(NOW.getTime() + 30 * 24 * 3600 * 1000).toISOString(); // 30 days out
  const alerts = deadlineAlertsFor(act("a5", dl), NOW_ISO);
  // 72h fire = 27 days out > 14d horizon; 24h fire = 29 days out > horizon
  assert.deepEqual(alerts, []);
});

test("horizon boundary: fire exactly inside 14 days is scheduled", () => {
  // deadline 17 days out -> 72h fire is 14 days out (inside horizon)
  const dl = new Date(NOW.getTime() + 17 * 24 * 3600 * 1000).toISOString();
  const alerts = deadlineAlertsFor(act("a6", dl), NOW_ISO);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].offsetHours, 72);
});

test("deadlineAlertsFor: null/garbage activity -> zero alerts", () => {
  assert.deepEqual(deadlineAlertsFor(null, NOW_ISO), []);
  assert.deepEqual(deadlineAlertsFor({}, NOW_ISO), []);
  assert.deepEqual(deadlineAlertsFor("nope", NOW_ISO), []);
});

test("planDeadlineAlerts: skips already-fired keys (delta semantics)", () => {
  const dl = "2026-10-30T23:59:00+08:00";
  const favs = [act("a1", dl)];
  const first = planDeadlineAlerts(favs, NOW_ISO, { firedKeys: [] });
  assert.equal(first.length, 2);
  const second = planDeadlineAlerts(favs, NOW_ISO, { firedKeys: first.map((a) => a.key) });
  assert.deepEqual(second, []);
});

test("planDeadlineAlerts: CHANGED deadline re-arms (new key fires again)", () => {
  const dl1 = "2026-10-30T23:59:00+08:00";
  const dl2 = "2026-11-02T23:59:00+08:00";
  const first = planDeadlineAlerts([act("a1", dl1)], NOW_ISO, { firedKeys: [] });
  const armed = first.map((a) => a.key);
  const after = planDeadlineAlerts([act("a1", dl2)], NOW_ISO, { firedKeys: armed });
  assert.equal(after.length, 2);
  for (const a of after) assert.ok(!armed.includes(a.key));
});

test("planDeadlineAlerts: dedupes the same activity favorited twice", () => {
  const dl = "2026-10-30T23:59:00+08:00";
  const plan = planDeadlineAlerts([act("a1", dl), act("a1", dl)], NOW_ISO, { firedKeys: [] });
  assert.equal(plan.length, 2);
});

test("describeAlert: human text contains title, date and lead", () => {
  const dl = "2026-10-30T23:59:00+08:00";
  // act(id, deadlineIso, title) — pass the display title as the 3rd arg.
  const a72 = deadlineAlertsFor(act("a-title-check", dl, "AI黑客松"), NOW_ISO).find((x) => x.offsetHours === 72);
  const text = describeAlert(a72);
  assert.ok(text.includes("AI黑客松"), `title in: ${text}`);
  assert.ok(text.includes("截止"), `截止 in: ${text}`);
  assert.ok(text.includes("3天"), `3天 lead in: ${text}`);
});

test("store key is namespaced and stable", () => {
  assert.equal(DEADLINE_ALERTS_STORE_KEY, "gorgon_workbench_deadline_alerts");
});
