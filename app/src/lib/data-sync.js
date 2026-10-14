// Gorgon V3F.1 — phone data refresh (manual pull, cached, honest).
//
// WHY THIS EXISTS
// ---------------
// The APK bundle ships a snapshot of the approved dataset (generated-data.js).
// Newer pipeline runs on the PC produce fresher data on the server, but the
// phone has no way to see them without shipping a new APK. This module adds
// the missing loop:
//
//   1. On boot: restore the last fetched dataset from localStorage cache
//      (fresher than the bundled snapshot when present).
//   2. On manual refresh: GET /api/activities from the deployed pipeline
//      server, validate, cache, and swap the activity list in place.
//   3. On failure: KEEP the local data, report honestly (server unavailable /
//      server error), never fake a "已刷新".
//
// Rules (V3F.1 task 3):
//   - Manual refresh only — no background polling, no fake real-time.
//   - The cached copy survives app restarts (localStorage + native mirror
//     via the existing gorgon_* write-through).
//   - lastSuccessAt records the last SUCCESSFUL fetch in Asia/Shanghai.
//   - The bundled snapshot is the fallback, never overwritten by anyone.
//
// Storage keys (gorgon_ prefix → mirrored into Capacitor Preferences on
// Android by native-persistence.js):
//   gorgon_sync_dataset    { generatedAt, fetchedAt, activities }
//   gorgon_sync_state      { lastSuccessAt, lastError, lastErrorCode }

import { API_BASE_URL } from "./api.js";

// V3F.2: /api/activities serves the RAW approved records, which carry
// `sourceName` but NOT the `demo` flag the UI filters on (DiscoverScreen
// keeps `!a.demo` rows only). Without stamping, the 17 demo seeds would
// leak into the real list after every refresh. The whitelist mirrors the
// server-side exporter (pipeline/export/gorgon_export.py _DEMO_SOURCES):
// everything NOT listed here is real (douban, future crawlers).
const DEMO_SOURCE_NAMES = new Set([
  "ai_community", "campus_bbs", "city_portal", "demo_source",
]);

/** Stamp the demo flag from provenance — same rule as the exporter. */
export function stampDemoFlags(activities) {
  for (const a of activities || []) {
    if (a && typeof a === "object" && typeof a.demo !== "boolean") {
      a.demo = DEMO_SOURCE_NAMES.has(a.sourceName);
    }
  }
  return activities;
}

export const SYNC_DATASET_KEY = "gorgon_sync_dataset";
export const SYNC_STATE_KEY = "gorgon_sync_state";
export const REFRESH_TIMEOUT_MS = 30000;

function safeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}

/** Now in Asia/Shanghai, "2026-10-14T12:46:14+08:00". */
export function nowShanghai() {
  const d = new Date();
  const parts = d.toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).replace(" ", "T");
  return parts + "+08:00";
}

/** "2026-10-14T12:46:14+08:00" -> "2026-10-14 12:46" (local render). */
export function formatSyncTime(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const d = new Date(t);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
    + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

/**
 * Restore the cached dataset, or null when none exists / it is unreadable.
 * The returned shape mirrors the bundled envelope: { generatedAt, activities }.
 */
export function readCachedDataset() {
  const raw = safeGet(SYNC_DATASET_KEY);
  if (!raw) return null;
  try {
    const doc = JSON.parse(raw);
    if (!doc || !Array.isArray(doc.activities)) return null;
    return { generatedAt: doc.generatedAt || null, activities: doc.activities };
  } catch (e) {
    return null;
  }
}

/** Read the sync state ({ lastSuccessAt, lastError, lastErrorCode }). */
export function readSyncState() {
  const raw = safeGet(SYNC_STATE_KEY);
  if (!raw) return null;
  try {
    const doc = JSON.parse(raw);
    return doc && typeof doc === "object" ? doc : null;
  } catch (e) {
    return null;
  }
}

function writeSyncState(patch) {
  const prev = readSyncState() || {};
  const next = Object.assign({}, prev, patch);
  safeSet(SYNC_STATE_KEY, JSON.stringify(next));
  return next;
}

/**
 * Validate a /api/activities response body. Returns the normalised
 * { generatedAt, activities } or null when the body is unusable — a corrupt
 * payload must never replace the local data.
 */
export function validateActivitiesPayload(data) {
  if (!data || typeof data !== "object") return null;
  const acts = data.activities;
  if (!Array.isArray(acts)) return null;
  // Every record must at least be an object with an id — anything else is a
  // corrupt dataset and the cache keeps winning.
  const clean = acts.filter((a) => a && typeof a === "object" && a.id);
  if (!clean.length) return null;
  // V3F.2: raw approved records carry sourceName but not `demo` — stamp it
  // here (one place) so the refreshed list honours the same demo rule as
  // the bundled snapshot and demo seeds never leak into the real list.
  stampDemoFlags(clean);
  return { generatedAt: data.generatedAt || null, activities: clean };
}

/**
 * GET <base>/api/activities. Never throws; returns a discriminated result:
 *   { kind: "ok",    data: { generatedAt, activities }, fetchedAt }
 *   { kind: "error", status, message }   — the server answered 4xx/5xx
 *   { kind: "unavailable" }              — no server reachable (offline)
 */
export async function fetchActivities({ timeoutMs } = {}) {
  const limit = timeoutMs || REFRESH_TIMEOUT_MS;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), limit) : null;
  const base = API_BASE_URL || "";
  try {
    const res = await fetch(base + "/api/activities", {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller ? controller.signal : undefined,
    });
    if (res.ok) {
      let body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      const valid = validateActivitiesPayload(body);
      if (!valid) {
        return { kind: "error", status: res.status,
                 message: "服务器返回的数据格式无效，已保留本地数据。" };
      }
      return { kind: "ok", data: valid, fetchedAt: nowShanghai() };
    }
    let message = "";
    try {
      const payload = await res.json();
      message = payload.message || "";
    } catch (e) { /* non-JSON error body */ }
    return { kind: "error", status: res.status, message };
  } catch (e) {
    if (e && e.name === "AbortError") {
      return { kind: "error", status: 0, message: "刷新超时，已保留本地数据。" };
    }
    return { kind: "unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The ONE manual refresh entry. Fetches, validates, caches on success and
 * reports honestly on failure. The caller swaps GORGON_DATA.activities from
 * the result.
 *
 * @returns {{ kind, message, count?, lastSuccessAt?, generatedAt? }}
 */
export async function refreshFromServer() {
  const out = await fetchActivities();
  if (out.kind !== "ok") {
    const message = out.kind === "unavailable"
      ? "无法连接数据服务，已保留本地数据（未刷新）"
      : (out.message || ("刷新失败（" + out.status + "），已保留本地数据"));
    const state = writeSyncState({
      lastError: message,
      lastErrorCode: out.kind === "unavailable" ? "unavailable" : out.status,
    });
    return { kind: out.kind, message, lastSuccessAt: state.lastSuccessAt || null };
  }
  // Success: cache the dataset, stamp the state, swap nothing here — the
  // caller decides when to swap the live list (single source of truth stays
  // with GORGON_DATA).
  const doc = {
    generatedAt: out.data.generatedAt,
    fetchedAt: out.fetchedAt,
    activities: out.data.activities,
  };
  const cached = safeSet(SYNC_DATASET_KEY, JSON.stringify(doc));
  const state = writeSyncState({ lastSuccessAt: out.fetchedAt, lastError: null, lastErrorCode: null });
  return {
    kind: "ok",
    message: cached ? "已刷新（" + out.data.activities.length + " 个活动）" : "已刷新（本地缓存不可写，本次会话有效）",
    count: out.data.activities.length,
    lastSuccessAt: state.lastSuccessAt,
    generatedAt: out.data.generatedAt,
    activities: out.data.activities,
  };
}
