// Gorgon Workbench — store facade (PHASE 2: unified Task Engine).
//
// PHASE 2 UPGRADE (TASK_ENGINE_FOUNDATION):
//   * Task persistence + mutation now lives in task-repository.js on the
//     versioned v2 schema ("gorgon_workbench_tasks_v2", envelope with
//     schemaVersion: 2). The Phase-1 flat demo store is GONE as a write
//     target; Phase-1 data under "gorgon_workbench_tasks" is migrated once
//     via migrateV1TasksToV2() and the original key is never destroyed.
//   * Status changes MUST go through the formal State Machine
//     (task-model.js TRANSITIONS) — arbitrary status writes are rejected.
//   * Review cards + the flat activity log remain local UI surfaces, as in
//     Phase 1. History now merges Task timelines with this log.
//   * Still NO backend, NO AI, NO LLM. Deliberately separate from the
//     legacy GorgonStore (store.js) contract.

import * as Repo from "./task-repository.js";
import {
  TASK_STATUS, canTransition, InvalidTransitionError,
  normIsoOrNull, normDateStrOrNull, normPriorityOrNull, localDateStr, isTaskOnDate, isOpenTask, isOverdue,
} from "../workbench/task-model.js";
import { runTask as runTaskEngine } from "../workbench/task-runner.js";
import { searchActivities } from "../lib/api.js";
import * as Proposals from "./proposal-repository.js";
import * as Projects from "./project-repository.js";
import * as Opportunities from "./opportunity-repository.js";
import * as JobsRepo from "./job-repository.js";
import * as UserActs from "./user-activity-repository.js";

const K_TASKS_V2 = Repo.SCHEMA_VERSION ? "gorgon_workbench_tasks_v2" : "gorgon_workbench_tasks_v2";
const K_V1_TASKS = "gorgon_workbench_tasks";
const K_REVIEW = "gorgon_workbench_review";
const K_LOG = "gorgon_workbench_log";

export const KEYS = { tasks: K_TASKS_V2, tasksV1: K_V1_TASKS, review: K_REVIEW, log: K_LOG };

// Formal Phase-2 vocabulary. NOTE: the Phase-1 "draft" label is retired —
// migrated tasks surface as "created" (see migrateV1TasksToV2).
export { TASK_STATUS, canTransition, InvalidTransitionError };

// V3E: in-memory mirror for the facade-owned UI surfaces (review cards +
// activity log) — same degrade path as the repositories. Plain Node tests
// and private-mode browser sessions keep working when localStorage is blocked.
const memoryStore = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) {
      // Browser with working storage, key absent — a memory mirror here can
      // only be stale (e.g. after reset), so drop it and report empty.
      memoryStore.delete(key);
      return fallback;
    }
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    // localStorage blocked / unavailable (plain Node, private mode) — the
    // in-session mirror is the source of truth for facade surfaces.
    return memoryStore.has(key) ? memoryStore.get(key) : fallback;
  }
}

function write(key, value) {
  memoryStore.set(key, value); // always mirror in memory first
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* private mode / quota — memory fallback keeps the session working */
  }
}

const nowIso = () => new Date().toISOString();

// ---- Tasks (formal engine via repository) ----------------------------

/** All tasks, v2 schema. First read auto-migrates Phase-1 data (§30). */
export function getTasks() {
  return Repo.listTasks();
}

export function getTask(id) {
  return Repo.getTask(id);
}

/**
 * Create a task. The user text is the GOAL; the title is auto-derived from
 * it (§16). Kept for Phase-1 call sites — returns the stored list.
 * Phase 4: opts may carry dueAt / scheduledDate / projectId (all optional;
 * createTask normalizes them, invalid values degrade to null).
 * V2.3 (Phase 1): opts may also carry priority ("high"|"normal"|"low";
 * invalid values degrade to "normal").
 */
export function addTask(goal, { source = "手动输入", dueAt = null, scheduledDate = null, projectId = null, priority = null } = {}) {
  const text = String(goal || "").trim();
  if (!text) return Repo.listTasks();
  const next = Repo.createTaskEntry(text, { source, dueAt, scheduledDate, projectId, priority });
  logEvent("task_create", `创建任务「${next[0] ? next[0].title : text}」`);
  return next;
}

/**
 * Status changes through the State Machine ONLY. Illegal / unknown target
 * statuses are a safe no-op (returns current list unchanged).
 */
export function setTaskStatus(id, status) {
  const before = Repo.getTask(id);
  const next = Repo.tryTransitionTask(id, status);
  if (!next) return Repo.listTasks(); // illegal or missing — no-op
  const t = Repo.getTask(id);
  logEvent("task_status", `「${t ? t.title : id}」→ ${status}`);
  void before;
  return next;
}

export function transitionTask(id, status, opts = {}) {
  const next = Repo.transitionTask(id, status, opts); // throws on illegal
  const t = Repo.getTask(id);
  logEvent("task_status", `「${t ? t.title : id}」→ ${status}`);
  return next;
}

export function tryTransitionTask(id, status, opts = {}) {
  return Repo.tryTransitionTask(id, status, opts);
}

// V3E (任务包 A): deleteTask is now SOFT delete (undo window); the old
// destructive behavior moved to deleteTaskForever. restoreTask/getDeletedTasks/
// purgeExpiredDeletedTasks back the回收站 surface in HistoryScreen.
export function deleteTask(id) {
  return Repo.deleteTask(id);
}

export function restoreTask(id) {
  const next = Repo.restoreTask(id);
  if (next) logEvent("task_restore", "任务已从回收站恢复");
  return next;
}

export function getDeletedTasks() {
  return Repo.getDeletedTasks();
}

export function deleteTaskForever(id) {
  return Repo.deleteTaskForever(id);
}

export function purgeExpiredDeletedTasks(nowIso) {
  return Repo.purgeExpiredDeletedTasks(nowIso);
}

export function addTaskStep(id, stepInput) {
  return Repo.addTaskStep(id, stepInput);
}

export function updateTaskStep(taskId, stepId, patch) {
  return Repo.updateTaskStep(taskId, stepId, patch);
}

export function setTaskResult(id, result) {
  return Repo.setTaskResult(id, result);
}

export function addTaskSource(id, source) {
  return Repo.addTaskSource(id, source);
}

export function getStorageHealth() {
  return Repo.getStorageHealth();
}

export function getSchemaVersion() {
  return Repo.SCHEMA_VERSION;
}

// ── Phase 4 (P0-B): task scheduling — dueAt / scheduledDate ────────────
//
// The user sets dates; the engine never does. All writes go through
// updateTask so the timeline records what actually happened.

export function setTaskSchedule(id, { dueAt, scheduledDate } = {}) {
  const task = Repo.getTask(id);
  if (!task) return null;
  const patch = {};
  let changed = false;
  if (dueAt !== undefined) {
    const v = dueAt === null ? null : normIsoOrNull(dueAt);
    if (dueAt !== null && !v) return null; // invalid input — refuse, never guess
    if (v !== task.dueAt) { patch.dueAt = v; changed = true; }
  }
  if (scheduledDate !== undefined) {
    const v = scheduledDate === null ? null : normDateStrOrNull(scheduledDate);
    if (scheduledDate !== null && !v) return null;
    if (v !== task.scheduledDate) { patch.scheduledDate = v; changed = true; }
  }
  if (!changed) return task;
  return Repo.updateTask(id, patch, {
    eventType: "task_scheduled",
    eventMessage: describeSchedule(patch),
    eventMetadata: patch,
  }) && Repo.getTask(id);
}

function describeSchedule(patch) {
  const parts = [];
  if ("dueAt" in patch) parts.push(patch.dueAt ? "截止 " + patch.dueAt.slice(0, 16).replace("T", " ") : "清除截止时间");
  if ("scheduledDate" in patch) parts.push(patch.scheduledDate ? "安排到 " + patch.scheduledDate : "清除计划日期");
  return "调整排期：" + (parts.join("；") || "无变化");
}

// ── V3 Phase A (gap 1): task reminders — remindAt on the task record ──
//
// The user sets reminder times; the engine never does. Same pattern as
// setTaskSchedule: writes go through updateTask so the timeline records
// what actually happened. Native notification scheduling is a SEPARATE,
// fire-and-forget concern handled by lib/native-reminders.js — the data
// layer stays platform-pure (unit-testable without a device).

export function setTaskReminder(id, { remindAt } = {}) {
  const task = Repo.getTask(id);
  if (!task) return null;
  if (remindAt === undefined) return task;
  const v = remindAt === null ? null : normIsoOrNull(remindAt);
  if (remindAt !== null && !v) return null; // invalid input — refuse, never guess
  if (v === task.remindAt) return task;
  return Repo.updateTask(id, { remindAt: v }, {
    eventType: "reminder_changed",
    eventMessage: v
      ? "设置提醒：" + describeReminderLocal(v)
      : "清除提醒",
    eventMetadata: { remindAt: v },
  }) && Repo.getTask(id);
}

function describeReminderLocal(iso) {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  } catch (e) {
    return iso;
  }
}

export function linkTaskToProject(taskId, projectId) {
  const task = Repo.getTask(taskId);
  const project = projectId ? Projects.getProject(projectId) : null;
  if (!task) return null;
  if (projectId && !project) return null;
  if ((task.projectId || null) === (projectId || null)) return task;
  Repo.updateTask(taskId, { projectId: projectId || null }, {
    eventType: "project_linked",
    eventMessage: project ? `关联到项目「${project.title}」` : "已移出项目",
    eventMetadata: { projectId: projectId || null },
  });
  return Repo.getTask(taskId);
}

// ── V2.3 (Phase 1 gap #1): task priority ───────────────────────────────
//
// The user sets the priority; the engine never does. Invalid values are
// refused (never guess); a no-change call returns the task untouched.
const PRIORITY_LABELS = { high: "高", normal: "普通", low: "低" };

export function setTaskPriority(id, priority) {
  const task = Repo.getTask(id);
  if (!task) return null;
  const v = priority === null || priority === undefined ? "normal" : normPriorityOrNull(priority);
  if (!v) return null; // invalid input — refuse, never guess
  if (v === task.priority) return task;
  const updated = Repo.updateTask(id, { priority: v }, {
    eventType: "priority_changed",
    eventMessage: `优先级：${PRIORITY_LABELS[task.priority] || task.priority} → ${PRIORITY_LABELS[v]}`,
    eventMetadata: { from: task.priority, to: v },
  });
  return updated ? Repo.getTask(id) : null;
}

// ── V2.3 (Phase 1 gap #3): task title editing ──────────────────────────
//
// The user renames the task; empty/whitespace is refused (never guess).
// Same-title is a no-op (no timeline noise).

export function setTaskTitle(id, title) {
  const task = Repo.getTask(id);
  if (!task) return null;
  const t = String(title == null ? "" : title).trim();
  if (!t) return null; // empty title — refuse
  if (t === task.title) return task;
  const updated = Repo.updateTask(id, { title: t }, {
    eventType: "task_title_changed",
    eventMessage: `标题：「${task.title}」→「${t}」`,
    eventMetadata: { from: task.title, to: t },
  });
  return updated ? Repo.getTask(id) : null;
}

// ── V2.3 (Phase 1 gap #4): task ↔ place link ───────────────────────────
//
// Additive task.placeId. The place must exist in the Places store; null
// clears the link. Invalid place ids are refused (never guess).

export function linkTaskToPlace(taskId, placeId) {
  const task = Repo.getTask(taskId);
  if (!task) return null;
  const place = placeId ? Opportunities.getPlace(placeId) : null;
  if (placeId && !place) return null; // unknown place — refuse
  if ((task.placeId || null) === (placeId || null)) return task;
  const updated = Repo.updateTask(taskId, { placeId: placeId || null }, {
    eventType: "place_linked",
    eventMessage: place ? `关联到地点「${place.name || place.title || placeId}」` : "已移除地点关联",
    eventMetadata: { placeId: placeId || null },
  });
  return updated ? Repo.getTask(taskId) : null;
}

// ── Phase B3: task ↔ PC agent-run link ──────────────────────────────────
//
// Additive task.agentRunIds (string[]). Idempotent: linking the same runId
// twice does NOT duplicate the entry or the timeline event. Unknown / empty
// runIds are refused (never guess). This closes the phone↔PC loop: the task
// keeps its gateway execution records so the user can find results from the
// task itself, without copying data between screens.

export function linkTaskToAgentRun(taskId, runId, { executor = null, summary = null } = {}) {
  const task = Repo.getTask(taskId);
  if (!task) return null;
  const rid = String(runId || "").trim();
  if (!rid) return null; // empty runId — refuse
  const runIds = Array.isArray(task.agentRunIds) ? task.agentRunIds.map(String) : [];
  if (runIds.indexOf(rid) >= 0) return task; // idempotent — already linked
  const updated = Repo.updateTask(taskId, { agentRunIds: runIds.concat([rid]) }, {
    eventType: "agent_run_linked",
    eventMessage: executor
      ? `关联电脑执行 ${rid.slice(0, 12)}…（${executor}${summary ? "： " + String(summary).slice(0, 60) : ""}）`
      : `关联电脑执行 ${rid.slice(0, 12)}…`,
    eventMetadata: { runId: rid, executor: executor || null, summary: summary ? String(summary).slice(0, 200) : null },
  });
  return updated ? Repo.getTask(taskId) : null;
}

export function getTaskAgentRunIds(taskId) {
  const task = Repo.getTask(taskId);
  if (!task) return [];
  return Array.isArray(task.agentRunIds) ? task.agentRunIds.map(String) : [];
}

// ── V2.3 (Phase 1 gap #5): cross-field task search ─────────────────────
//
// PURE HELPER. Query matches task title and goal (case-insensitive
// substring). No match = empty list — never guess.

export function searchTasks(tasks, query) {
  const q = String(query == null ? "" : query).trim().toLowerCase();
  if (!q) return Array.isArray(tasks) ? tasks.slice() : [];
  return (Array.isArray(tasks) ? tasks : []).filter((t) => {
    const title = String(t.title || "").toLowerCase();
    const goal = String(t.goal || "").toLowerCase();
    return title.includes(q) || goal.includes(q);
  });
}

/**
 * P0-B: convert the plan skill's steps into EDITABLE todo steps on the task.
 * Honest by construction:
 *   * every created step starts as `pending` — a suggestion is NEVER marked done;
 *   * steps carry metadata.origin="plan_suggestion" + method so the UI can say
 *     「来自本地规划建议」;
 *   * duplicates (same title already on the task) are skipped, so pressing the
 *     button twice does not pile up identical todos.
 */
export function savePlanStepsAsTodos(taskId, steps, { source = "plan_suggestion" } = {}) {
  const task = Repo.getTask(taskId);
  if (!task) return null;
  const titles = Array.isArray(steps) ? steps : [];
  const existing = new Set(task.steps.map((s) => s.title));
  const created = [];
  for (const raw of titles) {
    const title = String(raw == null ? "" : (typeof raw === "object" ? raw.title || "" : raw)).trim();
    if (!title || existing.has(title)) continue;
    existing.add(title);
    Repo.addTaskStep(taskId, {
      title,
      metadata: { origin: source, editable: true },
    });
    created.push(title);
  }
  if (created.length) {
    Repo.appendTimelineEvent(taskId, "plan_saved_as_todos",
      `规划建议已保存为 ${created.length} 个可编辑待办（初始状态均为待执行）`,
      { count: created.length, source });
  }
  return Repo.getTask(taskId);
}

/** Today's tasks: open tasks scheduled for (or due on) the given local date. */
export function getTodayTasks(dateStr) {
  const day = dateStr || localDateStr(new Date());
  return Repo.listTasks().filter((t) => isTaskOnDate(t, day));
}

/** Open tasks with no completed/failed status, newest first. */
export function getOpenTasks() {
  return Repo.listTasks().filter((t) => isOpenTask(t));
}

export function isTaskOverdue(task, now) {
  return isOverdue(task, now);
}

export { localDateStr, isTaskOnDate, isOpenTask, normIsoOrNull, normDateStrOrNull };

// ── Phase 4 (P0-A): projects — facade over project-repository ──────────

export const PROJECT_ORIGIN = Projects.PROJECT_ORIGIN;

export function getProjects(opts) {
  return Projects.listProjects(opts);
}

export function getProject(id) {
  return Projects.getProject(id);
}

export function createProject(input) {
  const p = Projects.createProject(input);
  if (p) logEvent("project_create", `创建项目「${p.title}」`);
  return p;
}

/**
 * Create a project FROM an activity view (P0-A step 3). The activity
 * snapshot is stored on the project; DEMO activities keep their flag.
 */
export function createProjectFromActivity(view, { title, goal } = {}) {
  if (!view || !view.id) return null;
  const p = Projects.createProject({
    title: title || view.title || "未命名项目",
    goal: goal || "",
    origin: Projects.PROJECT_ORIGIN.ACTIVITY,
    activity: view,
  });
  if (p) logEvent("project_create", `从活动「${p.title}」创建项目`);
  return p;
}

export function linkActivityToProject(projectId, view) {
  const p = Projects.linkActivity(projectId, view);
  if (p) logEvent("project_link", `项目关联活动「${(view && view.title) || ""}」`);
  return p;
}

export function findProjectByActivity(activityId) {
  return Projects.findProjectByActivity(activityId);
}

export function updateProject(id, patch) {
  return Projects.updateProject(id, patch);
}

export function archiveProject(id) {
  const p = Projects.archiveProject(id);
  if (p) logEvent("project_archive", `归档项目「${p.title}」`);
  return p;
}

// ── V2.3 Phase 5: user-created activities — facade ──────────────────────
// The honest "real data source" that works without any backend: activities
// the USER creates by hand, marked dataOrigin "user" (never impersonating
// pipeline/api/DEMO data). The repository owns persistence via its own
// versioned envelope key; this facade adds the activity-log trail.

export function getUserActivities() {
  return UserActs.listActivities();
}

export function getUserActivity(id) {
  return UserActs.getActivity(id);
}

export function addUserActivity(input) {
  const a = UserActs.addActivity(input || {});
  if (a) logEvent("activity_create", `自建活动「${a.title}」`);
  return a;
}

export function updateUserActivity(id, patch) {
  const a = UserActs.updateActivity(id, patch);
  if (a) logEvent("activity_update", `更新自建活动「${a.title}」`);
  return a;
}

export function removeUserActivity(id) {
  const prev = UserActs.getActivity(id);
  const ok = UserActs.removeActivity(id);
  if (ok && prev) logEvent("activity_remove", `删除自建活动「${prev.title}」`);
  return ok;
}

/**
 * V3F 任务 C — execute a user activity: click 执行 → create (or reuse) a
 * workbench task linked to the activity → write it into the schedule →
 * persist everything so it survives a cold restart.
 *
 * Dedupe contract: at most ONE live task per activity. Dedupe key is
 * metadata.activityId on the task side; the fresh read (listTasks) is the
 * restart-equivalent store, so a re-click can never create a duplicate —
 * including across app restarts. Executed tasks moved to the 回收站
 * (soft-deleted) allow re-execution: the user deleted the result, asking
 * again is a fresh request.
 *
 * Schedule rule (honest): scheduledDate is written ONLY from a real ISO
 * date on the activity (startDate "YYYY-MM-DD…"); a loose dateText is
 * display-only and NEVER parsed into a schedule claim. No date → the task
 * lands in the schedule's _undated bucket, visible, no invented day.
 *
 * Returns { ok, task, alreadyExecuted } — callers surface honest errors,
 * never a fake success.
 */
export function executeUserActivity(a) {
  const id = a && a.id != null ? String(a.id) : null;
  if (!id) return { ok: false, reason: "invalid-activity" };
  // Fresh read — the restart-equivalent store, not a stale prop.
  const act = UserActs.getActivity(id);
  if (!act) return { ok: false, reason: "not-found" };

  // Dedupe against the LIVE task list (soft-deleted tasks excluded by
  // listTasks): re-click after success re-opens the existing task.
  const existing = Repo.listTasks().find(
    (t) => t.metadata && t.metadata.activityId === id);
  if (existing) {
    return { ok: true, task: existing, alreadyExecuted: true };
  }

  // scheduledDate only from a real ISO date; dateText is display-only.
  let scheduledDate = null;
  const iso = act.startDate ? /^(\d{4}-\d{2}-\d{2})/.exec(String(act.startDate)) : null;
  if (iso) scheduledDate = iso[1];

  const goal = "参加活动：" + act.title;
  const tasks = Repo.createTaskEntry(goal, {
    source: "自建活动",
    scheduledDate,
    metadata: { activityId: id },
  });
  const task = Array.isArray(tasks) ? tasks[0] : null;
  if (!task) return { ok: false, reason: "task-create-failed" };

  // Execution state lives on BOTH sides: the task metadata (above) and the
  // activity record (below). The activity side survives restart via its own
  // envelope; the task side survives via the tasks envelope.
  const updated = UserActs.updateActivity(id, {
    executedAt: new Date().toISOString(),
    executionTaskId: task.id,
  });
  if (!updated) return { ok: false, reason: "activity-update-failed", task };

  logEvent("activity_execute", `执行自建活动「${act.title}」→ 任务「${task.title}」`);
  return { ok: true, task, alreadyExecuted: false };
}

/** Everything a project detail surface needs, assembled from the real stores. */
export function getProjectBundle(projectId) {
  const project = Projects.getProject(projectId);
  if (!project) return null;
  const tasks = Repo.listTasks().filter((t) => t.projectId === projectId);
  const notes = Opportunities.listNotes({ projectId });
  const places = Opportunities.listPlaces().filter((pl) => pl.projectId === projectId);
  const review = Opportunities.getProjectReview(projectId);
  const activityIds = project.activities.map((a) => a.activityId);
  const registrations = Opportunities.listRegistrations()
    .filter((r) => activityIds.includes(r.activityId));
  // V2.2 Stage 2: unified progress — project entries + this project's task entries.
  const taskIds = new Set(tasks.map((t) => t.id));
  const progress = ProgressRepo.listProgress({ subjectType: "project", subjectId: projectId })
    .concat(
      ProgressRepo.listProgress({ subjectType: "task" })
        .filter((e) => taskIds.has(e.subjectId))
    )
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { project, tasks, notes, places, review, registrations, progress };
}

/** Today + open view data for the workbench home (P0-D). */
export function getHomeData() {
  const today = localDateStr(new Date());
  const all = Repo.listTasks();
  return {
    today,
    todayTasks: all.filter((t) => isTaskOnDate(t, today)),
    openTasks: all.filter((t) => isOpenTask(t)),
    recentTasks: all.slice(0, 5),
    projects: Projects.listProjects().slice(0, 5),
    recentNotes: Opportunities.listNotes({ kind: "text" }).slice(0, 5),
  };
}

// ── Phase 4 (P0-C): notes + minimal review — facade ────────────────────

export function getNotes(filter) {
  return Opportunities.listNotes(filter || {});
}

export function addNote(input) {
  const n = Opportunities.addNote(input);
  if (n) {
    logEvent("note_create", `记录了一条笔记`);
    if (n.taskId) {
      Repo.appendTimelineEvent(n.taskId, "note_linked", "关联了一条笔记", { noteId: n.id });
    }
  }
  return n;
}

export function updateNote(id, patch) {
  return Opportunities.updateNote(id, patch);
}

export function removeNote(id) {
  return Opportunities.removeNote(id);
}

export function getProjectReview(projectId) {
  return Opportunities.getProjectReview(projectId);
}

export function setProjectReview(projectId, patch) {
  const r = Opportunities.setProjectReview(projectId, patch);
  if (r) logEvent("project_review", `保存了项目复盘`);
  return r;
}

// ── V2.2 (Stage 2): unified progress — facade over progress-repository ──
// One progress concept across projects / tasks / places / registrations.
// ADDITIVE: the repository owns its own versioned key
// (gorgon_workbench_progress_v1); no existing key or semantics change.
// Screens go through this facade, never the repository directly.

import * as ProgressRepo from "./progress-repository.js";

export const PROGRESS_SUBJECT = ProgressRepo.PROGRESS_SUBJECT;
export const PROGRESS_KIND = ProgressRepo.PROGRESS_KIND;
export const PROGRESS_LABEL = ProgressRepo.PROGRESS_LABEL;

export function getProgress(filter) {
  return ProgressRepo.listProgress(filter || {});
}

/**
 * Record a progress entry. The text is the USER's record — this never
 * auto-generates progress. kind is descriptive (note/milestone/blocked/done)
 * and does NOT change any real status; task state moves still go through
 * the formal state machine.
 */
export function addProgress(input) {
  const e = ProgressRepo.addProgress(input || {});
  if (e) {
    logEvent("progress_create", `记录了进度「${e.subjectTitle || e.subjectType}」`);
    if (e.subjectType === "task") {
      Repo.appendTimelineEvent(e.subjectId, "progress_logged", "记录了进度", { progressId: e.id });
    }
  }
  return e;
}

export function updateProgress(id, patch) {
  return ProgressRepo.updateProgress(id, patch || {});
}

export function removeProgress(id) {
  return ProgressRepo.removeProgress(id);
}

/** Everything a progress surface needs: entries + per-subject counts. */
export function getProjectProgressBundle(projectId) {
  const project = Projects.getProject(projectId);
  if (!project) return null;
  const entries = ProgressRepo.listProgress({ subjectType: "project", subjectId: projectId });
  const taskIds = new Set(Repo.listTasks().filter((t) => t.projectId === projectId).map((t) => t.id));
  const taskEntries = ProgressRepo.listProgress({ subjectType: "task" })
    .filter((e) => taskIds.has(e.subjectId));
  return { entries, taskEntries };
}

// ── V2.2 (Stage 4): progress center — cross-project plain-language summary ──
// One place that answers 「每个项目走到哪一步了」 for a normal person.
// Reads ONLY real store data; every summary is derived, never invented.

/**
 * Cross-project progress summary for the 进度中心 screen.
 * Per project: latest progress entry, open/total task counts, next scheduled
 * date, latest note. Plus job pipeline stage counts (Stage 3 vocabulary).
 */
export function getProgressCenterData() {
  const projects = Projects.listProjects().map((p) => {
    const tasks = Repo.listTasks().filter((t) => t.projectId === p.id);
    const open = tasks.filter((t) => isOpenTask(t));
    const latestProgress = ProgressRepo.listProgress({ subjectType: "project", subjectId: p.id })[0] || null;
    const taskProgressCount = ProgressRepo.listProgress({ subjectType: "task" })
      .filter((e) => tasks.some((t) => t.id === e.subjectId)).length;
    const latestNote = Opportunities.listNotes({ projectId: p.id })[0] || null;
    const nextScheduled = tasks
      .filter((t) => t.scheduledDate || t.dueAt)
      .sort((a, b) => String(a.scheduledDate || a.dueAt).localeCompare(String(b.scheduledDate || b.dueAt)))[0] || null;
    // Plain-language status line, derived honestly from real data:
    //   completed tasks exist and none open → 「已完成」
    //   open tasks exist → 「进行中 · N 个任务未完成」
    //   no tasks → 「还没有任务」
    let statusLine;
    if (tasks.length === 0) statusLine = "还没有任务";
    else if (open.length === 0) statusLine = "任务全部完成";
    else statusLine = `进行中 · ${open.length} 个任务未完成`;
    return {
      project: p,
      totalTasks: tasks.length,
      openTasks: open.length,
      completedTasks: tasks.length - open.length,
      latestProgress,
      taskProgressCount,
      latestNote,
      nextScheduled,
      statusLine,
    };
  });
  const jobCounts = JobsRepo.countByStage();
  const jobTotal = Object.values(jobCounts).reduce((s, n) => s + n, 0);
  return {
    projects,
    jobCounts,
    jobTotal,
    totalOpenTasks: Repo.listTasks().filter((t) => isOpenTask(t)).length,
  };
}

// Facade passthrough for the job pipeline (Stage 3) — the progress center
// and future UI surfaces go through here, never the repository directly.
export function getJobApplications(filter) {
  return JobsRepo.listApplications(filter || {});
}

export function addJobApplication(input) {
  const a = JobsRepo.addApplication(input || {});
  if (a) logEvent("job_create", `添加求职申请「${a.company} · ${a.role}」`);
  return a;
}

export function setJobStage(id, stage) {
  const prev = JobsRepo.getApplication(id);
  const a = JobsRepo.transitionStage(id, stage); // null on illegal — safe no-op
  if (a && prev && prev.stage !== stage) {
    logEvent("job_stage", `「${a.company} · ${a.role}」→ ${JobsRepo.JOB_STAGE_LABEL[stage] || stage}`);
  }
  return a;
}

// ── Module D facade: field-visit places ─────────────────────────────────
// The repository (opportunity-repository.js) owns persistence + the status
// vocabulary; this facade only adds the activity-log trail so History keeps
// a single place to see what happened. Screens never touch the repository
// directly.

export function getPlaces(statusFilter) {
  return Opportunities.listPlaces(statusFilter);
}

export function getPlace(id) {
  return Opportunities.getPlace(id);
}

export function upsertPlace(input) {
  const prev = input && input.id ? Opportunities.getPlace(input.id) : null;
  const p = Opportunities.upsertPlace(input);
  if (p) {
    logEvent(prev ? "place_update" : "place_create",
      prev ? `更新走访地点「${p.name}」` : `添加走访地点「${p.name}」`);
  }
  return p;
}

/** Status changes go through the repository's vocabulary check (safe no-op on illegal). */
export function setPlaceStatus(id, status) {
  const p = Opportunities.setPlaceStatus(id, status);
  if (p) logEvent("place_status", `「${p.name}」→ ${p.status}`);
  return p;
}

/** Record a REAL visit (time/note/next plan). The repository stamps at=now when absent. */
export function addPlaceVisit(id, visit) {
  const p = Opportunities.addVisit(id, visit || {});
  if (p) logEvent("place_visit", `记录了「${p.name}」的到访`);
  return p;
}

export function removePlace(id) {
  const prev = Opportunities.getPlace(id);
  const ok = Opportunities.removePlace(id);
  if (ok && prev) logEvent("place_remove", `删除走访地点「${prev.name}」`);
  return ok;
}

// ── V3E (任务包 C): place/note trash — facade passthrough ───────────────
// Mirrors the task trash surface (restoreTask/getDeletedTasks). The
// repository owns soft-delete semantics + the 30-day window; this facade
// adds the activity-log trail for restores so History shows what happened.
// removePlace/removeNote above already log ONLY on the first successful
// soft delete (repeat delete returns false → no duplicate log).

export function restorePlace(id) {
  const restored = Opportunities.restorePlace(id);
  if (restored) logEvent("place_restore", `恢复了走访地点「${restored.name || restored.id}」`);
  return restored;
}

export function getDeletedPlaces() {
  return Opportunities.getDeletedPlaces();
}

export function removePlaceForever(id) {
  return Opportunities.removePlaceForever(id);
}

export function purgeExpiredDeletedPlaces(nowIso) {
  return Opportunities.purgeExpiredDeletedPlaces(nowIso);
}

export function restoreNote(id) {
  const restored = Opportunities.restoreNote(id);
  if (restored) logEvent("note_restore", "恢复了笔记");
  return restored;
}

export function getDeletedNotes() {
  return Opportunities.getDeletedNotes();
}

export function removeNoteForever(id) {
  return Opportunities.removeNoteForever(id);
}

export function purgeExpiredDeletedNotes(nowIso) {
  return Opportunities.purgeExpiredDeletedNotes(nowIso);
}

// ── Module C facade: registration tracking + prep + ICS ────────────────
// The repository owns the honest vocabulary (opening the official page is
// NEVER recorded as registered; REGISTERED only via an explicit user
// confirm). This facade adds the activity-log trail. Screens go through
// here, never the repository directly.

export function getRegistration(activityId) {
  return Opportunities.getRegistration(activityId);
}

export function getRegistrations() {
  return Opportunities.listRegistrations();
}

/** Record OPENED the official page (advances NONE -> OPENED only). */
export function markRegistrationOpened(activityId, sourceUrl) {
  const prev = Opportunities.getRegistration(activityId);
  const r = Opportunities.markRegistrationOpened(activityId, sourceUrl);
  if (r && (prev ? prev.status === "none" : true)) {
    logEvent("registration_opened", `打开了报名页（未确认报名）`);
  }
  return r;
}

/**
 * Explicit user status change. REGISTERED is only reachable through this
 * call — the UI must ask the user to confirm; opening a link never does.
 */
export function setRegistrationStatus(activityId, status, extra = {}) {
  const r = Opportunities.setRegistration(activityId, Object.assign({ status }, extra));
  if (r) {
    const labels = {
      none: "未报名", opened_registration: "已打开报名页", in_progress: "报名中",
      registered: "已报名（用户确认）", failed: "未成功", cancelled: "已取消",
    };
    logEvent("registration_status", `报名状态 → ${labels[status] || status}`);
  }
  return r;
}

/** Set/clear the 出行前准备 checklist (+ optional reminder) for an activity. */
export function setPrep(activityId, prepItems, remindAt) {
  const r = Opportunities.setPrep(activityId, prepItems, remindAt);
  if (r) logEvent("prep_update", `更新了出行准备清单`);
  return r;
}

/** Seed the default prep checklist for an activity view (pure helper). */
export function defaultPrepFor(view) {
  return Opportunities.defaultPrepFor(view);
}

/** Export ONE activity as an .ics file (null when time fields are missing). */
export function exportICS(activityId, view) {
  const ics = Opportunities.exportICS(activityId, view);
  if (ics) logEvent("ics_export", `导出了活动日历（.ics）`);
  return ics;
}

// ── Phase 3: Task execution (deterministic router + skills) ────────────
//
// runTask drives the real Task Runner: it routes the goal, builds steps, runs
// each Skill, and writes the result back through the repository. The search
// skill reuses the SAME api.searchActivities client the NaturalSearchScreen
// uses — no second search client. Returns the Runner's result object.
//
// Phase 7: aiClient is OPT-IN and passed through to the Runner. It is injected
// by the HOST (desktop shell / CLI via GORGON_AI_* env, or an Android bridge
// behind secure storage) — never created inside the browser bundle, so a key
// can never be compiled into the frontend. When omitted every skill stays
// purely deterministic; when a provider fails the assist bridge falls back to
// the local path, so the task still completes (AI 失败本地可用).
export async function runTask(id, { skillIds = null, aiClient = null } = {}) {
  const result = await runTaskEngine(id, { search: searchActivities, skillIds, aiClient });
  return result;
}

// ---- Review cards (DEMO / PREVIEW — local UI state only) --------------

function sanitizeReview(c) {
  if (!c || typeof c !== "object") return null;
  const title = typeof c.title === "string" ? c.title.trim() : "";
  if (!title) return null;
  return {
    id: typeof c.id === "string" && c.id ? c.id : "rv-" + Math.random().toString(36).slice(2, 10),
    title,
    detail: typeof c.detail === "string" ? c.detail : "",
    // pending | approved | rejected — LOCAL UI STATE ONLY. The real Human
    // Review protocol migrates in Phase 6.
    decision: ["pending", "approved", "rejected", "edited"].includes(c.decision) ? c.decision : "pending",
    createdAt: typeof c.createdAt === "string" ? c.createdAt : nowIso(),
  };
}

export function getReviewCards() {
  const v = read(K_REVIEW, []);
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeReview).filter(Boolean);
}

export function setReviewCards(list) {
  if (!Array.isArray(list)) return;
  write(K_REVIEW, list.map(sanitizeReview).filter(Boolean));
}

/** First-run seed: one clearly-marked demo card so the shell has content. */
export function ensureReviewSeed() {
  const cur = getReviewCards();
  if (cur.length > 0) return cur;
  const seeded = [{
    id: "rv-demo-1",
    title: "建议创建任务：准备 Hackathon 报名材料",
    detail: "这是一张 DEMO / PREVIEW 演示卡片，用于展示审核中心的工作方式。未来 AI 或自动化操作在真正执行前会先进入这里等待确认。",
    decision: "pending",
    createdAt: nowIso(),
  }];
  setReviewCards(seeded);
  return seeded;
}

export function decideReviewCard(id, decision) {
  const next = getReviewCards().map((c) =>
    c.id === id ? Object.assign({}, c, { decision }) : c
  );
  setReviewCards(next);
  if (decision === "approved") logEvent("user_approve", "批准了一项待审核操作");
  if (decision === "rejected") logEvent("user_reject", "拒绝了一项待审核操作");
  return next;
}

// ---- Proposals (Phase 6: REAL Human Review model) ---------------------
//
// The Phase-1 demo review cards above are UI sugar only. These are the real
// persisted Proposals with a proper state machine, backing the Review Center.

export function getProposals() {
  return Proposals.listProposals();
}

export function addProposal(input) {
  return Proposals.saveProposal(input);
}

/** Approve / reject a proposal. Approving a local action executes it. */
export function decideProposal(id, decision) {
  const next =
    decision === "approve"
      ? Proposals.approveProposal(id, {
          // The local "apply" step: approving a follow-up proposal really
          // creates a task in the Task Engine, and the proposal history records it.
          createTask: (p) => {
            const goal = p.goal || p.title || "后续任务";
            const list = addTask(goal, { source: "建议执行" });
            return list && list[0] ? list[0] : null;
          },
        })
      : Proposals.rejectProposal(id);
  if (decision === "approve") logEvent("user_approve", "批准了一条建议");
  if (decision === "reject") logEvent("user_reject", "拒绝了一条建议");
  return next;
}

// ---- Activity log (flat list, kept for cross-surface events) ----------

export function getLog() {
  const v = read(K_LOG, []);
  return Array.isArray(v) ? v.filter((e) => e && typeof e === "object" && e.type) : [];
}

export function logEvent(type, text) {
  const entry = { type, text: String(text || ""), at: nowIso() };
  const next = [entry].concat(getLog()).slice(0, 100); // newest first, cap 100
  write(K_LOG, next);
  return next;
}

// ---- Reset ------------------------------------------------------------

export function reset() {
  try {
    localStorage.removeItem(K_TASKS_V2);
    localStorage.removeItem(K_REVIEW);
    localStorage.removeItem(K_LOG);
    // NOTE: the Phase-1 v1 key ("gorgon_workbench_tasks") is intentionally
    // NOT removed here — §31: never silently destroy old data.
  } catch (e) { /* ignore */ }
}
