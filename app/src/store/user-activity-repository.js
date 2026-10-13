// Gorgon Workbench — user-activity-repository.js (Phase 5: 真实活动源).
//
// Activities the USER creates by hand — the honest "real data source" that
// works without any backend. Distinct from:
//   * ui_kits/app/data.js DEMO records (demo: true, fallback only);
//   * ui_kits/app/generated-data.js pipeline records (demo: true);
//   * recorded API search results (dataOrigin per result).
//
// Mirrors progress-repository.js conventions:
//   * versioned envelope under one key (gorgon_workbench_user_activities_v1)
//   * corruption safety: invalid JSON is QUARANTINED under
//     "<key>.corrupt-<n>", never auto-destroyed
//   * in-memory fallback so the session still works when storage is blocked
//   * reads always prefer localStorage, so a fresh read after a write IS the
//     "re-enter and look again" semantics (cold restart equivalent)
//
// HONESTY RULES:
//   * a user activity is marked dataOrigin "user" — it never pretends to
//     come from the pipeline or an API;
//   * title is required; everything else is optional and normalized;
//   * ADDITIVE: its own envelope key — no existing key or semantics change.

import { randomUUID } from "../workbench/uuid.js";

const K = "gorgon_workbench_user_activities_v1";
export const SCHEMA_VERSION = 1;
export const USER_ACTIVITY_KEY = K;

export const USER_ACTIVITY_ORIGIN = "user";

const nowIso = () => new Date().toISOString();

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false; // quota/private mode — memory fallback stays in play
  }
}

let memory = null; // in-session fallback mirror
let warned = false;

function warnOnce(msg) {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn("[user-activity-repository] " + msg);
}

function quarantine(raw, why) {
  try {
    let slot = 0;
    let archiveKey = `${K}.corrupt-${slot}`;
    while (localStorage.getItem(archiveKey) != null) {
      slot += 1;
      archiveKey = `${K}.corrupt-${slot}`;
    }
    localStorage.setItem(archiveKey, raw);
  } catch (e) { /* nothing more we can do */ }
  warnOnce(`corrupt envelope quarantined (${why}); starting fresh`);
}

function normalizeActivity(a) {
  if (!a || typeof a !== "object") return null;
  const title = String(a.title == null ? "" : a.title).trim();
  if (!title) return null;
  return {
    id: String(a.id || randomUUID()),
    // dataOrigin "user" — these records never impersonate pipeline/api data.
    dataOrigin: USER_ACTIVITY_ORIGIN,
    demo: false,
    isDemo: false,
    title,
    // when (loose display fields; the schedule layer parses scheduledDate)
    dateText: a.dateText ? String(a.dateText) : null,
    day: a.day ? String(a.day) : null,           // sat/sun/mon...
    startDate: a.startDate ? String(a.startDate) : null, // ISO when known
    time: a.time ? String(a.time) : null,        // "14:00"
    end: a.end ? String(a.end) : null,
    // where
    venue: a.venue ? String(a.venue) : null,
    address: a.address ? String(a.address) : null,
    district: a.district ? String(a.district) : null,
    coord: a.coord && typeof a.coord === "object" ? a.coord : null,
    // what
    category: a.category ? String(a.category) : null,
    tags: Array.isArray(a.tags) ? a.tags.filter((t) => typeof t === "string" && t) : [],
    price: a.price ? String(a.price) : null,
    priceType: a.priceType ? String(a.priceType) : null,
    organizer: a.organizer ? String(a.organizer) : null,
    description: a.description ? String(a.description) : null,
    // links — never invented: null when the user did not provide one
    sourceUrl: a.sourceUrl ? String(a.sourceUrl) : null,
    registrationUrl: a.registrationUrl ? String(a.registrationUrl) : null,
    createdAt: a.createdAt || nowIso(),
    updatedAt: a.updatedAt || nowIso(),
  };
}

/** Fresh envelope from localStorage (memory fallback when storage blocked). */
function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(K);
  } catch (e) {
    raw = null;
  }
  if (raw == null) {
    if (memory && typeof memory === "object") return memory;
    return { schemaVersion: SCHEMA_VERSION, activities: [] };
  }
  try {
    const env = JSON.parse(raw);
    if (!env || typeof env !== "object" || !Array.isArray(env.activities)) {
      quarantine(raw, "envelope shape");
      return { schemaVersion: SCHEMA_VERSION, activities: [] };
    }
    memory = env;
    return env;
  } catch (e) {
    quarantine(raw, "invalid JSON");
    return { schemaVersion: SCHEMA_VERSION, activities: [] };
  }
}

function save(env) {
  memory = env;
  const ok = writeRaw(K, env);
  if (!ok) warnOnce("storage write failed; keeping in-memory mirror only");
  return ok;
}

/** List user activities, newest first. */
export function listActivities() {
  return load().activities.filter((a) => a && typeof a === "object" && a.id)
    .slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getActivity(id) {
  return load().activities.find((a) => a.id === String(id)) || null;
}

/**
 * Create a user activity. Returns the created record, or null when the
 * title is empty (nothing is written).
 */
export function addActivity(input) {
  const next = normalizeActivity(Object.assign({}, input, {
    id: (input && input.id) || randomUUID(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  if (!next) return null;
  const env = load();
  env.activities.unshift(next);
  save(env);
  return next;
}

/**
 * Update an existing user activity (partial patch). Returns the updated
 * record, or null when the id is unknown. dataOrigin is never overwritable.
 */
export function updateActivity(id, patch) {
  const env = load();
  const idx = env.activities.findIndex((a) => a.id === String(id));
  if (idx < 0) return null;
  const next = normalizeActivity(Object.assign({}, env.activities[idx], patch || {}, {
    id: String(id),
    dataOrigin: USER_ACTIVITY_ORIGIN, // never overwritable
    demo: false,
    isDemo: false,
    createdAt: env.activities[idx].createdAt,
    updatedAt: nowIso(),
  }));
  if (!next) return null;
  env.activities[idx] = next;
  save(env);
  return next;
}

export function removeActivity(id) {
  const env = load();
  const idx = env.activities.findIndex((a) => a.id === String(id));
  if (idx < 0) return false;
  env.activities.splice(idx, 1);
  save(env);
  return true;
}

/** Count of user activities (for honest display). */
export function countActivities() {
  return load().activities.length;
}

/** Test/diagnostic reset — clears the envelope and the memory mirror. */
export function reset() {
  memory = null;
  try {
    localStorage.removeItem(K);
  } catch (e) { /* storage blocked — memory already cleared */ }
}
