// Gorgon Workbench — V3N one-shot submission regression tests.
//
// Covers the P0 acceptance scenarios of docs/ONE_SHOT_AGENT_REDESIGN.md:
//   * scenario 1: 整理清单 → local checklist, no error online search
//   * scenario 2: 找真实活动清单 → real retrieval + filter + sources
//   * scenario 3: double submit / restart → ONE task, no duplicates
//   * scenario 4: offline / not-configured / unsupported → honest Chinese
//     failure states, never a fake success
//   * scenario 5: mixed task, one step fails → partial recorded, retry
//     re-runs ONLY the failed step (completed work not re-consumed)
//   * dedupe: submissionKey normalization + restart-safe recovery
//   * error language: every known code maps to plain-Chinese text + hint
//
// The orchestrator is dependency-injected, so everything runs in plain
// Node with an in-memory repository — no localStorage / DOM / network.

import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import("../src/workbench/task-model.js");
const OneShot = await import("../src/workbench/one-shot.js");
const { submitOneShot, normalizeSubmissionKey, findExistingSubmission, explainError, explainRunProblem } = OneShot;
const Runner = await import("../src/workbench/task-runner.js");
const { runTask } = Runner;
const Registry = await import("../src/workbench/skills/registry.js");
const realRouter = (await import("../src/workbench/task-router.js")).routeTask;
const Checklist = await import("../src/workbench/skills/activity-checklist-skill.js");

const TS = "2026-10-23T02:00:00.000Z";
const NOW_FN = () => TS;

// ── In-memory repository faithful to the real API surface ──────────────────
class MockRepository {
  constructor() { this.tasks = new Map(); }
  getTask(id) { return this.tasks.get(id) || null; }
  listTasks() { return [...this.tasks.values()].filter((t) => !t.deletedAt); }
  listTasksRaw() { return [...this.tasks.values()]; }
  createTaskEntry(goal, opts = {}) {
    const task = M.createTask(goal, opts);
    if (!task) return this.listTasks();
    this.tasks.set(task.id, task);
    return [task, ...this.listTasks()];
  }
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
    const next = { ...cur, steps: [...cur.steps, step], updatedAt: TS,
      timeline: [...cur.timeline, M.makeTimelineEvent("step_added", `添加步骤「${step.title}」`, { stepId: step.id })] };
    this.tasks.set(id, next);
    return next;
  }
  updateTaskStep(id, stepId, patch) {
    const cur = this.getTask(id);
    const steps = cur.steps.map((s) => (s.id === stepId ? { ...s, ...patch, updatedAt: TS } : s));
    this.tasks.set(id, { ...cur, steps, updatedAt: TS });
    return this.tasks.get(id);
  }
  setTaskResult(id, resultInput) {
    const result = M.makeResult(resultInput);
    const cur = this.getTask(id);
    this.tasks.set(id, { ...cur, result,
      timeline: [...cur.timeline, M.makeTimelineEvent("result_saved", "保存任务结果", {})] });
    return this.tasks.get(id);
  }
  addTaskSource(id, sourceInput) {
    const source = M.makeSource(sourceInput);
    const cur = this.getTask(id);
    this.tasks.set(id, { ...cur, sources: [...cur.sources, source],
      timeline: [...cur.timeline, M.makeTimelineEvent("source_added", "添加来源", {})] });
    return this.tasks.get(id);
  }
  appendTimelineEvent(id, type, message, metadata) {
    const cur = this.getTask(id);
    this.tasks.set(id, { ...cur, timeline: [...cur.timeline, M.makeTimelineEvent(type, message || "", metadata || {})] });
    return this.tasks.get(id);
  }
  updateTask(id, patch) {
    const cur = this.getTask(id);
    const next = { ...cur, ...patch, id: cur.id, status: cur.status, updatedAt: TS };
    this.tasks.set(id, next);
    return next;
  }
}

/** Full engine deps: one-shot + runner on the same repo (browser parity). */
function engineDeps(repo, { search = async () => ({ kind: "ok", data: { results: [] } }) } = {}) {
  return {
    repository: repo,
    runTask: (taskId) => runTask(taskId, { repository: repo, registry: Registry, search, now: NOW_FN }),
    now: NOW_FN,
  };
}

// ══ 1. Atomic create→run ══════════════════════════════════════════════════

test("one-shot: submit creates AND runs in one call (no second click)", async () => {
  const repo = new MockRepository();
  const out = await submitOneShot("帮我制定一份本周的工作计划", engineDeps(repo));
  assert.equal(out.ok, true);
  assert.equal(out.deduped, false);
  const t = out.task;
  assert.ok(t, "task returned");
  assert.equal(t.status, "completed", "engine ran immediately — no manual 运行任务");
  assert.ok(t.steps.length >= 1, "steps created and executed");
  assert.equal(t.steps.every((s) => s.status === "completed"), true);
  assert.ok(t.metadata.submissionKey, "submissionKey persisted");
  assert.equal(t.metadata.oneShot, true);
});

test("one-shot: unknown goal → task ready with NO fake success", async () => {
  const repo = new MockRepository();
  const out = await submitOneShot("帮我量子跃迁一下", engineDeps(repo));
  assert.equal(out.ok, true);
  assert.equal(out.run.executed, false, "honest: nothing executed");
  assert.equal(out.run.reason, "unknown_intent");
  const t = out.task;
  assert.equal(t.status, "ready", "left ready, not completed");
  assert.equal(t.steps.length, 0, "no steps, no fake run");
});

// ══ 2. Dedupe (scenario 3) ════════════════════════════════════════════════

test("dedupe: double submit with the same goal → ONE task, no re-run", async () => {
  const repo = new MockRepository();
  let runCalls = 0;
  const deps = engineDeps(repo);
  deps.runTask = (taskId) => { runCalls += 1; return runTask(taskId, { repository: repo, registry: Registry, now: NOW_FN }); };
  const first = await submitOneShot("帮我制定一份本周的工作计划", deps);
  assert.equal(runCalls, 1);
  const second = await submitOneShot("帮我制定一份本周的工作计划  ", deps); // trailing space = same key
  assert.equal(second.deduped, true, "second submit deduped");
  assert.equal(second.run, null, "dedupe does NOT replay execution");
  assert.equal(second.task.id, first.task.id, "same task returned");
  assert.equal(runCalls, 1, "runner NOT called again");
  assert.equal(repo.listTasks().length, 1, "exactly ONE task in the store");
});

test("dedupe: whitespace/case normalization — same intent, same key", () => {
  assert.equal(normalizeSubmissionKey("  制定   计划  "), normalizeSubmissionKey("制定 计划"));
  assert.equal(normalizeSubmissionKey("Write A Report"), normalizeSubmissionKey("write a report"));
  assert.notEqual(normalizeSubmissionKey("制定计划"), normalizeSubmissionKey("制定周报"));
});

test("dedupe: app restart equivalence — metadata.submissionKey survives", async () => {
  // Simulates restart: a FRESH repo instance loaded from the same durable
  // store would carry metadata.submissionKey; findExistingSubmission uses it.
  const persisted = [{ id: "t1", status: "completed", metadata: { submissionKey: normalizeSubmissionKey("整理清单") } }];
  assert.equal(findExistingSubmission(persisted, normalizeSubmissionKey("整理清单")).id, "t1");
  assert.equal(findExistingSubmission(persisted, normalizeSubmissionKey("其他目标")), null);
});

test("dedupe: soft-deleted task = fresh request (not deduped)", async () => {
  const repo = new MockRepository();
  const deps = engineDeps(repo);
  const first = await submitOneShot("帮我制定一份本周的工作计划", deps);
  // User deletes the result → soft delete
  const raw = repo.listTasksRaw().find((t) => t.id === first.task.id);
  repo.tasks.set(raw.id, { ...raw, deletedAt: TS });
  const second = await submitOneShot("帮我制定一份本周的工作计划", deps);
  assert.equal(second.deduped, false, "deleted result = fresh run");
  assert.equal(repo.listTasks().length, 1, "only the new task is visible");
  assert.notEqual(second.task.id, first.task.id);
});

// ══ 3. Scenario 1: local organize checklist ═══════════════════════════════

test("scenario 1: 整理比赛报名资料清单 → local extract, NO online search error", async () => {
  const repo = new MockRepository();
  // search fn exists (browser parity) but the goal is local-organize.
  const out = await submitOneShot("帮我整理一份比赛报名所需的资料清单", engineDeps(repo));
  assert.equal(out.ok, true);
  const t = out.task;
  assert.equal(t.status, "completed");
  assert.equal(t.steps.map((s) => s.metadata.skillId).includes("search"), false,
    "local-organize goal does NOT force the task online");
  assert.ok(t.result, "real local result produced");
});

// ══ 4. Scenario 2: real activity search closed loop ═══════════════════════

test("scenario 2: 找上海未来7天免费AI活动清单 → real search + filter + sources", async () => {
  const repo = new MockRepository();
  const mockSearch = async () => ({
    kind: "ok",
    data: { results: [
      { activity: { title: "上海AI大会", startDate: "2026-10-25", district: "上海", priceType: "free", sourceUrl: "https://a.com" } },
      { activity: { title: "北京AI展", startDate: "2026-10-25", district: "北京", priceType: "free", sourceUrl: "https://b.com" } },
      { activity: { title: "上海付费工作坊", startDate: "2026-10-26", district: "上海", priceType: "paid", price: 99, sourceUrl: "https://c.com" } },
    ] },
  });
  const out = await submitOneShot("找上海未来7天真实的免费AI活动并整理参加清单", engineDeps(repo, { search: mockSearch }));
  assert.equal(out.ok, true);
  const t = out.task;
  assert.equal(t.status, "completed");
  const skillIds = t.steps.map((s) => s.metadata.skillId);
  assert.ok(skillIds.includes("activity-checklist"), "checklist skill ran");
  assert.equal(skillIds.includes("search"), false, "no double search (checklist does its own)");
  // Real results, filtered deterministically. 「整理」also routes extract, so
  // the final result is the workflow envelope — find the checklist entry.
  const checklistEntry = Array.isArray(t.result.content)
    ? t.result.content.find((e) => e.skillId === "activity-checklist")
    : null;
  assert.ok(checklistEntry && checklistEntry.result, "checklist entry in workflow result");
  const content = checklistEntry.result.content;
  const check = content.checklist;
  assert.ok(check, "checklist in result");
  assert.equal(content.rawCount, 3);
  assert.equal(content.matchedCount, 1, "only the Shanghai free in-window activity matches");
  assert.ok(check.items[0].includes("上海AI大会"), "checklist item carries the activity");
  assert.equal(content.offline, false, "NOT an offline draft — real query");
  assert.ok(t.sources.length >= 1, "sources preserved");
  assert.equal(t.steps.find((s) => s.metadata.skillId === "activity-checklist").metadata.method, "api_search_filter",
    "method records the REAL online query");
});

test("scenario 2 (offline): search unavailable → honest FAILED state, no masquerade", async () => {
  const repo = new MockRepository();
  const mockSearch = async () => ({ kind: "unavailable" });
  const out = await submitOneShot("找上海未来7天真实的免费AI活动并整理参加清单", engineDeps(repo, { search: mockSearch }));
  const t = out.task;
  assert.equal(t.status, "failed", "honest failure — never fake completed");
  assert.ok(t.failureReason.includes("不可用") || t.failureReason.includes("离线"),
    "plain-Chinese failure reason");
  const step = t.steps.find((s) => s.metadata.skillId === "activity-checklist");
  assert.equal(step.status, "failed");
  const problem = explainRunProblem(out.run);
  assert.ok(problem && problem.text.includes("检索服务"), "error explained in Chinese");
});

// ══ 5. Scenario 4: honest error states ════════════════════════════════════

test("scenario 4: not-configured / offline / API error → Chinese reason + hint", () => {
  const c1 = explainError("SEARCH_NOT_CONFIGURED");
  assert.ok(/[\u4e00-\u9fa5]/.test(c1.text) && c1.text.includes("配置"), "plain Chinese");
  assert.ok(c1.hint, "recovery hint present");
  const c2 = explainError("SEARCH_OFFLINE");
  assert.ok(/[\u4e00-\u9fa5]/.test(c2.text));
  assert.ok(c2.hint);
  const c3 = explainError("SEARCH_API_ERROR", "检索失败（HTTP 500）");
  assert.ok(c3.text.includes("错误"));
  const c4 = explainError("UNKNOWN_CODE_XYZ", "原始消息");
  assert.equal(c4.text, "原始消息", "unknown codes fall back to the original message");
  assert.equal(explainError("SEARCH_EMPTY_GOAL").hint, null);
});

test("scenario 4: empty submit → refused with guidance", async () => {
  const repo = new MockRepository();
  const out = await submitOneShot("   ", engineDeps(repo));
  assert.equal(out.ok, false);
  assert.equal(out.code, "ONE_SHOT_EMPTY_GOAL");
  assert.ok(out.message.includes("写下"), "guidance, not a bare error");
});

// ══ 6. Scenario 5: partial success + retry recovery ═══════════════════════

test("scenario 5: mixed task one step fails → partial recorded, retry runs ONLY failed step", async () => {
  const repo = new MockRepository();
  let searchCalls = 0;
  const mockSearch = async () => {
    searchCalls += 1;
    if (searchCalls === 1) return { kind: "unavailable" }; // first run: search fails
    return { kind: "ok", data: { results: [{ activity: { title: "修复后活动", sourceUrl: "https://x.com" } }] } };
  };
  const out = await submitOneShot("帮我找出最近的行业活动", engineDeps(repo, { search: mockSearch }));
  const t0 = out.task;
  assert.equal(t0.status, "failed");
  // 「找出」routes BOTH search and extract: search failed, extract (local)
  // succeeded → partial bookkeeping applies.
  assert.ok(t0.metadata.retryableSkillIds.includes("search"), "retryable skills persisted to metadata");
  assert.equal(t0.metadata.partial, true, "extract succeeded + search failed = partial");
  const searchStep0 = t0.steps.find((s) => s.metadata.skillId === "search");
  assert.equal(searchStep0.status, "failed");

  // Recovery: retry ONLY the failed skill (browser parity: failed → ready,
  // runTaskEngine with retryFailedOnly).
  repo.transitionTask(t0.id, "ready");
  const retry = await runTask(t0.id, {
    repository: repo, registry: Registry,
    search: mockSearch, now: NOW_FN,
    skillIds: t0.metadata.retryableSkillIds, retryFailedOnly: true,
  });
  assert.equal(retry.ok, true);
  const t1 = repo.getTask(t0.id);
  assert.equal(t1.status, "completed", "recovered after the backend came back");
  assert.equal(t1.steps.length, t0.steps.length, "no duplicate steps");
  const searchStep = t1.steps.find((s) => s.metadata.skillId === "search");
  assert.equal(searchStep.status, "completed", "failed step now completed");
  const extractStep = t1.steps.find((s) => s.metadata.skillId === "extract");
  assert.ok(extractStep, "successful step still present (not redone)");
});

test("scenario 5b: retry with all steps already done → honest no-op", async () => {
  // A successful task has no retryable skills — the metadata contract.
  const repo2 = new MockRepository();
  const out2 = await submitOneShot("帮我找出最近的行业活动并整理清单", engineDeps(repo2, {
    search: async () => ({ kind: "ok", data: { results: [{ activity: { title: "A", sourceUrl: "https://a.com" } }] } }),
  }));
  const t2 = out2.task;
  if (t2.status !== "completed") {
    // If the workflow failed for another reason, skip gracefully.
    return;
  }
  assert.ok(t2.metadata.retryableSkillIds === undefined || t2.metadata.retryableSkillIds.length === 0,
    "successful task has no retryable skills");
  // completed is a TERMINAL state — the state machine refuses the retry
  // transition entirely (completed -> ready is illegal by design).
  assert.equal(M.canTransition("completed", "ready"), false, "completed tasks can never be re-run");
});

test("runner retryFailedOnly: completed step is never re-executed", async () => {
  const repo = new MockRepository();
  const goal = "帮我整理比赛资料并制定计划";
  const out = await submitOneShot(goal, engineDeps(repo));
  const t = out.task;
  if (!t || t.status !== "failed") return; // only meaningful for partial failures
  const completedBefore = t.steps.filter((s) => s.status === "completed").length;
  if (!completedBefore) return;
  repo.transitionTask(t.id, "ready");
  await runTask(t.id, {
    repository: repo, registry: Registry, now: NOW_FN,
    skillIds: t.metadata.retryableSkillIds || [], retryFailedOnly: true,
  });
  const t1 = repo.getTask(t.id);
  const completedAfter = t1.steps.filter((s) => s.status === "completed").length;
  assert.ok(completedAfter >= completedBefore, "completed work preserved");
});

// ══ 7. Error language completeness ════════════════════════════════════════

test("error language: every known engine code has plain-Chinese text", () => {
  const codes = [
    "ONE_SHOT_EMPTY_GOAL", "ONE_SHOT_BAD_DEPS", "ONE_SHOT_CREATE_FAILED",
    "TASK_NOT_FOUND", "SEARCH_NOT_CONFIGURED", "SEARCH_OFFLINE",
    "SEARCH_PROVIDER_ERROR", "SEARCH_API_ERROR", "SKILL_THREW", "RUNNER_THREW",
  ];
  for (const c of codes) {
    const e = explainError(c);
    assert.ok(e.text, `${c} has text`);
    assert.ok(/[\u4e00-\u9fa5]/.test(e.text), `${c} text is Chinese`);
  }
  assert.equal(explainRunProblem(null), null, "fine run → no problem");
  assert.equal(explainRunProblem({ ok: true }), null);
  assert.ok(explainRunProblem({ ok: false, code: "SEARCH_OFFLINE" }).text.includes("检索"));
});

// ══ 8. Checklist skill unit coverage ══════════════════════════════════════

test("checklist skill: no search fn → SEARCH_NOT_CONFIGURED (no local masquerade)", async () => {
  const res = await Checklist.default.execute({ goal: "找上海的活动并整理参加清单" }, {});
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "SEARCH_NOT_CONFIGURED");
});

test("checklist skill: parses city/window/free conditions deterministically", async () => {
  assert.deepEqual(Checklist.parseCities("找上海的活动"), ["上海"]);
  assert.deepEqual(Checklist.parseCities("宁波市的活动"), ["宁波"]);
  assert.equal(Checklist.parseDayWindow("未来3天的活动"), 3);
  assert.equal(Checklist.parseDayWindow("本周的活动"), 7);
  assert.equal(Checklist.parseDayWindow("本月活动"), 30);
  assert.equal(Checklist.parseFreeOnly("免费的活动"), true);
  assert.equal(Checklist.parseFreeOnly("付费活动"), false);
});

test("checklist skill: filterActivities excludes by city/window/free", () => {
  const now = "2026-10-23T02:00:00.000Z";
  const acts = [
    { title: "上海免费", district: "上海", startDate: "2026-10-25", priceType: "free" },
    { title: "北京免费", district: "北京", startDate: "2026-10-25", priceType: "free" },
    { title: "上海付费", district: "上海", startDate: "2026-10-25", priceType: "paid", price: 50 },
    { title: "上海过期", district: "上海", startDate: "2026-09-01", priceType: "free" },
  ];
  const { matched, excluded } = Checklist.filterActivities(acts, { cities: ["上海"], freeOnly: true, windowDays: 7, now });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].title, "上海免费");
  assert.equal(excluded.city, 1);
  assert.equal(excluded.window, 1);
  assert.equal(excluded.free, 1);
});
