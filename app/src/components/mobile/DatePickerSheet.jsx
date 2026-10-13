// Gorgon Workbench — DatePickerSheet (Phase 2, G-2).
//
// ONE component, THREE modes (mode="date" | "datetime" | "range") —
// per docs/workbench/ui-redesign/G_DATE_PICKER.md G2. No second calendar.
//
// Data contract (G3, hard — unchanged from the existing app):
//   * date     mode  → onConfirm("YYYY-MM-DD", null)
//   * datetime mode  → onConfirm("YYYY-MM-DD", "HH:mm")
//                        (caller converts HH:mm to a UTC ISO dueAt)
//   * range    mode  → onConfirm(startDayStr, endDayStr)
//   * clear          → onConfirm(null, null) — same semantics as
//                      setTaskSchedule(id, {scheduledDate:null})
//   * cancel (Esc / mask / close) → onConfirm(null) is NEVER called;
//                      onCancel() only. No value is written.
//
// Visual spec (G2.2): 48×48 day cells & header buttons, 44×44 time steppers,
// Monday-first, Chinese labels ("2026年10月14日 周三").

import React from "react";
import {
  WEEKDAY_HEADERS, monthGrid, daysInMonth, todayStr, addDays,
  formatCN, formatCNMonth, diffDays,
} from "../../lib/calendar.js";
import { Icon } from "../Icon.jsx";

const MODES = ["date", "datetime", "range"];

const sheetStyle = {
  position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90,
  maxWidth: 640, margin: "0 auto",
  background: "var(--surface-card, #fff)",
  borderTopLeftRadius: 22, borderTopRightRadius: 22,
  padding: "10px 18px calc(18px + env(safe-area-inset-bottom, 0px))",
  maxHeight: "88%", overflowY: "auto",
  boxShadow: "0 -8px 32px rgba(12,13,18,0.18)",
};

const iconBtn = {
  width: 48, height: 48, borderRadius: "var(--radius-sm, 10px)",
  border: "none", background: "transparent", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  color: "var(--text-strong)",
};

const cellBase = {
  width: 48, height: 48, border: "none", cursor: "pointer",
  borderRadius: 12, fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  position: "relative", padding: 0, touchAction: "manipulation",
};

function hhmmOf(dueIso) {
  if (typeof dueIso !== "string") return null;
  const d = new Date(dueIso);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function DatePickerSheet({
  open,
  mode = "date",
  title = "选择日期",
  // seed values
  initialDate = null,      // "YYYY-MM-DD" | null
  initialDueAt = null,     // ISO | null (datetime mode seeds HH:mm from this)
  initialRange = null,     // {start, end} | null
  // gating
  minDate = null,          // "YYYY-MM-DD" | null (disable earlier days)
  maxDate = null,          // "YYYY-MM-DD" | null
  // callbacks
  onConfirm = null,        // (dateStr, second) => void — ONLY on 确定/清除
  onCancel = null,         // () => void — Esc / mask / close
}) {
  const effMode = MODES.indexOf(mode) >= 0 ? mode : "date";
  const today = todayStr();

  // ── local draft state (seeded on open; never written on cancel) ──
  const [ym, setYm] = React.useState(null);          // [year, month1based]
  const [selDate, setSelDate] = React.useState(null);
  const [range, setRange] = React.useState({ start: null, end: null });
  const [hh, setHh] = React.useState(9);
  const [mm, setMm] = React.useState(0);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setError("");
    if (effMode === "range") {
      const r = initialRange && initialRange.start ? initialRange : null;
      setRange({ start: r ? r.start : null, end: r ? r.end : null });
      setSelDate(null);
      const seedDay = r ? r.start : today;
      setYm([Number(seedDay.slice(0, 4)), Number(seedDay.slice(5, 7))]);
    } else {
      const seedDay = initialDate || (initialDueAt ? todayStr(new Date(initialDueAt)) : null) || today;
      setSelDate(seedDay);
      setRange({ start: null, end: null });
      setYm([Number(seedDay.slice(0, 4)), Number(seedDay.slice(5, 7))]);
      const t = hhmmOf(initialDueAt);
      if (t) { setHh(Number(t.slice(0, 2))); setMm(Number(t.slice(3, 5))); }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes WITHOUT writing (G2.4 返回键/取消).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && onCancel) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !ym) return null;

  const [year, month] = ym;
  const cells = monthGrid(year, month, today);

  const isDisabled = (dayStr) => {
    if (minDate && diffDays(dayStr, minDate) != null && dayStr < minDate) return true;
    if (maxDate && dayStr > maxDate) return true;
    return false;
  };

  const prevMonth = () => setYm(([y, m]) => (m === 1 ? [y - 1, 12] : [y, m - 1]));
  const nextMonth = () => setYm(([y, m]) => (m === 12 ? [y + 1, 1] : [y, m + 1]));

  const pickDay = (dayStr) => {
    setError("");
    if (effMode === "range") {
      // First click = start; second click (later day) = end; earlier click restarts.
      if (!range.start || (range.start && range.end)) setRange({ start: dayStr, end: null });
      else if (dayStr < range.start) setRange({ start: dayStr, end: null });
      else setRange({ start: range.start, end: dayStr });
      return;
    }
    setSelDate(dayStr);
  };

  const goToday = () => {
    setYm([Number(today.slice(0, 4)), Number(today.slice(5, 7))]);
    if (effMode === "range") setRange({ start: today, end: null });
    else setSelDate(today);
  };

  const confirm = () => {
    if (effMode === "range") {
      if (!range.start || !range.end) { setError("请选择起止两个日期"); return; }
      if (onConfirm) onConfirm(range.start, range.end);
      return;
    }
    if (!selDate) { setError("请选择一个日期"); return; }
    if (effMode === "datetime") {
      if (onConfirm) onConfirm(selDate, `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
      return;
    }
    if (onConfirm) onConfirm(selDate, null);
  };

  const clear = () => { if (onConfirm) onConfirm(null, null); };

  const rangePreview = effMode === "range" && range.start && range.end
    ? `${formatCN(range.start)} — ${formatCN(range.end)}`
    : null;

  return (
    <div
      data-testid="gg-datepicker"
      role="dialog" aria-modal="true" aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget && onCancel) onCancel(); }}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(12,13,18,0.45)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
    >
      <div style={sheetStyle} data-testid="gg-datepicker-sheet">
        {/* drag handle */}
        <div style={{ width: 38, height: 4, borderRadius: 2, background: "var(--border-subtle)", margin: "0 auto 6px" }} aria-hidden="true" />

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-strong)", flex: 1 }}>{title}</div>
          <button style={iconBtn} aria-label="关闭日期选择" data-testid="gg-datepicker-close" onClick={() => onCancel && onCancel()}>
            <Icon name="x" style={{ width: 17, height: 17 }} />
          </button>
        </div>

        {/* month nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0" }}>
          <button style={iconBtn} aria-label="上一月" data-testid="gg-datepicker-prev" onClick={prevMonth}>
            <Icon name="chevron-left" style={{ width: 17, height: 17 }} />
          </button>
          <div aria-live="polite" data-testid="gg-datepicker-month" style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
            {formatCNMonth(year, month)}
          </div>
          <button style={iconBtn} aria-label="下一月" data-testid="gg-datepicker-next" onClick={nextMonth}>
            <Icon name="chevron-right" style={{ width: 17, height: 17 }} />
          </button>
        </div>

        {/* weekday header (Monday-first) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 48px)", gap: 2, justifyContent: "center" }} aria-hidden="true">
          {WEEKDAY_HEADERS.map((h) => (
            <div key={h} style={{ width: 48, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-faint)", fontWeight: 600 }}>{h}</div>
          ))}
        </div>

        {/* day grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 48px)", gap: 2, justifyContent: "center" }}>
          {cells.map((c, i) => {
            const disabled = isDisabled(c.dayStr);
            let selected = false;
            let inRange = false;
            let rangeEdge = null;
            if (effMode === "range") {
              inRange = range.start && range.end && c.dayStr >= range.start && c.dayStr <= range.end;
              rangeEdge = c.dayStr === range.start ? "rstart" : c.dayStr === range.end ? "rend" : null;
            } else {
              selected = selDate === c.dayStr;
            }
            const style = Object.assign({}, cellBase, {
              background: selected || rangeEdge ? "var(--brand)" : inRange ? "var(--brand-soft)" : "transparent",
              color: selected || rangeEdge ? "#fff" : c.inMonth ? "var(--text-strong)" : "var(--border-subtle)",
            });
            return (
              <button
                key={i}
                data-testid="gg-datepicker-day"
                data-date={c.dayStr}
                disabled={disabled}
                aria-label={`${formatCN(c.dayStr)}${c.isToday ? " 今天" : ""}`}
                aria-selected={selected || !!rangeEdge}
                aria-current={c.isToday ? "date" : undefined}
                aria-disabled={disabled || undefined}
                onClick={() => pickDay(c.dayStr)}
                style={style}
              >
                {Number(c.dayStr.slice(8, 10))}
                {c.isToday && !(selected || rangeEdge) && (
                  <span style={{ position: "absolute", bottom: 6, left: "50%", marginLeft: -2.5, width: 5, height: 5, borderRadius: "50%", background: "var(--brand)" }} />
                )}
              </button>
            );
          })}
        </div>

        {/* time stepper (datetime mode) */}
        {effMode === "datetime" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10 }} data-testid="gg-datepicker-time">
            <button aria-label="小时减一" style={{ ...iconBtn, width: 44, height: 44 }} onClick={() => setHh((h) => (h + 23) % 24)}>−</button>
            <div style={{ width: 62, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-sunken)", borderRadius: 10, fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 16, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>
              {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}
            </div>
            <button aria-label="小时加一" style={{ ...iconBtn, width: 44, height: 44 }} onClick={() => setHh((h) => (h + 1) % 24)}>＋</button>
            <button aria-label="分钟减一" style={{ ...iconBtn, width: 44, height: 44 }} onClick={() => setMm((m) => (m + 55) % 60)}>−</button>
            <button aria-label="分钟加一" style={{ ...iconBtn, width: 44, height: 44 }} onClick={() => setMm((m) => (m + 5) % 60)}>＋</button>
          </div>
        )}

        {/* range quick presets (range mode) */}
        {effMode === "range" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {[["未来 7 天", 7], ["未来 30 天", 30]].map(([label, n]) => (
              <button key={label}
                onClick={() => setRange({ start: today, end: addDays(today, n) })}
                style={{ height: 40, padding: "8px 14px", borderRadius: "var(--radius-pill)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", color: "var(--text-body)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* error row (role=alert, hidden by default) */}
        {error && (
          <div role="alert" data-testid="gg-datepicker-error" style={{ marginTop: 8, fontSize: 12.5, color: "var(--danger)", fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* value preview */}
        {(selDate && effMode !== "range") && (
          <div data-testid="gg-datepicker-preview" style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>
            {effMode === "datetime" ? formatCNTime(selDate, `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`) : formatCN(selDate)}
          </div>
        )}
        {rangePreview && (
          <div data-testid="gg-datepicker-preview" style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>
            {rangePreview}
          </div>
        )}

        {/* bottom actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button data-testid="gg-datepicker-clear" onClick={clear}
            style={{ flex: 1, minHeight: 48, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-body)", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
            清除
          </button>
          <button data-testid="gg-datepicker-today" onClick={goToday}
            style={{ flex: 1, minHeight: 48, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-body)", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
            今天
          </button>
          <button data-testid="gg-datepicker-confirm" onClick={confirm}
            style={{ flex: 1, minHeight: 48, borderRadius: "var(--radius-sm)", border: "none", background: "var(--brand)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export default DatePickerSheet;
