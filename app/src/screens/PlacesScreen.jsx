// Gorgon Workbench — PlacesScreen (Module D: field-visit places).
//
// Closes the V2-audit P1 gap: the repository (opportunity-repository.js)
// has owned places + visits + the status vocabulary since the first
// opportunity iteration, but no screen consumed it. This screen is the UI
// half of the field-visit loop:
//
//   新建地点 -> 状态流转（待走访/已走访/需复访/不适合）-> 记录到访
//
// Honesty rules carried over from the repository:
//   * a visit is recorded with a REAL timestamp (now) — never fabricated;
//   * marking visited flips TODO/REVISIT -> VISITED only through
//     addVisit/setPlaceStatus — the screen never writes raw status;
//   * 删除 asks for confirmation (one click, no undo).
//
// Data + handlers come in through props (App owns the facade calls),
// mirroring TasksScreen/ProjectsScreen. Screen never touches localStorage.

import React from "react";
import { Button } from "../lib/ds.js";
import { Icon } from "../components/Icon.jsx";
import { PLACE_LABEL } from "../store/opportunity-repository.js";

const STATUS_TONE = {
  todo: { color: "var(--brand)", bg: "var(--brand-soft)" },
  visited: { color: "var(--accent-strong, #047857)", bg: "var(--accent-soft)" },
  revisit: { color: "#9A6300", bg: "var(--warning-soft)" },
  unsuitable: { color: "var(--danger)", bg: "var(--danger-soft)" },
};

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "todo", label: "待走访" },
  { key: "revisit", label: "需复访" },
  { key: "visited", label: "已走访" },
  { key: "unsuitable", label: "不适合" },
];

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

export function PlacesScreen({ places, projects, onCreate, onStatus, onVisit, onRemove }) {
  const [filter, setFilter] = React.useState("all");
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const [visitFor, setVisitFor] = React.useState(null); // place id being logged
  const [visitNote, setVisitNote] = React.useState("");
  const [visitPlan, setVisitPlan] = React.useState("");

  const list = React.useMemo(
    () => (filter === "all" ? places : places.filter((p) => p.status === filter)),
    [places, filter]
  );

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onCreate({ name: n, address: address.trim(), projectId: projectId || null });
    setName(""); setAddress(""); setProjectId("");
  };

  const submitVisit = () => {
    if (!visitFor) return;
    onVisit(visitFor, {
      note: visitNote.trim(),
      nextPlan: visitPlan.trim() || null,
      // at is omitted — the repository stamps the REAL current time.
    });
    setVisitFor(null); setVisitNote(""); setVisitPlan("");
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-places">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            走访地点
          </h1>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
            地推走访记录 · 本地数据
          </span>
        </div>

        {/* new place form */}
        <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <input
            aria-label="地点名称"
            data-testid="workbench-place-new-name"
            placeholder="地点名称，例如：某园区 A 座前台"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{
              flex: 2, minWidth: 160, border: "1px solid var(--border-subtle)", outline: "none",
              borderRadius: "var(--radius-md)", padding: "11px 14px", background: "var(--surface-card)",
              fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-strong)",
            }}
          />
          <input
            aria-label="地点地址"
            data-testid="workbench-place-new-address"
            placeholder="地址（可选）"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{
              flex: 3, minWidth: 160, border: "1px solid var(--border-subtle)", outline: "none",
              borderRadius: "var(--radius-md)", padding: "11px 14px", background: "var(--surface-card)",
              fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-strong)",
            }}
          />
          <Button variant="primary" onClick={submit} disabled={!name.trim()}
            leadingIcon={<Icon name="plus" style={{ width: 15, height: 15 }} />}>
            添加
          </Button>
        </div>
        {projects.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <select
              aria-label="关联项目（可选）"
              data-testid="workbench-place-new-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={{
                border: "1px solid var(--border-subtle)", outline: "none",
                borderRadius: "var(--radius-md)", padding: "8px 12px", background: "var(--surface-card)",
                fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--text-body)", cursor: "pointer",
              }}>
              <option value="">不关联项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* status filter */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <button key={f.key} data-testid={"workbench-place-filter-" + f.key} onClick={() => setFilter(f.key)}
                style={{
                  border: on ? "1px solid var(--brand)" : "1px solid var(--border-subtle)",
                  background: on ? "var(--brand)" : "var(--surface-card)",
                  color: on ? "#fff" : "var(--text-body)",
                  fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 12.5,
                  padding: "7px 13px", borderRadius: "var(--radius-pill)", cursor: "pointer",
                }}>
                {f.label}
              </button>
            );
          })}
        </div>

        {list.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "30px 0", lineHeight: 1.7 }}>
            还没有走访地点。添加一个，把地推走访的计划与结果记在一起。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="workbench-place-list">
            {list.map((p) => {
              const tone = STATUS_TONE[p.status] || STATUS_TONE.todo;
              const lastVisit = p.visits && p.visits.length > 0 ? p.visits[p.visits.length - 1] : null;
              return (
                <div key={p.id} data-testid="workbench-place-item" style={{
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", padding: "13px 16px", minWidth: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Icon name="map-pin" style={{ width: 16, height: 16, color: "var(--brand)", flex: "none" }} />
                    <span style={{ minWidth: 0, flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </span>
                    <span data-testid="workbench-place-status" style={{
                      flex: "none", fontSize: 11.5, fontWeight: 700, padding: "4px 10px",
                      borderRadius: "var(--radius-pill)", background: tone.bg, color: tone.color,
                    }}>
                      {PLACE_LABEL[p.status] || p.status}
                    </span>
                  </div>
                  {p.address && (
                    <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>
                      {p.address}
                    </div>
                  )}
                  {p.nextPlan && (
                    <div style={{ fontSize: 12, color: "var(--text-body)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                      <Icon name="calendar-clock" style={{ width: 12, height: 12, color: "var(--brand)" }} />
                      复访计划：{p.nextPlan}
                    </div>
                  )}
                  {lastVisit && (
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>
                      最近到访 {fmtTime(lastVisit.at)}{lastVisit.note ? ` · ${lastVisit.note}` : ""}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {p.status !== "visited" && (
                      <button data-testid="workbench-place-visit" onClick={() => { setVisitFor(visitFor === p.id ? null : p.id); setVisitNote(""); setVisitPlan(""); }}
                        style={{
                          border: "1px solid var(--border-subtle)", background: "transparent",
                          color: "var(--text-body)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          padding: "6px 11px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}>
                        <Icon name="check" style={{ width: 13, height: 13 }} />记录到访
                      </button>
                    )}
                    {p.status === "todo" && (
                      <button data-testid="workbench-place-skip" onClick={() => onStatus(p.id, "unsuitable")}
                        style={{
                          border: "1px solid var(--border-subtle)", background: "transparent",
                          color: "var(--text-faint)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          padding: "6px 11px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                        }}>
                        标记不适合
                      </button>
                    )}
                    {p.status === "visited" && (
                      <button data-testid="workbench-place-revisit" onClick={() => onStatus(p.id, "revisit")}
                        style={{
                          border: "1px solid var(--border-subtle)", background: "transparent",
                          color: "var(--text-body)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          padding: "6px 11px", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
                        }}>
                        需复访
                      </button>
                    )}
                    <span style={{ flex: 1 }} />
                    {onRemove && (
                      <button data-testid="workbench-place-remove" onClick={() => { if (window.confirm(`删除地点「${p.name}」？此操作不可撤销。`)) onRemove(p.id); }}
                        aria-label={"删除地点：" + p.name}
                        style={{
                          border: "none", background: "transparent", color: "var(--danger)",
                          fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "6px 8px",
                          display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-sans)",
                        }}>
                        <Icon name="trash-2" style={{ width: 13, height: 13 }} />删除
                      </button>
                    )}
                  </div>

                  {visitFor === p.id && (
                    <div data-testid="workbench-place-visit-form" style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: "var(--radius-sm)" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          aria-label="现场笔记"
                          data-testid="workbench-place-visit-note"
                          placeholder="现场笔记（可选），例如：前台拒收，需预约"
                          value={visitNote}
                          onChange={(e) => setVisitNote(e.target.value)}
                          style={{
                            flex: 2, minWidth: 150, border: "1px solid var(--border-subtle)", outline: "none",
                            borderRadius: "var(--radius-sm)", padding: "8px 11px", background: "var(--surface-card)",
                            fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)",
                          }}
                        />
                        <input
                          aria-label="复访计划"
                          data-testid="workbench-place-visit-plan"
                          placeholder="复访计划（可选），例如：下周一带材料再来"
                          value={visitPlan}
                          onChange={(e) => setVisitPlan(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") submitVisit(); }}
                          style={{
                            flex: 2, minWidth: 150, border: "1px solid var(--border-subtle)", outline: "none",
                            borderRadius: "var(--radius-sm)", padding: "8px 11px", background: "var(--surface-card)",
                            fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)",
                          }}
                        />
                        <Button size="sm" variant="primary" onClick={submitVisit}>保存到访</Button>
                        <button onClick={() => { setVisitFor(null); setVisitNote(""); setVisitPlan(""); }} aria-label="取消记录到访"
                          style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)", padding: "6px 8px" }}>
                          <Icon name="x" style={{ width: 16, height: 16 }} />
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                        保存后到访时间记录为当前时间，地点状态自动变为{visitPlan.trim() ? "「需复访」" : "「已走访」"}。
                      </div>
                    </div>
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
