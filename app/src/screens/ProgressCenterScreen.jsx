// Gorgon V2.2 Stage 4 — ProgressCenterScreen (多项目进度中心).
//
// ONE place that answers 「每个项目走到哪一步了」 in plain language for a
// normal person. No jargon, no status enums on the surface — every line is
// derived honestly from the real stores (tasks / progress / notes /
// schedule / job pipeline) through the workbench-store facade.
//
// Design rules:
//   * Every number on this page comes from real store data — nothing is
//     invented or hardcoded.
//   * A project with no data honestly says 还没有任务 — an empty state is
//     a real state, never hidden.
//   * The job pipeline (Stage 3) shows its honest stage vocabulary.

import React from "react";
import { Icon } from "../components/Icon.jsx";
import { JOB_STAGE_LABEL } from "../store/job-repository.js";

const card = {
  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)", padding: "13px 15px",
};

function fmtDay(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch (e) { return ""; }
}

function fmtDateStr(s) {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return `${m}月${d}日`;
  }
  return fmtDay(s);
}

export function ProgressCenterScreen({ data, onOpenProject }) {
  const { projects, jobCounts, jobTotal, totalOpenTasks } = data || {};
  const list = projects || [];

  const overviewStats = [
    { label: "项目总数", value: list.length, testid: "workbench-progress-total-projects" },
    { label: "未完成任务", value: totalOpenTasks || 0, testid: "workbench-progress-open-tasks" },
    { label: "求职申请", value: jobTotal || 0, testid: "workbench-progress-jobs" },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-progress-center">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            进度中心
          </h1>
          <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 5 }}>
            所有项目走到哪一步了，一眼看清 —— 全部来自你的真实记录
          </div>
        </div>

        {/* overview counters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }} data-testid="workbench-progress-overview">
          {overviewStats.map((s) => (
            <div key={s.label} style={{ ...card, flex: "1 1 120px", textAlign: "center", padding: "12px 10px" }}>
              <div data-testid={s.testid} style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
                {s.value}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* per-project summary */}
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>
          项目进度
        </div>
        {list.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "26px 0", lineHeight: 1.7 }} data-testid="workbench-progress-empty">
            还没有项目。在工作台创建一个项目，或在活动详情页把活动变成项目 —— 这里就会显示它的进度。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="workbench-progress-list">
            {list.map((row) => {
              const p = row.project;
              const hasDemo = p.activities.some((a) => a.isDemo);
              const doneRatio = row.totalTasks ? Math.round((row.completedTasks / row.totalTasks) * 100) : null;
              return (
                <button key={p.id} data-testid="workbench-progress-item"
                  onClick={() => onOpenProject && onOpenProject(p.id)}
                  style={{
                    ...card, width: "100%", textAlign: "left", cursor: onOpenProject ? "pointer" : "default",
                    display: "flex", alignItems: "center", gap: 12, minWidth: 0, fontFamily: "var(--font-sans)",
                  }}>
                  <span style={{
                    flex: "none", width: 34, height: 34, borderRadius: "var(--radius-sm)",
                    background: "var(--brand-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon name="folder-kanban" style={{ width: 17, height: 17, color: "var(--brand)" }} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span data-testid="workbench-progress-project-title" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-strong)" }}>
                        {p.title}
                      </span>
                      {hasDemo && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300" }}>
                          含 DEMO 活动
                        </span>
                      )}
                    </span>
                    {/* plain-language status line — derived, never invented */}
                    <span data-testid="workbench-progress-status-line" style={{ display: "block", fontSize: 13, color: "var(--text-body)", marginTop: 4 }}>
                      {row.statusLine}
                      {row.totalTasks ? `（已完成 ${row.completedTasks}/${row.totalTasks}` : ""}
                      {row.totalTasks ? "）" : ""}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginTop: 3 }}>
                      {row.latestProgress && (
                        <>最近进度：{row.latestProgress.text.slice(0, 24)}{row.latestProgress.text.length > 24 ? "…" : ""} · </>
                      )}
                      {row.nextScheduled && (
                        <>下一个安排：{fmtDateStr(row.nextScheduled.scheduledDate || row.nextScheduled.dueAt)} · </>
                      )}
                      {row.taskProgressCount > 0 && <>{row.taskProgressCount} 条任务记录 · </>}
                      {row.latestNote && <>最新笔记 {fmtDay(row.latestNote.updatedAt)}</>}
                    </span>
                  </span>
                  {doneRatio != null && (
                    <span style={{
                      flex: "none", fontSize: 13, fontWeight: 700, color: doneRatio === 100 ? "var(--brand)" : "var(--text-muted)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {doneRatio}%
                    </span>
                  )}
                  <Icon name="chevron-right" style={{ width: 16, height: 16, color: "var(--text-faint)", flex: "none" }} />
                </button>
              );
            })}
          </div>
        )}

        {/* job pipeline summary (Stage 3 vocabulary, honest) */}
        {(jobTotal || 0) > 0 && (
          <div style={{ marginTop: 22 }} data-testid="workbench-progress-jobs-section">
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>
              求职进度
            </div>
            <div style={{ ...card }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }} data-testid="workbench-progress-job-stages">
                {Object.entries(jobCounts || {}).filter(([, n]) => n > 0).map(([stage, n]) => (
                  <span key={stage} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-body)" }}>
                      {JOB_STAGE_LABEL[stage] || stage}
                    </span>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
                      background: "var(--brand-soft)", color: "var(--brand)", fontVariantNumeric: "tabular-nums",
                    }}>
                      {n}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
