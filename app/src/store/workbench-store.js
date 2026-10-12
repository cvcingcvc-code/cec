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
  normIsoOrNull, normDateStrOrNull, localDateStr, isTaskOnDate, isOpenTask, isOverdue,
} from "../workbench/task-model.js";
import { runTask as runTaskEngine } from "../workbench/task-runner.js";
import { searchActivities } from "../lib/api.js";
import * as Proposals from "./proposal-repository.js";
import * as Projects from "./project-repository.js";
import * as Opportunities from "./opportunity-repository.js";
import * as JobsRepo from "./job-repository.js";

const K_TASKS_V2 = Repo.SCHEMA_VERSION ? "gorgon_workbench_tasks_v2" : "gorgon_workbench_tasks_v2";
const K_V1_TASKS = "gorgon_workbench_tasks";
const K_REVIEW = "gorgon_workbench_review";
const K_LOG = "gorgon_workbench_log";

export const KEYS = { tasks: K_TASKS_V2, tasksV1: K_V1_TASKS, review: K_REVIEW, log: K_LOG };

// Formal Phase-2 vocabulary. NOTE: the Phase-1 "draft" label is retired —
// migrated tasks surface as "created" (see migrateV1TasksToV2).
export { TASK_STATUS, canTransition, InvalidTransitionError };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* private mode / quota — degrade to in-memory */
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
 */
export function addTask(goal, { source = "手动输入", dueAt = null, scheduledDate = null, projectId = null } = {}) {
  const text = String(goal || "").trim();
  if (!text) return Repo.listTasks();
  const next = Repo.createTaskEntry(text, { source, dueAt, scheduledDate, projectId });
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

export function deleteTask(id) {
  return Repo.deleteTask(id);
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
export async function runTask(id, { skillIds = null } = {}) {
  const result = await runTaskEngine(id, { search: searchActivities, skillIds });
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
