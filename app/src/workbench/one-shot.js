// Gorgon Workbench — One-Shot Submission Orchestrator (V3N, P0).
//
// The ONE module that makes "submit once → done" real (§2 of
// docs/ONE_SHOT_AGENT_REDESIGN.md). It owns exactly three concerns:
//
//   1. IDEMPOTENT SUBMISSION — a normalized submissionKey derived from the
//      goal text. A second submit (double tap, re-render, retry after
//      reconnect, app restart) with the SAME goal re-opens the existing
//      task instead of creating a duplicate or replaying side effects.
//      Scope: LIVE (non-deleted) tasks only — a user who deleted the
//      result explicitly asked for a fresh run.
//
//   2. ATOMIC CREATE→RUN — create the task, persist it, then immediately
//      drive the existing Task Runner. No second "运行任务" click. The
//      caller receives the runner's full result so the UI can show real
//      progress/state instead of a fake success.
//
//   3. HONEST ERROR LANGUAGE — every engine/skill error code maps to a
//      plain-Chinese explanation plus the user's next actionable step
//      (§2: 用户永远不必自行猜测错误原因).
//
// Dependency-injected like the Runner: repository / runTask / search / now
// are all supplied by the host, so this module is unit-testable in plain
// Node with ZERO localStorage / DOM / LLM. The browser binds them in
// workbench-store.submitOneShotGoal().

// ── 1. Submission identity / dedupe ─────────────────────────────────────

/**
 * Normalize a goal into a stable submission key: collapse whitespace,
 * trim, lowercase (harmless for CJK, helps mixed Latin input). The same
 * human intent typed twice yields the same key; different goals never do.
 */
export function normalizeSubmissionKey(goal) {
  return String(goal == null ? "" : goal).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Find an existing LIVE task created from the same submission key.
 * Soft-deleted tasks are invisible here BY DESIGN (deleted result = fresh
 * request). Returns the newest match or null.
 */
export function findExistingSubmission(tasks, submissionKey) {
  if (!submissionKey) return null;
  const list = Array.isArray(tasks) ? tasks : [];
  for (const t of list) {
    if (!t || t.deletedAt) continue;
    if (t.metadata && t.metadata.submissionKey === submissionKey) return t;
  }
  return null;
}

// ── 2. Atomic create → run ──────────────────────────────────────────────

/**
 * Submit a goal once: dedupe → create → immediately run the engine.
 *
 * @param {string} goal raw user text
 * @param {object} deps
 *   repository : { createTaskEntry(goal, opts), listTasks(), getTask(id) }
 *   runTask    : (taskId, opts) => Promise<runner result>
 *   now        : () => ISO string (optional, for tests)
 * @returns {Promise<{
 *   ok: boolean,
 *   task: object|null,
 *   deduped: boolean,           // true → existing task re-opened, nothing created
 *   run: object|null,           // runner result (null for dedupe / create failure)
 *   code?: string, message?: string
 * }>}
 */
export async function submitOneShot(goal, deps = {}) {
  const repository = deps.repository;
  const runTask = typeof deps.runTask === "function" ? deps.runTask : null;
  const text = String(goal == null ? "" : goal).trim();

  if (!repository || typeof repository.createTaskEntry !== "function" || typeof repository.listTasks !== "function") {
    return { ok: false, task: null, deduped: false, run: null, code: "ONE_SHOT_BAD_DEPS", message: "提交通道未正确初始化" };
  }
  if (!text) {
    return { ok: false, task: null, deduped: false, run: null, code: "ONE_SHOT_EMPTY_GOAL", message: "请先写下你想完成的事" };
  }

  // Dedupe: same submission key → re-open the existing task. Never create a
  // second task, never replay execution side effects.
  const key = normalizeSubmissionKey(text);
  const existing = findExistingSubmission(repository.listTasks(), key);
  if (existing) {
    return { ok: true, task: repository.getTask ? repository.getTask(existing.id) || existing : existing, deduped: true, run: null };
  }

  // Create + persist (metadata.submissionKey is the durable dedupe marker —
  // it survives an app restart, unlike an in-memory set).
  const list = repository.createTaskEntry(text, {
    source: deps.source || "一句话提交",
    metadata: {
      submissionKey: key,
      oneShot: true,
      submittedAt: (deps.now ? deps.now() : new Date().toISOString()),
    },
  });
  const task = Array.isArray(list) ? list[0] : null;
  if (!task) {
    return { ok: false, task: null, deduped: false, run: null, code: "ONE_SHOT_CREATE_FAILED", message: "任务创建未成功，请重试" };
  }

  // Immediately run — the atomic part of "submit once". The runner owns
  // routing / execution / partial-success bookkeeping; failures propagate
  // honestly (the task ends failed/partial with a timeline record).
  let run = null;
  if (runTask) {
    try {
      run = await runTask(task.id);
    } catch (e) {
      run = { ok: false, executed: false, code: "RUNNER_THREW", message: String((e && e.message) || e) };
    }
  }
  const finalTask = repository.getTask ? repository.getTask(task.id) || task : task;
  return { ok: true, task: finalTask, deduped: false, run };
}

// ── 3. Honest error language ────────────────────────────────────────────

/**
 * Engine / skill error code → plain-Chinese explanation + next step.
 * Unknown codes fall back to the original message (never blank, never
 * invented detail). Shape: { text, hint } — hint is null when the engine
 * message already contains the action.
 */
const ERROR_EXPLAIN = {
  ONE_SHOT_EMPTY_GOAL: { text: "还没有输入内容。写下你想完成的事，再点「开始处理」。", hint: null },
  ONE_SHOT_BAD_DEPS: { text: "提交通道没有正确初始化，这是应用内部问题。", hint: "请重启应用后再试一次。" },
  ONE_SHOT_CREATE_FAILED: { text: "任务创建未成功（本地存储可能不可用）。", hint: "请重试；若反复出现，检查设备存储空间。" },
  TASK_NOT_FOUND: { text: "这条任务已不存在（可能已被删除）。", hint: null },
  TASK_ALREADY_RUNNING: { text: "任务正在执行中，不用重复点击。", hint: "可回到任务详情查看实时进度。" },
  TASK_NOT_RUNNABLE: { text: "任务当前状态不支持再次执行。", hint: "已完成的任务可以直接查看成果。" },
  NO_SKILLS_SPECIFIED: { text: "还没有确定要执行的处理步骤。", hint: "请在任务详情中手动选择处理方式。" },
  SEARCH_NOT_CONFIGURED: { text: "搜索后端没有配置，无法完成在线检索。", hint: "联网并配置检索服务后可重试；本地整理类任务不受影响。" },
  SEARCH_OFFLINE: { text: "检索服务当前不可用（设备离线或服务未连接）。", hint: "恢复网络后可重试；需要在线检索的部分这次没有完成。" },
  SEARCH_PROVIDER_ERROR: { text: "检索服务出现了错误，在线检索没有完成。", hint: "可稍后重试；已成功的其他部分不会丢失。" },
  SEARCH_API_ERROR: { text: "检索服务返回了错误，在线检索没有完成。", hint: "可稍后重试。" },
  SEARCH_EMPTY_GOAL: { text: "这条任务没有可检索的内容。", hint: null },
  SKILL_THREW: { text: "执行过程出现了意外错误。", hint: "可重试失败的步骤；已成功的部分不会重做。" },
  RUNNER_THREW: { text: "任务引擎出现了意外错误。", hint: "请重试；若反复出现，请反馈问题。" },
};

/**
 * Human explanation for an error code. Returns { text, hint } — text is
 * always non-empty; hint may be null. Falls back to the original message
 * for unknown codes (honest, never invented).
 */
export function explainError(code, message) {
  const key = String(code || "");
  const known = ERROR_EXPLAIN[key];
  if (known) return known;
  const m = String(message || "").trim();
  return { text: m || "出现了未知问题。", hint: null };
}

/** Map a runner result into { text, hint } for the UI (null when fine). */
export function explainRunProblem(run) {
  if (!run) return null;
  // Runner-level success is STILL a problem when the run itself failed
  // (ok:true + failed:true = "the runner finished, the task failed").
  if (run.failed) {
    const f = Array.isArray(run.failures) && run.failures[0];
    if (f) return explainError(f.code, f.message);
    return { text: String(run.failureReason || "任务执行失败。"), hint: null };
  }
  if (run.ok === true) return null;
  return explainError(run.code, run.message);
}
