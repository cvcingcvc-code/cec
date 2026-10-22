// Gorgon Workbench — WorkbenchHome (Phase 2: creates REAL tasks).
//
// The main task input now calls the formal createTask() engine path (§16):
//   * goal = the full user text
//   * title = auto-truncated from the goal
//   * status = created (formal state machine vocabulary)
//   * then the app navigates to the Task Detail screen, which honestly
//     shows 等待任务引擎 — nothing pretends the AI understood the task.

import React from "react";
import { useResponsive } from "../lib/useResponsive.js";
import { STATUS_LABELS as SHARED_LABELS } from "../workbench/task-status-labels.js";
import { Icon } from "../components/Icon.jsx";
import "../styles/v3k-home.css";

const QUICK_ACTIONS = [
  { key: "opportunity", label: "寻找行业机会", text: "帮我寻找本周值得参加的行业机会活动" },
  { key: "organize", label: "整理资料", text: "帮我整理一份比赛报名所需的资料清单" },
  { key: "plan", label: "制定工作计划", text: "帮我制定一份本周的工作计划" },
  { key: "search", label: "智能搜索", gotoSearch: true },
];

// Issue #3 (readable results): every label and value reads as plain Chinese —
// "Deterministic" / "Not connected" were developer strings, not information.
// The meanings are unchanged (same keys, same ok flags); only the copy.
const STATUS_ITEMS = [
  { key: "engine", label: "任务引擎", value: "就绪", ok: true },
  { key: "router", label: "任务路由", value: "规则确定", ok: true },
  { key: "skills", label: "技能", value: "5 个", ok: true },
  { key: "ai", label: "AI 引擎", value: "未连接", ok: false },
  { key: "review", label: "人工确认", value: "就绪 / 按需", ok: true },
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

export function WorkbenchHome({ tasks, onCreateTask, onGoSearch, onGoTasks, onOpenTask,
  onGoSchedule = null,
  todayTasks = [], openTaskCount = 0, projects = [], projectStats = {},
  recentNotes = [], onOpenProject = null, onGoProjects = null }) {
  const { isMobile } = useResponsive();
  const [value, setValue] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const inputRef = React.useRef(null);
  const recent = tasks.slice(0, 3);

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    const task = onCreateTask(t);
    setValue("");
    if (task && onOpenTask) {
      onOpenTask(task.id);
      return;
    }
    setNotice(task
      ? "任务已创建并保存到本地。任务引擎尚未执行它——这是如实状态，不是 AI 理解结果。"
      : "任务创建失败，请检查输入内容。");
  };

  const quick = (a) => {
    if (a.gotoSearch) { onGoSearch(); return; }
    setValue(a.text);
    inputRef.current?.focus();
  };

  return (
    <div className="v3k-home v3k-page" data-gg-screen="workbench-home">
      <div className="v3k-home-inner">
        <header className="v3k-home-heading" data-testid="workbench-hero">
          <div className="v3k-home-eyebrow"><span className="v3k-home-signal" />个人行动空间</div>
          <h1>把想法，<br className="v3k-home-title-break" />变成下一步。</h1>
          <p>把重要的事，变成看得见的进展。</p>
        </header>

        <section data-testid="workbench-task-input" aria-label="创建真实任务">
          <div className="v3k-hero v3k-home-composer" onClick={() => inputRef.current?.focus()}>
            <div className="v3k-home-composer-top">
              <span className="v3k-home-composer-kicker"><Icon name="sparkles" />从一个目标开始</span>
              <span className="v3k-home-connection"><span />AI 未连接</span>
            </div>
            <label htmlFor="v3k-home-goal" className="v3k-home-composer-title">今天想完成什么？</label>
            <textarea
              id="v3k-home-goal"
              className="v3k-goal-input"
              aria-label="描述一个目标"
              placeholder="写下你的目标，例如：帮我制定本周学习计划…"
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
              <span>{isMobile ? "先创建，再决定如何执行" : "Enter 创建 · Shift + Enter 换行"}</span>
              <button type="button" className="v3k-home-start" onClick={submit} disabled={!value.trim()}>
                开始任务<Icon name="arrow-up-right" />
              </button>
            </div>
          </div>
          {notice && <div className="v3k-home-notice" data-testid="workbench-task-notice" role="status">{notice}</div>}
        </section>

        <nav className="v3k-home-shortcuts" aria-label="快捷任务">
          {QUICK_ACTIONS.map((a) => (
            <button type="button" key={a.key} data-testid={"workbench-quick-" + a.key} onClick={() => quick(a)}>
              <Icon name={a.gotoSearch ? "search" : a.key === "plan" ? "calendar-clock" : a.key === "organize" ? "files" : "compass"} />
              {a.label}
            </button>
          ))}
        </nav>

        <section className="v3k-section" data-testid="workbench-today">
          <SectionHeading title="今日待办">
            {onGoSchedule && <button type="button" onClick={onGoSchedule} data-testid="workbench-today-goschedule">日程视图<Icon name="arrow-up-right" /></button>}
            <button type="button" onClick={onGoTasks} aria-label="查看全部任务"><Icon name="arrow-right" /></button>
          </SectionHeading>
          {openTaskCount > 0 && <p className="v3k-home-section-caption">今日 {todayTasks.length} 项安排 · 还有 {openTaskCount} 项任务待推进</p>}
          {todayTasks.length === 0 ? (
            <EmptyState icon="calendar-clock" title="今天还没有安排">
              在任务详情设置计划日期或截止时间，待办就会出现在这里。
            </EmptyState>
          ) : (
            <div className="v3k-home-list">
              {todayTasks.slice(0, 5).map((t) => (
                <button type="button" key={t.id} className="v3k-home-row v3k-panel" data-testid="workbench-today-item"
                  onClick={() => onOpenTask && onOpenTask(t.id)} disabled={!onOpenTask}>
                  <span className="v3k-home-row-icon"><Icon name="calendar-clock" /></span>
                  <span className="v3k-home-row-copy"><strong>{t.title}</strong><span>
                    {t.scheduledDate ? `计划 ${t.scheduledDate}` : ""}{t.dueAt ? `${t.scheduledDate ? " · " : ""}截止 ${fmtTime(t.dueAt)}` : ""}
                  </span></span>
                  <span className="v3k-home-task-status" data-status={t.status}>{SHARED_LABELS[t.status] || t.status}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="v3k-section" data-testid="workbench-home-projects">
          <SectionHeading title="我的项目"><button type="button" onClick={onGoProjects}>全部项目<Icon name="arrow-up-right" /></button></SectionHeading>
          {projects.length === 0 ? (
            <EmptyState icon="folder-kanban" title="给重要的事，一个空间">
              在项目页新建项目，把任务、活动和笔记放在一起。
            </EmptyState>
          ) : (
            <div className="v3k-home-list">
              {projects.slice(0, 4).map((p) => {
                const st = projectStats[p.id] || { tasks: 0, openTasks: 0, notes: 0 };
                const hasDemo = p.activities.some((a) => a.isDemo);
                return (
                  <button type="button" key={p.id} className="v3k-home-row v3k-panel" data-testid="workbench-home-project"
                    onClick={() => onOpenProject && onOpenProject(p.id)} disabled={!onOpenProject}>
                    <span className="v3k-home-row-icon"><Icon name="folder-kanban" /></span>
                    <span className="v3k-home-row-copy"><strong>{p.title}{hasDemo && <small className="v3k-home-demo">DEMO</small>}</strong>
                      <span>任务 {st.tasks}{st.openTasks ? `（进行中 ${st.openTasks}）` : ""} · 笔记 {st.notes} · 活动 {p.activities.length}</span>
                    </span>
                    <Icon className="v3k-home-chevron" name="chevron-right" />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="v3k-section" data-testid="workbench-recent">
          <SectionHeading title="最近任务"><button type="button" onClick={onGoTasks}>查看全部<Icon name="arrow-up-right" /></button></SectionHeading>
          {recent.length === 0 ? (
            <p className="v3k-home-quiet-empty">还没有任务。写下第一个目标，让行动有个起点。</p>
          ) : (
            <div className="v3k-home-list">
              {recent.map((t) => (
                <button type="button" key={t.id} className="v3k-home-row v3k-panel" onClick={() => onOpenTask && onOpenTask(t.id)} disabled={!onOpenTask}>
                  <span className="v3k-home-row-copy"><strong>{t.title}</strong><span>{fmtTime(t.createdAt)} · 本地任务数据</span></span>
                  <span className="v3k-home-task-status" data-status={t.status}>{SHARED_LABELS[t.status] || t.status}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="v3k-section" data-testid="workbench-recent-notes">
          <SectionHeading title="最近记录" />
          {recentNotes.length === 0 ? (
            <p className="v3k-home-quiet-empty">还没有记录。在项目详情里「记一笔」，留下你的思考。</p>
          ) : (
            <div className="v3k-home-list">
              {recentNotes.slice(0, 4).map((n) => (
                <div key={n.id} className="v3k-home-row v3k-panel" data-testid="workbench-recent-note">
                  <span className="v3k-home-row-icon"><Icon name="notebook-pen" /></span>
                  <div className="v3k-home-row-copy"><strong>{n.text}</strong><span>{fmtTime(n.updatedAt)}{n.taskId ? " · 关联任务" : ""}{n.projectId ? " · 关联项目" : ""}</span></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="v3k-section v3k-home-status" data-testid="workbench-status">
          <SectionHeading title="工作台状态" />
          <div className="v3k-panel v3k-home-status-panel">
            {STATUS_ITEMS.map((s) => (
              <div key={s.key} data-testid={"workbench-status-" + s.key}>
                <span>{s.label}</span>
                <strong data-ready={s.ok}><i aria-hidden="true" />{s.value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
