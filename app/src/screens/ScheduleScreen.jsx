// Gorgon Workbench — ScheduleScreen (Phase 2: 周/月日历视图).
//
// The formal schedule surface: a month grid + a week/day list, driven by
// the REAL task data via the pure helpers in schedule-view.js.
//
// Requirements covered:
//   #1 周/月视图     — SegmentedControl 月历 | 本周
//   #4 冲突检测      — conflictIdsOnDate flags red dots on the grid + day list
//   #5 过期提醒      — overdueTaskIds renders a red banner
//   #6 排序/筛选     — timed-first ordering inside each day
//   #7 完成状态同步  — completed tasks render a check + muted style
//
// Honest rules: no fabricated events; an empty day is empty; the transport
// note stays (no routing provider). Reuses TaskDetailScreen for drill-in
// via onOpenTask.

import React from "react";
import { Button, SegmentedControl } from "../lib/ds.js";
import {
  monthGrid, todayStr, formatCN, diffDays, conflictIdsOnDate,
  sortTasksForDay, formatCNMonth,
} from "../lib/calendar.js";
import {
  effectiveDay, weekRange, groupTasksByDate, tasksInMonth,
  overdueTaskIds,
} from "../lib/schedule-view.js";
import { Icon } from "../components/Icon.jsx";

const STATUS_LABEL = {
  created: "已创建", planning: "规划中", ready: "等待执行", running: "执行中",
  review_required: "待审核", completed: "已完成", failed: "失败",
};

function fmtClock(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return null; }
}

/* ── Month grid ─────────────────────────────────────────────────────── */

function MonthGrid({ anchor, tasks, onPickDay }) {
  const [year, month] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))];
  const today = todayStr();
  const cells = monthGrid(year, month, today);
  const byDate = groupTasksByDate(tasks);
  const conflicts = React.useMemo(() => {
    const map = {};
    for (const [day, dayTasks] of Object.entries(byDate)) {
      if (day === "_undated") continue;
      Object.assign(map, conflictIdsOnDate(dayTasks, day));
    }
    return map;
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-testid="workbench-schedule-month">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }} aria-hidden="true">
        {["一", "二", "三", "四", "五", "六", "日"].map((h) => (
          <div key={h} style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, color: "var(--text-faint)", padding: "4px 0" }}>{h}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((c, i) => {
          const dayTasks = byDate[c.dayStr] || [];
          const hasConflict = dayTasks.some((t) => conflicts[t.id]);
          const selected = c.dayStr === anchor;
          return (
            <button key={i}
              data-testid="workbench-schedule-grid-day"
              data-date={c.dayStr}
              aria-label={`${formatCN(c.dayStr)}${dayTasks.length ? `，${dayTasks.length} 项` : ""}${c.isToday ? " 今天" : ""}`}
              onClick={() => onPickDay(c.dayStr)}
              style={{
                minHeight: 46, border: selected ? "1px solid var(--brand)" : "1px solid transparent",
                borderRadius: 10, cursor: "pointer", fontFamily: "var(--font-sans)",
                background: selected ? "var(--brand-soft)" : "transparent",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                padding: "2px 0", touchAction: "manipulation",
              }}>
              <span style={{
                fontSize: 13.5, fontWeight: 600,
                color: !c.inMonth ? "var(--border-subtle)" : c.isToday ? "var(--brand)" : "var(--text-strong)",
              }}>
                {Number(c.dayStr.slice(8, 10))}
              </span>
              {dayTasks.length > 0 && (
                <span style={{ display: "flex", gap: 2 }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: hasConflict ? "var(--danger)" : "var(--brand)",
                  }} />
                  {dayTasks.length > 1 && (
                    <span style={{ fontSize: 8.5, color: "var(--text-faint)", lineHeight: "10px" }}>{dayTasks.length}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Day list row ───────────────────────────────────────────────────── */

function TaskRow({ task, conflict, onOpenTask }) {
  const done = task.status === "completed";
  const failed = task.status === "failed";
  const clock = fmtClock(task.dueAt);
  return (
    <div data-testid="workbench-schedule-task" onClick={() => onOpenTask && onOpenTask(task.id)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 13px",
        background: "var(--surface-card)", border: `1px solid ${conflict ? "var(--danger)" : "var(--border-subtle)"}`,
        borderRadius: "var(--radius-md)", cursor: onOpenTask ? "pointer" : "default", minWidth: 0,
      }}>
      <div style={{ width: 46, flex: "none", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13.5, color: conflict ? "var(--danger)" : "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
          {clock || "全天"}
        </div>
        {clock && <div style={{ fontSize: 10, color: "var(--text-faint)" }}>截止</div>}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: done ? "var(--text-faint)" : "var(--text-strong)", textDecoration: done ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
          {done && <Icon name="check" style={{ width: 13, height: 13, color: "var(--accent-strong, #047857)", flex: "none" }} />}
          {failed && <Icon name="alert-triangle" style={{ width: 13, height: 13, color: "var(--danger)", flex: "none" }} />}
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
        </div>
      </div>
      <span style={{
        flex: "none", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
        background: done ? "var(--accent-soft)" : failed ? "var(--danger-soft)" : "var(--brand-soft)",
        color: done ? "var(--accent-strong, #047857)" : failed ? "var(--danger)" : "var(--brand)",
      }}>
        {STATUS_LABEL[task.status] || task.status}
      </span>
      {conflict && (
        <span data-testid="workbench-schedule-conflict" style={{ flex: "none", fontSize: 10.5, fontWeight: 700, color: "var(--danger)" }}>时间冲突</span>
      )}
    </div>
  );
}

/* ── Screen ─────────────────────────────────────────────────────────── */

export function ScheduleScreen({ tasks, onOpenTask }) {
  const today = todayStr();
  const [view, setView] = React.useState("月历");   // 月历 | 本周
  const [anchor, setAnchor] = React.useState(today); // selected day

  const monthTasks = React.useMemo(() => tasksInMonth(tasks, anchor), [tasks, anchor]);
  const byDate = React.useMemo(() => groupTasksByDate(tasks), [tasks]);
  const [weekStart, weekEnd] = React.useMemo(() => weekRange(anchor), [anchor]);

  const overdue = React.useMemo(() => overdueTaskIds(tasks), [tasks]);

  // Month nav
  const prevMonth = () => {
    const [y, m] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))];
    const nm = m === 1 ? [y - 1, 12] : [y, m - 1];
    setAnchor(`${nm[0]}-${String(nm[1]).padStart(2, "0")}-01`);
  };
  const nextMonth = () => {
    const [y, m] = [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))];
    const nm = m === 12 ? [y + 1, 1] : [y, m + 1];
    setAnchor(`${nm[0]}-${String(nm[1]).padStart(2, "0")}-01`);
  };

  // Days to list: 月历 → the anchor day; 本周 → all 7 days Mon..Sun
  const listDays = React.useMemo(() => {
    if (view === "月历") return [anchor];
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));
    return days;
  }, [view, anchor, weekStart]);

  const monthCount = monthTasks.length;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-schedule">
      <div style={{ padding: "28px 16px 48px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            日程
          </h1>
          <SegmentedControl options={["月历", "本周"]} value={view} onChange={setView} />
        </div>

        {/* 过期提醒 banner (#5) */}
        {overdue.length > 0 && (
          <div data-testid="workbench-schedule-overdue" role="alert" style={{
            marginBottom: 12, padding: "10px 14px", borderRadius: "var(--radius-md)",
            background: "var(--danger-soft)", color: "var(--danger)",
            fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 7,
          }}>
            <Icon name="alert-triangle" style={{ width: 15, height: 15, flex: "none" }} />
            有 {overdue.length} 个任务已过期未完成，点击任务可查看详情。
          </div>
        )}

        {/* month grid (月历 view) */}
        {view === "月历" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <button aria-label="上一月" data-testid="workbench-schedule-prev-month" onClick={prevMonth}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="chevron-left" style={{ width: 17, height: 17 }} />
              </button>
              <div data-testid="workbench-schedule-month-title" aria-live="polite" style={{ fontSize: 16, fontWeight: 700, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
                {formatCNMonth(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)))}
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>{monthCount} 项</span>
              </div>
              <button aria-label="下一月" data-testid="workbench-schedule-next-month" onClick={nextMonth}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="chevron-right" style={{ width: 17, height: 17 }} />
              </button>
            </div>
            <MonthGrid anchor={anchor} tasks={tasks} onPickDay={setAnchor} />
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-faint)", textAlign: "center" }}>
              点击日期查看当天安排 · 红点表示时间冲突
            </div>
          </div>
        )}

        {/* week header (本周 view) */}
        {view === "本周" && (
          <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text-muted)", fontWeight: 600, textAlign: "center" }}>
            {formatCN(weekStart)} — {formatCN(weekEnd)}
          </div>
        )}

        {/* day lists */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {listDays.map((day) => {
            const dayTasks = sortTasksForDay(byDate[day] || [], day);
            const dayConflicts = conflictIdsOnDate(dayTasks, day);
            const [y, m, d] = day.split("-").map(Number);
            const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(y, m - 1, d).getDay()];
            const isToday = day === today;
            return (
              <div key={day} data-testid="workbench-schedule-day">
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: isToday ? "var(--brand)" : "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
                    {m}月{d}日 {weekday}{isToday ? " · 今天" : ""}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{dayTasks.length ? `${dayTasks.length} 项` : ""}</span>
                </div>
                {dayTasks.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "2px 0 6px" }}>当天没有安排。</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {dayTasks.map((t) => (
                      <TaskRow key={t.id} task={t} conflict={!!dayConflicts[t.id]} onOpenTask={onOpenTask} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {/* undated bucket — honest, not hidden */}
          {byDate._undated.length > 0 && (
            <div data-testid="workbench-schedule-undated">
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)", marginBottom: 8 }}>未安排日期（{byDate._undated.length}）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {byDate._undated.map((t) => (
                  <TaskRow key={t.id} task={t} conflict={false} onOpenTask={onOpenTask} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScheduleScreen;
