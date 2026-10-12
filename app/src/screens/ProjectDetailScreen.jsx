// Gorgon Phase 4 — ProjectDetailScreen (P0-A hub + P0-B schedule + P0-C notes/review).
//
// ONE project, everything attached to it, on one scrollable mobile-friendly
// page. This is the surface that proves the workbench loop is real:
//   活动 (linked snapshot, DEMO badge kept) → 任务 (real task engine data,
//   complete via the state machine) → 日程 (due dates) → 笔记 (create/edit/
//   delete through the opportunity data layer) → 复盘 (outcome + next action,
//   saved by the user, never auto-generated).
//
// All mutations go through the workbench-store facade; all task status moves
// go through the formal state machine (illegal transitions are not offered).

import React from "react";
import { Button } from "../lib/ds.js";
import { Icon } from "../components/Icon.jsx";
import { canTransition } from "../workbench/task-model.js";
import { STATUS_LABELS } from "../workbench/task-status-labels.js";
import { PLACE_LABEL } from "../store/opportunity-repository.js";

const card = {
  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)", padding: "12px 14px",
};

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

function fmtDay(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

/** The single legal "move it forward" action for a task, if any. */
function nextLegalStatus(status) {
  const order = ["ready", "running", "completed"];
  for (const to of order) if (canTransition(status, to)) return to;
  return null;
}
const NEXT_LABEL = { ready: "准备就绪", running: "开始执行", completed: "标记完成" };

export function ProjectDetailScreen({
  bundle, onBack, onOpenTask, onTaskStatus, onAddTask,
  onAddNote, onUpdateNote, onRemoveNote,
  onSaveReview, onArchiveProject, onPlaceVisit,
}) {
  const { project, tasks, notes, places, review, registrations } = bundle;

  const [newTask, setNewTask] = React.useState("");
  const [noteDraft, setNoteDraft] = React.useState("");
  const [editingNoteId, setEditingNoteId] = React.useState(null);
  const [editingText, setEditingText] = React.useState("");
  const [outcome, setOutcome] = React.useState((review && review.outcome) || "");
  const [nextAction, setNextAction] = React.useState((review && review.nextAction) || "");

  // Re-sync the review form when the bundle changes under us (cold restart).
  React.useEffect(() => {
    setOutcome((review && review.outcome) || "");
    setNextAction((review && review.nextAction) || "");
  }, [review && review.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const addTask = () => {
    const t = newTask.trim();
    if (!t) return;
    onAddTask(t, project.id);
    setNewTask("");
  };

  const saveNote = () => {
    const t = noteDraft.trim();
    if (!t) return;
    onAddNote(t, project.id);
    setNoteDraft("");
  };

  const saveReview = () => {
    onSaveReview(project.id, { outcome: outcome.trim(), nextAction: nextAction.trim() });
  };

  const scheduled = tasks.filter((t) => t.scheduledDate || t.dueAt);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-project-detail">
      <div style={{ padding: "28px 16px 48px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        {onBack && (
          <button onClick={onBack} data-testid="workbench-project-back"
            style={{ border: "none", background: "transparent", color: "var(--brand)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="arrow-left" style={{ width: 15, height: 15 }} />返回项目列表
          </button>
        )}

        {/* header */}
        <div data-testid="workbench-project-header">
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 23, color: "var(--text-strong)", margin: 0, lineHeight: 1.4 }}>
            {project.title}
          </h1>
          {project.goal && (
            <div style={{ marginTop: 8, ...card, fontSize: 13.5, color: "var(--text-body)", lineHeight: 1.7 }} data-testid="workbench-project-goal">
              目标：{project.goal}
            </div>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>
            <span>创建于 {fmtDay(project.createdAt)}</span>
            <span>{project.origin === "activity" ? "来自活动" : "手动创建"}</span>
          </div>
        </div>

        {/* ── activities ─────────────────────────────────────────────── */}
        <Section title={`关联活动 (${project.activities.length})`} testid="workbench-project-activities">
          {project.activities.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
              还没有关联活动。在活动详情页点「创建项目 / 关联项目」即可挂到这里。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {project.activities.map((a) => {
                const reg = registrations.find((r) => r.activityId === a.activityId);
                return (
                  <div key={a.activityId} data-testid="workbench-project-activity" style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon name="calendar-heart" style={{ width: 16, height: 16, color: "var(--brand)", flex: "none" }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)" }}>{a.title}</span>
                        {a.isDemo && (
                          <span data-testid="workbench-project-activity-demo" style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300" }}>
                            DEMO 数据
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 3 }}>
                        {[a.dateText, a.venue].filter(Boolean).join(" · ") || "时间地点待定"}
                        {reg ? ` · 报名状态：${reg.status}` : ""}
                      </div>
                      {/* PHASE 5 (P5-C): 来源可从项目详情追溯 — the snapshot
                          keeps the sourceUrl it was retrieved with; render it
                          as-is when present, and render NOTHING when it is
                          missing (a missing source is never fabricated). */}
                      {(a.sourceUrl || (a.raw && a.raw.sourceUrl)) ? (
                        <a href={a.sourceUrl || (a.raw && a.raw.sourceUrl)} target="_blank" rel="noopener noreferrer"
                          data-testid="workbench-project-activity-source"
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 11.5, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
                          <Icon name="external-link" style={{ width: 12, height: 12 }} />查看来源
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ── tasks ──────────────────────────────────────────────────── */}
        <Section title={`关联任务 (${tasks.length})`} testid="workbench-project-tasks">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tasks.map((t) => {
              const next = nextLegalStatus(t.status);
              const done = t.status === "completed";
              return (
                <div key={t.id} data-testid="workbench-project-task" style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1, cursor: onOpenTask ? "pointer" : "default" }}
                    onClick={() => onOpenTask && onOpenTask(t.id)}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: done ? "var(--text-muted)" : "var(--text-strong)", textDecoration: done ? "line-through" : "none" }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>
                      {STATUS_LABELS[t.status] || t.status}
                      {t.scheduledDate ? ` · 计划 ${t.scheduledDate}` : ""}
                      {t.dueAt ? ` · 截止 ${fmtDay(t.dueAt)}` : ""}
                    </div>
                  </div>
                  {next && !done && (
                    <button data-testid="workbench-project-task-next"
                      onClick={() => onTaskStatus(t.id, next)}
                      style={{ flex: "none", border: "1px solid var(--border-subtle)", background: "transparent", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "6px 11px", borderRadius: "var(--radius-sm)", color: "var(--text-body)" }}>
                      {NEXT_LABEL[next]}
                    </button>
                  )}
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 9 }}>
              <input aria-label="在项目中新建任务" data-testid="workbench-project-task-input"
                placeholder="为这个项目加一个任务，例如：准备报名材料"
                value={newTask} onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
                style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
              <Button onClick={addTask} disabled={!newTask.trim()}>添加任务</Button>
            </div>
          </div>
        </Section>

        {/* ── schedule view (same tasks, date lens) ──────────────────── */}
        <Section title={`日程 (${scheduled.length})`} testid="workbench-project-schedule">
          {scheduled.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
              还没有安排时间。打开任务详情即可设置计划日期或截止时间。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {scheduled.slice().sort((a, b) => String(a.scheduledDate || a.dueAt).localeCompare(String(b.scheduledDate || b.dueAt))).map((t) => (
                <div key={t.id} data-testid="workbench-project-schedule-item" style={{ ...card, padding: "9px 13px", display: "flex", alignItems: "center", gap: 10 }}>
                  <Icon name="calendar-clock" style={{ width: 15, height: 15, color: "var(--brand)", flex: "none" }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-strong)", flex: "none", fontVariantNumeric: "tabular-nums" }}>
                    {t.scheduledDate || fmtDay(t.dueAt)}
                  </span>
                  <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.title}
                  </span>
                  <span style={{ flex: "none", fontSize: 11, color: "var(--text-faint)" }}>{STATUS_LABELS[t.status] || t.status}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── places (Module D data already linked by projectId) ─────── */}
        {places.length > 0 && (
          <Section title={`走访地点 (${places.length})`} testid="workbench-project-places">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {places.map((pl) => (
                <div key={pl.id} data-testid="workbench-project-place" style={{ ...card, padding: "9px 13px", fontSize: 12.5, color: "var(--text-body)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Icon name="map-pin" style={{ width: 14, height: 14, color: "var(--brand)", flex: "none" }} />
                    <b style={{ color: "var(--text-strong)" }}>{pl.name}</b>
                    {pl.address ? <span style={{ color: "var(--text-faint)" }}>· {pl.address}</span> : null}
                    <span style={{
                      flex: "none", fontSize: 11, fontWeight: 700, padding: "3px 9px",
                      borderRadius: "var(--radius-pill)", background: "var(--brand-soft)", color: "var(--brand)",
                    }}>
                      {PLACE_LABEL[pl.status] || pl.status}
                    </span>
                    {onPlaceVisit && pl.status !== "visited" && (
                      <button data-testid="workbench-project-place-visit" onClick={() => onPlaceVisit(pl.id, {})}
                        style={{
                          marginLeft: "auto", border: "1px solid var(--border-subtle)", background: "transparent",
                          color: "var(--text-body)", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                          padding: "4px 10px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                        }}>
                        记录到访
                      </button>
                    )}
                  </div>
                  {pl.nextPlan && (
                    <div style={{ fontSize: 11.5, color: "var(--text-body)", marginTop: 4 }}>
                      复访计划：{pl.nextPlan}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── notes (P0-C) ───────────────────────────────────────────── */}
        <Section title={`项目笔记 (${notes.length})`} testid="workbench-project-notes">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {notes.map((n) => (
              <div key={n.id} data-testid="workbench-project-note" style={{ ...card }}>
                {editingNoteId === n.id ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input aria-label="编辑笔记内容" data-testid="workbench-project-note-edit-input"
                      value={editingText} onChange={(e) => setEditingText(e.target.value)}
                      style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-sm)", padding: "8px 11px", background: "var(--bg-sunken)", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)" }} />
                    <Button size="sm" onClick={() => { onUpdateNote(n.id, editingText); setEditingNoteId(null); }} disabled={!editingText.trim()}>保存</Button>
                    <button onClick={() => setEditingNoteId(null)} aria-label="取消编辑"
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)" }}>
                      <Icon name="x" style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div data-testid="workbench-project-note-text" style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {n.text}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{fmtDay(n.updatedAt)}{n.taskId ? " · 已关联任务" : ""}</span>
                      <button data-testid="workbench-project-note-edit"
                        onClick={() => { setEditingNoteId(n.id); setEditingText(n.text); }}
                        aria-label="编辑笔记"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--brand)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 }}>
                        <Icon name="pencil" style={{ width: 13, height: 13 }} />编辑
                      </button>
                      <button data-testid="workbench-project-note-delete"
                        onClick={() => onRemoveNote(n.id)}
                        aria-label="删除笔记"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--danger)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 }}>
                        <Icon name="trash-2" style={{ width: 13, height: 13 }} />删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 9 }}>
              <input aria-label="新笔记内容" data-testid="workbench-project-note-input"
                placeholder="记一笔：现场情况、关键信息、想法……"
                value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveNote(); }}
                style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--surface-card)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
              <Button onClick={saveNote} disabled={!noteDraft.trim()}>记一笔</Button>
            </div>
          </div>
        </Section>

        {/* ── minimal review (P0-C step 4) ───────────────────────────── */}
        <Section title="执行复盘" testid="workbench-project-review">
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 5 }}>实际结果（由你亲自填写，不会自动生成）</div>
              <textarea aria-label="实际结果" data-testid="workbench-project-review-outcome"
                rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)}
                placeholder="实际发生了什么？例如：完成报名并到场，认识了 3 位开发者"
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--bg-sunken)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)", resize: "vertical" }} />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 5 }}>下一步行动</div>
              <input aria-label="下一步行动" data-testid="workbench-project-review-next"
                value={nextAction} onChange={(e) => setNextAction(e.target.value)}
                placeholder="例如：下周三前把合作方案发给对方"
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-md)", padding: "10px 13px", background: "var(--bg-sunken)", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Button variant="primary" onClick={saveReview} data-testid="workbench-project-review-save">保存复盘</Button>
              {review && review.updatedAt && (
                <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>上次保存 {fmtDay(review.updatedAt)}</span>
              )}
            </div>
          </div>
        </Section>

        {/* archive (soft delete — data is never destroyed) */}
        <div style={{ marginTop: 26, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
          <button onClick={() => onArchiveProject(project.id)} data-testid="workbench-project-archive"
            style={{ border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "8px 14px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)" }}>
            归档项目（不删除任何数据）
          </button>
        </div>
      </div>
    </div>
  );
}
