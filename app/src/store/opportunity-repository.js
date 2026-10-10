// Gorgon 2.0 — Opportunity management repository (Modules C / D / E / F).
//
// The SINGLE persistence + mutation layer for opportunity-centric records:
//   C  registration tracking per favorited activity + prep checklist + reminders
//   D  field-visit places (地推走访) with status workflow
//   E  notes (text now; audio metadata once recording lands)
//   F  post-event review — PREDICTED value and ACTUAL outcome stored SEPARATELY
//
// Screens never touch localStorage directly; they go through this module,
// mirroring task-repository.js conventions:
//   * versioned envelope under one key (gorgon_opportunities_v1)
//   * corruption safety: invalid JSON is QUARANTINED under
//     "<key>.corrupt-<n>", never auto-destroyed
//   * in-memory fallback so the session still works when storage is blocked
//
// HONESTY RULES (task charter §III-C):
//   * Opening the official registration page is recorded as
//     "opened_registration" — it is NEVER recorded as registered.
//   * Only an explicit user confirmation moves a record to "registered".
//   * Predicted benefits (Module B's ranking reasons) and user-recorded
//     actual outcomes (Module F) live in different fields and are never
//     merged by this layer.

import { randomUUID } from "../workbench/uuid.js";
import { buildICS } from "../lib/ics.js";

const K = "gorgon_opportunities_v1";
export const SCHEMA_VERSION = 1;

/**
 * Registration states — the ONLY vocabulary the UI may render.
 * 未报名 / 已打开报名页 / 报名中 / 已报名(用户确认) / 未成功 / 已取消
 */
export const REG_STATUS = {
  NONE: "none",                        // 未报名（默认）
  OPENED: "opened_registration",       // 已打开官方报名页 —— NOT registered
  IN_PROGRESS: "in_progress",          // 报名中（用户在官网填表，未提交/未确认）
  REGISTERED: "registered",            // 已报名 —— ONLY via explicit user confirm
  FAILED: "failed",                    // 未成功（名额满/资格不符/超时…）
  CANCELLED: "cancelled",              // 已取消
};

export const REG_LABEL = {
  [REG_STATUS.NONE]: "未报名",
  [REG_STATUS.OPENED]: "已打开报名页",
  [REG_STATUS.IN_PROGRESS]: "报名中",
  [REG_STATUS.REGISTERED]: "已报名",
  [REG_STATUS.FAILED]: "未成功",
  [REG_STATUS.CANCELLED]: "已取消",
};

/** Field-visit place statuses (Module D). 待走访/已走访/需复访/不适合 */
export const PLACE_STATUS = {
  TODO: "todo",
  VISITED: "visited",
  REVISIT: "revisit",
  UNSUITABLE: "unsuitable",
};

export const PLACE_LABEL = {
  [PLACE_STATUS.TODO]: "待走访",
  [PLACE_STATUS.VISITED]: "已走访",
  [PLACE_STATUS.REVISIT]: "需复访",
  [PLACE_STATUS.UNSUITABLE]: "不适合",
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
  console.warn("[opportunity-repository] " + msg);
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
  return {
    schemaVersion: SCHEMA_VERSION,
    registrations: {},  // activityId -> registration record
    places: [],         // Module D place records
    notes: [],          // Module E note records
    reviews: {},        // activityId -> Module F review record
    // Phase 4 (P0-C): projectId -> minimal project review record.
    // Additive: old envelopes have no projectReviews and normalize to {}.
    projectReviews: {},
  };
}

function normalizeRegistration(r) {
  if (!r || typeof r !== "object") return null;
  const status = Object.values(REG_STATUS).includes(r.status) ? r.status : REG_STATUS.NONE;
  return {
    activityId: String(r.activityId || ""),
    status,
    goal: r.goal == null ? null : String(r.goal),
    confirmedAt: r.confirmedAt || null,   // only set with REGISTERED
    openedAt: r.openedAt || null,
    updatedAt: r.updatedAt || nowIso(),
    prep: Array.isArray(r.prep) ? r.prep : [],       // [{id,title,done}]
    remindAt: r.remindAt || null,                    // ISO or null
    note: r.note == null ? null : String(r.note),
    sourceUrl: r.sourceUrl || null,
  };
}

function normalizePlace(p) {
  if (!p || typeof p !== "object") return null;
  const status = Object.values(PLACE_STATUS).includes(p.status) ? p.status : PLACE_STATUS.TODO;
  return {
    id: String(p.id || randomUUID()),
    name: String(p.name || ""),
    address: p.address ? String(p.address) : "",
    coord: p.coord && typeof p.coord === "object" ? p.coord : null, // {lat,lng}
    status,
    visits: Array.isArray(p.visits) ? p.visits : [],  // [{at,note,nextPlan}]
    nextPlan: p.nextPlan ? String(p.nextPlan) : null, // 复访计划
    // Phase 4 (P0-A): optional project link. Old records normalize to null,
    // so existing data keeps loading unchanged.
    projectId: p.projectId ? String(p.projectId) : null,
    createdAt: p.createdAt || nowIso(),
    updatedAt: p.updatedAt || nowIso(),
  };
}

function normalizeNote(n) {
  if (!n || typeof n !== "object") return null;
  const kind = n.kind === "audio" ? "audio" : "text";
  return {
    id: String(n.id || randomUUID()),
    kind,
    text: n.text ? String(n.text) : "",
    // audio metadata (recording itself lives in the app sandbox via
    // Filesystem; we only keep the pointer + duration here).
    audioPath: kind === "audio" ? (n.audioPath ? String(n.audioPath) : null) : null,
    audioDurationMs: kind === "audio" ? (Number(n.audioDurationMs) || 0) : null,
    // associations — a note belongs to an activity and/or a place and/or a task
    activityId: n.activityId ? String(n.activityId) : null,
    placeId: n.placeId ? String(n.placeId) : null,
    taskId: n.taskId ? String(n.taskId) : null,
    // Phase 4 (P0-A/P0-C): project link. Additive — null for all pre-Phase-4
    // records, which keeps them readable and simply "unassigned".
    projectId: n.projectId ? String(n.projectId) : null,
    createdAt: n.createdAt || nowIso(),
    updatedAt: n.updatedAt || nowIso(),
  };
}

function normalizeReview(rv) {
  if (!rv || typeof rv !== "object") return null;
  return {
    activityId: String(rv.activityId || ""),
    // Phase 4 (P0-C): the minimal review can also hang off a project.
    projectId: rv.projectId ? String(rv.projectId) : null,
    // Module F: ACTUAL outcome recorded by the user AFTER the event.
    actual: {
      outcome: rv.actual && rv.actual.outcome ? String(rv.actual.outcome) : "",
      gains: rv.actual && Array.isArray(rv.actual.gains) ? rv.actual.gains.map(String) : [],
      costs: rv.actual && Array.isArray(rv.actual.costs) ? rv.actual.costs.map(String) : [],
      recordedAt: rv.actual && rv.actual.recordedAt ? rv.actual.recordedAt : null,
    },
    // PREDICTED value is stored here ONLY as an immutable snapshot of what
    // the system predicted at save time — never edited by review flows, and
    // the UI must render predicted vs actual as two separate blocks.
    predicted: {
      reasons: rv.predicted && Array.isArray(rv.predicted.reasons) ? rv.predicted.reasons.map(String) : [],
      expectedBenefit: rv.predicted && rv.predicted.expectedBenefit ? String(rv.predicted.expectedBenefit) : "",
      expectedCost: rv.predicted && rv.predicted.expectedCost ? String(rv.predicted.expectedCost) : "",
      snapshotAt: rv.predicted && rv.predicted.snapshotAt ? rv.predicted.snapshotAt : null,
    },
    followUps: Array.isArray(rv.followUps) ? rv.followUps : [], // [{id,title,done}]
    nextAction: rv.nextAction ? String(rv.nextAction) : "",
    updatedAt: rv.updatedAt || nowIso(),
  };
}

/**
 * Phase 4 (P0-C) — the MINIMAL project review (复盘).
 * Deliberately small: 实际结果 + 下一步行动 + 可选跟进清单. The user fills
 * this in by hand after executing; nothing is auto-generated, and an empty
 * review is honestly empty (never pre-filled with AI suggestions).
 */
function normalizeProjectReview(rv) {
  if (!rv || typeof rv !== "object") return null;
  const projectId = String(rv.projectId || "");
  if (!projectId) return null;
  return {
    projectId,
    outcome: rv.outcome ? String(rv.outcome) : "",
    nextAction: rv.nextAction ? String(rv.nextAction) : "",
    followUps: Array.isArray(rv.followUps)
      ? rv.followUps.map((f) => ({
          id: String((f && f.id) || randomUUID()),
          title: String((f && f.title) || ""),
          done: !!(f && f.done),
        })).filter((f) => f.title)
      : [],
    createdAt: rv.createdAt || nowIso(),
    updatedAt: rv.updatedAt || nowIso(),
  };
}

function normalizeEnvelope(parsed) {
  const env = emptyEnvelope();
  if (!parsed || typeof parsed !== "object") return env;
  if (parsed.registrations && typeof parsed.registrations === "object") {
    for (const [id, rec] of Object.entries(parsed.registrations)) {
      const n = normalizeRegistration(Object.assign({}, rec, { activityId: id }));
      if (n && n.activityId) env.registrations[n.activityId] = n;
    }
  }
  if (Array.isArray(parsed.places)) {
    env.places = parsed.places.map(normalizePlace).filter(Boolean);
  }
  if (Array.isArray(parsed.notes)) {
    env.notes = parsed.notes.map(normalizeNote).filter(Boolean);
  }
  if (parsed.reviews && typeof parsed.reviews === "object") {
    for (const [id, rec] of Object.entries(parsed.reviews)) {
      const n = normalizeReview(Object.assign({}, rec, { activityId: id }));
      if (n && n.activityId) env.reviews[n.activityId] = n;
    }
  }
  if (parsed.projectReviews && typeof parsed.projectReviews === "object") {
    for (const [id, rec] of Object.entries(parsed.projectReviews)) {
      const n = normalizeProjectReview(Object.assign({}, rec, { projectId: id }));
      if (n && n.projectId) env.projectReviews[n.projectId] = n;
    }
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

/* ── Module C: registration tracking ──────────────────────────────── */

export function getRegistration(activityId) {
  const env = load();
  return env.registrations[String(activityId)] || null;
}

export function listRegistrations() {
  return Object.values(load().registrations);
}

/**
 * Upsert a registration record. `status` is validated against REG_STATUS;
 * unknown values degrade to NONE. REGISTERED requires an explicit call —
 * there is no path where opening a link sets it.
 */
export function setRegistration(activityId, patch = {}) {
  const env = load();
  const id = String(activityId);
  const prev = env.registrations[id] || normalizeRegistration({ activityId: id });
  const next = normalizeRegistration(Object.assign({}, prev, patch, {
    activityId: id,
    updatedAt: nowIso(),
  }));
  if (next.status === REG_STATUS.REGISTERED && !next.confirmedAt) {
    next.confirmedAt = nowIso();
  }
  if (next.status !== REG_STATUS.REGISTERED) {
    next.confirmedAt = null; // confirmation only lives with REGISTERED
  }
  env.registrations[id] = next;
  save();
  return next;
}

/**
 * Record that the user OPENED the official registration page.
 * Deliberately does NOT touch status when the user already progressed
 * further (in_progress/registered/…) — opening the page twice changes
 * nothing. It only advances NONE -> OPENED.
 */
export function markRegistrationOpened(activityId, sourceUrl) {
  const env = load();
  const id = String(activityId);
  const prev = env.registrations[id];
  const patch = { openedAt: nowIso() };
  if (sourceUrl) patch.sourceUrl = String(sourceUrl);
  if (!prev || prev.status === REG_STATUS.NONE) patch.status = REG_STATUS.OPENED;
  return setRegistration(id, patch);
}

/** Set/clear the prep checklist and reminder for one activity. */
export function setPrep(activityId, prepItems, remindAt) {
  const patch = {};
  if (Array.isArray(prepItems)) {
    patch.prep = prepItems.map((it) => ({
      id: String((it && it.id) || randomUUID()),
      title: String((it && it.title) || ""),
      done: !!(it && it.done),
    })).filter((it) => it.title);
  }
  if (remindAt !== undefined) patch.remindAt = remindAt || null;
  return setRegistration(activityId, patch);
}

/**
 * Generate the default 出行前准备事项 for one activity view.
 * Pure helper — the UI seeds the checklist with this, then the user edits.
 */
export function defaultPrepFor(view) {
  const items = ["查看资格要求与报名截止", "规划路线与出行时间", "准备自我介绍/名片"];
  if (view && view.priceType && String(view.priceType).indexOf("免费") < 0) {
    items.push("确认费用与支付方式");
  }
  return items.map((title) => ({ id: randomUUID(), title, done: false }));
}

/**
 * Export ONE activity as an .ics string (Module C).
 * Returns null when required time fields are missing — we never export a
 * fabricated time.
 */
export function exportICS(activityId, view) {
  if (!view) return null;
  const start = view.startDateTime || view.startDate || view.start;
  if (!start) return null;
  const reg = getRegistration(activityId);
  return buildICS({
    uid: `gorgon-${activityId}@workbench`,
    summary: view.title || view.name || "Gorgon 活动",
    start,
    end: view.endDateTime || view.endDate || view.end || null,
    location: view.venue || view.address || null,
    description: [
      view.organizer ? `主办方：${view.organizer}` : "",
      view.sourceUrl ? `来源：${view.sourceUrl}` : "",
      reg && reg.status === REG_STATUS.REGISTERED ? "报名状态：已报名（用户确认）" : "",
      reg && reg.status === REG_STATUS.OPENED ? "报名状态：已打开报名页（未确认报名）" : "",
    ].filter(Boolean).join("\n") || null,
    url: view.registrationUrl || view.sourceUrl || null,
  });
}

/* ── Module D: places & field visits ──────────────────────────────── */

export function listPlaces(statusFilter) {
  const env = load();
  if (!statusFilter) return env.places.slice();
  const want = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
  return env.places.filter((p) => want.includes(p.status));
}

export function getPlace(id) {
  return load().places.find((p) => p.id === String(id)) || null;
}

export function upsertPlace(input) {
  const env = load();
  const id = input && input.id ? String(input.id) : randomUUID();
  const prev = env.places.find((p) => p.id === id);
  const next = normalizePlace(Object.assign({}, prev || {}, input, {
    id,
    updatedAt: nowIso(),
    createdAt: prev ? prev.createdAt : nowIso(),
  }));
  if (prev) {
    env.places[env.places.indexOf(prev)] = next;
  } else {
    env.places.unshift(next);
  }
  save();
  return next;
}

export function setPlaceStatus(id, status) {
  if (!Object.values(PLACE_STATUS).includes(status)) return null;
  return upsertPlace({ id, status });
}

/**
 * Append a visit record (到访时间/现场笔记/复访计划).
 * Marking visited also flips TODO/REVISIT -> VISITED automatically; the
 * caller can still override via setPlaceStatus (e.g. 不适合).
 */
export function addVisit(id, { at, note, nextPlan, status } = {}) {
  const place = getPlace(id);
  if (!place) return null;
  const visit = {
    at: at || nowIso(),
    note: note ? String(note) : "",
    nextPlan: nextPlan ? String(nextPlan) : null,
  };
  const autoStatus = status || (nextPlan ? PLACE_STATUS.REVISIT : PLACE_STATUS.VISITED);
  return upsertPlace({
    id,
    visits: place.visits.concat([visit]),
    nextPlan: visit.nextPlan,
    status: Object.values(PLACE_STATUS).includes(autoStatus) ? autoStatus : PLACE_STATUS.VISITED,
  });
}

export function removePlace(id) {
  const env = load();
  const idx = env.places.findIndex((p) => p.id === String(id));
  if (idx < 0) return false;
  env.places.splice(idx, 1);
  save();
  return true;
}

/* ── Module E: notes ───────────────────────────────────────────────── */

export function listNotes(filter = {}) {
  let notes = load().notes.slice();
  if (filter.activityId) notes = notes.filter((n) => n.activityId === String(filter.activityId));
  if (filter.placeId) notes = notes.filter((n) => n.placeId === String(filter.placeId));
  if (filter.taskId) notes = notes.filter((n) => n.taskId === String(filter.taskId));
  if (filter.projectId) notes = notes.filter((n) => n.projectId === String(filter.projectId));
  if (filter.kind) notes = notes.filter((n) => n.kind === filter.kind);
  return notes;
}

export function addNote(input) {
  const env = load();
  const note = normalizeNote(Object.assign({}, input, {
    id: (input && input.id) || randomUUID(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  env.notes.unshift(note);
  save();
  return note;
}

export function updateNote(id, patch) {
  const env = load();
  const idx = env.notes.findIndex((n) => n.id === String(id));
  if (idx < 0) return null;
  const next = normalizeNote(Object.assign({}, env.notes[idx], patch, {
    id: String(id),
    updatedAt: nowIso(),
  }));
  env.notes[idx] = next;
  save();
  return next;
}

export function removeNote(id) {
  const env = load();
  const idx = env.notes.findIndex((n) => n.id === String(id));
  if (idx < 0) return false;
  env.notes.splice(idx, 1);
  save();
  return true;
}

/* ── Module F: review (predicted vs actual, kept apart) ───────────── */

export function getReview(activityId) {
  return load().reviews[String(activityId)] || null;
}

/**
 * Snapshot the PREDICTED value (from Module B's ranking reasons) when the
 * user saves/registers. Immutable afterwards unless explicitly re-snapshotted.
 */
export function snapshotPredicted(activityId, { reasons, expectedBenefit, expectedCost } = {}) {
  const env = load();
  const id = String(activityId);
  const prev = env.reviews[id] || normalizeReview({ activityId: id });
  prev.predicted = {
    reasons: Array.isArray(reasons) ? reasons.map(String) : prev.predicted.reasons,
    expectedBenefit: expectedBenefit ? String(expectedBenefit) : prev.predicted.expectedBenefit,
    expectedCost: expectedCost ? String(expectedCost) : prev.predicted.expectedCost,
    snapshotAt: nowIso(),
  };
  env.reviews[id] = prev;
  save();
  return prev;
}

/** Record the ACTUAL outcome after the event. Never touches `predicted`. */
export function recordActual(activityId, { outcome, gains, costs } = {}) {
  const env = load();
  const id = String(activityId);
  const prev = env.reviews[id] || normalizeReview({ activityId: id });
  prev.actual = {
    outcome: outcome ? String(outcome) : prev.actual.outcome,
    gains: Array.isArray(gains) ? gains.map(String) : prev.actual.gains,
    costs: Array.isArray(costs) ? costs.map(String) : prev.actual.costs,
    recordedAt: nowIso(),
  };
  env.reviews[id] = prev;
  save();
  return prev;
}

export function setFollowUps(activityId, followUps, nextAction) {
  const env = load();
  const id = String(activityId);
  const prev = env.reviews[id] || normalizeReview({ activityId: id });
  if (Array.isArray(followUps)) {
    prev.followUps = followUps.map((f) => ({
      id: String((f && f.id) || randomUUID()),
      title: String((f && f.title) || ""),
      done: !!(f && f.done),
    })).filter((f) => f.title);
  }
  if (nextAction !== undefined) prev.nextAction = nextAction ? String(nextAction) : "";
  prev.updatedAt = nowIso();
  env.reviews[id] = prev;
  save();
  return prev;
}

/* ── Phase 4 (P0-C): project review — the minimal 复盘 ─────────────── */

export function getProjectReview(projectId) {
  return load().projectReviews[String(projectId)] || null;
}

export function listProjectReviews() {
  return Object.values(load().projectReviews);
}

/**
 * Upsert the minimal review of a project: 实际结果 + 下一步行动.
 * Only non-empty strings overwrite; passing "" keeps the previous value
 * (an accidental clear must not wipe a recorded outcome).
 */
export function setProjectReview(projectId, { outcome, nextAction, followUps } = {}) {
  const env = load();
  const id = String(projectId);
  if (!id) return null;
  const prev = env.projectReviews[id] || normalizeProjectReview({ projectId: id });
  const next = normalizeProjectReview({
    projectId: id,
    // Falsy ("") keeps the previous value: an accidental clear in the UI
    // must not wipe a recorded outcome. Deletion is not a review-flow job.
    outcome: outcome ? String(outcome) : prev.outcome,
    nextAction: nextAction ? String(nextAction) : prev.nextAction,
    followUps: Array.isArray(followUps) ? followUps : prev.followUps,
    createdAt: prev.createdAt,
    updatedAt: nowIso(),
  });
  env.projectReviews[id] = next;
  save();
  return next;
}

/* ── Reset (used by demo-reset and tests) ─────────────────────────── */

export function reset() {
  memory = null;
  try {
    localStorage.removeItem(K);
  } catch (e) { /* ignore */ }
}
