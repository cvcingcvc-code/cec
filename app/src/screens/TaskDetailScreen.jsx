// Gorgon Workbench — TaskDetailScreen (Phase 2).
//
// The formal detail surface for ONE task: title / goal / status / times /
// steps / sources / result / timeline (§14). Simulation buttons drive the
// REAL State Machine — buttons for illegal transitions are not rendered,
// so an illegal move is impossible from this UI. No AI, no backend.

import React from "react";
import { Button } from "../lib/ds.js";
import * as WB from "../store/workbench-store.js";
import { TASK_STATUS, canTransition } from "../workbench/task-model.js";
import * as SkillRegistry from "../workbench/skills/registry.js";
import { summarizeResult, RESULT_TYPE_LABEL } from "../workbench/result-summary.js";
import { Icon } from "../components/Icon.jsx";

const STATUS_LABEL = {
  created: "已创建",
  planning: "规划中",
  ready: "等待执行",
  running: "执行中",
  review_required: "待审核",
  completed: "已完成",
  failed: "失败",
};

const STEP_LABEL = { pending: "待执行", running: "执行中", completed: "已完成", failed: "失败" };

const EVENT_LABEL = {
  task_created: "创建任务",
  status_changed: "状态变更",
  step_added: "添加步骤",
  step_updated: "更新步骤",
  source_added: "添加来源",
  result_saved: "保存结果",
  task_failed: "任务失败",
  // Phase 4 events.
  task_scheduled: "调整排期",
  project_linked: "项目关联",
  plan_saved_as_todos: "规划建议已存为待办",
  note_linked: "关联笔记",
};

const EVENT_ICON = {
  task_created: "plus",
  status_changed: "git-branch",
  step_added: "list-plus",
  step_updated: "list-todo",
  source_added: "link",
  result_saved: "file-check",
  task_failed: "alert-triangle",
  // Phase 3 execution events (§23).
  routing_started: "compass",
  routing_completed: "map",
  skill_started: "play",
  skill_completed: "check-circle",
  skill_failed: "alert-triangle",
  task_execution_completed: "flag",
  // Phase 4 events.
  task_scheduled: "calendar-clock",
  project_linked: "folder-kanban",
  plan_saved_as_todos: "list-todo",
  note_linked: "notebook-pen",
};

// Phase 3 Router result rendering (§25): map skill ids / intent → labels.
function skillName(id) {
  const s = SkillRegistry.getSkill(id);
  return s ? s.name : id;
}
function intentLabel(router) {
  if (!router) return "未分析";
  if (router.intent === "unknown") return "未识别（需手动选择工具）";
  if (router.intent === "manual") return "手动选择";
  if (router.intent === "workflow") return "多步工作流";
  return skillName(router.intent);
}

// The 5 deterministic skills a user may pick manually (§27). Order matters.
const MANUAL_SKILLS = ["search", "summarize", "extract", "plan", "write"];

// Issue #3 (readable results): a plain <details> disclosure that keeps the
// raw JSON reachable for anyone who needs it, without putting a wall of
// code language in front of an ordinary reader.
function RawJsonDisclosure({ content }) {
  return (
    <details data-testid="workbench-detail-result-raw" style={{ marginTop: 10 }}>
      <summary style={{ fontSize: 11.5, color: "var(--text-faint)", cursor: "pointer", userSelect: "none" }}>
        技术详情（原始数据）
      </summary>
      <pre style={{
        marginTop: 8, padding: "10px 12px", borderRadius: "var(--radius-sm)",
        background: "var(--bg-sunken)", color: "var(--text-muted)",
        fontSize: 11.5, lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
      }}>
        {JSON.stringify(content, null, 2)}
      </pre>
    </details>
  );
}

// Issue #3: the human summary for ONE search-result item. Shows title /
// description / when / where / price as plain Chinese lines — every field
// is derived from the stored record; a missing field renders nothing.
function SearchItemCard({ item }) {
  const facts = [
    { icon: "calendar", text: item.when },
    { icon: "map-pin", text: item.where },
    { icon: "ticket", text: [item.price, item.organizer].filter(Boolean).join(" · ") || null },
  ].filter((f) => f.text);
  return (
    <div data-testid="workbench-detail-result-item" style={{
      padding: "10px 0", borderTop: "1px dashed var(--border-subtle)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)", minWidth: 0 }}>
          {item.demo && (
            <span data-testid="workbench-detail-result-demo-badge" style={{
              marginRight: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px",
              borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300",
            }}>
              DEMO
            </span>
          )}
          {item.title}
        </span>
      </div>
      {item.description && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 3 }}>
          {item.description}
        </div>
      )}
      {facts.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 5 }}>
          {facts.map((f, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-faint)" }}>
              <Icon name={f.icon} style={{ width: 12, height: 12 }} />
              {f.text}
            </span>
          ))}
        </div>
      )}
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer"
          style={{ display: "inline-block", marginTop: 5, fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>
          查看来源链接 ↗
        </a>
      )}
    </div>
  );
}

// Simulation controls (§14): each maps to a LEGAL transition target; the
// button only renders when canTransition(current, target) is true.
const SIM_ACTIONS = [
  { key: "planning", to: TASK_STATUS.PLANNING, label: "进入规划", testid: "workbench-detail-sim-planning" },
  { key: "ready", to: TASK_STATUS.READY, label: "准备就绪", testid: "workbench-detail-sim-ready" },
  { key: "running", to: TASK_STATUS.RUNNING, label: "开始执行", testid: "workbench-detail-sim-running" },
  { key: "review", to: TASK_STATUS.REVIEW_REQUIRED, label: "需要审核", testid: "workbench-detail-sim-review" },
  { key: "completed", to: TASK_STATUS.COMPLETED, label: "标记完成", testid: "workbench-detail-sim-completed" },
  { key: "failed", to: TASK_STATUS.FAILED, label: "标记失败", testid: "workbench-detail-sim-failed" },
];

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

/**
 * Phase 4 (P0-B): extract the suggested steps from a plan-skill result.
 * A plan result is {type:"plan", content:[...]} — content may be an array of
 * strings/objects or a newline-delimited string. Returns clean titles.
 */
function extractPlanSteps(result) {
  if (!result || result.type !== "plan") return [];
  const c = result.content;
  if (Array.isArray(c)) {
    return c.map((x) => (x && typeof x === "object" ? (x.title || x.text || "") : String(x)))
      .map((s) => s.trim()).filter(Boolean);
  }
  if (typeof c === "string") {
    return c.split(/\r?\n/).map((s) => s.trim().replace(/^[\d.\-\s]+/, "")).filter(Boolean);
  }
  return [];
}

function Section({ title, testid, children, extra }) {
  return (
    <div style={{ marginTop: 20 }} data-testid={testid}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 9 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>{title}</div>
        {extra}
      </div>
      {children}
    </div>
  );
}

const card = {
  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)", padding: "12px 14px",
};

export function TaskDetailScreen({ task, onTransition, onBack, onAddStep, onUpdateStep, onSetResult, onAddSource, onRun,
  // ── Phase 4 (P0-B): schedule editor, plan→todos, step title editing,
  //    project link. All optional — the screen degrades gracefully.
  onSetSchedule = null, onSavePlanTodos = null, onLinkProject = null, projects = [],
  // ── Phase 4 (P0-C): task-linked notes (execution records).
  notes = [], onAddNote = null }) {
  const [stepTitle, setStepTitle] = React.useState("");
  const [sourceTitle, setSourceTitle] = React.useState("");
  const [resultText, setResultText] = React.useState("");
  const [noteDraft, setNoteDraft] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [runError, setRunError] = React.useState(null);
  // Phase 4 — schedule editor local state (seeded from the task, re-seeded
  // when a different task is opened).
  const [schedDate, setSchedDate] = React.useState("");
  const [dueInput, setDueInput] = React.useState("");
  const [editingStepId, setEditingStepId] = React.useState(null);
  const [editingStepTitle, setEditingStepTitle] = React.useState("");
  const [planSavedFlash, setPlanSavedFlash] = React.useState(false);

  React.useEffect(() => {
    if (!task) return;
    setSchedDate(task.scheduledDate || "");
    setDueInput(task.dueAt ? task.dueAt.slice(0, 16) : "");
  }, [task && task.id, task && task.scheduledDate, task && task.dueAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const router = task.metadata && task.metadata.router;
  const routerHasSkills = !!(router && Array.isArray(router.skillIds) && router.skillIds.length > 0);
  // The Run button drives the engine: from `created` it routes + executes; from
  // `ready` it only runs when the router already resolved ≥1 skill. A `ready`
  // task with no skills (unknown intent) must use manual selection instead, so
  // we disable Run there rather than producing a no-op error click (§8/§27).
  const isRunnable = (task.status === TASK_STATUS.CREATED || (task.status === TASK_STATUS.READY && routerHasSkills)) && !running;

  const handleRun = async (skillIds) => {
    if (!onRun || running) return;
    setRunError(null);
    setRunning(true);
    try {
      const out = await onRun(task.id, skillIds ? { skillIds } : {});
      if (out && out.ok === false && out.code) {
        setRunError(out.message || "无法运行任务");
      }
    } catch (e) {
      setRunError(String((e && e.message) || e));
    } finally {
      setRunning(false);
    }
  };

  if (!task) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-task-detail">
        <div style={{ padding: "28px 16px", maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 13.5, color: "var(--text-faint)" }}>任务不存在或已被删除。</div>
          {onBack && <div style={{ marginTop: 12 }}><Button onClick={onBack}>返回任务列表</Button></div>}
        </div>
      </div>
    );
  }

  const legalActions = SIM_ACTIONS.filter((a) => canTransition(task.status, a.to));

  const submitStep = () => {
    const t = stepTitle.trim();
    if (!t) return;
    onAddStep(t);
    setStepTitle("");
  };

  const submitSource = () => {
    const t = sourceTitle.trim();
    if (!t) return;
    onAddSource({ type: "user", title: t });
    setSourceTitle("");
  };

  const saveResult = () => {
    const t = resultText.trim();
    if (!t) return;
    onSetResult({ type: "text", content: t });
    setResultText("");
  };

  // ── Phase 4 (P0-C): task-linked notes ─────────────────────────────
  const submitNote = () => {
    const t = noteDraft.trim();
    if (!t || !onAddNote) return;
    onAddNote(t, task);
    setNoteDraft("");
  };

  // ── Phase 4 (P0-B): schedule editor ────────────────────────────────
  // The user sets the date/time; the engine never does. Empty input on a
  // field means "clear it" — handled by setTaskSchedule via null.
  const saveSchedule = () => {
    if (!onSetSchedule) return;
    const patch = {};
    patch.scheduledDate = schedDate ? schedDate : null;
    // datetime-local gives "YYYY-MM-DDTHH:mm"; convert to an ISO instant in
    // local time. Empty = clear.
    patch.dueAt = dueInput ? new Date(dueInput).toISOString() : null;
    onSetSchedule(task.id, patch);
  };

  // ── Phase 4 (P0-B): plan → editable todos ──────────────────────────
  // A plan skill result is {type:"plan", content:[...steps]}. We surface a
  // button that turns those SUGGESTED steps into editable pending todos.
  // Honesty rule: they are created as `pending` by the facade — never done.
  // (Plain function, not a hook — this component has an early return.)
  const planSteps = extractPlanSteps(task.result);

  // Issue #3 (readable results): derive the human summary over the stored
  // result. Pure function over task.result — the stored data is untouched;
  // rendering falls back to the raw JSON disclosure when null.
  const resultSummary = summarizeResult(task.result);
  const resultTypeLabel = RESULT_TYPE_LABEL[task.result && task.result.type]
    || (task.result && task.result.type) || "";

  const alreadySavedAsTodos = task.timeline.some((e) => e.type === "plan_saved_as_todos");

  const doSavePlanTodos = () => {
    if (!onSavePlanTodos || planSteps.length === 0) return;
    onSavePlanTodos(task.id, planSteps);
    setPlanSavedFlash(true);
    setTimeout(() => setPlanSavedFlash(false), 2000);
  };

  // Step title editing (P0-B: suggestions are editable, not fixed).
  const startEditStep = (s) => { setEditingStepId(s.id); setEditingStepTitle(s.title); };
  const commitEditStep = () => {
    const t = editingStepTitle.trim();
    if (t && onUpdateStep) onUpdateStep(editingStepId, { title: t });
    setEditingStepId(null);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-task-detail">
      <div style={{ padding: "28px 16px 48px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        {onBack && (
          <button onClick={onBack} data-testid="workbench-detail-back"
            style={{ border: "none", background: "transparent", color: "var(--brand)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="arrow-left" style={{ width: 15, height: 15 }} />返回任务列表
          </button>
        )}

        {/* header */}
        <div data-testid="workbench-detail-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span data-testid="workbench-detail-status" style={{
              fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: "var(--radius-pill)",
              background: task.status === "completed" ? "var(--accent-soft)" : task.status === "failed" ? "var(--danger-soft)" : "var(--brand-soft)",
              color: task.status === "completed" ? "var(--accent-strong, #047857)" : task.status === "failed" ? "var(--danger)" : "var(--brand)",
            }}>
              {STATUS_LABEL[task.status] || task.status}
            </span>
            {task.status === "created" && (
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>等待任务引擎 · 尚未开始执行</span>
            )}
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 23, color: "var(--text-strong)", margin: "10px 0 0", lineHeight: 1.4 }}>
            {task.title}
          </h1>
          <div style={{ marginTop: 10, ...card, fontSize: 13.5, color: "var(--text-body)", lineHeight: 1.7 }} data-testid="workbench-detail-goal">
            {task.goal}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>
            <span>创建于 {fmtTime(task.createdAt)}</span>
            <span>更新于 {fmtTime(task.updatedAt)}</span>
            {task.startedAt && <span>开始于 {fmtTime(task.startedAt)}</span>}
            {task.completedAt && <span>完成于 {fmtTime(task.completedAt)}</span>}
            {task.failureReason && (
              <span style={{ color: "var(--danger)" }} data-testid="workbench-detail-failure">失败原因：{task.failureReason}</span>
            )}
          </div>
        </div>

        {/* ── Phase 4 (P0-B): schedule editor ─────────────────────────── */}
        {onSetSchedule && (
          <div style={{ ...card, marginTop: 14 }} data-testid="workbench-detail-schedule">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 9, letterSpacing: "0.03em" }}>
              <Icon name="calendar-clock" style={{ width: 13, height: 13, verticalAlign: "-2px", marginRight: 5 }} />
              排期（由你设置，引擎不会自动安排）
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>
                计划日期
                <input type="date" aria-label="计划日期" data-testid="workbench-detail-schedule-date"
                  value={schedDate} onChange={(e) => setSchedDate(e.target.value)}
                  style={{ border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-sm)", padding: "8px 11px", background: "var(--bg-sunken)", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>
                截止时间
                <input type="datetime-local" aria-label="截止时间" data-testid="workbench-detail-schedule-due"
                  value={dueInput} onChange={(e) => setDueInput(e.target.value)}
                  style={{ border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-sm)", padding: "8px 11px", background: "var(--bg-sunken)", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)" }} />
              </label>
              <Button size="sm" data-testid="workbench-detail-schedule-save" onClick={saveSchedule}>保存排期</Button>
              {(task.scheduledDate || task.dueAt) && (
                <span data-testid="workbench-detail-schedule-current" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  当前：{task.scheduledDate ? `计划 ${task.scheduledDate}` : ""}{task.scheduledDate && task.dueAt ? " · " : ""}{task.dueAt ? `截止 ${fmtTime(task.dueAt)}` : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Phase 4 (P0-A): project link ─────────────────────────────── */}
        {onLinkProject && projects.length > 0 && (
          <div style={{ ...card, marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }} data-testid="workbench-detail-project-link">
            <Icon name="folder-kanban" style={{ width: 15, height: 15, color: "var(--brand)", flex: "none" }} />
            <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 600 }}>所属项目：</span>
            <select aria-label="所属项目" data-testid="workbench-detail-project-select"
              value={task.projectId || ""}
              onChange={(e) => onLinkProject(task.id, e.target.value || null)}
              style={{ border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-sm)", padding: "7px 10px", background: "var(--bg-sunken)", fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--text-strong)" }}>
              <option value="">（不关联）</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        )}

        {/* ── Phase 3: run / router / manual selection (§18/§24/§25/§27) ── */}
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }} data-testid="workbench-detail-runzone">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="primary" data-testid="workbench-detail-run" disabled={!isRunnable}
              onClick={() => handleRun(null)}
              leadingIcon={<Icon name={running ? "compass" : "play"} style={{ width: 15, height: 15 }} />}>
              {running ? "正在执行…" : "运行任务"}
            </Button>
            {task.status === TASK_STATUS.CREATED && !running && (
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                任务引擎会先分析目标，再按顺序执行对应工具。
              </span>
            )}
            {task.status === TASK_STATUS.RUNNING && (
              <span style={{ fontSize: 12, color: "var(--brand)" }}>正在执行，请勿重复点击。</span>
            )}
            {runError && (
              <span data-testid="workbench-detail-run-error" style={{ fontSize: 12.5, color: "var(--danger)" }}>
                {runError}
              </span>
            )}
          </div>

          {router && (
            <div style={{ ...card, fontSize: 13, lineHeight: 1.7 }} data-testid="workbench-detail-router">
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 7, letterSpacing: "0.03em" }}>
                任务路由（确定性规则）
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 7 }}>
                <span style={{ color: "var(--text-muted)", fontWeight: 600, marginRight: 4 }}>任务类型：</span>
                <span style={{ fontWeight: 700, color: "var(--text-strong)" }}>{intentLabel(router)}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 7 }}>
                <span style={{ color: "var(--text-muted)", fontWeight: 600, marginRight: 4 }}>使用工具：</span>
                {router.skillIds.length === 0 ? (
                  <span style={{ color: "var(--text-faint)" }}>无（未识别到明确能力）</span>
                ) : (
                  router.skillIds.map((sid) => (
                    <span key={sid} style={{
                      fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: "var(--radius-pill)",
                      background: "var(--brand-soft)", color: "var(--brand)",
                    }}>✓ {skillName(sid)}</span>
                  ))
                )}
              </div>
              <div style={{ color: "var(--text-muted)" }}>
                <span style={{ fontWeight: 600, marginRight: 4 }}>判断依据：</span>
                {router.reasons.length ? router.reasons.join("；") : "（未识别到关键词）"}
              </div>
            </div>
          )}

          {isRunnable && (
            <div data-testid="workbench-detail-manual">
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 7, letterSpacing: "0.03em" }}>
                手动选择工具（确定性本地能力，无需模型）
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MANUAL_SKILLS.map((sid) => (
                  <button key={sid} data-testid={"workbench-detail-manual-" + sid} disabled={running}
                    onClick={() => handleRun([sid])}
                    style={{
                      border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                      color: "var(--text-body)", fontSize: 12.5, fontWeight: 600, cursor: running ? "default" : "pointer",
                      padding: "7px 12px", borderRadius: "var(--radius-pill)", fontFamily: "var(--font-sans)",
                    }}>
                    {skillName(sid)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {router && router.intent === "unknown" && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", padding: "9px 13px", lineHeight: 1.6 }}>
              暂时无法确定该使用哪项能力。你可以修改目标，或手动选择一个工具。
            </div>
          )}
        </div>

        {/* simulation controls — LEGAL transitions only (kept for manual state checks) */}
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }} data-testid="workbench-detail-actions">
          {legalActions.map((a) => (
            <button key={a.key} data-testid={a.testid} onClick={() => onTransition(a.to)}
              style={{
                border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                color: "var(--text-body)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                padding: "8px 13px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
              }}>
              {a.label}
            </button>
          ))}
          {legalActions.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
              任务已到终态（{STATUS_LABEL[task.status] || task.status}），没有可用流转。
            </span>
          )}
        </div>

        {/* steps */}
        <Section title={`步骤 (${task.steps.length})`} testid="workbench-detail-steps">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {task.steps.map((s) => {
              const fromPlan = s.metadata && s.metadata.origin === "plan_suggestion";
              return (
              <div key={s.id} data-testid="workbench-detail-step" style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
                {editingStepId === s.id ? (
                  <>
                    <input aria-label="编辑步骤标题" data-testid="workbench-detail-step-edit-input"
                      value={editingStepTitle} onChange={(e) => setEditingStepTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEditStep(); if (e.key === "Escape") setEditingStepId(null); }}
                      autoFocus
                      style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-sm)", padding: "7px 10px", background: "var(--bg-sunken)", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)" }} />
                    <button data-testid="workbench-detail-step-edit-save" onClick={commitEditStep}
                      style={{ border: "1px solid var(--border-subtle)", background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "5px 10px", borderRadius: "var(--radius-sm)", color: "var(--text-body)" }}>
                      保存
                    </button>
                    <button onClick={() => setEditingStepId(null)} aria-label="取消编辑步骤"
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)" }}>
                      <Icon name="x" style={{ width: 15, height: 15 }} />
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)" }}>{s.title}</span>
                      {fromPlan && (
                        <span data-testid="workbench-detail-step-plan-badge" style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "var(--bg-sunken)", color: "var(--text-muted)" }}>
                          来自规划建议
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>{STEP_LABEL[s.status] || s.status}</span>
                    {onUpdateStep && (
                      <button data-testid="workbench-detail-step-edit" onClick={() => startEditStep(s)} aria-label="编辑步骤标题"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--brand)", display: "inline-flex", alignItems: "center", padding: 4 }}>
                        <Icon name="pencil" style={{ width: 13, height: 13 }} />
                      </button>
                    )}
                    {s.status === "pending" && onUpdateStep && (
                      <button data-testid="workbench-detail-step-start" onClick={() => onUpdateStep(s.id, { status: "running" })}
                        style={{ border: "1px solid var(--border-subtle)", background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "5px 10px", borderRadius: "var(--radius-sm)", color: "var(--text-body)" }}>
                        开始
                      </button>
                    )}
                    {(s.status === "running" || s.status === "pending") && onUpdateStep && (
                      <button data-testid="workbench-detail-step-complete" onClick={() => onUpdateStep(s.id, { status: "completed" })}
                        style={{ border: "1px solid var(--border-subtle)", background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "5px 10px", borderRadius: "var(--radius-sm)", color: "var(--text-body)" }}>
                        完成
                      </button>
                    )}
                  </>
                )}
              </div>
              );
            })}
            <div style={{ display: "flex", gap: 9 }}>
              <input aria-label="新步骤标题" data-testid="workbench-detail-step-input" placeholder="添加一个步骤，例如：收集本周活动列表"
                value={stepTitle} onChange={(e) => setStepTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitStep(); }}
                style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
              <Button onClick={submitStep} disabled={!stepTitle.trim()}>添加步骤</Button>
            </div>
          </div>
        </Section>

        {/* sources */}
        <Section title={`来源 (${task.sources.length})`} testid="workbench-detail-sources">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {task.sources.map((s) => (
              <div key={s.id} data-testid="workbench-detail-source" style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
                <Icon name="link" style={{ width: 15, height: 15, color: "var(--text-faint)", flex: "none" }} />
                <div style={{ minWidth: 0, flex: 1, fontSize: 13, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>{s.title}</a> : s.title}
                </div>
                {s.demo && (
                  <span data-testid="workbench-detail-demo-badge" style={{ flex: "none", fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300" }}>
                    DEMO 数据
                  </span>
                )}
                <span style={{ fontSize: 11.5, color: "var(--text-faint)", flex: "none" }}>{s.type}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 9 }}>
              <input aria-label="新来源标题" data-testid="workbench-detail-source-input" placeholder="添加一个来源，例如：活动官网"
                value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitSource(); }}
                style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
              <Button onClick={submitSource} disabled={!sourceTitle.trim()}>添加来源</Button>
            </div>
          </div>
        </Section>

        {/* result */}
        <Section title="结果" testid="workbench-detail-result">
          {task.result ? (
            <div style={card} data-testid="workbench-detail-result-view">
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 6 }}>
                {resultTypeLabel} · {fmtTime(task.result.createdAt)}
              </div>
              {/* Issue #3: human summary first (activities / facts / workflow
                  per-skill headlines); the raw JSON stays behind the
                  技术详情 disclosure instead of filling the page. */}
              {resultSummary && resultSummary.kind === "activities" && (
                <div data-testid="workbench-detail-result-activities">
                  <div style={{ fontSize: 13, color: "var(--text-body)", marginBottom: 2 }}>
                    共找到 <b style={{ color: "var(--text-strong)" }}>{resultSummary.count}</b> 条相关结果{resultSummary.count === 0 ? "（没有匹配的内容，未猜测）" : ""}
                  </div>
                  {resultSummary.items.map((item, i) => <SearchItemCard key={i} item={item} />)}
                </div>
              )}
              {resultSummary && resultSummary.kind === "facts" && (
                <div data-testid="workbench-detail-result-facts" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {resultSummary.groups.map((g, i) => (
                    <div key={i} style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.7 }}>
                      <span style={{ fontWeight: 700, color: "var(--text-strong)", marginRight: 6 }}>{g.label}</span>
                      <span>{g.values.join("、")}</span>
                    </div>
                  ))}
                </div>
              )}
              {resultSummary && resultSummary.kind === "workflow" && (
                <div data-testid="workbench-detail-result-workflow" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {resultSummary.steps.map((st, i) => (
                    <div key={i} data-testid="workbench-detail-result-workflow-step">
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)", display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon name="check-circle" style={{ width: 14, height: 14, color: "var(--accent-strong, #047857)" }} />
                        {st.skillId ? skillName(st.skillId) : "执行"}：{st.headline}
                      </div>
                      {st.items.length > 0 && (
                        <div style={{ marginTop: 3, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 2 }}>
                          {st.items.slice(0, 5).map((it, j) => (
                            <div key={j} style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              · {it.title}
                            </div>
                          ))}
                          {st.items.length > 5 && (
                            <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                              …等共 {st.items.length} 条
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {resultSummary && resultSummary.kind === "fields" && (
                <div data-testid="workbench-detail-result-fields" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {resultSummary.lines.map((l, i) => (
                    <div key={i} style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.7 }}>
                      <span style={{ fontWeight: 600, color: "var(--text-strong)", marginRight: 6 }}>{l.label}</span>
                      <span>{l.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* string / plan-array content: rendered directly as before —
                  it is already human text, no JSON is involved. */}
              {!resultSummary && typeof task.result.content === "string" && (
                <div style={{ fontSize: 13.5, color: "var(--text-body)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {task.result.content}
                </div>
              )}
              {typeof task.result.content !== "string" && (
                <RawJsonDisclosure content={task.result.content} />
              )}
              {/* Phase 4 (P0-B): plan → editable pending todos. Honest copy:
                  these are SUGGESTIONS; saving them creates pending steps, never
                  completed ones. */}
              {planSteps.length > 0 && onSavePlanTodos && (
                <div data-testid="workbench-detail-plan-todos" style={{ marginTop: 12, paddingTop: 11, borderTop: "1px dashed var(--border-subtle)" }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 9 }}>
                    这是一份本地规划<b style={{ color: "var(--text-strong)" }}>建议</b>（{planSteps.length} 步）。保存为待办后，它们会以「待执行」状态出现在上方步骤里，由你逐条手动推进 —— AI 不会替你标记完成。
                  </div>
                  <Button size="sm" variant="primary" data-testid="workbench-detail-save-plan"
                    onClick={doSavePlanTodos} disabled={alreadySavedAsTodos}
                    leadingIcon={<Icon name="list-todo" style={{ width: 14, height: 14 }} />}>
                    {alreadySavedAsTodos ? "已保存为待办" : "保存为可编辑待办"}
                  </Button>
                  {planSavedFlash && (
                    <span data-testid="workbench-detail-plan-saved-flash" style={{ marginLeft: 10, fontSize: 12, color: "var(--accent-strong, #047857)", fontWeight: 600 }}>
                      已存入步骤（均为待执行）
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "4px 0 10px" }}>还没有保存结果。</div>
          )}
          <div style={{ display: "flex", gap: 9, marginTop: 10 }}>
            <input aria-label="结果内容" data-testid="workbench-detail-result-input" placeholder="记录一段文本结果，例如：已确认 3 场目标活动"
              value={resultText} onChange={(e) => setResultText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveResult(); }}
              style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
            <Button onClick={saveResult} disabled={!resultText.trim()}>保存结果</Button>
          </div>
        </Section>

        {/* Phase 4 (P0-C): task notes — the execution record channel. */}
        {onAddNote && (
          <Section title={`执行记录（笔记） (${notes.length})`} testid="workbench-detail-notes">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {notes.map((n) => (
                <div key={n.id} data-testid="workbench-detail-note" style={{ ...card, fontSize: 13, color: "var(--text-body)", lineHeight: 1.6 }}>
                  <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>{fmtTime(n.updatedAt)}{n.projectId ? " · 已关联项目" : ""}</div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 9 }}>
                <input aria-label="任务笔记" data-testid="workbench-detail-note-input"
                  placeholder="执行过程中记一笔，例如：已完成电话确认，对方要求带身份证"
                  value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
                  style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
                <Button onClick={submitNote} disabled={!noteDraft.trim()}>记一笔</Button>
              </div>
            </div>
          </Section>
        )}

        {/* processing mode — Local vs AI Assisted, per skill (Phase 7).
            Read from the REAL skill metadata; never guessed. */}
        <Section title="处理方式" testid="workbench-detail-processing">
          <div style={card} data-testid="workbench-detail-processing-view">
            {task.steps.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>尚无执行步骤。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {task.steps.map((s) => {
                  const m = s.metadata || {};
                  const ai = m.aiAssisted === true;
                  const sim = m.simulated === true;
                  // Issue #3: "AI Assisted" was English on a Chinese page —
                  // the label is now AI 辅助（本地处理 unchanged）.
                  const label = ai ? "AI 辅助" : "本地处理";
                  const reason = m.aiFallbackReason || m.aiReason || "";
                  const tokens = m.aiUsageTotal || 0;
                  return (
                    <div key={s.id} data-testid="workbench-detail-processing-item" style={{
                      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                      fontSize: 12.5, color: "var(--text-body)",
                    }}>
                      <span style={{ fontWeight: 600, color: "var(--text-strong)", minWidth: 0 }}>
                        {s.title}
                      </span>
                      <span data-testid="workbench-detail-processing-label" style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
                        background: ai ? "var(--brand-soft, var(--warning-soft))" : "var(--surface-sunken, var(--surface-card))",
                        color: ai ? "var(--brand-ink, #1D4ED8)" : "var(--text-muted)",
                        border: ai ? "1px solid transparent" : "1px solid var(--border-subtle)",
                      }}>
                        {label}
                      </span>
                      {sim && (
                        <span data-testid="workbench-detail-processing-simulated" style={{
                          fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)",
                          background: "var(--warning-soft)", color: "#9A6300",
                        }}>
                          模拟输出
                        </span>
                      )}
                      <span style={{ color: "var(--text-faint)" }}>
                        模型调用次数：{tokens}
                      </span>
                      {reason && (
                        <span style={{ color: "var(--text-faint)" }} data-testid="workbench-detail-processing-reason">
                          · {reason}
                        </span>
                      )}
                    </div>
                  );
                })}
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6, marginTop: 2 }} data-testid="workbench-detail-processing-summary">
                  共 {task.steps.length} 个步骤 · 其中 AI 辅助 {task.steps.filter((s) => s.metadata && s.metadata.aiAssisted === true).length} 个 ·
                  确定性本地处理 {task.steps.filter((s) => !(s.metadata && s.metadata.aiAssisted === true)).length} 个
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* timeline */}
        <Section title={`时间线 (${task.timeline.length})`} testid="workbench-detail-timeline">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="workbench-detail-timeline-list">
            {task.timeline.slice().reverse().map((ev, i) => {
              const meta = { icon: EVENT_ICON[ev.type] || "info", label: EVENT_LABEL[ev.type] || ev.type };
              return (
                <div key={ev.id || i} data-testid="workbench-detail-timeline-item" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 13px",
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)",
                }}>
                  <span style={{ flex: "none", width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={meta.icon} style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>{meta.label}</div>
                    {ev.message && (
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.message}</div>
                    )}
                  </div>
                  <span style={{ flex: "none", fontSize: 11.5, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(ev.timestamp)}</span>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}
