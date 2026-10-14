// Gorgon V3F.1 — data-sync unit tests.
//
// Covers the phone refresh contract:
//   F1  validateActivitiesPayload accepts a valid envelope
//   F2  validateActivitiesPayload rejects a corrupt/empty payload
//   F3  readCachedDataset round-trips through localStorage
//   F4  readCachedDataset returns null on corrupt cache data
//   F5  formatSyncTime renders a readable stamp
//   F6  readSyncState round-trips and never throws on corrupt data
//
// Run:  node --test tests/v3f1-data-sync.test.mjs   (from app/)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Minimal browser globals BEFORE the module import: data-sync.js touches
// localStorage (guarded) and window (via api.js import chain).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = { location: { search: "", protocol: "http:" } };
globalThis.importMetaEnvBackup = true;

const HERE = path.dirname(fileURLToPath(import.meta.url));

// api.js reads import.meta.env — guarded, so plain Node is fine. But
// VITE_API_BASE_URL is build-time; in Node it is undefined -> API_BASE_URL "".
const { validateActivitiesPayload, readCachedDataset, readSyncState,
        formatSyncTime, SYNC_DATASET_KEY, SYNC_STATE_KEY, nowShanghai,
        stampDemoFlags } =
  await import("../src/lib/data-sync.js");

beforeEach(() => store.clear());

test("F1: validateActivitiesPayload accepts a valid envelope", () => {
  const out = validateActivitiesPayload({
    generatedAt: "2026-10-14T12:00:00+08:00",
    count: 2,
    activities: [
      { id: "a1", title: "活动一", startDate: "2026-10-17" },
      { id: "a2", title: "活动二", demo: false },
    ],
  });
  assert.ok(out);
  assert.equal(out.activities.length, 2);
  assert.equal(out.generatedAt, "2026-10-14T12:00:00+08:00");
});

test("F2: validateActivitiesPayload rejects corrupt payloads", () => {
  assert.equal(validateActivitiesPayload(null), null);
  assert.equal(validateActivitiesPayload({}), null);
  assert.equal(validateActivitiesPayload({ activities: "nope" }), null);
  assert.equal(validateActivitiesPayload({ activities: [] }), null);
  assert.equal(validateActivitiesPayload({ activities: [{ title: "no id" }] }), null);
});

test("F3: readCachedDataset round-trips through localStorage", () => {
  const doc = {
    generatedAt: "2026-10-14T12:00:00+08:00",
    fetchedAt: "2026-10-14T12:01:00+08:00",
    activities: [{ id: "x1", title: "缓存活动" }],
  };
  localStorage.setItem(SYNC_DATASET_KEY, JSON.stringify(doc));
  const out = readCachedDataset();
  assert.ok(out);
  assert.equal(out.activities.length, 1);
  assert.equal(out.activities[0].id, "x1");
  assert.equal(out.generatedAt, doc.generatedAt);
});

test("F4: readCachedDataset returns null on corrupt cache data", () => {
  localStorage.setItem(SYNC_DATASET_KEY, "{corrupt json");
  assert.equal(readCachedDataset(), null);
  localStorage.setItem(SYNC_DATASET_KEY, JSON.stringify({ noActivities: true }));
  assert.equal(readCachedDataset(), null);
});

test("F5: formatSyncTime renders a readable stamp", () => {
  const label = formatSyncTime("2026-10-14T12:46:14+08:00");
  // Local timezone varies — only assert the shape: YYYY-MM-DD HH:MM.
  assert.match(label, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(formatSyncTime(null), null);
  assert.equal(formatSyncTime("not-a-date"), null);
});

test("F6: readSyncState round-trips and survives corrupt data", () => {
  assert.equal(readSyncState(), null);
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({ lastSuccessAt: "2026-10-14T12:00:00+08:00" }));
  const st = readSyncState();
  assert.equal(st.lastSuccessAt, "2026-10-14T12:00:00+08:00");
  localStorage.setItem(SYNC_STATE_KEY, "{broken");
  assert.equal(readSyncState(), null);
});

test("F7: nowShanghai produces an ISO-like stamp with +08:00", () => {
  const stamp = nowShanghai();
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
});

test("F8: validateActivitiesPayload stamps demo from sourceName (V3F.2)", () => {
  // /api/activities serves RAW approved records — sourceName present, demo
  // absent. Douban rows are real; demo-seed sources must be marked demo.
  const out = validateActivitiesPayload({
    generatedAt: "2026-10-14T15:00:00+08:00",
    count: 3,
    activities: [
      { id: "douban_1", sourceName: "豆瓣同城", startDate: "2026-10-17" },
      { id: "seed_1", sourceName: "ai_community" },
      { id: "seed_2", sourceName: "campus_bbs" },
    ],
  });
  assert.ok(out);
  const byId = Object.fromEntries(out.activities.map((a) => [a.id, a]));
  assert.equal(byId.douban_1.demo, false, "douban row is real");
  assert.equal(byId.seed_1.demo, true, "ai_community is a demo seed");
  assert.equal(byId.seed_2.demo, true, "campus_bbs is a demo seed");
});

test("F9: stampDemoFlags never overwrites an explicit demo field", () => {
  const acts = [
    { id: "x1", sourceName: "ai_community", demo: false },
    { id: "x2", sourceName: "豆瓣同城" },
    null,
    "junk",
  ];
  stampDemoFlags(acts);
  assert.equal(acts[0].demo, false, "explicit false is preserved");
  assert.equal(acts[1].demo, false, "douban (not whitelisted) is real");
  assert.equal(acts[2], null, "null rows pass through untouched");
  assert.equal(acts[3], "junk", "non-object rows pass through untouched");
});

test("F10: city_portal and demo_source stamp as demo; unknown source is real", () => {
  const acts = [
    { id: "s1", sourceName: "city_portal" },
    { id: "s2", sourceName: "demo_source" },
    { id: "r1", sourceName: "dianping" }, // a future real crawler
  ];
  stampDemoFlags(acts);
  assert.equal(acts[0].demo, true);
  assert.equal(acts[1].demo, true);
  assert.equal(acts[2].demo, false, "unknown sources default to REAL");
});
