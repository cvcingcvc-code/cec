// V2.4 (feat/hackathon-discovery-v1) — hackathon dataset + view helpers.
//
// Pins the data rules the task charter promises:
//   * every record has id + title (identity required)
//   * ISO date fields parse; invalid ones normalize to null
//   * registrationUrl / sourceUrl are https URLs when present
//   * curated REAL data carries demo:false (never rendered as DEMO)
//   * deadlineCountdown / filterActivities / sortByDeadline honesty
// Plus the additive toView fields (mode/modeLabel/registrationDeadline/
// deadlineCountdown/prize/eligibility/teamSize) and idempotence.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HACKATHONS, validatedHackathons, normalizeHackathon, MODE_LABEL,
} from "../src/data/hackathons.js";
import {
  toView, deadlineCountdown, isDeadlinePassed, filterActivities, sortByDeadline, MODES,
} from "../src/lib/activity-view.js";

test("hackathon dataset: every record has id and title", () => {
  for (const a of HACKATHONS) {
    assert.ok(a.id, "id required");
    assert.ok(a.title, "title required");
  }
});

test("hackathon dataset: curated REAL data is demo:false", () => {
  for (const a of HACKATHONS) {
    assert.equal(a.demo, false, "curated records are never DEMO");
  }
});

test("hackathon dataset: URLs are https when present", () => {
  for (const a of HACKATHONS) {
    if (a.registrationUrl) assert.match(a.registrationUrl, /^https:\/\//);
    if (a.sourceUrl) assert.match(a.sourceUrl, /^https:\/\//);
  }
});

test("hackathon dataset: dates are valid ISO YYYY-MM-DD", () => {
  for (const a of HACKATHONS) {
    if (a.startDate) assert.match(a.startDate, /^\d{4}-\d{2}-\d{2}$/);
    if (a.endDate) assert.match(a.endDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("hackathon dataset: mode values use the closed vocabulary", () => {
  for (const a of HACKATHONS) {
    if (a.mode) assert.ok(MODES.indexOf(a.mode) >= 0, "mode " + a.mode + " in vocabulary");
  }
});

test("normalizeHackathon: missing id/title is dropped, never guessed", () => {
  assert.equal(normalizeHackathon(null), null);
  assert.equal(normalizeHackathon({ title: "no id" }), null);
  assert.equal(normalizeHackathon({ id: "x" }), null);
});

test("normalizeHackathon: unknown fields normalize to null (honest 待定)", () => {
  const n = normalizeHackathon({ id: "t1", title: "测试", mode: "submarine", registrationDeadline: "not-a-date" });
  assert.equal(n.mode, null);
  assert.equal(n.registrationDeadline, null);
  assert.equal(n.prize, null);
  assert.equal(n.eligibility, null);
  assert.equal(n.city, null);
  assert.equal(n.demo, false);
});

test("validatedHackathons: drops invalid, keeps valid verbatim", () => {
  const out = validatedHackathons([null, { id: "ok", title: "OK" }, { title: "no id" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "ok");
});

test("toView: hackathon record gains additive fields", () => {
  const src = HACKATHONS[0];
  const v = toView(src);
  assert.equal(v.mode, src.mode);
  assert.equal(v.modeLabel, MODE_LABEL[src.mode]);
  assert.ok(v.registrationDeadline);
  assert.ok(v.deadlineCountdown);
  assert.equal(v.prize, src.prize);
  assert.equal(v.eligibility, src.eligibility);
  assert.equal(v.teamSize, src.teamSize);
});

test("toView: legacy record (no hackathon fields) normalizes to null, not invented", () => {
  const v = toView({ id: "l1", title: "老记录", demo: true });
  assert.equal(v.mode, null);
  assert.equal(v.modeLabel, null);
  assert.equal(v.registrationDeadline, null);
  assert.equal(v.deadlineCountdown, null);
  assert.equal(v.prize, null);
  assert.equal(v.eligibility, null);
  assert.equal(v.teamSize, null);
});

test("toView is idempotent on hackathon views (stored view upgrade)", () => {
  const v = toView(HACKATHONS[0]);
  const v2 = toView(v);
  assert.equal(v2.mode, v.mode);
  assert.equal(v2.registrationDeadline, v.registrationDeadline);
  assert.equal(v2.prize, v.prize);
});

test("deadlineCountdown: honesty over guessing", () => {
  assert.equal(deadlineCountdown(null), null);
  assert.equal(deadlineCountdown("garbage"), null);
  const now = new Date("2026-10-23T12:00:00+08:00");
  assert.equal(deadlineCountdown("2026-10-26T23:59:00+08:00", now), "3天后截止");
  assert.equal(deadlineCountdown("2026-10-23T18:00:00+08:00", now), "6小时后截止");
  assert.equal(deadlineCountdown("2026-10-23T11:00:00+08:00", now), "已截止");
});

test("isDeadlinePassed: null deadline never blocks", () => {
  assert.equal(isDeadlinePassed(null), false);
  assert.equal(isDeadlinePassed("garbage"), false);
  assert.equal(isDeadlinePassed("2020-01-01", new Date("2026-10-23")), true);
  assert.equal(isDeadlinePassed("2027-01-01", new Date("2026-10-23")), false);
});

test("filterActivities: category/city/mode/query compose", () => {
  const list = HACKATHONS.map(normalizeHackathon).filter(Boolean);
  const hacks = filterActivities(list, { category: "hackathon" });
  assert.ok(hacks.length > 0);
  assert.ok(hacks.every((a) => a.category === "hackathon"));

  const shanghai = filterActivities(list, { city: "上海" });
  assert.ok(shanghai.length > 0);
  assert.ok(shanghai.every((a) => a.city === "上海" || a.city == null), "null-city stays visible");

  const offline = filterActivities(list, { mode: "offline" });
  assert.ok(offline.length > 0);
  assert.ok(offline.every((a) => a.mode === "offline"));

  const q = filterActivities(list, { query: "具身" });
  assert.ok(q.length > 0);

  const none = filterActivities(list, { category: "hackathon", mode: "offline", query: "不存在的关键词xyz" });
  assert.equal(none.length, 0);
});

test("filterActivities: timeframe open excludes passed deadlines", () => {
  const list = HACKATHONS.map(normalizeHackathon).filter(Boolean);
  const open = filterActivities(list, { timeframe: "open" });
  for (const a of open) {
    if (a.registrationDeadline) {
      assert.equal(isDeadlinePassed(a.registrationDeadline, new Date("2026-10-23")), false);
    }
  }
});

test("sortByDeadline: open events first by soonest deadline, unknown last", () => {
  const list = [
    normalizeHackathon({ id: "unknown", title: "无截止" }),
    normalizeHackathon({ id: "late", title: "晚截止", registrationDeadline: "2026-12-01T00:00:00+08:00" }),
    normalizeHackathon({ id: "early", title: "早截止", registrationDeadline: "2026-10-26T00:00:00+08:00" }),
  ];
  const sorted = sortByDeadline(list, new Date("2026-10-23T12:00:00+08:00"));
  assert.equal(sorted[0].id, "early");
  assert.equal(sorted[1].id, "late");
  assert.equal(sorted[2].id, "unknown");
});
