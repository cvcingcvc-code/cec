// Gorgon Phase 4 — Project Repository (P0-A: 统一项目与任务关系).
//
// The SINGLE persistence + mutation layer for Projects — the hub that links
// 目标 → 活动(Opportunity) → 任务(Task) → 日程(Schedule) → 笔记(Note) → 复盘(Review).
//
// Design constraints (task charter §III P0-A):
//   * ADDITIVE on the existing schema. Tasks carry `projectId` (task-model.js,
//     Phase 4); notes/places carry `projectId` (opportunity-repository.js).
//     This repository only owns the Project records themselves plus the
//     project↔activity link — it never rewrites other stores.
//   * Old data stays readable: a task/note/place without projectId is simply
//     "unassigned" and keeps working everywhere it worked before.
//   * Mirrors task-repository.js conventions exactly:
//       - versioned envelope under ONE key (gorgon_workbench_projects_v1)
//       - corruption is QUARANTINED under "<key>.corrupt-<n>", never destroyed
//       - in-memory fallback when storage is blocked
//   * The key is prefixed `gorgon_`, so native-persistence.js automatically
//     mirrors it to Capacitor Preferences → cold-restart safe on Android.
//
// HONESTY RULES:
//   * A project records WHO created it (`origin`): "manual" | "activity".
//     Activity-linked projects keep the activity snapshot (title/time/venue/
//     dataOrigin) so a DEMO activity is still visibly DEMO inside the project.
//   * Deleting a project is a soft ARCHIVE — user data is never destroyed
//     (charter §IV「不删除已有用户数据」). Tasks/notes keep their projectId;
//     they simply render as belonging to an archived project.

import { randomUUID } from "../workbench/uuid.js";

const K = "gorgon_workbench_projects_v1";
export const SCHEMA_VERSION = 1;

export const PROJECT_ORIGIN = {
  MANUAL: "manual",       // 用户手动创建
  ACTIVITY: "activity",   // 从活动卡片创建
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
    return false;
  }
}

let memory = null; // in-session fallback mirror
let warned = false;

function warnOnce(msg) {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn("[project-repository] " + msg);
}

function quarantine(raw, why) {
  try {
    let slot = 0;
    let archiveKey = `${K}.corrupt-${slot}`;
    while (localStorage.getItem(archiveKey) != null) {
      slot += 1;
      archiveKey = `${K}.corrupt-${slot}`;
    }
    localStorage.setItem(archiveKey, String(raw));
    warnOnce(`"${K}" unreadable (${why}); archived at "${archiveKey}"; starting empty. NOT auto-cleared.`);
  } catch {
    warnOnce(`"${K}" unreadable (${why}); could not archive; starting empty.`);
  }
}

function emptyEnvelope() {
  return { schemaVersion: SCHEMA_VERSION, projects: [] };
}

/** Normalize an activity snapshot stored ON the project (display-only copy). */
function normalizeActivityLink(a) {
  if (!a || typeof a !== "object") return null;
  const id = String(a.activityId || a.id || "");
  if (!id) return null;
  return {
    activityId: id,
    title: a.title ? String(a.title) : "",
    dateText: a.dateText ? String(a.dateText) : null,
    timeText: a.timeText ? String(a.timeText) : null,
    venue: a.venue ? String(a.venue) : null,
    district: a.district ? String(a.district) : null,
    sourceUrl: a.sourceUrl ? String(a.sourceUrl) : null,
    // Honesty: keep the demo flag on the snapshot so the project UI can
    // badge DEMO activities exactly like the search results do.
    isDemo: a.isDemo === true || a.dataOrigin === "demo",
    linkedAt: a.linkedAt || nowIso(),
  };
}

function normalizeProject(p) {
  if (!p || typeof p !== "object") return null;
  const title = typeof p.title === "string" ? p.title.trim() : "";
  if (!title) return null;
  const origin = Object.values(PROJECT_ORIGIN).includes(p.origin) ? p.origin : PROJECT_ORIGIN.MANUAL;
  return {
    id: String(p.id || randomUUID()),
    title,
    goal: p.goal ? String(p.goal) : "",
    origin,
    activities: Array.isArray(p.activities) ? p.activities.map(normalizeActivityLink).filter(Boolean) : [],
    archived: p.archived === true,
    createdAt: p.createdAt || nowIso(),
    updatedAt: p.updatedAt || nowIso(),
  };
}

function normalizeEnvelope(parsed) {
  const env = emptyEnvelope();
  if (!parsed || typeof parsed !== "object") return env;
  if (Array.isArray(parsed.projects)) {
    env.projects = parsed.projects.map(normalizeProject).filter(Boolean);
  }
  return env;
}

function load() {
  if (memory) return memory;
  const raw = readRaw(K);
  if (raw != null) {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      quarantine(raw, "invalid JSON");
      parsed = null;
    }
    if (parsed && parsed.schemaVersion === SCHEMA_VERSION) {
      memory = normalizeEnvelope(parsed);
      return memory;
    }
    if (parsed) quarantine(raw, `unknown schemaVersion ${parsed.schemaVersion}`);
  }
  memory = emptyEnvelope();
  return memory;
}

function save() {
  const env = load();
  env.schemaVersion = SCHEMA_VERSION;
  if (!writeRaw(K, env)) {
    warnOnce("localStorage write failed; changes live in memory for this session only.");
  }
  return env;
}

// ── Repository API ────────────────────────────────────────────────────

export function listProjects({ includeArchived = false } = {}) {
  const all = load().projects.slice();
  return includeArchived ? all : all.filter((p) => !p.archived);
}

export function getProject(id) {
  return load().projects.find((p) => p.id === String(id)) || null;
}

/**
 * Create a project. `activity` (optional) is a view-model-shaped snapshot
 * {id,title,dateText,timeText,venue,district,sourceUrl,dataOrigin} — it is
 * stored as a display copy so the project survives even if the source list
 * changes. Returns the created project (or null on empty title).
 */
export function createProject({ title, goal, origin, activity } = {}) {
  const t = String(title || "").trim();
  if (!t) return null;
  const env = load();
  const project = normalizeProject({
    id: randomUUID(),
    title: t,
    goal: goal || "",
    origin: origin === PROJECT_ORIGIN.ACTIVITY ? PROJECT_ORIGIN.ACTIVITY : PROJECT_ORIGIN.MANUAL,
    activities: activity ? [normalizeActivityLink({
      activityId: activity.id || activity.activityId,
      title: activity.title,
      dateText: activity.dateText,
      timeText: activity.timeText,
      venue: activity.venue,
      district: activity.district,
      sourceUrl: activity.sourceUrl,
      isDemo: activity.dataOrigin === "demo" || activity.isDemo === true,
    })] : [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (!project) return null;
  env.projects.unshift(project);
  save();
  return project;
}

/**
 * Find an existing (non-archived) project already linked to this activity.
 * Lets the UI offer "关联到已有项目" without duplicating links blindly.
 */
export function findProjectByActivity(activityId) {
  const id = String(activityId || "");
  if (!id) return null;
  return load().projects.find(
    (p) => !p.archived && p.activities.some((a) => a.activityId === id),
  ) || null;
}

export function updateProject(id, patch = {}) {
  const env = load();
  const idx = env.projects.findIndex((p) => p.id === String(id));
  if (idx < 0) return null;
  const next = normalizeProject(Object.assign({}, env.projects[idx], patch, {
    id: String(id),
    createdAt: env.projects[idx].createdAt,
    updatedAt: nowIso(),
  }));
  if (!next) return null;
  env.projects[idx] = next;
  save();
  return next;
}

/** Link an activity snapshot to a project. Idempotent per activityId. */
export function linkActivity(projectId, activity) {
  const project = getProject(projectId);
  const link = normalizeActivityLink({
    activityId: activity && (activity.id || activity.activityId),
    title: activity && activity.title,
    dateText: activity && activity.dateText,
    timeText: activity && activity.timeText,
    venue: activity && activity.venue,
    district: activity && activity.district,
    sourceUrl: activity && activity.sourceUrl,
    isDemo: !!(activity && (activity.dataOrigin === "demo" || activity.isDemo === true)),
  });
  if (!project || !link) return null;
  if (project.activities.some((a) => a.activityId === link.activityId)) return project;
  return updateProject(projectId, { activities: project.activities.concat([link]) });
}

/** Unlink (never deletes the activity data itself). */
export function unlinkActivity(projectId, activityId) {
  const project = getProject(projectId);
  if (!project) return null;
  return updateProject(projectId, {
    activities: project.activities.filter((a) => a.activityId !== String(activityId)),
  });
}

/** Soft delete — archive, never destroy (charter §IV). */
export function archiveProject(id) {
  return updateProject(id, { archived: true });
}

export function restoreProject(id) {
  return updateProject(id, { archived: false });
}

/** §31-style diagnostics surface. */
export function getStorageHealth() {
  const raw = readRaw(K);
  if (raw == null) return { state: "empty" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.projects)) {
      return { state: "ok", count: parsed.projects.length };
    }
    return { state: "unknown_schema", version: parsed ? parsed.schemaVersion : null };
  } catch {
    return { state: "corrupt" };
  }
}

/** Test/demo-reset hook. Mirrors the other repositories. */
export function reset() {
  memory = null;
  try {
    localStorage.removeItem(K);
  } catch (e) { /* ignore */ }
}
