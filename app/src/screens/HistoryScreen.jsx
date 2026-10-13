// Gorgon Workbench — HistoryScreen (Phase 2: REAL Task timelines).
//
// Default view "最近活动": aggregates every task's timeline, sorted by
// timestamp, newest first (§19). The Phase-1 flat local log is still shown
// as a secondary section (cross-surface events like search/approvals that
// do not belong to a single task). No mock history data.
//
// V3E (任务包 A): the 回收站 section lists soft-deleted tasks (deletedAt
// set, kept for 30 days). Restore clears the marker; 彻底删除 is explicit.

import React from "react";
import { STATUS_LABELS } from "../workbench/task-status-labels.js";
import { Icon } from "../components/Icon.jsx";

const EVENT_META = {
  task_created: { icon: "plus", label: "创建任务" },
  status_changed: { icon: "git-branch", label: "状态变更" },
  step_added: { icon: "list-plus", label: "添加步骤" },
  step_updated: { icon: "list-todo", label: "更新步骤" },
  source_added: { icon: "link", label: "添加来源" },
  result_saved: { icon: "file-check", label: "保存结果" },
  task_failed: { icon: "alert-triangle", label: "任务失败" },
  // V3E (任务包 A): soft delete / restore events.
  task_restored: { icon: "rotate-ccw", label: "任务恢复" },
};

const LOG_META = {
  task_create: { icon: "plus", label: "创建任务" },
  task_status: { icon: "list-todo", label: "任务状态" },
  run_search: { icon: "search", label: "运行搜索" },
  user_approve: { icon: "shield-check", label: "用户批准" },
  user_reject: { icon: "shield-alert", label: "用户拒绝" },
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

/** Aggregate: all task timeline events -> flat newest-first list (§19). */
export function collectRecentActivity(tasks) {
  const rows = [];
  for (const t of tasks || []) {
    if (!t || !Array.isArray(t.timeline)) continue;
    for (const ev of t.timeline) {
      if (!ev || typeof ev !== "object" || !ev.type) continue;
      rows.push({ kind: "timeline", taskId: t.id, taskTitle: t.title, taskStatus: t.status, ...ev });
    }
  }
  rows.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  return rows;
}

// V3E (任务包 A): days left before an auto-purge (30-day window). Pure helper.
const RETENTION_DAYS = 30;
export function remainingDays(deletedAtIso) {
  const t = Date.parse(deletedAtIso);
  if (!Number.isFinite(t)) return RETENTION_DAYS;
  const elapsed = Date.now() - t;
  const left = Math.ceil((RETENTION_DAYS * 24 * 3600 * 1000 - elapsed) / (24 * 3600 * 1000));
  return Math.max(0, left);
}

export function HistoryScreen({ tasks, log, onOpenTask, deletedTasks = [], onRestoreTask = null, onDeleteTaskForever = null }) {
  const activity = React.useMemo(() => collectRecentActivity(tasks), [tasks]);
  const entries = (log && log.length > 0) ? log : [];
  // V3E (任务包 A): the软删除回收站 — the caller passes WB.getDeletedTasks()
  // (soft-deleted records are hidden from the visible list, so they arrive
  // via a dedicated prop). Renders empty when nothing is deleted (honesty).
  const trash = Array.isArray(deletedTasks) ? deletedTasks : [];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-history">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
          工作记录
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.7, margin: "8px 0 0" }}>
          最近活动按时间汇总你本机的任务记录（创建、排期、执行、记录）。数据只保存在本机。
        </p>

        {/* V3E (任务包 A): the 回收站 — soft-deleted tasks, 30-day undo window. */}
        <div style={{ marginTop: 18 }} data-testid="workbench-history-trash">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>
            回收站 ({trash.length})
          </div>
          {trash.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "4px 0" }}>
              回收站是空的。删除的任务会在这里保留 30 天。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="workbench-history-trash-list">
              {trash.map((t) => (
                <div key={t.id} data-testid="workbench-history-trash-item" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
                  background: "var(--bg-sunken)", border: "1px dashed var(--border-subtle)",
                  borderRadius: "var(--radius-md)", minWidth: 0,
                }}>
                  <span style={{
                    flex: "none", width: 30, height: 30, borderRadius: "var(--radius-sm)",
                    background: "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon name="trash-2" style={{ width: 15, height: 15, color: "var(--text-muted)" }} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, color: "var(--text-muted)", fontWeight: 600, lineHeight: 1.5 }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                      删除于 {fmtTime(t.deletedAt)} · {remainingDays(t.deletedAt)} 天后自动清除
                    </div>
                  </div>
                  {onRestoreTask && (
                    <button data-testid="workbench-trash-restore" onClick={() => onRestoreTask(t.id)}
                      style={{
                        flex: "none", border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                        color: "var(--brand)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        padding: "10px 13px", minHeight: 44, borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                      }}>
                      恢复
                    </button>
                  )}
                  {onDeleteTaskForever && (
                    <button data-testid="workbench-trash-delete-forever" onClick={() => {
                      if (window.confirm("彻底删除「" + t.title + "」？此操作不可撤销。")) {
                        onDeleteTaskForever(t.id);
                      }
                    }}
                      style={{
                        flex: "none", border: "none", background: "transparent",
                        color: "var(--danger)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                        padding: "10px 8px", minHeight: 44, borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                      }}>
                      彻底删除
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* A. aggregated task timelines */}
        <div style={{ marginTop: 18 }} data-testid="workbench-history-recent">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>
            最近活动 ({activity.length})
          </div>
          {activity.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "14px 0", lineHeight: 1.7 }}>
              暂无任务活动。创建任务后，事件会出现在这里。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="workbench-history-list">
              {activity.slice(0, 200).map((e, i) => {
                const meta = EVENT_META[e.type] || { icon: "info", label: "事件" };
                return (
                  <div key={(e.id || "") + "-" + i} data-testid="workbench-history-item"
                    className="gg-pressable"
                    onClick={() => onOpenTask && e.taskId && onOpenTask(e.taskId)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
                      background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-md)", minWidth: 0,
                      cursor: onOpenTask && e.taskId ? "pointer" : "default",
                    }}>
                    <span style={{
                      flex: "none", width: 30, height: 30, borderRadius: "var(--radius-sm)",
                      background: "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon name={meta.icon} style={{ width: 15, height: 15, color: "var(--text-muted)" }} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, color: "var(--text-strong)", fontWeight: 600, lineHeight: 1.5 }}>
                        {meta.label}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.taskTitle ? `「${e.taskTitle}」` : ""}{e.message || ""}
                      </div>
                    </div>
                    <span style={{ flex: "none", fontSize: 11.5, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtTime(e.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* B. cross-surface local log (kept from Phase 1) */}
        {entries.length > 0 && (
          <div style={{ marginTop: 26 }} data-testid="workbench-history-log">
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>
              其他本地事件
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {entries.slice(0, 50).map((e, i) => {
                const meta = LOG_META[e.type] || { icon: "info", label: "事件" };
                return (
                  <div key={(e.at || "") + "-" + i} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 13px",
                    background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", minWidth: 0,
                  }}>
                    <span style={{ flex: "none", width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={meta.icon} style={{ width: 14, height: 14, color: "var(--text-faint)" }} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-body)" }}>{meta.label}</span>
                      {e.text && <span style={{ fontSize: 12, color: "var(--text-muted)" }}> · {e.text}</span>}
                    </div>
                    <span style={{ flex: "none", fontSize: 11.5, color: "var(--text-faint)" }}>{fmtTime(e.at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
