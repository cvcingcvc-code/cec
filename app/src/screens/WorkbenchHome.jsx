// Gorgon Lite — Home screen (一句话建任务 → 今日任务 → 最近执行与复盘).
//
// Streamlined from WorkbenchHome (V3N): keeps the atomic one-shot composer
// (dedupe → create → deterministic/opt-in runner), surfaces in-flight &
// confirmation-needed tasks, Today's Tasks, and Recent Executions & Reviews.
// Removes duplicate module placeholders (projects/notes empty blocks) and
// the developer status table so the home screen stays focused on daily action.

import React from "react";
import { useResponsive } from "../lib/useResponsive.js";
import { statusLabel } from "../workbench/task-status-labels.js";
import { explainRunProblem } from "../workbench/one-shot.js";
import { Icon } from "../components/Icon.jsx";
import "../styles/v3k-home.css";

const QUICK_ACTIONS = [
  { key: "plan", label: "拆解行动计划", text: "帮我制定一份本周重点任务的执行计划" },
  { key: "organize", label: "整理准备清单", text: "帮我整理一份项目交付前需要核对的资料清单" },
  { key: "extract", label: "提炼纪要待办", text: "从会议记录中提取待办事项和截止日期：" },
];

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch (e) { return ""; }
}

function SectionHeading({ title, children }) {
  return <div className="v3k-home-section-heading"><h2>{title}</h2><div>{children}</div></div>;
}

function EmptyState({ icon, title, children }) {
  return (
    <div className="v3k-home-empty v3k-panel">
      <span className="v3k-home-empty-icon"><Icon name={icon} /></span>
      <div><p>{title}</p><span>{children}</span></div>
    </div>
  );
}

function describeRecentTask(t) {
  const parts = [];
  const when = fmtTime(t.updatedAt || t.createdAt);
  if (when) parts.push(when);
  if (t.status === "failed" && t.failureReason) {
    parts.push(`原因：${t.failureReason.slice(0, 42)}`);
  } else if (t.result) {
    parts.push("已有真实结果 · 可记录复盘");
  } else if (t.agentRunIds && t.agentRunIds.length > 0) {
    parts.push(`已关联 ${t.agentRunIds.length} 条电脑执行记录`);
  } else {
    parts.push("尚未产生执行结果");
  }
  return parts.join(" · ");
}

export function WorkbenchHome({
  tasks,
  onCreateTask,
  onSubmitGoal = null,
  submittingGoal = false,
  onGoTasks,
  onOpenTask,
  onGoSchedule = null,
  onGoAgent = null,
  todayTasks = [],
  openTaskCount = 0,
  agentPaired = false,
}) {
  const { isMobile } = useResponsive();
  const [value, setValue] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const inputRef = React.useRef(null);

  const runningTasks = tasks.filter((t) => t.status === "running" || t.status === "planning");
  const confirmTasks = tasks.filter((t) =>
    t.status === "review_required" ||
    (t.status === "failed" && t.metadata && Array.isArray(t.metadata.retryableSkillIds) && t.metadata.retryableSkillIds.length > 0)
  );
  const finishedTasks = tasks.filter((t) => t.status === "completed" || t.status === "failed");
  const recent = finishedTasks.length ? finishedTasks.slice(0, 4) : tasks.slice(0, 4);

  const submit = async () => {
    const t = value.trim();
    if (!t) return;
    if (!onSubmitGoal) {
      const task = onCreateTask(t);
      setValue("");
      if (task && onOpenTask) { onOpenTask(task.id); return; }
      setNotice(task ? "任务已创建并保存到本机，尚未开始执行。" : "任务创建失败，请检查输入内容。");
      return;
    }
    setNotice("正在处理…");
    const out = await onSubmitGoal(t);
    setValue("");
    if (out && out.deduped && out.task) {
      setNotice("这个目标已提交过，已为你打开原任务，不会重复执行。");
      if (onOpenTask) onOpenTask(out.task.id);
      return;
    }
    if (out && out.ok && out.task) {
      if (onOpenTask) { onOpenTask(out.task.id); return; }
      const problem = explainRunProblem(out.run);
      setNotice(problem
        ? `已创建任务「${out.task.title}」。${problem.text}${problem.hint || ""}`
        : `已完成「${out.task.title}」，成果已保存在任务详情中。`);
      return;
    }
    setNotice((out && out.message) || "任务创建失败，请检查输入内容。");
  };

  const quick = (a) => {
    setValue(a.text);
    inputRef.current?.focus();
  };

  const aiBadgeText = agentPaired ? "AI 未连接 · 已存电脑配对" : "AI 未连接 · 本地引擎就绪";

  return (
    <div className="v3k-home v3k-page" data-gg-screen="workbench-home">
      <div className="v3k-home-inner">
        <header className="v3k-home-heading" data-testid="workbench-hero">
          <div className="v3k-home-eyebrow"><span className="v3k-home-signal" />GORGON LITE · 个人行动助手</div>
          <h1>把想法，<br className="v3k-home-title-break" />变成真实行动。</h1>
          <p>创建任务 → 辅助执行 → 查看真实结果 → 保存记录与复盘。</p>
        </header>

        <section data-testid="workbench-task-input" aria-label="一句话提交，自动处理">
          <div className="v3k-hero v3k-home-composer" onClick={() => inputRef.current?.focus()}>
            <div className="v3k-home-composer-top">
              <span className="v3k-home-composer-kicker"><Icon name="sparkles" />一句话建任务</span>
              {onGoAgent ? (
                <button
                  type="button"
                  data-testid="workbench-status-ai"
                  onClick={(e) => { e.stopPropagation(); onGoAgent(); }}
                  style={{
                    minHeight: 36, padding: "4px 10px", borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.06)",
                    color: "#cbc9e0", fontSize: 12, fontFamily: "var(--font-sans)", cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#aaa8c4" }} />
                  {aiBadgeText}
                </button>
              ) : (
                <span className="v3k-home-connection" data-testid="workbench-status-ai"><span />{aiBadgeText}</span>
              )}
            </div>
            <label htmlFor="v3k-home-goal" className="v3k-home-composer-title">你想推进哪件事？</label>
            <textarea
              id="v3k-home-goal"
              className="v3k-goal-input"
              aria-label="描述一个目标"
              placeholder="写下你的目标，例如：帮我整理一份交付前核对清单…"
              rows={isMobile ? 2 : 3}
              enterKeyHint="send"
              value={value}
              ref={inputRef}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
            />
            <div className="v3k-home-composer-footer">
              <span>{submittingGoal ? "正在处理，请稍候…" : (isMobile ? "提交后自动路由本地能力并保存记录" : "Enter 开始处理 · Shift + Enter 换行")}</span>
              <button type="button" className="v3k-home-start" data-testid="workbench-home-submit" onClick={submit} disabled={!value.trim() || submittingGoal}>
                {submittingGoal ? "正在处理…" : "开始处理"}<Icon name="arrow-up-right" />
              </button>
            </div>
          </div>
          {notice && <div className="v3k-home-notice" data-testid="workbench-task-notice" role="status">{notice}</div>}
        </section>

        <nav className="v3k-home-shortcuts" aria-label="快捷任务模板">
          {QUICK_ACTIONS.map((a) => (
            <button type="button" key={a.key} data-testid={"workbench-quick-" + a.key} onClick={() => quick(a)}>
              <Icon name={a.key === "plan" ? "calendar-clock" : a.key === "organize" ? "files" : "list-todo"} />
              {a.label}
            </button>
          ))}
        </nav>

        {runningTasks.length > 0 && (
          <section className="v3k-section" data-testid="workbench-home-running">
            <SectionHeading title="正在执行" />
            <div className="v3k-home-list">
              {runningTasks.slice(0, 3).map((t) => (
                <button type="button" key={t.id} className="v3k-home-row v3k-panel" data-testid="workbench-home-running-item"
                  onClick={() => onOpenTask && onOpenTask(t.id)} disabled={!onOpenTask}>
                  <span className="v3k-home-row-icon"><Icon name="clock" /></span>
                  <span className="v3k-home-row-copy"><strong>{t.title}</strong><span>自动处理中，点击查看进度</span></span>
                  <span className="v3k-home-task-status" data-status={t.status}>{statusLabel(t.status, t)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {confirmTasks.length > 0 && (
          <section className="v3k-section" data-testid="workbench-home-confirm">
            <SectionHeading title="需要你确认或重试" />
            <div className="v3k-home-list">
              {confirmTasks.slice(0, 3).map((t) => (
                <button type="button" key={t.id} className="v3k-home-row v3k-panel" data-testid="workbench-home-confirm-item"
                  onClick={() => onOpenTask && onOpenTask(t.id)} disabled={!onOpenTask}>
                  <span className="v3k-home-row-icon"><Icon name="alert-triangle" /></span>
                  <span className="v3k-home-row-copy">
                    <strong>{t.title}</strong>
                    <span>{t.status === "failed" ? "存在失败步骤，可进入详情单独重试" : "等待人工确认后继续"}</span>
                  </span>
                  <span className="v3k-home-task-status" data-status={t.status}>{statusLabel(t.status, t)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="v3k-section" data-testid="workbench-today">
          <SectionHeading title="今日任务">
            {onGoSchedule && (
              <button type="button" onClick={onGoSchedule} data-testid="workbench-today-goschedule">
                日程<Icon name="arrow-up-right" />
              </button>
            )}
            <button type="button" onClick={onGoTasks} aria-label="查看全部任务">
              全部任务<Icon name="arrow-right" />
            </button>
          </SectionHeading>
          {openTaskCount > 0 && (
            <p className="v3k-home-section-caption">
              今日已排期 {todayTasks.length} 项 · 全部待完成 {openTaskCount} 项
            </p>
          )}
          {todayTasks.length === 0 ? (
            <EmptyState icon="calendar-clock" title="今天还没有排期任务">
              {openTaskCount > 0
                ? `当前有 ${openTaskCount} 项待推进任务尚未排到今天，可在「任务」页设置计划日期或提醒。`
                : "在上方输入一句话目标，或在任务详情中设置计划日期与提醒。"}
            </EmptyState>
          ) : (
            <div className="v3k-home-list">
              {todayTasks.slice(0, 5).map((t) => (
                <button type="button" key={t.id} className="v3k-home-row v3k-panel" data-testid="workbench-today-item"
                  onClick={() => onOpenTask && onOpenTask(t.id)} disabled={!onOpenTask}>
                  <span className="v3k-home-row-icon"><Icon name="calendar-clock" /></span>
                  <span className="v3k-home-row-copy"><strong>{t.title}</strong><span>
                    {t.scheduledDate ? `计划 ${t.scheduledDate}` : ""}{t.dueAt ? `${t.scheduledDate ? " · " : ""}截止 ${fmtTime(t.dueAt)}` : ""}
                    {t.remindAt ? " · 已设提醒" : ""}
                  </span></span>
                  <span className="v3k-home-task-status" data-status={t.status}>{statusLabel(t.status, t)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="v3k-section" data-testid="workbench-recent">
          <SectionHeading title="最近执行与复盘">
            <button type="button" onClick={onGoTasks}>查看全部<Icon name="arrow-up-right" /></button>
          </SectionHeading>
          {recent.length === 0 ? (
            <p className="v3k-home-quiet-empty">还没有执行记录。提交第一个任务后，真实结果、失败原因与复盘都会保存在这里。</p>
          ) : (
            <div className="v3k-home-list">
              {recent.map((t) => (
                <button type="button" key={t.id} className="v3k-home-row v3k-panel" data-testid="workbench-home-recent-result"
                  onClick={() => onOpenTask && onOpenTask(t.id)} disabled={!onOpenTask}>
                  <span className="v3k-home-row-copy">
                    <strong>{t.title}</strong>
                    <span>{describeRecentTask(t)}</span>
                  </span>
                  <span className="v3k-home-task-status" data-status={t.status}>{statusLabel(t.status, t)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
