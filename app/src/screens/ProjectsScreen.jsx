// Gorgon Phase 4 — ProjectsScreen (P0-A: 我的项目).
//
// The project hub list: create a project (title + optional goal), see every
// non-archived project with its linked activity/task/note counts, and open
// one to reach ProjectDetailScreen. Projects created FROM an activity keep
// its DEMO flag visible here — a demo activity can never masquerade as a
// real one inside the workbench (charter §IV).
//
// Data comes through the workbench-store facade only; this screen never
// touches localStorage.

import React from "react";
import { Button } from "../lib/ds.js";
import { Icon } from "../components/Icon.jsx";

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch (e) { return ""; }
}

export function ProjectsScreen({ projects, stats, onCreateProject, onOpenProject }) {
  const [title, setTitle] = React.useState("");
  const [goal, setGoal] = React.useState("");

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onCreateProject({ title: t, goal: goal.trim() });
    setTitle("");
    setGoal("");
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-projects">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            我的项目
          </h1>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
            项目把活动、任务、日程、笔记连成一条可执行的主线
          </span>
        </div>

        {/* create form */}
        <div data-testid="workbench-project-create" style={{
          background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)", padding: "14px 16px", marginBottom: 16,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <input
            aria-label="新项目名称"
            data-testid="workbench-project-new-input"
            placeholder="新建项目，例如：参加 10 月的 AI Hackathon"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{
              width: "100%", boxSizing: "border-box", border: "1px solid var(--border-subtle)", outline: "none",
              borderRadius: "var(--radius-md)", padding: "11px 14px", background: "var(--bg-sunken)",
              fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-strong)",
            }}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <input
              aria-label="项目目标（可选）"
              data-testid="workbench-project-new-goal"
              placeholder="目标（可选），例如：完成报名并进入决赛"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              style={{
                flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none",
                borderRadius: "var(--radius-md)", padding: "11px 14px", background: "var(--surface-card)",
                fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--text-strong)",
              }}
            />
            <Button variant="primary" onClick={submit} disabled={!title.trim()}
              leadingIcon={<Icon name="folder-plus" style={{ width: 15, height: 15 }} />}>
              创建项目
            </Button>
          </div>
        </div>

        {/* project list */}
        {!projects || projects.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "30px 0", lineHeight: 1.7 }} data-testid="workbench-project-empty">
            还没有项目。可以直接创建一个，或在活动详情页把活动变成项目 —— 报名、准备、执行、复盘都会挂在项目下面。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="workbench-project-list">
            {projects.map((p) => {
              const st = (stats && stats[p.id]) || { tasks: 0, notes: 0, openTasks: 0 };
              const hasDemo = p.activities.some((a) => a.isDemo);
              return (
                <button key={p.id} data-testid="workbench-project-item"
                  onClick={() => onOpenProject(p.id)}
                  style={{
                    background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)", padding: "13px 16px", width: "100%",
                    display: "flex", alignItems: "center", gap: 12, minWidth: 0, cursor: "pointer",
                    textAlign: "left", fontFamily: "var(--font-sans)",
                  }}>
                  <span style={{
                    flex: "none", width: 34, height: 34, borderRadius: "var(--radius-sm)",
                    background: "var(--brand-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon name="folder-kanban" style={{ width: 17, height: 17, color: "var(--brand)" }} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span data-testid="workbench-project-title" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-strong)" }}>
                        {p.title}
                      </span>
                      {p.origin === "activity" && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "var(--bg-sunken)", color: "var(--text-muted)" }}>
                          来自活动
                        </span>
                      )}
                      {hasDemo && (
                        <span data-testid="workbench-project-demo-badge" style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--radius-pill)", background: "var(--warning-soft)", color: "#9A6300" }}>
                          含 DEMO 活动
                        </span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>
                      {fmtTime(p.createdAt)}
                      {" · 活动 "}{p.activities.length}
                      {" · 任务 "}{st.tasks}{st.openTasks ? `（进行中 ${st.openTasks}）` : ""}
                      {" · 笔记 "}{st.notes}
                      {p.goal ? ` · ${p.goal}` : ""}
                    </span>
                  </span>
                  <Icon name="chevron-right" style={{ width: 16, height: 16, color: "var(--text-faint)", flex: "none" }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
