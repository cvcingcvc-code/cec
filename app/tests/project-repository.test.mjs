// Gorgon Phase 4 — Project Repository + task scheduling unit tests.
//
// Covers P0-A (project CRUD, activity link, soft archive, corruption
// quarantine, old-data compatibility) and P0-B (dueAt/scheduledDate
// normalization + pure date helpers) and P0-C (note projectId filter,
// minimal project review).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
globalThis.localStorage = makeStorage();

const P = await import("../src/store/project-repository.js");
const O = await import("../src/store/opportunity-repository.js");
const M = await import("../src/workbench/task-model.js");
const Repo = await import("../src/store/task-repository.js");

beforeEach(() => {
  localStorage.clear();
  P.reset();
  O.reset();
  Repo.resetTaskStorage();
});

/* ── P0-A: project CRUD ─────────────────────────────────────────────── */

test("createProject stores and reads back", () => {
  const p = P.createProject({ title: "参加 AI Hackathon", goal: "本周报名并组队" });
  assert.ok(p && p.id);
  assert.equal(p.title, "参加 AI Hackathon");
  assert.equal(p.goal, "本周报名并组队");
  assert.equal(p.origin, P.PROJECT_ORIGIN.MANUAL);
  assert.equal(p.archived, false);
  assert.deepEqual(p.activities, []);
  const read = P.getProject(p.id);
  assert.equal(read.title, p.title);
});

test("createProject rejects empty titles", () => {
  assert.equal(P.createProject({ title: "" }), null);
  assert.equal(P.createProject({ title: "   " }), null);
  assert.equal(P.createProject({}), null);
});

test("activity origin keeps the snapshot + demo flag", () => {
  const p = P.createProject({
    title: "上海 AI Meetup",
    origin: P.PROJECT_ORIGIN.ACTIVITY,
    activity: {
      id: "act-1", title: "上海 AI 开发者 Meetup", dateText: "10月12日",
      venue: "徐汇西岸", district: "徐汇", dataOrigin: "demo",
    },
  });
  assert.equal(p.origin, P.PROJECT_ORIGIN.ACTIVITY);
  assert.equal(p.activities.length, 1);
  assert.equal(p.activities[0].activityId, "act-1");
  assert.equal(p.activities[0].isDemo, true, "DEMO activity must stay visibly DEMO");
  const real = P.createProject({
    title: "real one", origin: P.PROJECT_ORIGIN.ACTIVITY,
    activity: { id: "act-2", title: "T", dataOrigin: "real" },
  });
  assert.equal(real.activities[0].isDemo, false);
});

test("linkActivity is idempotent; unlink removes only the link", () => {
  const p = P.createProject({ title: "Proj" });
  const a = { id: "act-9", title: "活动九" };
  P.linkActivity(p.id, a);
  P.linkActivity(p.id, a); // duplicate link ignored
  assert.equal(P.getProject(p.id).activities.length, 1);
  P.unlinkActivity(p.id, "act-9");
  assert.deepEqual(P.getProject(p.id).activities, []);
});

test("findProjectByActivity locates the linked project", () => {
  const p = P.createProject({ title: "Proj" });
  P.linkActivity(p.id, { id: "act-77", title: "X" });
  assert.equal(P.findProjectByActivity("act-77").id, p.id);
  assert.equal(P.findProjectByActivity("act-missing"), null);
});

test("archive is a SOFT delete: data kept, hidden by default", () => {
  const p = P.createProject({ title: "Archive me" });
  P.archiveProject(p.id);
  assert.equal(P.listProjects().length, 0);
  assert.equal(P.listProjects({ includeArchived: true }).length, 1);
  assert.equal(P.getProject(p.id).archived, true);
  P.restoreProject(p.id);
  assert.equal(P.listProjects().length, 1);
});

test("envelope persists under one versioned key + corruption quarantine", () => {
  P.createProject({ title: "Persisted" });
  const raw = JSON.parse(localStorage.getItem("gorgon_workbench_projects_v1"));
  assert.equal(raw.schemaVersion, 1);
  assert.equal(raw.projects.length, 1);

  // Simulate a reload with a broken payload: drop the mirror FIRST (reset
  // also removes the key), then write corrupt JSON, then read.
  P.reset();
  localStorage.setItem("gorgon_workbench_projects_v1", "{{{broken json");
  assert.deepEqual(P.listProjects(), [], "corrupt payload degrades to empty");
  const archived = localStorage.getItem("gorgon_workbench_projects_v1.corrupt-0");
  assert.equal(archived, "{{{broken json", "payload quarantined, never destroyed");
  assert.equal(localStorage.getItem("gorgon_workbench_projects_v1"), "{{{broken json", "raw preserved");
});

test("old task records without projectId still normalize (compat)", () => {
  // Simulate a Phase-2 era task stored before Phase 4 existed.
  const legacy = {
    id: "legacy-1", version: 2, title: "旧任务", goal: "旧任务",
    status: "created", createdAt: "2026-10-01T00:00:00.000Z",
    steps: [], sources: [], metadata: {}, timeline: [],
  };
  const n = M.normalizeTask(legacy);
  assert.ok(n);
  assert.equal(n.projectId, null);
  assert.equal(n.dueAt, null);
  assert.equal(n.scheduledDate, null);
  assert.equal(n.status, "created");
});

/* ── P0-B: scheduling fields + helpers ──────────────────────────────── */

test("createTask accepts dueAt / scheduledDate / projectId", () => {
  const t = M.createTask("准备路演", {
    dueAt: "2026-10-12T18:00:00.000Z",
    scheduledDate: "2026-10-12",
    projectId: "proj-1",
  });
  assert.equal(t.dueAt, "2026-10-12T18:00:00.000Z");
  assert.equal(t.scheduledDate, "2026-10-12");
  assert.equal(t.projectId, "proj-1");
});

test("invalid dates degrade to null, never fabricated", () => {
  const t = M.createTask("bad dates", { dueAt: "not-a-date", scheduledDate: "2026-13-45" });
  assert.equal(t.dueAt, null);
  assert.equal(t.scheduledDate, null);
  assert.equal(M.normDateStrOrNull("2026-02-30"), null, "Feb 30 rejected");
  assert.equal(M.normDateStrOrNull("2026-10-12"), "2026-10-12");
});

test("localDateStr / isTaskOnDate / isOpenTask / isOverdue are pure + correct", () => {
  const d = new Date(2026, 9, 12, 8, 30); // Oct 12 2026 local
  assert.equal(M.localDateStr(d), "2026-10-12");

  const task = { status: "running", scheduledDate: "2026-10-12", dueAt: "2026-10-12T10:00:00.000Z" };
  assert.equal(M.isTaskOnDate(task, "2026-10-12"), true);
  assert.equal(M.isTaskOnDate(task, "2026-10-13"), false);
  assert.equal(M.isOpenTask(task), true);
  assert.equal(M.isOpenTask({ status: "completed" }), false);
  assert.equal(M.isOverdue(task, "2026-10-12T12:00:00.000Z"), true);
  assert.equal(M.isOverdue(task, "2026-10-12T09:00:00.000Z"), false);
  assert.equal(M.isOverdue({ status: "completed", dueAt: "2020-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z"), false);
});

test("repository round-trips scheduling fields through persistence", () => {
  Repo.createTaskEntry("带日期的任务", {
    dueAt: "2026-10-15T09:00:00.000Z",
    scheduledDate: "2026-10-15",
    projectId: "p-1",
  });
  const t = Repo.listTasks()[0];
  assert.equal(t.scheduledDate, "2026-10-15");
  assert.equal(t.projectId, "p-1");
  // Re-read from storage (fresh normalize pass).
  const raw = JSON.parse(localStorage.getItem("gorgon_workbench_tasks_v2"));
  const renorm = M.normalizeTask(raw.tasks[0]);
  assert.equal(renorm.dueAt, "2026-10-15T09:00:00.000Z");
});

/* ── P0-C: note project link + minimal project review ───────────────── */

test("notes can be linked to a project and filtered by it", () => {
  const n = O.addNote({ text: "现场记录", projectId: "proj-5", taskId: "t-1" });
  assert.equal(n.projectId, "proj-5");
  assert.equal(O.listNotes({ projectId: "proj-5" }).length, 1);
  assert.equal(O.listNotes({ projectId: "proj-other" }).length, 0);
  // old-style note without projectId still works
  const plain = O.addNote({ text: "无项目" });
  assert.equal(plain.projectId, null);
  assert.equal(O.listNotes().length, 2);
});

test("minimal project review: outcome + nextAction, upsert keeps data", () => {
  const r = O.setProjectReview("proj-1", { outcome: "完成报名", nextAction: "下周组队" });
  assert.equal(r.outcome, "完成报名");
  assert.equal(r.nextAction, "下周组队");
  // empty-string upsert must NOT wipe a recorded value
  const r2 = O.setProjectReview("proj-1", { outcome: "" });
  assert.equal(r2.outcome, "完成报名", "empty upsert keeps previous outcome");
  assert.equal(O.getProjectReview("proj-1").nextAction, "下周组队");
  assert.equal(O.getProjectReview("proj-missing"), null);
});

test("project review survives envelope reload", async () => {
  O.setProjectReview("proj-9", { outcome: "到场 3 人", followUps: [{ title: "发感谢信" }] });
  const raw = JSON.parse(localStorage.getItem("gorgon_opportunities_v1"));
  assert.ok(raw.projectReviews["proj-9"]);
  // simulate a page reload with a FRESH module instance (memory mirror gone)
  const fresh = await import("../src/store/opportunity-repository.js?fresh=" + Math.random());
  const back = fresh.getProjectReview("proj-9");
  assert.equal(back.outcome, "到场 3 人");
  assert.equal(back.followUps.length, 1);
  assert.ok(back.followUps[0].id, "follow-up got an id");
});

test("places accept projectId (Module D link)", () => {
  const pl = O.upsertPlace({ name: "创业咖啡", projectId: "proj-3" });
  assert.equal(pl.projectId, "proj-3");
  const old = O.upsertPlace({ name: "老地点" });
  assert.equal(old.projectId, null);
});
