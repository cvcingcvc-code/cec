// Gorgon 2.0 — opportunity repository tests (Modules C/D/E/F data layer).
//
// Runs under plain Node with an in-memory localStorage stub. The charter's
// honesty rules are FIRST-CLASS assertions here:
//   * opening the registration page must never yield status "registered"
//   * REGISTERED only via explicit setRegistration, and carries confirmedAt
//   * predicted vs actual stay in separate fields, recordActual never
//     touches predicted

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    _map: m,
  };
}

globalThis.localStorage = makeStorage();

const R = await import("../src/store/opportunity-repository.js");

beforeEach(() => { R.reset(); localStorage.clear(); });

/* ── Module C: registration ────────────────────────────────────────── */

test("registration defaults to none; opened-page never equals registered", () => {
  assert.equal(R.getRegistration("a1"), null);
  const rec = R.markRegistrationOpened("a1", "https://example.com/signup");
  assert.equal(rec.status, R.REG_STATUS.OPENED);
  assert.notEqual(rec.status, R.REG_STATUS.REGISTERED);
  assert.equal(rec.openedAt != null, true);
  assert.equal(rec.confirmedAt, null, "no confirmation timestamp without REGISTERED");
});

test("REGISTERED requires an explicit call and stamps confirmedAt", () => {
  R.markRegistrationOpened("a2");
  const reg = R.setRegistration("a2", { status: R.REG_STATUS.REGISTERED });
  assert.equal(reg.status, R.REG_STATUS.REGISTERED);
  assert.ok(reg.confirmedAt, "confirmedAt set exactly once at confirmation");
});

test("re-opening the page does not regress an advanced status", () => {
  R.setRegistration("a3", { status: R.REG_STATUS.REGISTERED });
  const after = R.markRegistrationOpened("a3");
  assert.equal(after.status, R.REG_STATUS.REGISTERED, "REGISTERED stays");
  // downgrade from in_progress also must not happen
  R.setRegistration("a4", { status: R.REG_STATUS.IN_PROGRESS });
  assert.equal(R.markRegistrationOpened("a4").status, R.REG_STATUS.IN_PROGRESS);
});

test("leaving REGISTERED clears confirmedAt", () => {
  R.setRegistration("a5", { status: R.REG_STATUS.REGISTERED });
  const cancelled = R.setRegistration("a5", { status: R.REG_STATUS.CANCELLED });
  assert.equal(cancelled.confirmedAt, null);
});

test("invalid status values degrade to none", () => {
  const rec = R.setRegistration("a6", { status: "hacked-registered" });
  assert.equal(rec.status, R.REG_STATUS.NONE);
});

test("prep checklist + reminder round-trip; defaultPrepFor adds fee item only for paid events", () => {
  const prep = [{ id: "p1", title: "查看资格要求与报名截止", done: false }];
  R.setPrep("a7", prep, "2026-09-18T09:00:00+08:00");
  const rec = R.getRegistration("a7");
  assert.deepEqual(rec.prep, prep);
  assert.equal(rec.remindAt, "2026-09-18T09:00:00+08:00");

  const freePrep = R.defaultPrepFor({ priceType: "免费" });
  assert.ok(!freePrep.some((p) => p.title.includes("费用")));
  const paidPrep = R.defaultPrepFor({ priceType: "付费" });
  assert.ok(paidPrep.some((p) => p.title.includes("费用")));
  assert.ok(freePrep.every((p) => p.id && p.title && p.done === false));
});

test("exportICS emits real times only; missing start => null, never fabricated", () => {
  assert.equal(R.exportICS("a8", null), null);
  assert.equal(R.exportICS("a8", { title: "无时间活动" }), null);
  R.markRegistrationOpened("a9");
  const ics = R.exportICS("a9", {
    title: "AI 沙龙", startDate: "2026-09-19T14:00:00+08:00",
    venue: "徐汇", sourceUrl: "https://src.example", organizer: "某社区",
  });
  assert.ok(ics.includes("SUMMARY:AI 沙龙"));
  assert.ok(ics.includes("DTSTART:20260919T060000Z"));
  assert.ok(ics.includes("已打开报名页（未确认报名）"), "ICS states registration honestly");
  assert.ok(!ics.includes("已报名"), "must not claim registered");
});

/* ── Module D: places & visits ─────────────────────────────────────── */

test("place lifecycle: todo -> visited -> revisit, with visit records", () => {
  const p = R.upsertPlace({ name: "五角场咖啡馆", address: "邯郸路 1 号", coord: { lat: 31.3, lng: 121.5 } });
  assert.equal(p.status, R.PLACE_STATUS.TODO);

  const visited = R.addVisit(p.id, { note: "店长有兴趣", nextPlan: "下周三带资料再来" });
  assert.equal(visited.status, R.PLACE_STATUS.REVISIT, "a nextPlan implies revisit");
  assert.equal(visited.visits.length, 1);
  assert.equal(visited.visits[0].note, "店长有兴趣");

  const second = R.addVisit(p.id, {});
  assert.equal(second.status, R.PLACE_STATUS.VISITED, "no nextPlan => visited");
  assert.equal(second.visits.length, 2);
});

test("place status filter + invalid status rejected", () => {
  R.upsertPlace({ id: "p1", name: "A" });
  R.upsertPlace({ id: "p2", name: "B", status: R.PLACE_STATUS.UNSUITABLE });
  assert.equal(R.listPlaces().length, 2);
  assert.deepEqual(R.listPlaces(R.PLACE_STATUS.TODO).map((p) => p.name), ["A"]);
  assert.deepEqual(R.listPlaces([R.PLACE_STATUS.UNSUITABLE]).map((p) => p.name), ["B"]);
  assert.equal(R.setPlaceStatus("p1", "made-up"), null);
});

test("removePlace works and reports misses", () => {
  R.upsertPlace({ id: "p9", name: "临时" });
  assert.equal(R.removePlace("p9"), true);
  assert.equal(R.removePlace("p9"), false);
});

/* ── Module E: notes ───────────────────────────────────────────────── */

test("text + audio notes with associations; filters; update; remove", async () => {
  const t = R.addNote({ kind: "text", text: "现场聊到的需求", placeId: "p1", activityId: "a1" });
  const a = R.addNote({ kind: "audio", audioPath: "file:///rec1.m4a", audioDurationMs: 32100, taskId: "t1" });
  assert.equal(t.kind, "text");
  assert.equal(a.kind, "audio");
  assert.equal(a.text, "");
  assert.equal(a.audioDurationMs, 32100);

  assert.equal(R.listNotes().length, 2);
  assert.deepEqual(R.listNotes({ placeId: "p1" }).map((n) => n.id), [t.id]);
  assert.deepEqual(R.listNotes({ kind: "audio" }).map((n) => n.id), [a.id]);
  assert.deepEqual(R.listNotes({ taskId: "t1" }).map((n) => n.id), [a.id]);

  // wait one tick so the ISO timestamps cannot collide within the same ms
  await new Promise((r) => setTimeout(r, 5));
  const upd = R.updateNote(t.id, { text: "补充：他们下周有活动" });
  assert.equal(upd.text, "补充：他们下周有活动");
  assert.notEqual(upd.updatedAt, t.updatedAt, "updatedAt advances on write");
  assert.equal(upd.createdAt, t.createdAt, "createdAt is stable");
  assert.equal(R.updateNote("nope", { text: "x" }), null);

  assert.equal(R.removeNote(a.id), true);
  assert.equal(R.listNotes().length, 1);
});

/* ── Module F: review — predicted vs actual kept apart ─────────────── */

test("predicted snapshot and actual outcome live in separate fields", () => {
  R.snapshotPredicted("r1", {
    reasons: ["与目标匹配：AI 社区", "免费"],
    expectedBenefit: "认识 3 位开发者",
    expectedCost: "通勤 1 小时",
  });
  const rev = R.recordActual("r1", {
    outcome: "去了，聊得不错",
    gains: ["加了 2 个微信"],
    costs: ["迟到 20 分钟"],
  });
  assert.equal(rev.predicted.reasons.length, 2);
  assert.equal(rev.actual.outcome, "去了，聊得不错");
  assert.deepEqual(rev.actual.gains, ["加了 2 个微信"]);
  // actual recording must NOT have touched predicted
  assert.equal(rev.predicted.expectedBenefit, "认识 3 位开发者");
});

test("recordActual without a snapshot still works and keeps predicted empty", () => {
  const rev = R.recordActual("r2", { outcome: "无预测直接复盘" });
  assert.deepEqual(rev.predicted.reasons, []);
  assert.equal(rev.actual.outcome, "无预测直接复盘");
});

test("follow-ups + next action round-trip", () => {
  const rev = R.setFollowUps("r3", [{ id: "f1", title: "给认识的朋友发资料", done: false }], "下月再参加一次");
  assert.equal(rev.followUps.length, 1);
  assert.equal(rev.nextAction, "下月再参加一次");
  const done = R.setFollowUps("r3", [{ id: "f1", title: "给认识的朋友发资料", done: true }]);
  assert.equal(done.followUps[0].done, true);
});

/* ── persistence & corruption safety ───────────────────────────────── */

test("envelope survives reset-and-reload from the same localStorage", async () => {
  R.setRegistration("persist1", { status: R.REG_STATUS.IN_PROGRESS });
  R.upsertPlace({ id: "pp1", name: "持久化地点" });
  R.addNote({ kind: "text", text: "持久化笔记" });
  // simulate a page reload: drop the in-memory mirror, force re-read
  const raw = localStorage.getItem("gorgon_opportunities_v1");
  assert.ok(raw, "envelope written to localStorage");
  const fresh = await import("../src/store/opportunity-repository.js?fresh=" + Math.random());
  assert.equal(fresh.getRegistration("persist1").status, R.REG_STATUS.IN_PROGRESS);
  assert.equal(fresh.getPlace("pp1").name, "持久化地点");
  assert.equal(fresh.listNotes().length, 1);
});

test("corrupt payload is quarantined, never auto-destroyed", () => {
  localStorage.setItem("gorgon_opportunities_v1", "{not json");
  assert.deepEqual(R.listRegistrations(), []);
  assert.equal(localStorage.getItem("gorgon_opportunities_v1"), "{not json", "raw preserved");
  assert.equal(localStorage.getItem("gorgon_opportunities_v1.corrupt-0"), "{not json", "archived");
});
