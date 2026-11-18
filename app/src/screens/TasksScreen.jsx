// Gorgon Lite — TasksScreen (formal Task Engine v2 + schedule/notes/projects hub).
//
// Highlights creation, schedule/reminder indicators, controlled 7-state machine,
// completion/partial/failure visibility, and contextual entry points to
// Schedule, Notes, Projects, and Recycle Bin — keeping user data reachable
// while the mobile main tabbar stays 3 tabs.

import React from "react";
import { Button } from "../lib/ds.js";
import * as WB from "../store/workbench-store.js";
import { canTransition } from "../workbench/task-model.js";
import { statusLabel } from "../workbench/task-status-labels.js";
import { Icon } from "../components/Icon.jsx";

const STATUS_TONE = {
  created: { color: "var(--text-muted)", bg: "var(--bg-sunken)" },
  planning: { color: "var(--brand)", bg: "var(--brand-soft)" },
  ready: { color: "var(--brand)", bg: "var(--brand-soft)" },
  running: { color: "var(--brand)", bg: "var(--brand-soft)" },
  review_required: { color: "var(--warning-ink, #9A6300)", bg: "var(--warning-soft)" },
  completed: { color: "var(--accent-strong, #047857)", bg: "var(--accent-soft)" },
  failed: { color: "var(--danger)", bg: "var(--danger-soft)" },
};

const FILTER_GROUPS = {
  all: null,
  active: ["created", "planning", "ready", "running"],
  review: ["review_required"],
  completed: ["completed"],
  failed: ["failed"],
};

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "today", label: "今日待办" },
  { key: "open", label: "待完成" },
  { key: "active", label: "进行中" },
  { key: "review", label: "需要确认" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败/部分完成" },
];

const NEXT_ACTION = {
  created: { label: "准备就绪", to: "ready" },
  ready: { label: "开始执行", to: "running" },
  review_required: { label: "继续任务", to: "running" },
  failed: { label: "重新就绪", to: "ready" },
};

const PRIORITY_BADGE = {
  high: { label: "高优先", color: "var(--danger)", bg: "var(--danger-soft)" },
  low: { label: "低优先", color: "var(--text-muted)", bg: "var(--bg-sunken)" },
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

export function TasksScreen({
  tasks,
  onStatusChange,
  onAddTask,
  onOpenTask,
  projects = [],
  notes = [],
  onGoSchedule = null,
  onGoNotes = null,
  onGoProjects = null,
  onGoHistory = null,
}) {
  const [value, setValue] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");

  const projectMap = React.useMemo(() => {
    const m = new Map();
    for (const p of projects || []) {
      if (p && p.id) m.set(p.id, p.title);
    }
    return m;
  }, [projects]);

  const noteCountByTask = React.useMemo(() => {
    const m = new Map();
    for (const n of notes || []) {
      if (n && n.taskId) m.set(n.taskId, (m.get(n.taskId) || 0) + 1);
    }
    return m;
  }, [notes]);

  const group = FILTER_GROUPS[filter];
  const list = React.useMemo(() => {
    let out;
    if (filter === "today") out = tasks.filter((t) => WB.isTaskOnDate(t, WB.localDateStr(new Date())));
    else if (filter === "open") out = tasks.filter((t) => WB.isOpenTask(t));
    else out = tasks.filter((t) => !group || group.indexOf(t.status) >= 0);
    return WB.searchTasks(out, query);
  }, [tasks, filter, group, query]);

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onAddTask(t);
    setValue("");
  };

  const hasSecondary = Boolean(onGoSchedule || onGoNotes || onGoProjects || onGoHistory);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-tasks">
      <div style={{ padding: "24px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            任务
          </h1>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
            共 {tasks.length} 项 · 本机保存 · 状态机受控
          </span>
        </div>

        {/* Secondary preserved user-data views reachable right from Tasks */}
        {hasSecondary && (
          <div data-testid="tasks-secondary-links" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {onGoSchedule && (
              <button type="button" data-testid="tasks-go-schedule" onClick={onGoSchedule} style={{
                border: "1px solid var(--border-subtle)", background: "var(--surface-card)", color: "var(--text-body)",
                borderRadius: "var(--radius-sm)", padding: "8px 12px", minHeight: 40, fontSize: 12.5, fontWeight: 600,
                fontFamily: "var(--font-sans)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                <Icon name="calendar-clock" style={{ width: 14, height: 14, color: "var(--brand)" }} />日程视图
              </button>
            )}
            {onGoNotes && (
              <button type="button" data-testid="tasks-go-notes" onClick={onGoNotes} style={{
                border: "1px solid var(--border-subtle)", background: "var(--surface-card)", color: "var(--text-body)",
                borderRadius: "var(--radius-sm)", padding: "8px 12px", minHeight: 40, fontSize: 12.5, fontWeight: 600,
                fontFamily: "var(--font-sans)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                <Icon name="notebook-pen" style={{ width: 14, height: 14, color: "var(--brand)" }} />笔记 ({notes.length})
              </button>
            )}
            {onGoProjects && (
              <button type="button" data-testid="tasks-go-projects" onClick={onGoProjects} style={{
                border: "1px solid var(--border-subtle)", background: "var(--surface-card)", color: "var(--text-body)",
                borderRadius: "var(--radius-sm)", padding: "8px 12px", minHeight: 40, fontSize: 12.5, fontWeight: 600,
                fontFamily: "var(--font-sans)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                <Icon name="folder-kanban" style={{ width: 14, height: 14, color: "var(--brand)" }} />项目 ({projects.length})
              </button>
            )}
            {onGoHistory && (
              <button type="button" data-testid="tasks-go-history" onClick={onGoHistory} style={{
                border: "1px solid var(--border-subtle)", background: "var(--surface-card)", color: "var(--text-body)",
                borderRadius: "var(--radius-sm)", padding: "8px 12px", minHeight: 40, fontSize: 12.5, fontWeight: 600,
                fontFamily: "var(--font-sans)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                <Icon name="history" style={{ width: 14, height: 14, color: "var(--brand)" }} />记录与回收站
              </button>
            )}
          </div>
        )}

        {/* add form */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <input
            aria-label="新建任务目标"
            data-testid="workbench-task-new-input"
            placeholder="新建一个任务，例如：整理项目复盘要点"
            enterKeyHint="done"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{
              flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none",
              borderRadius: "var(--radius-md)", padding: "11px 14px", background: "var(--surface-card)",
              fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--text-strong)", minHeight: 48,
            }}
          />
          <Button variant="primary" onClick={submit} disabled={!value.trim()}
            leadingIcon={<Icon name="plus" style={{ width: 15, height: 15 }} />}>
            添加
          </Button>
        </div>

        {/* status filter */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <button type="button" key={f.key} data-testid={"workbench-task-filter-" + f.key} onClick={() => setFilter(f.key)}
                style={{
                  border: on ? "1px solid var(--brand)" : "1px solid var(--border-subtle)",
                  background: on ? "var(--brand)" : "var(--surface-card)",
                  color: on ? "var(--v3k-action-ink, #fff)" : "var(--text-body)",
                  fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 12.5,
                  padding: "7px 13px", minHeight: 38, borderRadius: "var(--radius-pill)", cursor: "pointer",
                }}>
                {f.label}
              </button>
            );
          })}
        </div>

        {/* cross-field search over title/goal */}
        <div style={{ marginBottom: 14 }}>
          <input
            aria-label="搜索任务"
            data-testid="workbench-task-search-input"
            placeholder="搜索任务（标题或目标）…"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box", border: "1px solid var(--border-subtle)", outline: "none",
              borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)",
              fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-strong)", minHeight: 44,
            }}
          />
        </div>

        {list.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "30px 0", lineHeight: 1.7 }}>
            当前筛选下没有任务。可在上方新建任务，或回到「首页」输入一句话目标自动处理。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="workbench-task-list">
            {list.map((t) => {
              const label = statusLabel(t.status, t);
              const tone = label === "部分完成"
                ? { color: "var(--warning-ink, #9A6300)", bg: "var(--warning-soft)" }
                : (STATUS_TONE[t.status] || STATUS_TONE.created);
              const next = NEXT_ACTION[t.status] && canTransition(t.status, NEXT_ACTION[t.status].to)
                ? NEXT_ACTION[t.status] : null;
              const overdue = WB.isTaskOverdue(t);
              const prio = PRIORITY_BADGE[t.priority] || null;
              const projName = t.projectId ? projectMap.get(t.projectId) : null;
              const noteCount = noteCountByTask.get(t.id) || 0;
              return (
                <div key={t.id} data-testid="workbench-task-item" style={{
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", padding: "13px 16px",
                  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0,
                }}>
                  <div style={{ minWidth: 0, flex: 1, cursor: onOpenTask ? "pointer" : "default" }}
                    onClick={() => onOpenTask && onOpenTask(t.id)}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      {prio && (
                        <span data-testid="workbench-task-priority" style={{
                          flex: "none", fontSize: 10.5, fontWeight: 700, padding: "2px 7px",
                          borderRadius: "var(--radius-pill)", background: prio.bg, color: prio.color,
                        }}>
                          {prio.label}
                        </span>
                      )}
                      <span style={{ overflowWrap: "anywhere" }}>{t.title}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
                      <span>创建于 {fmtTime(t.createdAt)}</span>
                      {t.steps && t.steps.length > 0 && <span>· 步骤 {t.steps.length}</span>}
                      {t.result && <span>· 已有结果</span>}
                      {noteCount > 0 && <span>· 记录 {noteCount}</span>}
                      {projName && <span>· 项目：{projName}</span>}
                      {t.agentRunIds && t.agentRunIds.length > 0 && <span>· 电脑记录 {t.agentRunIds.length}</span>}
                    </div>
                    {(t.scheduledDate || t.dueAt || t.remindAt) && (
                      <div data-testid="workbench-task-schedule-line" style={{ fontSize: 11.5, marginTop: 4, color: overdue ? "var(--danger)" : "var(--brand)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Icon name="calendar-clock" style={{ width: 12, height: 12 }} />
                        {t.scheduledDate ? `计划 ${t.scheduledDate}` : ""}
                        {t.scheduledDate && t.dueAt ? " · " : ""}
                        {t.dueAt ? `截止 ${fmtTime(t.dueAt)}` : ""}
                        {t.remindAt ? `${(t.scheduledDate || t.dueAt) ? " · " : ""}提醒 ${fmtTime(t.remindAt)}` : ""}
                        {overdue && " · 已逾期"}
                      </div>
                    )}
                    {t.status === "failed" && t.failureReason && (
                      <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 4, overflowWrap: "anywhere" }}>
                        失败原因：{t.failureReason}
                      </div>
                    )}
                  </div>
                  <span data-testid="workbench-task-status" style={{
                    flex: "none", fontSize: 11.5, fontWeight: 700, padding: "4px 10px",
                    borderRadius: "var(--radius-pill)", background: tone.bg, color: tone.color,
                  }}>
                    {label}
                  </span>
                  {next && (
                    <button type="button" data-testid="workbench-task-next" onClick={(e) => { e.stopPropagation(); onStatusChange(t.id, next.to); }}
                      style={{
                        flex: "none", border: "1px solid var(--border-subtle)", background: "transparent",
                        color: "var(--text-body)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        padding: "11px 13px", minHeight: 44, borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                      }}>
                      {next.label}
                    </button>
                  )}
                  {onOpenTask && (
                    <button type="button" data-testid="workbench-task-open" onClick={(e) => { e.stopPropagation(); onOpenTask(t.id); }}
                      aria-label={"打开任务详情：" + t.title}
                      style={{
                        flex: "none", border: "none", background: "transparent", color: "var(--brand)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "11px 8px", minHeight: 44,
                        fontFamily: "var(--font-sans)",
                        display: "inline-flex", alignItems: "center", gap: 4,
                      }}>
                      详情<Icon name="chevron-right" style={{ width: 13, height: 13 }} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
