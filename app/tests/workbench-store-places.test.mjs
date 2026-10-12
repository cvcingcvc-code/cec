// Gorgon Module D UI — workbench-store places facade tests.
//
// The facade is what PlacesScreen calls; these tests pin the contract:
//   * upsertPlace creates/updates with the activity log trail
//   * setPlaceStatus is a safe no-op on illegal vocabulary
//   * addPlaceVisit stamps a REAL timestamp and flips status via the
//     repository (never a fabricated time, never a raw status write)
//   * removePlace logs and reports what it did

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

/* ── create / update ─────────────────────────────────────────────────── */

test("upsertPlace creates a place with defaults + log event", () => {
  const p = WB.upsertPlace({ name: "某园区 A 座", address: "浦东新区" });
  assert.ok(p.id, "id generated");
  assert.equal(p.name, "某园区 A 座");
  assert.equal(p.status, "todo", "default status is 待走访");
  assert.deepEqual(p.visits, []);
  const log = WB.getLog();
  assert.ok(log.some((e) => e.type === "place_create" && e.text.includes("某园区 A 座")));
});

test("upsertPlace updates an existing place without duplicating", () => {
  const p1 = WB.upsertPlace({ name: "A" });
  const p2 = WB.upsertPlace({ id: p1.id, name: "A 改", address: "徐汇区" });
  assert.equal(p2.id, p1.id);
  assert.equal(p2.name, "A 改");
  assert.equal(WB.getPlaces().length, 1, "no duplicate rows");
  const log = WB.getLog();
  assert.ok(log.some((e) => e.type === "place_update"));
});

test("upsertPlace links an optional project", () => {
  const proj = WB.createProject({ title: "地推项目" });
  const p = WB.upsertPlace({ name: "B", projectId: proj.id });
  assert.equal(p.projectId, proj.id);
});

/* ── status vocabulary ───────────────────────────────────────────────── */

test("setPlaceStatus moves through the official vocabulary", () => {
  const p = WB.upsertPlace({ name: "C" });
  const v = WB.setPlaceStatus(p.id, "visited");
  assert.equal(v.status, "visited");
  const r = WB.setPlaceStatus(p.id, "revisit");
  assert.equal(r.status, "revisit");
  const log = WB.getLog();
  assert.ok(log.filter((e) => e.type === "place_status").length >= 2);
});

test("setPlaceStatus refuses illegal status (safe no-op)", () => {
  const p = WB.upsertPlace({ name: "D" });
  assert.equal(WB.setPlaceStatus(p.id, "garbage"), null);
  assert.equal(WB.getPlace(p.id).status, "todo", "status unchanged on refusal");
});

/* ── visits ──────────────────────────────────────────────────────────── */

test("addPlaceVisit stamps a REAL time and flips status to visited", () => {
  const p = WB.upsertPlace({ name: "E" });
  const before = Date.now();
  const v = WB.addPlaceVisit(p.id, { note: "前台拒收，需预约" });
  const after = Date.now();
  assert.equal(v.visits.length, 1);
  const at = new Date(v.visits[0].at).getTime();
  assert.ok(at >= before - 1000 && at <= after + 1000, "visit time is the real now, not fabricated");
  assert.equal(v.visits[0].note, "前台拒收，需预约");
  assert.equal(v.status, "visited", "TODO -> VISITED automatically");
});

test("addPlaceVisit with a next plan flips status to revisit", () => {
  const p = WB.upsertPlace({ name: "F" });
  const v = WB.addPlaceVisit(p.id, { note: "需带材料", nextPlan: "下周一带材料再来" });
  assert.equal(v.status, "revisit");
  assert.equal(v.nextPlan, "下周一带材料再来");
  assert.equal(v.visits.length, 1);
});

test("addPlaceVisit on a missing place is a safe no-op", () => {
  assert.equal(WB.addPlaceVisit("no-such-id", { note: "x" }), null);
});

test("addPlaceVisit appends (second visit keeps the first)", () => {
  const p = WB.upsertPlace({ name: "G" });
  WB.addPlaceVisit(p.id, { note: "第一次" });
  const v = WB.addPlaceVisit(p.id, { note: "第二次", nextPlan: "再来" });
  assert.equal(v.visits.length, 2);
  assert.equal(v.visits[0].note, "第一次");
});

/* ── remove + filters ────────────────────────────────────────────────── */

test("removePlace deletes and logs", () => {
  const p = WB.upsertPlace({ name: "H" });
  assert.equal(WB.removePlace(p.id), true);
  assert.equal(WB.getPlace(p.id), null);
  assert.ok(WB.getLog().some((e) => e.type === "place_remove"));
});

test("removePlace on a missing id returns false", () => {
  assert.equal(WB.removePlace("no-such-id"), false);
});

test("getPlaces filters by status", () => {
  WB.upsertPlace({ name: "待" });
  const p2 = WB.upsertPlace({ name: "已" });
  WB.setPlaceStatus(p2.id, "visited");
  const all = WB.getPlaces();
  const todos = WB.getPlaces("todo");
  const visited = WB.getPlaces("visited");
  assert.equal(all.length, 2);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].name, "待");
  assert.equal(visited.length, 1);
  assert.equal(visited[0].name, "已");
});
