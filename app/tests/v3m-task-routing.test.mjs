// Gorgon Workbench — V3M Phase A: task routing & offline-failure fixes (P0).
//
// Acceptance targets (V3M 真机整改 #P0 任务失败问题):
//   1. "整理比赛报名资料清单" must NOT trigger the online search skill —
//      it routes to extract (local organizing job).
//   2. Explicit retrieval goals (找/查询/搜索…) keep triggering search.
//   3. A failed skill no longer aborts the whole run — later skills still
//      execute, partial success is recorded, prior results are PRESERVED.
//   4. When the search backend is offline, a locally-satisfiable goal
//      (organize-style, no retrieval verb) still produces a LOCAL TEMPLATE —
//      never fabricated activity facts.
//   5. A genuinely-external goal (retrieval verb) reports SEARCH_OFFLINE with
//      an honest "未完成在线检索" message — never fake results.
//   6. Failed runs expose structured failure codes + a retry skill list.

import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import("../src/workbench/task-model.js");
const Runner = await import("../src/workbench/task-runner.js");
const { runTask } = Runner;
const Registry = await import("../src/workbench/skills/registry.js");
const { routeTask } = await import("../src/workbench/task-router.js");
const searchSkill = (await import("../src/workbench/skills/search-skill.js")).default;

const TS = "2026-10-23T00:00:00.000Z";

// ── In-memory repository (same shape as task-runner.test.mjs) ───────────────
class MockRepository {
  constructor() { this.tasks = new Map(); }
  seed(task) { this.tasks.set(task.id, task); return task; }
  getTask(id) { return this.tasks.get(id) || null; }
  listTasks() { return [...this.tasks.values()]; }
  transitionTask(id, status, opts = {}) {
    const cur = this.getTask(id);
    if (!cur) throw new Error("missing:" + id);
    const next = M.transitionTaskState(cur, status, opts);
    this.tasks.set(id, next);
    return next;
  }
  addTaskStep(id, input) {
    const cur = this.getTask(id);
    const step = M.makeStep(typeof input === "string" ? input : input.title,
      input && typeof input === "object" ? input : {});
    const next = {
      ...cur,
      steps: [...cur.steps, step],
      updatedAt: TS,
      timeline: [...cur.timeline, M.makeTimelineEvent("step_added", `添加步骤「${step.title}」`, { stepId: step.id })],
    };
    this.tasks.set(id, next);
    return next;
  }
  updateTaskStep(id, stepId, patch) {
    const cur = this.getTask(id);
    const steps = cur.steps.map((s) => (s.id === stepId ? { ...s, ...patch, updatedAt: TS } : s));
    const next = { ...cur, steps, updatedAt: TS };
    this.tasks.set(id, next);
    return next;
  }
  setTaskResult(id, resultInput) {
    const result = M.makeResult(resultInput);
    const cur = this.getTask(id);
    const next = {
      ...cur, result,
      timeline: [...cur.timeline, M.makeTimelineEvent("result_saved", "保存任务结果", { type: result && result.type })],
    };
    this.tasks.set(id, next);
    return next;
  }
  addTaskSource(id, sourceInput) {
    const source = M.makeSource(sourceInput);
    const cur = this.getTask(id);
    const next = {
      ...cur, sources: [...cur.sources, source],
      timeline: [...cur.timeline, M.makeTimelineEvent("source_added", `添加来源「${source.title}」`, { sourceId: source.id, type: source.type })],
    };
    this.tasks.set(id, next);
    return next;
  }
  appendTimelineEvent(id, type, message, metadata) {
    const cur = this.getTask(id);
    const next = { ...cur, timeline: [...cur.timeline, M.makeTimelineEvent(type, message || "", metadata || {})] };
    this.tasks.set(id, next);
    return next;
  }
  updateTask(id, patch) {
    const cur = this.getTask(id);
    const next = { ...cur, ...patch, id: cur.id, status: cur.status, updatedAt: TS };
    this.tasks.set(id, next);
    return next;
  }
}

function seedCreated(goal) {
  const repo = new MockRepository();
  repo.seed(M.createTask(goal));
  return repo;
}

/* ── 1. Router: organize-style goals stay offline-local ─────────────────── */

test("V3M: 整理比赛报名资料清单 routes to extract, NOT search (P0 验收①)", () => {
  const r = routeTask({ goal: "帮我整理一份比赛报名所需的资料清单" });
  assert.equal(r.intent, "extract");
  assert.deepEqual(r.skillIds, ["extract"]);
  assert.ok(!r.skillIds.includes("search"), "must not trigger online search");
});

test("V3M: bare 整理比赛报名资料清单 (acceptance phrasing) routes to extract", () => {
  const r = routeTask({ goal: "整理比赛报名资料清单" });
  assert.equal(r.intent, "extract");
  assert.deepEqual(r.skillIds, ["extract"]);
});

test("V3M: 整理黑客松报名材料清单 also stays local", () => {
  const r = routeTask({ goal: "整理黑客松报名材料清单" });
  assert.ok(r.skillIds.includes("extract"));
  assert.ok(!r.skillIds.includes("search"));
});

/* ── 2. Router: explicit retrieval goals still go online ────────────────── */

test("V3M: 找活动 keeps triggering search (verb hit)", () => {
  const r = routeTask({ goal: "帮我找上海本周免费的 AI 活动" });
  assert.equal(r.intent, "search");
  assert.deepEqual(r.skillIds, ["search"]);
});

test("V3M: 查询未来一个月上海黑客松 triggers search (查询 verb)", () => {
  const r = routeTask({ goal: "查询未来一个月上海黑客松" });
  assert.equal(r.intent, "search");
  assert.deepEqual(r.skillIds, ["search"]);
});

test("V3M: search+plan workflow unchanged (找活动并制定计划)", () => {
  const r = routeTask({ goal: "帮我找上海的 AI 活动并制定参加计划" });
  assert.deepEqual(r.skillIds, ["search", "plan"]);
});

test("V3M: topic noun WITHOUT local intent still triggers search (有哪些活动)", () => {
  const r = routeTask({ goal: "最近有哪些活动" });
  assert.equal(r.intent, "search");
  assert.deepEqual(r.skillIds, ["search"]);
});

test("V3M: demo chain goal (找…并制定参加计划) still routes search+plan", () => {
  const r = routeTask({ goal: "帮我找上海未来一周值得参加的 AI/创业活动，优先免费、适合认识开发者，并帮我制定参加计划。" });
  assert.deepEqual(r.skillIds, ["search", "plan"]);
});

test("V3M: router output stays deterministic", () => {
  const goal = "帮我整理一份比赛报名所需的资料清单";
  const a = routeTask({ goal });
  const b = routeTask({ goal });
  assert.deepEqual(a, b);
});

/* ── 3. Runner: partial success — a failed skill does not abort the run ─── */

test("V3M: first skill fails, second still runs, task records partial success", async () => {
  const repo = seedCreated("帮我找活动并整理成清单");
  const id = repo.listTasks()[0].id;
  const calls = [];
  const reg = {
    getSkill: (sid) => ({
      id: sid,
      name: sid,
      execute: async () => {
        calls.push(sid);
        if (sid === "search") {
          return { ok: false, skillId: sid, error: { code: "SEARCH_OFFLINE", message: "检索服务不可用" } };
        }
        return {
          ok: true, skillId: sid,
          summary: "本地提取到：1 条待办",
          result: { type: "json", content: { todos: ["整理资料"] } },
          sources: [],
          metadata: { method: "regex" },
        };
      },
    }),
  };
  const res = await runTask(id, { repository: repo, registry: reg, skillIds: ["search", "extract"], now: () => TS });

  assert.equal(res.ok, true);
  assert.equal(res.executed, true);
  assert.deepEqual(calls, ["search", "extract"], "second skill must still run after the first failed");
  assert.equal(res.failed, true);
  assert.equal(res.partial, true, "partial success must be flagged");
  assert.deepEqual(res.failures.map((f) => f.code), ["SEARCH_OFFLINE"], "failure codes exposed");
  assert.deepEqual(res.retryableSkillIds, ["search"], "retry entry lists the failed skills");

  const t = repo.getTask(id);
  assert.equal(t.status, "failed");
  assert.equal(t.steps.length, 2);
  assert.equal(t.steps[0].status, "failed");
  assert.equal(t.steps[1].status, "completed", "the successful step is preserved");
  assert.ok(t.result, "partial result is preserved");
  assert.equal(t.result.type, "workflow_result");
  const okPart = t.result.content.find((c) => c.skillId === "extract");
  assert.ok(okPart, "successful skill output survives in the workflow envelope");
  const failPart = t.result.content.find((c) => c.skillId === "search");
  assert.ok(failPart && failPart.failed === true, "failure record appears in the envelope");
  assert.equal(failPart.code, "SEARCH_OFFLINE");
  const types = t.timeline.map((e) => e.type);
  assert.ok(types.includes("task_execution_partial"), "partial-success timeline event recorded");
  assert.ok(types.includes("skill_failed"));
});

test("V3M: all skills failing keeps the plain failed state (no partial claim)", async () => {
  const repo = seedCreated("帮我找活动");
  const id = repo.listTasks()[0].id;
  const reg = {
    getSkill: (sid) => ({
      id: sid, name: sid,
      execute: async () => ({ ok: false, skillId: sid, error: { code: "SEARCH_OFFLINE", message: "离线" } }),
    }),
  };
  const res = await runTask(id, { repository: repo, registry: reg, skillIds: ["search"], now: () => TS });
  assert.equal(res.failed, true);
  assert.equal(res.partial, false, "all-failed is NOT partial success");
  assert.deepEqual(res.retryableSkillIds, ["search"]);
  const t = repo.getTask(id);
  assert.equal(t.status, "failed");
  assert.ok(t.failureReason.includes("离线"));
  const types = t.timeline.map((e) => e.type);
  assert.ok(!types.includes("task_execution_partial"), "no partial event when nothing succeeded");
});

test("V3M: multi-failure failureReason lists every skill + code", async () => {
  const repo = seedCreated("x");
  const id = repo.listTasks()[0].id;
  const reg = {
    getSkill: (sid) => ({
      id: sid, name: sid,
      execute: async () => ({ ok: false, skillId: sid, error: { code: "E_" + sid.toUpperCase(), message: "失败" + sid } }),
    }),
  };
  const res = await runTask(id, { repository: repo, registry: reg, skillIds: ["search", "extract"], now: () => TS });
  assert.equal(res.failed, true);
  assert.ok(res.failureReason.includes("search（E_SEARCH）"), res.failureReason);
  assert.ok(res.failureReason.includes("extract（E_EXTRACT）"), res.failureReason);
  const t = repo.getTask(id);
  assert.equal(t.failureReason, res.failureReason, "multi-failure reason persists to the task");
});

test("V3M: unregistered skill still hard-aborts (config error)", async () => {
  const repo = seedCreated("帮我找活动");
  const id = repo.listTasks()[0].id;
  let secondRan = false;
  const reg = {
    getSkill: (sid) => {
      if (sid === "bogus") return null;
      return {
        id: sid, name: sid,
        execute: async () => { secondRan = true; return { ok: true, skillId: sid, result: { type: "text", content: "x" }, sources: [], metadata: {} }; },
      };
    },
  };
  const res = await runTask(id, { repository: repo, registry: reg, skillIds: ["bogus", "extract"], now: () => TS });
  assert.equal(res.failed, true);
  assert.equal(secondRan, false, "unregistered skill aborts the run (engine config error)");
  assert.equal(res.failureReason, "工具「bogus」未注册");
});

test("V3M: happy path is untouched — no failures means no partial event", async () => {
  const repo = seedCreated("帮我提取日期：10月12日截止");
  const id = repo.listTasks()[0].id;
  const res = await runTask(id, { repository: repo, registry: Registry, now: () => TS });
  assert.equal(res.ok, true);
  assert.equal(res.failed, false);
  assert.equal(res.partial, false);
  const t = repo.getTask(id);
  assert.equal(t.status, "completed");
  const types = t.timeline.map((e) => e.type);
  assert.ok(types.includes("task_execution_completed"));
  assert.ok(!types.includes("task_execution_partial"));
});

/* ── 4+5. Search skill: offline local template vs honest failure ────────── */

test("V3M: offline + organize-style goal → local template (P0 验收①)", async () => {
  const r = await searchSkill.execute({ goal: "整理比赛报名资料清单" }, { search: async () => ({ kind: "unavailable" }) });
  assert.equal(r.ok, true, "must NOT fail — local template is produced");
  assert.equal(r.metadata.method, "local_template");
  assert.equal(r.metadata.offline, true);
  assert.ok(r.result.content.checklist, "template carried as a checklist");
  assert.ok(r.result.content.checklist.items.length >= 5);
  assert.ok(r.summary.includes("未完成实时检索"), "summary is honest about the offline state");
  assert.ok(r.summary.includes("本地模板"));
  // No fabricated facts: the template note must say requirements come from
  // official pages, and no sources may be attached.
  assert.equal(r.sources.length, 0);
  assert.ok(r.result.content.note.includes("未包含任何虚构"), "template is labelled a suggestion, not facts");
});

test("V3M: offline + backend-unconfigured + organize goal → local template", async () => {
  const r = await searchSkill.execute({ goal: "帮我整理一份比赛报名所需的资料清单" }, { search: null });
  assert.equal(r.ok, true);
  assert.equal(r.metadata.method, "local_template");
  assert.ok(r.result.content.checklist.items.length >= 5);
});

test("V3M: offline + retrieval-verb goal → honest SEARCH_OFFLINE (P0 验收②离线半)", async () => {
  const r = await searchSkill.execute({ goal: "查询未来一个月上海黑客松" }, { search: async () => ({ kind: "unavailable" }) });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SEARCH_OFFLINE");
  assert.ok(r.error.message.includes("未完成在线检索"), "honest message: the live query did NOT happen");
  assert.ok(r.error.message.includes("重试"), "retry hint present");
});

test("V3M: thrown provider error + retrieval goal → SEARCH_PROVIDER_ERROR", async () => {
  const r = await searchSkill.execute({ goal: "找上海活动" }, { search: async () => { throw new Error("net down"); } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "SEARCH_PROVIDER_ERROR");
});

test("V3M: online search success path unchanged", async () => {
  const search = async () => ({
    kind: "ok",
    data: { results: [{ activity: { title: "上海黑客松", sourceUrl: "https://x.com" } }] },
  });
  const r = await searchSkill.execute({ goal: "查询上海黑客松" }, { search });
  assert.equal(r.ok, true);
  assert.equal(r.metadata.method, "api");
  assert.equal(r.sources.length, 1);
});

/* ── 6. End-to-end: the exact V3M acceptance scenario ───────────────────── */

test("V3M E2E: 整理比赛报名资料清单 runs extract locally, never touches search", async () => {
  const repo = seedCreated("整理比赛报名资料清单");
  const id = repo.listTasks()[0].id;
  let searchRan = false;
  const spyRegistry = {
    getSkill: (sid) => {
      const real = Registry.getSkill(sid);
      if (!real) return null;
      if (sid === "search") {
        return {
          ...real,
          execute: async (ctx, deps) => { searchRan = true; return real.execute(ctx, deps); },
        };
      }
      return real;
    },
  };
  // Backend is unavailable (offline phone) — the search fn still injected as
  // the app does, but returns unavailable.
  const res = await runTask(id, {
    repository: repo, registry: spyRegistry,
    search: async () => ({ kind: "unavailable" }),
    now: () => TS,
  });

  assert.equal(searchRan, false, "search skill must never be routed for this goal");
  assert.equal(res.ok, true);
  assert.equal(res.failed, false);
  const t = repo.getTask(id);
  assert.equal(t.status, "completed");
  assert.equal(t.steps.length, 1);
  assert.equal(t.steps[0].metadata.skillId, "extract");
  assert.ok(t.result.content.checklist || t.result.content.dates !== undefined, "extract output preserved");
});
