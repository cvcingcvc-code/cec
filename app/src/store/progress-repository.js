// Gorgon V2.2 — Progress repository (unified progress concept).
//
// The SINGLE persistence layer for progress entries across ALL subjects
// (projects / tasks / places / registrations). V2.2 gap #1 from the audit:
// progress previously existed only as scattered timeline events and the
// REG_STATUS "in_progress" label — there was no unified, user-facing
// progress record a person can write and re-read.
//
// Mirrors opportunity-repository.js conventions:
//   * versioned envelope under one key (gorgon_workbench_progress_v1)
//   * corruption safety: invalid JSON is QUARANTINED under
//     "<key>.corrupt-<n>", never auto-destroyed
//   * in-memory fallback so the session still works when storage is blocked
//   * reads always prefer localStorage, so a fresh read after a write IS the
//     "re-enter and look again" semantics (cold restart equivalent)
//
// HONESTY RULES:
//   * A progress entry is written by the USER (or an explicit action) — this
//     layer never auto-generates progress text.
//   * kind is descriptive only ("milestone"/"blocked"/"done"/"note"); it does
//     NOT change any subject's real status. Task status changes still must go
//     through the formal state machine (task-model.js TRANSITIONS).

import { randomUUID } from "../workbench/uuid.js";

const K = "gorgon_workbench_progress_v1";
export const SCHEMA_VERSION = 1;
export const PROGRESS_KEY = K;

/** What a progress entry can be attached to. */
export const PROGRESS_SUBJECT = {
  PROJECT: "project",
  TASK: "task",
  PLACE: "place",
  REGISTRATION: "registration",
};

/** Entry kinds — descriptive vocabulary, rendered by the UI as-is. */
export const PROGRESS_KIND = {
  NOTE: "note",           // 记录（默认）
  MILESTONE: "milestone", // 里程碑
  BLOCKED: "blocked",     // 受阻
  DONE: "done",           // 完成
};

export const PROGRESS_LABEL = {
  [PROGRESS_KIND.NOTE]: "记录",
  [PROGRESS_KIND.MILESTONE]: "里程碑",
  [PROGRESS_KIND.BLOCKED]: "受阻",
  [PROGRESS_KIND.DONE]: "完成",
};

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
  console.warn("[progress-repository] " + msg);
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

function normalizeEntry(input) {
  const text = String(input.text == null ? "" : input.text).trim();
  if (!text) return null;
  const subjectType = PROGRESS_SUBJECT[(String(input.subjectType || "")).toUpperCase()]
    || (Object.values(PROGRESS_SUBJECT).includes(input.subjectType) ? input.subjectType : null);
  const subjectId = String(input.subjectId == null ? "" : input.subjectId).trim();
  if (!subjectType || !subjectId) return null;
  const kind = Object.values(PROGRESS_KIND).includes(input.kind) ? input.kind : PROGRESS_KIND.NOTE;
  return {
    id: String(input.id || randomUUID()),
    subjectType,
    subjectId,
    subjectTitle: String(input.subjectTitle == null ? "" : input.subjectTitle).trim(),
    kind,
    text,
    createdAt: String(input.createdAt || nowIso()),
    updatedAt: String(input.updatedAt || nowIso()),
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
    return { schemaVersion: SCHEMA_VERSION, entries: [] };
  }
  try {
    const env = JSON.parse(raw);
    if (!env || typeof env !== "object" || !Array.isArray(env.entries)) {
      quarantine(raw, "envelope shape");
      return { schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    memory = env;
    return env;
  } catch (e) {
    quarantine(raw, "invalid JSON");
    return { schemaVersion: SCHEMA_VERSION, entries: [] };
  }
}

function save(env) {
  memory = env;
  const ok = writeRaw(K, env);
  if (!ok) warnOnce("storage write failed; keeping in-memory mirror only");
  return ok;
}

/** List progress entries, newest first. Filter: {subjectType, subjectId, kind}. */
export function listProgress(filter = {}) {
  const env = load();
  let entries = env.entries.filter((e) => e && typeof e === "object" && e.id);
  if (filter.subjectType) entries = entries.filter((e) => e.subjectType === filter.subjectType);
  if (filter.subjectId) entries = entries.filter((e) => e.subjectId === filter.subjectId);
  if (filter.kind) entries = entries.filter((e) => e.kind === filter.kind);
  return entries.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Add one progress entry. Returns the stored entry, or null on invalid input. */
export function addProgress(input) {
  const env = load();
  const entry = normalizeEntry(Object.assign({}, input, {
    id: (input && input.id) || randomUUID(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  if (!entry) return null;
  env.entries.unshift(entry);
  save(env);
  return entry;
}

/** Update text/kind of one entry. Subject identity is immutable. */
export function updateProgress(id, patch = {}) {
  const env = load();
  const idx = env.entries.findIndex((e) => e.id === String(id));
  if (idx < 0) return null;
  const prev = env.entries[idx];
  const text = patch.text !== undefined ? String(patch.text).trim() : prev.text;
  if (!text) return null; // empty text would erase the record — refuse
  const kind = Object.values(PROGRESS_KIND).includes(patch.kind) ? patch.kind : prev.kind;
  const next = Object.assign({}, prev, {
    text,
    kind,
    updatedAt: nowIso(),
  });
  env.entries[idx] = next;
  save(env);
  return next;
}

/** Remove one entry. Returns true when something was removed. */
export function removeProgress(id) {
  const env = load();
  const idx = env.entries.findIndex((e) => e.id === String(id));
  if (idx < 0) return false;
  env.entries.splice(idx, 1);
  save(env);
  return true;
}

/** Count entries for one subject (any kind). */
export function countProgress(subjectType, subjectId) {
  return load().entries.filter(
    (e) => e.subjectType === subjectType && e.subjectId === subjectId
  ).length;
}

/** Storage health probe for the settings/diagnostics surface. */
export function getStorageHealth() {
  let raw = null;
  try {
    raw = localStorage.getItem(K);
  } catch (e) {
    return { available: false, key: K, entries: 0, corrupted: 0 };
  }
  let corrupted = 0;
  try {
    let slot = 0;
    while (localStorage.getItem(`${K}.corrupt-${slot}`) != null) {
      corrupted += 1;
      slot += 1;
    }
  } catch (e) { /* ignore */ }
  let entries = 0;
  try {
    const env = raw == null ? null : JSON.parse(raw);
    if (env && Array.isArray(env.entries)) entries = env.entries.length;
  } catch (e) { /* counted as corrupted on next load */ }
  return { available: true, key: K, entries, corrupted };
}

export function reset() {
  memory = null;
  try {
    localStorage.removeItem(K);
  } catch (e) { /* ignore */ }
}
