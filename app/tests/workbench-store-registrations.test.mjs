// Gorgon Module C UI — workbench-store registration/prep/ICS facade tests.
//
// The facade is what ActivityDetailScreen/ProjectDetailScreen call; these
// tests pin the honest contract:
//   * markRegistrationOpened advances NONE -> OPENED only, NEVER registered
//   * REGISTERED requires the explicit setRegistrationStatus call
//   * prep checklist: seed/add/toggle round-trip
//   * exportICS refuses to fabricate a time (null without time fields)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
globalThis.localStorage = makeStorage();

const WB = await import("../src/store/workbench-store.js");
const P = await import("../src/store/project-repository.js");
const O = await import("../src/store/opportunity-repository.js");

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  P.reset();
  O.reset(); // opportunity-repository keeps a module-level memory mirror
});

/* ── honest registration tracking ────────────────────────────────────── */

test("markRegistrationOpened advances NONE -> OPENED, never registered", () => {
  const r = WB.markRegistrationOpened("act-1", "https://example.com/reg");
  assert.equal(r.status, "opened_registration");
  assert.equal(r.status, "opened_registration", "opening a page is NOT registered");
  assert.ok(r.openedAt, "openedAt stamped");
  assert.equal(r.confirmedAt, null, "no confirmation without REGISTERED");
  assert.ok(WB.getLog().some((e) => e.type === "registration_opened"));
});

test("markRegistrationOpened is idempotent once progressed further", () => {
  WB.setRegistrationStatus("act-1", "in_progress");
  const r = WB.markRegistrationOpened("act-1", "https://example.com/reg");
  assert.equal(r.status, "in_progress", "opening twice changes nothing beyond NONE");
});

test("REGISTERED only via the explicit status call (confirmedAt stamped)", () => {
  const r = WB.setRegistrationStatus("act-1", "registered");
  assert.equal(r.status, "registered");
  assert.ok(r.confirmedAt, "confirmation stamped with REGISTERED");
  const log = WB.getLog();
  assert.ok(log.some((e) => e.type === "registration_status" && e.text.includes("已报名")));
});

test("demoting from REGISTERED clears confirmedAt", () => {
  WB.setRegistrationStatus("act-1", "registered");
  const r = WB.setRegistrationStatus("act-1", "cancelled");
  assert.equal(r.status, "cancelled");
  assert.equal(r.confirmedAt, null, "confirmation only lives with REGISTERED");
});

test("unknown status degrades to NONE (safe, never fabricated)", () => {
  const r = WB.setRegistrationStatus("act-1", "garbage");
  assert.equal(r.status, "none");
});

/* ── prep checklist ──────────────────────────────────────────────────── */

test("setPrep stores a checklist; toggle round-trips", () => {
  const r1 = WB.setPrep("act-2", [{ title: "规划路线" }, { title: "准备名片" }]);
  assert.equal(r1.prep.length, 2);
  const id = r1.prep[0].id;
  const r2 = WB.setPrep("act-2", r1.prep.map((p) => (p.id === id ? Object.assign({}, p, { done: true }) : p)));
  assert.equal(r2.prep[0].done, true);
  assert.equal(r2.prep[1].done, false);
  assert.ok(WB.getLog().some((e) => e.type === "prep_update"));
});

test("defaultPrepFor seeds the standard checklist (free activity)", () => {
  const items = WB.defaultPrepFor({ priceType: "免费" });
  assert.ok(items.length >= 3);
  assert.ok(items.every((i) => i.id && i.title && i.done === false));
  const paid = WB.defaultPrepFor({ priceType: "收费" });
  assert.equal(paid.length, items.length + 1, "paid adds the cost item");
});

/* ── ICS export ──────────────────────────────────────────────────────── */

test("exportICS builds an ICS with the real fields", () => {
  const ics = WB.exportICS("act-3", {
    title: "Gorgon 黑客松", startDateTime: "2026-10-18T13:00:00",
    venue: "徐汇某园区", sourceUrl: "https://example.com/e",
  });
  assert.ok(ics, "ics built");
  assert.ok(ics.includes("BEGIN:VCALENDAR"));
  assert.ok(ics.includes("Gorgon 黑客松"));
  assert.ok(ics.includes("徐汇某园区"));
  assert.ok(WB.getLog().some((e) => e.type === "ics_export"));
});

test("exportICS refuses without time fields (never fabricated)", () => {
  assert.equal(WB.exportICS("act-4", { title: "无时间活动" }), null);
  assert.equal(WB.exportICS("act-4", null), null);
});
