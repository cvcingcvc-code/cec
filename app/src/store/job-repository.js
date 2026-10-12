// Gorgon V2.2 Stage 3 — Job application repository (求职场景 B persistence).
//
// The SINGLE persistence layer for job applications, mirroring
// opportunity-repository.js conventions:
//   * versioned envelope under one key (gorgon_workbench_jobs_v1)
//   * corruption safety: invalid JSON is QUARANTINED under
//     "<key>.corrupt-<n>", never auto-destroyed
//   * in-memory fallback so the session still works when storage is blocked
//
// HONESTY RULES (job-model.js):
//   * Stage moves ONLY via transitionStage() against the TRANSITIONS
//     whitelist; illegal moves are a safe no-op.
//   * offered / accepted are ONLY reachable via explicit user confirmation —
//     this layer never auto-advances a stage.
//   * rejected / ghosted are honest terminal records, never hidden.

import * as Model from "../workbench/job-model.js";

const K = "gorgon_workbench_jobs_v1";
export const SCHEMA_VERSION = 1;
export const JOB_KEY = K;

export const JOB_STAGE = Model.JOB_STAGE;
export const JOB_STAGE_LABEL = Model.JOB_STAGE_LABEL;
export const canTransitionJobStage = Model.canTransition;
export const InvalidJobStageError = Model.InvalidStageTransitionError;

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
    return false;
  }
}

let memory = null;
let warned = false;

function warnOnce(msg) {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn("[job-repository] " + msg);
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

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(K);
  } catch (e) {
    raw = null;
  }
  if (raw == null) {
    if (memory && typeof memory === "object") return memory;
    return { schemaVersion: SCHEMA_VERSION, applications: [] };
  }
  try {
    const env = JSON.parse(raw);
    if (!env || typeof env !== "object" || !Array.isArray(env.applications)) {
      quarantine(raw, "envelope shape");
      return { schemaVersion: SCHEMA_VERSION, applications: [] };
    }
    memory = env;
    return env;
  } catch (e) {
    quarantine(raw, "invalid JSON");
    return { schemaVersion: SCHEMA_VERSION, applications: [] };
  }
}

function save(env) {
  memory = env;
  const ok = writeRaw(K, env);
  if (!ok) warnOnce("storage write failed; keeping in-memory mirror only");
  return ok;
}

/** All applications, newest first. Filter: {stage}. */
export function listApplications(filter = {}) {
  const env = load();
  let apps = env.applications.filter((a) => a && typeof a === "object" && a.id);
  if (filter.stage) apps = apps.filter((a) => a.stage === filter.stage);
  return apps.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getApplication(id) {
  return load().applications.find((a) => a.id === String(id)) || null;
}

/** Add one application. Starts at COLLECTING — never a later stage. */
export function addApplication(input) {
  const env = load();
  const app = Model.normalizeApplication(Object.assign({}, input, {
    id: (input && input.id) || undefined,
    createdAt: nowIso(),
  }));
  if (!app) return null; // company/role missing — never fabricate
  env.applications.unshift(app);
  save(env);
  return app;
}

/**
 * The ONLY legal stage-change path. Illegal / unknown stages are a safe
 * no-op (returns null). Every move appends to stageHistory (audit trail).
 */
export function transitionStage(id, toStage) {
  const env = load();
  const idx = env.applications.findIndex((a) => a.id === String(id));
  if (idx < 0) return null;
  const app = env.applications[idx];
  const from = app.stage;
  if (from === toStage) return app; // no-op
  if (!Model.canTransition(from, toStage)) return null; // illegal — refuse
  app.stage = toStage;
  app.stageHistory = (app.stageHistory || []).concat([{ stage: toStage, at: nowIso() }]);
  app.updatedAt = nowIso();
  env.applications[idx] = app;
  save(env);
  return app;
}

/** Update notes / sourceUrl only. Stage moves go through transitionStage. */
export function updateApplication(id, patch = {}) {
  const env = load();
  const idx = env.applications.findIndex((a) => a.id === String(id));
  if (idx < 0) return null;
  const prev = env.applications[idx];
  const next = Object.assign({}, prev);
  if (patch.notes !== undefined) next.notes = String(patch.notes).trim();
  if (patch.sourceUrl !== undefined) next.sourceUrl = String(patch.sourceUrl).trim();
  next.updatedAt = nowIso();
  env.applications[idx] = next;
  save(env);
  return next;
}

/** Remove one application. Returns true when something was removed. */
export function removeApplication(id) {
  const env = load();
  const idx = env.applications.findIndex((a) => a.id === String(id));
  if (idx < 0) return false;
  env.applications.splice(idx, 1);
  save(env);
  return true;
}

/** Count applications per stage (for the progress center summary). */
export function countByStage() {
  const env = load();
  const counts = {};
  for (const s of Object.values(Model.JOB_STAGE)) counts[s] = 0;
  for (const a of env.applications) {
    if (counts[a.stage] !== undefined) counts[a.stage] += 1;
  }
  return counts;
}

export function getStorageHealth() {
  let raw = null;
  try {
    raw = localStorage.getItem(K);
  } catch (e) {
    return { available: false, key: K, applications: 0, corrupted: 0 };
  }
  let corrupted = 0;
  try {
    let slot = 0;
    while (localStorage.getItem(`${K}.corrupt-${slot}`) != null) {
      corrupted += 1;
      slot += 1;
    }
  } catch (e) { /* ignore */ }
  let applications = 0;
  try {
    const env = raw == null ? null : JSON.parse(raw);
    if (env && Array.isArray(env.applications)) applications = env.applications.length;
  } catch (e) { /* counted as corrupted on next load */ }
  return { available: true, key: K, applications, corrupted };
}

export function reset() {
  memory = null;
  try {
    localStorage.removeItem(K);
  } catch (e) { /* ignore */ }
}
