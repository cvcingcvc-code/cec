// Gorgon 2.0 — native persistence bridge tests (Module A).
//
// The bridge mirrors gorgon_* localStorage writes into Capacitor
// Preferences (native durable storage) and hydrates them back BEFORE React
// mounts, so a WebView data wipe (or an origin/port change) can no longer
// lose tasks. These tests run under plain Node with an in-memory
// localStorage stub plus a fake Preferences plugin injected through the
// documented test hook (__GORGON_PREFS_OVERRIDE__).
//
// Run: node --test tests/   (from app/)

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get size() { return m.size; },
    _map: m,
  };
}

/** Fake of @capacitor/preferences: same async surface, in-memory Map. */
function makeFakePrefs() {
  const m = new Map();
  return {
    _map: m,
    async get({ key }) {
      return { value: m.has(key) ? m.get(key) : null };
    },
    async set({ key, value }) {
      m.set(key, String(value));
    },
    async remove({ key }) {
      m.delete(key);
    },
    async keys() {
      return { keys: Array.from(m.keys()) };
    },
    async clear() {
      m.clear();
    },
  };
}

let storage;
let prefs;
let mod;

beforeEach(async () => {
  storage = makeStorage();
  globalThis.localStorage = storage;
  prefs = makeFakePrefs();
  globalThis.__GORGON_PREFS_OVERRIDE__ = prefs;
  // pretend we are inside the Capacitor native shell
  globalThis.window = globalThis;
  globalThis.window.Capacitor = { isNativePlatform: () => true };
  // fresh module per test so module-level state (mirror installed, prefs) resets
  mod = await import("../src/lib/native-persistence.js?fresh=" + Math.random());
});

afterEach(() => {
  delete globalThis.__GORGON_PREFS_OVERRIDE__;
  delete globalThis.window;
  delete globalThis.localStorage;
});

const settle = () => new Promise((r) => setTimeout(r, 600)); // > debounce

test("isNative() reflects the Capacitor flag", () => {
  assert.equal(mod.isNative(), true);
  globalThis.window.Capacitor = { isNativePlatform: () => false };
  assert.equal(mod.isNative(), false);
});

test("gorgon_* writes are mirrored into Preferences (debounced)", async () => {
  const boot = await mod.initNativePersistence();
  assert.equal(boot.native, true);
  assert.equal(boot.mirrored, true, "mirror must install on native");

  localStorage.setItem("gorgon_workbench_tasks_v2", JSON.stringify({ tasks: [1] }));
  await settle();

  assert.equal(
    prefs._map.get("gorgon_workbench_tasks_v2"),
    JSON.stringify({ tasks: [1] }),
    "value mirrored to Preferences"
  );
  // revision bookkeeping written alongside, and NOT itself mirrored as data
  assert.equal(prefs._map.get("gorgon__rev_gorgon_workbench_tasks_v2"), "1");
});

test("non-gorgon keys are left alone", async () => {
  await mod.initNativePersistence();
  localStorage.setItem("some_other_app_key", "x");
  await settle();
  assert.equal(prefs._map.has("some_other_app_key"), false);
});

test("hydrate restores durable data after a WebView data wipe", async () => {
  // Session 1: write + mirror.
  await mod.initNativePersistence();
  localStorage.setItem("gorgon_favorites", JSON.stringify(["a", "b"]));
  await mod.flushPendingWrites();
  assert.equal(prefs._map.get("gorgon_favorites"), JSON.stringify(["a", "b"]));

  // Session 2: simulate a wiped WebView (empty localStorage) with the SAME
  // Preferences store, then hydrate.
  storage._map.clear();
  const boot2 = await mod.initNativePersistence();
  assert.ok(boot2.hydratedKeys >= 1, "hydrate reports restored key count");
  assert.equal(
    localStorage.getItem("gorgon_favorites"),
    JSON.stringify(["a", "b"]),
    "data survives the wipe via Preferences"
  );
});

test("removeItem removes from both stores", async () => {
  await mod.initNativePersistence();
  localStorage.setItem("gorgon_selected_district", JSON.stringify("徐汇"));
  await settle();
  assert.equal(prefs._map.has("gorgon_selected_district"), true);

  localStorage.removeItem("gorgon_selected_district");
  await settle();
  assert.equal(prefs._map.has("gorgon_selected_district"), false);
  assert.equal(prefs._map.has("gorgon__rev_gorgon_selected_district"), false);
});

test("native wins when it is strictly newer than local", async () => {
  await mod.initNativePersistence();
  localStorage.setItem("gorgon_admin_review", JSON.stringify({ v: "local-old" }));
  await settle();

  // another (newer) native revision, local copy stale
  await prefs.set({ key: "gorgon_admin_review", value: JSON.stringify({ v: "native-new" }) });
  await prefs.set({ key: "gorgon__rev_gorgon_admin_review", value: "99" });

  const boot2 = await mod.initNativePersistence();
  assert.ok(boot2.hydratedKeys >= 1);
  assert.equal(
    localStorage.getItem("gorgon_admin_review"),
    JSON.stringify({ v: "native-new" }),
    "newer native revision overwrites stale local"
  );
});

test("never throws when Preferences is unavailable — app still boots", async () => {
  // null (not undefined) — the override hook treats null as "plugin failed to load"
  globalThis.__GORGON_PREFS_OVERRIDE__ = null;
  prefs = makeFakePrefs(); // keep afterEach happy; unused by the module now
  const fresh = await import("../src/lib/native-persistence.js?noprefs=" + Math.random());
  const boot = await fresh.initNativePersistence();
  assert.equal(boot.mirrored, false);
  assert.ok(boot.error, "degradation is reported, not silent");
  // plain localStorage still works
  localStorage.setItem("gorgon_demo_v1", "true");
  assert.equal(localStorage.getItem("gorgon_demo_v1"), "true");
});

test("flushPendingWrites drains the debounce queue", async () => {
  await mod.initNativePersistence();
  localStorage.setItem("gorgon_my_weekend_items", JSON.stringify({ a1: { id: "a1" } }));
  await mod.flushPendingWrites(); // no waiting for the timer
  assert.equal(
    prefs._map.get("gorgon_my_weekend_items"),
    JSON.stringify({ a1: { id: "a1" } })
  );
});

test("web (no Capacitor) is a no-op", async () => {
  globalThis.window.Capacitor = { isNativePlatform: () => false };
  const fresh = await import("../src/lib/native-persistence.js?web=" + Math.random());
  const boot = await fresh.initNativePersistence();
  assert.equal(boot.native, false);
  assert.equal(boot.mirrored, false);
  assert.equal(prefs._map.size, 0, "nothing written to Preferences on web");
});
