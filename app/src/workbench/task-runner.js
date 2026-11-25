// Gorgon Workbench — Task Runner (Phase 3 execution engine).
//
// The Runner is the ONLY writer between Skills and the Task layer (§3).
// Skills return a SkillResult; the Runner persists it into the repository
// (steps, sources, result, timeline). A Skill can NEVER mutate a Task,
// localStorage, or React state — that keeps Phase-4 LLM skills from ever
// corrupting Task state.
//
// Flow (§18/§19):
//   created ─▶ planning ─(route)─▶ ready ─▶ running ─▶ completed | failed
//
// V3M (P0 部分成功): a failed skill no longer aborts the whole run. Every
// routed skill still executes at most once and in stable order, but a
// failure now marks THAT step failed and continues with the remaining
// skills. Final state:
//   * all succeeded                          → completed
//   * some failed, at least one succeeded    → failed + partial:true
//     (the partial result / successful steps are PRESERVED, and the
//      failureReason records exactly which skills failed + their codes)
//   * every skill failed                     → failed (as before)
//   * a skill is NOT REGISTERED              → hard abort (config error, not
//     a runtime failure — continuing would hide a broken engine)
//
// Determinism & safety (§48/§49):
//   * Router runs exactly ONCE per run.
//   * Each skill executes at most once, in a fixed, stable order.
//   * MAX_SKILLS_PER_TASK caps the work; manual selection is also clipped.
//   * A task already `running` is refused (concurrency guard).
//
// The Runner is dependency-injected: every external collaborator (repository,
// router, registry, search fn, clock) can be supplied via `options`, so it is
// unit-testable in plain Node with ZERO localStorage / DOM / LLM.

import {
  TASK_STATUS, makeStep,
} from "./task-model.js";
import {
  routeTask, MAX_SKILLS_PER_TASK,
} from "./task-router.js";
import {
  getSkill as defaultGetSkill,
} from "./skills/registry.js";

// Real repository is the default persistence layer (browser). It is only
// imported for its function signatures; its localStorage access happens inside
// the functions, which unit tests never reach because they inject a mock.
import * as defaultRepository from "../store/task-repository.js";

const defaultNow = () => new Date().toISOString();

/** Build a manual-selection route (§27). Clipped to the cap. */
function manualRoute(ids) {
  const clipped = Array.isArray(ids) ? ids.slice(0, MAX_SKILLS_PER_TASK) : [];
  return {
    intent: "manual",
    skillIds: clipped,
    confidence: 1,
    reasons: ["手动选择工具"],
  };
}

/**
 * Run a task to completion through the deterministic engine.
 *
 * @param {string} taskId
 * @param {object} [options]
 *   repository : { getTask, transitionTask, addTaskStep, updateTaskStep,
 *                 setTaskResult, addTaskSource, appendTimelineEvent, updateTask }
 *   router     : (input) => { intent, skillIds, confidence, reasons }
 *   registry   : { getSkill(id) => skill|null }
 *   search     : fn passed to the search skill as deps.search (real API client)
 *   aiClient   : OPT-IN AI client; when omitted every skill stays deterministic
 *   skillIds   : forced skill list (manual selection / re-run), overrides router
 *   retryFailedOnly : V3N (P0 失败恢复) — when true, `skillIds` entries whose
 *                step already COMPLETED are skipped (NOT re-executed, NOT
 *                re-consumed). Used by the "重试失败步骤" recovery path so a
 *                retry never re-does the parts that already succeeded.
 *   now        : () => timestamp string
 * @returns {Promise<{ok:boolean, executed?:boolean, task?:object,
 *                     routed?:object, failed?:boolean, failureReason?:string,
 *                     code?:string, message?:string}>}
 */
export async function runTask(taskId, options = {}) {
  const repository = options.repository || defaultRepository;
  const router = options.router || routeTask;
  const registry = options.registry || { getSkill: defaultGetSkill };
  const now = typeof options.now === "function" ? options.now : defaultNow;
  // `aiClient` is OPT-IN (Phase 5). When absent, every Skill stays purely
  // deterministic — which is what keeps the competition demo at AI_CALLS = 0
  // and prevents a mock provider from degrading good local output.
  const deps = { search: options.search, now, aiClient: options.aiClient };

  const task0 = repository.getTask(taskId);
  if (!task0) {
    return { ok: false, code: "TASK_NOT_FOUND", message: "任务不存在" };
  }
  if (task0.status === TASK_STATUS.RUNNING) {
    return { ok: false, code: "TASK_ALREADY_RUNNING", message: "任务正在运行中，请勿重复执行", task: task0 };
  }
  if (task0.status !== TASK_STATUS.CREATED && task0.status !== TASK_STATUS.READY) {
    return {
      ok: false, code: "TASK_NOT_RUNNABLE",
      message: `任务处于「${task0.status}」状态，无法运行`, task: task0,
    };
  }

  const forced = Array.isArray(options.skillIds) && options.skillIds.length
    ? options.skillIds.slice()
    : null;
  // V3N (P0 失败恢复): when retryFailedOnly is set, steps that already
  // completed are dropped from the forced list — a retry re-runs ONLY the
  // failed skills and never re-consumes a completed step.
  const retryFailedOnly = options.retryFailedOnly === true;

  let skillIds = [];
  let route = null;

  // ── Phase A: planning (only from a fresh `created` task) ──────────────
  if (task0.status === TASK_STATUS.CREATED) {
    repository.transitionTask(taskId, TASK_STATUS.PLANNING, { at: now() });
    repository.appendTimelineEvent(
      taskId, "routing_started", "开始分析任务目标", { goal: task0.goal },
    );

    route = forced ? manualRoute(forced) : router({ goal: task0.goal, metadata: task0.metadata });

    const curMeta = repository.getTask(taskId).metadata || {};
    repository.updateTask(taskId, {
      metadata: Object.assign({}, curMeta, { router: route }),
    });
    repository.appendTimelineEvent(
      taskId, "routing_completed",
      `确定工具：${route.skillIds.join(" + ") || "无"}`,
      { intent: route.intent, skillIds: route.skillIds, confidence: route.confidence },
    );

    skillIds = route.skillIds;

    if (skillIds.length === 0) {
      // §8: cannot determine intent. Leave the task ready; no steps, no run.
      repository.transitionTask(taskId, TASK_STATUS.READY, { at: now() });
      return {
        ok: true, executed: false, routed: route, reason: "unknown_intent",
        task: repository.getTask(taskId),
      };
    }

    // Create one step per skill; step.metadata.skillId links them (§20).
    for (const sid of skillIds) {
      const sk = registry.getSkill(sid);
      const title = sk ? sk.name : sid;
      repository.addTaskStep(taskId, makeStep(title, { metadata: { skillId: sid }, now: now() }));
    }
    repository.transitionTask(taskId, TASK_STATUS.READY, { at: now() });
  } else {
    // ── Manual selection / re-run from `ready` (§27) ───────────────────
    if (!forced) {
      return {
        ok: false, code: "NO_SKILLS_SPECIFIED",
        message: "请选择要执行的工具", task: repository.getTask(taskId),
      };
    }
    // V3N: recovery path — drop skills whose step already completed so a
    // retry never re-executes (or re-consumes) a successful step.
    const cur0 = repository.getTask(taskId);
    const doneSkills = new Set(cur0.steps
      .filter((s) => s.status === "completed" && s.metadata && s.metadata.skillId)
      .map((s) => s.metadata.skillId));
    let requested = manualRoute(forced);
    if (retryFailedOnly) {
      const remaining = requested.skillIds.filter((sid) => !doneSkills.has(sid));
      if (remaining.length === 0) {
        return {
          ok: true, executed: false, reason: "all_steps_already_done",
          message: "失败的步骤都已恢复完成，没有需要重试的内容", task: cur0,
        };
      }
      requested = { intent: "manual", skillIds: remaining, confidence: 1, reasons: ["重试失败的步骤（已完成部分不重做）"] };
      repository.appendTimelineEvent(
        taskId, "retry_started",
        `重试 ${remaining.length} 个失败步骤（已完成部分不重做）`,
        { retryFailedOnly: true, remaining },
      );
    }
    route = requested;
    skillIds = route.skillIds;
    const cur = repository.getTask(taskId);
    for (const sid of skillIds) {
      const exists = cur.steps.some((s) => s.metadata && s.metadata.skillId === sid);
      if (!exists) {
        const sk = registry.getSkill(sid);
        repository.addTaskStep(taskId, makeStep(sk ? sk.name : sid, { metadata: { skillId: sid }, now: now() }));
      }
    }
    const curMeta = repository.getTask(taskId).metadata || {};
    repository.updateTask(taskId, {
      metadata: Object.assign({}, curMeta, { router: route }),
    });
  }

  // ── Phase B: running ─────────────────────────────────────────────────
  repository.transitionTask(taskId, TASK_STATUS.RUNNING, { at: now() });

  const baseTask = repository.getTask(taskId);
  const previousResults = [];
  const previousSources = [];
  const aggregated = [];
  const failures = []; // V3M: [{skillId, code, message}] — every failed skill
  let failed = false;
  let failureReason = null;

  for (const sid of skillIds) {
    const skill = registry.getSkill(sid);
    if (!skill) {
      // NOT-registered is a config/engine error, not a runtime failure:
      // continuing would hide a broken engine behind a partial result.
      repository.appendTimelineEvent(
        taskId, "skill_failed", `工具「${sid}」未注册`, { skillId: sid },
      );
      failed = true;
      failureReason = `工具「${sid}」未注册`;
      break;
    }

    const step = baseTask.steps.find((s) => s.metadata && s.metadata.skillId === sid);
    // V3M: a skill that comes after a real failure still runs — record that
    // it was NOT skipped by the engine (honest timeline).
    if (failures.length && step) {
      repository.appendTimelineEvent(
        taskId, "skill_skipped_none", `继续执行：${skill.name}（前序有 ${failures.length} 个工具失败）`, { skillId: sid },
      );
    }
    repository.appendTimelineEvent(
      taskId, "skill_started", `开始执行：${skill.name}`, { skillId: sid },
    );
    if (step) repository.updateTaskStep(taskId, step.id, { status: "running" });

    let result;
    try {
      result = await skill.execute(
        { task: baseTask, goal: baseTask.goal, previousResults, previousSources },
        deps,
      );
    } catch (e) {
      result = {
        ok: false, skillId: sid,
        error: { code: "SKILL_THREW", message: String((e && e.message) || e) },
      };
    }

    if (result && result.ok) {
      if (step) {
        // Data accuracy: persist the skill's REAL metadata (method / aiAssisted /
        // aiReason / aiUsageTotal / simulated / isDemo ...) onto the step so the
        // "处理方式" panel reads actual values instead of defaults. Previously
        // only status + result content were written, silently dropping the very
        // metadata the UI promises to surface (§46 honesty guarantee).
        repository.updateTaskStep(taskId, step.id, {
          status: "completed",
          result: result.result || null,
          metadata: Object.assign({}, step.metadata || {}, result.metadata || {}),
        });
      }
      repository.appendTimelineEvent(
        taskId, "skill_completed", `完成：${skill.name}`, { skillId: sid },
      );
      const sources = Array.isArray(result.sources) ? result.sources : [];
      for (const src of sources) repository.addTaskSource(taskId, src);
      previousResults.push({ skillId: sid, result: result.result || null });
      previousSources.push(...sources);
      aggregated.push({ skillId: sid, result: result.result || null });
    } else {
      if (step) repository.updateTaskStep(taskId, step.id, { status: "failed" });
      const errMsg = (result && result.error && result.error.message) || "执行失败";
      const errCode = result && result.error ? result.error.code : null;
      repository.appendTimelineEvent(
        taskId, "skill_failed", `失败：${skill.name} — ${errMsg}`, { skillId: sid, code: errCode },
      );
      // V3M: record the failure and CONTINUE with the remaining skills. The
      // step stays failed; later skills still get their chance to produce a
      // usable partial result. No break here (except for the unregistered
      // hard-abort above).
      failures.push({ skillId: sid, code: errCode, message: errMsg });
      failed = true;
      failureReason = errMsg;
    }
  }

  // §22: single skill → its result; multi → workflow_result envelope.
  // V3M: with failures, the workflow envelope keeps BOTH the successful
  // outputs AND the failure records, so a partial run is still useful and
  // honest (failed skills appear in content with ok:false entries).
  const finalResult = skillIds.length === 1
    ? (aggregated[0] ? aggregated[0].result : null)
    : {
      type: "workflow_result",
      content: aggregated.concat(failures.map((f) => ({
        skillId: f.skillId, result: null, failed: true, code: f.code, error: f.message,
      }))),
    };

  if (finalResult) repository.setTaskResult(taskId, finalResult);

  // V3M: partial-success bookkeeping. When some skills failed but others
  // succeeded, the failed task keeps its partial result AND the timeline
  // records a task_execution_partial event (plus a retry hint event) so the
  // user can see what to re-run without losing what already worked.
  const succeededCount = aggregated.length;
  const failedCount = failures.length;
  // V3N: persist the recovery hints onto the task metadata so the UI (detail
  // screen / retry button) can offer "重试失败步骤" after a restart, not just
  // in the same session. Purity: metadata only — status/transition untouched.
  if (failed && failures.length) {
    const curMeta = repository.getTask(taskId).metadata || {};
    repository.updateTask(taskId, {
      metadata: Object.assign({}, curMeta, {
        executionFailures: failures,
        retryableSkillIds: failures.map((f) => f.skillId),
        partial: failedCount > 0 && succeededCount > 0,
      }),
    });
  }
  if (failed && failedCount > 0 && succeededCount > 0) {
    const codes = failures.map((f) => `${f.skillId}:${f.code || "?"}`).join("、");
    repository.appendTimelineEvent(
      taskId, "task_execution_partial",
      `部分成功：${succeededCount} 个工具完成，${failedCount} 个失败（${codes}）。已有结果已保留，可重试。`,
      { skillIds, succeededCount, failedCount, failures },
    );
  }
  // Enrich the failureReason with the structured codes (single failure keeps
  // its original message; multi-failure lists them all).
  if (failedCount > 1) {
    failureReason = failures.map((f) => `${f.skillId}（${f.code || "未知"}）：${f.message}`).join("；");
  }

  if (!failed) {
    repository.transitionTask(taskId, TASK_STATUS.COMPLETED, { at: now() });
    repository.appendTimelineEvent(
      taskId, "task_execution_completed", "任务执行完成", { skillIds },
    );
  } else {
    repository.transitionTask(taskId, TASK_STATUS.FAILED, { at: now(), failureReason });
  }

  return {
    ok: true, executed: true,
    task: repository.getTask(taskId),
    routed: route, failed, failureReason,
    // V3M: structured partial-success info for callers (UI/retry entry).
    partial: failed && failedCount > 0 && succeededCount > 0,
    failures,
    retryableSkillIds: failures.map((f) => f.skillId),
  };
}

export default runTask;
