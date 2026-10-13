// Gorgon Workbench — PlacesScreen (Module D: field-visit places, V2.3 Phase 3).
//
// Closes the V2-audit P1 gap: the repository (opportunity-repository.js)
// has owned places + visits + the status vocabulary since the first
// opportunity iteration, but no screen consumed it. This screen is the UI
// half of the field-visit loop:
//
//   新建地点 -> 状态流转（待走访/已走访/需复访/不适合）-> 记录到访
//
// V2.3 Phase 3 additions (地点管理):
//   * 文本搜索（name/address 大小写不敏感，lib/place-view.js）
//   * 重复地点提示（同名地点在新建时警告，创建仍是用户的选择）
//   * 地点编辑（名称/地址 upsert 更新路径）
//   * 访问历史展开（visits 全量，倒序）
//   * 地点笔记（addNote placeId 关联 + 笔记列表展示）
//   * 关联任务展示（task.placeId 反查）
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
import { searchPlaces, duplicatePlaceName } from "../lib/place-view.js";

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

const inputStyle = {
  border: "1px solid var(--border-subtle)", outline: "none",
  borderRadius: "var(--radius-md)", padding: "11px 14px", background: "var(--surface-card)",
  fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-strong)",
};

const chipBtnStyle = {
  border: "1px solid var(--border-subtle)", background: "transparent",
  color: "var(--text-body)", fontSize: 12, fontWeight: 600, cursor: "pointer",
  padding: "10px 12px", minHeight: 44, borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)",
  display: "inline-flex", alignItems: "center", gap: 4,
};

export function PlacesScreen({
  places, projects, tasks, notes,
  onCreate, onStatus, onVisit, onRemove, onEditPlace, onAddPlaceNote, onRemovePlaceNote,
}) {
  const [filter, setFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const [visitFor, setVisitFor] = React.useState(null); // place id being logged
  const [visitNote, setVisitNote] = React.useState("");
  const [visitPlan, setVisitPlan] = React.useState("");
  // Phase 3: edit + history + notes local state
  const [editingId, setEditingId] = React.useState(null);
  const [editName, setEditName] = React.useState("");
  const [editAddress, setEditAddress] = React.useState("");
  const [historyFor, setHistoryFor] = React.useState(null);
  const [notesFor, setNotesFor] = React.useState(null);
  const [noteDraft, setNoteDraft] = React.useState("");

  const list = React.useMemo(() => {
    let out = filter === "all" ? places : places.filter((p) => p.status === filter);
    out = searchPlaces(out, query);
    return out;
  }, [places, filter, query]);

  // Phase 3: 反查每个地点关联的任务（task.placeId）
  const tasksByPlace = React.useMemo(() => {
    const map = {};
    for (const t of tasks || []) {
      if (!t.placeId) continue;
      (map[t.placeId] = map[t.placeId] || []).push(t);
    }
    return map;
  }, [tasks]);

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

  const submitEdit = () => {
    if (!editingId) return;
    const n = editName.trim();
    if (!n) return;
    onEditPlace(editingId, { name: n, address: editAddress.trim() });
    setEditingId(null); setEditName(""); setEditAddress("");
  };

  const submitPlaceNote = () => {
    if (!notesFor) return;
    const text = noteDraft.trim();
    if (!text) return;
    onAddPlaceNote(notesFor, text);
    setNoteDraft("");
  };

  // duplicate hint: same-name place exists (excluding the one being edited)
  const newPlaceDupId = duplicatePlaceName(places, name, editingId);
  const editDupId = editingId
    ? duplicatePlaceName(places, editName, editingId)
    : null;

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
            style={{ ...inputStyle, flex: 2, minWidth: 160 }}
          />
          <input
            aria-label="地点地址"
            data-testid="workbench-place-new-form-address"
            placeholder="地址（可选）"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{ ...inputStyle, flex: 3, minWidth: 160 }}
          />
          <Button variant="primary" onClick={submit} disabled={!name.trim()}
            leadingIcon={<Icon name="plus" style={{ width: 15, height: 15 }} />}>
            添加
          </Button>
        </div>
        {newPlaceDupId && (
          <div data-testid="workbench-place-duplicate-hint" role="status"
            style={{ fontSize: 12, color: "#9A6300", marginBottom: 10, display: "flex", alignItems: "center", gap: 5 }}>
            <Icon name="alert-triangle" style={{ width: 13, height: 13 }} />
            已有同名地点「{(places.find((p) => p.id === newPlaceDupId) || {}).name || ""}」，确认是否重复录入。
          </div>
        )}
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

        {/* search + status filter */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input
            aria-label="搜索地点"
            data-testid="workbench-place-search-input"
            placeholder="搜索地点名称或地址"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 200, padding: "8px 12px", fontSize: 13 }}
          />
        </div>
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
                  padding: "7px 13px", minHeight: 40, borderRadius: "var(--radius-pill)", cursor: "pointer", touchAction: "manipulation",
                }}>
                {f.label}
              </button>
            );
          })}
        </div>

        {list.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "30px 0", lineHeight: 1.7 }}>
            {(query || filter !== "all")
              ? "没有符合条件的地点。换个关键词或筛选试试。"
              : "还没有走访地点。添加一个，把地推走访的计划与结果记在一起。"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="workbench-place-list">
            {list.map((p) => {
              const tone = STATUS_TONE[p.status] || STATUS_TONE.todo;
              const placeVisits = p.visits || [];
              const placeNotes = (notes || []).filter((n) => n.placeId === p.id);
              const placeTasks = tasksByPlace[p.id] || [];
              const isEditing = editingId === p.id;
              return (
                <div key={p.id} data-testid="workbench-place-item" style={{
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", padding: "13px 16px", minWidth: 0,
                }}>
                  {isEditing ? (
                    /* ── edit form ── */
                    <div data-testid="workbench-place-edit-form">
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          aria-label="编辑地点名称"
                          data-testid="workbench-place-edit-name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={{ ...inputStyle, flex: 2, minWidth: 160 }}
                        />
                        <input
                          aria-label="编辑地点地址"
                          data-testid="workbench-place-edit-address"
                          value={editAddress}
                          onChange={(e) => setEditAddress(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") submitEdit(); }}
                          style={{ ...inputStyle, flex: 3, minWidth: 160 }}
                        />
                        <Button size="sm" variant="primary" onClick={submitEdit} disabled={!editName.trim()}>保存</Button>
                        <button onClick={() => { setEditingId(null); setEditName(""); setEditAddress(""); }}
                          aria-label="取消编辑"
                          style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)", padding: "10px 10px", minHeight: 44 }}>
                          <Icon name="x" style={{ width: 16, height: 16 }} />
                        </button>
                      </div>
                      {editDupId && (
                        <div data-testid="workbench-place-edit-duplicate-hint" role="status"
                          style={{ fontSize: 12, color: "#9A6300", marginTop: 8 }}>
                          <Icon name="alert-triangle" style={{ width: 13, height: 13 }} />
                          {" "}已有同名地点，保存前请确认。
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ── display mode ── */
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <Icon name="map-pin" style={{ width: 16, height: 16, color: "var(--brand)", flex: "none" }} />
                        <span style={{ minWidth: 0, flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name}
                        </span>
                        <span data-testid="workbench-place-status" style={{
                          flex: "none", fontSize: 11.5, fontWeight: 700, padding: "4px 10px",
                          borderRadius: "var(--radius-pill)", background: tone.bg, color: tone.color,
                        }}>
                          {PLACE_LABEL[p.status] || "状态未知"}
                        </span>
                      </div>
                      {p.address && (
                        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>
                          {p.address}
                        </div>
                      )}
                      {p.projectId && (projects || []).find((pr) => pr.id === p.projectId) && (
                        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                          <Icon name="folder-kanban" style={{ width: 12, height: 12 }} />
                          项目：{(projects.find((pr) => pr.id === p.projectId) || {}).title}
                        </div>
                      )}
                      {placeTasks.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--text-body)", marginTop: 4, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          <Icon name="list-todo" style={{ width: 12, height: 12, color: "var(--brand)" }} />
                          关联任务：
                          {placeTasks.map((t, i) => (
                            <span key={t.id} style={{ color: "var(--text-body)" }}>
                              {i > 0 && "、"}{t.title}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.nextPlan && (
                        <div style={{ fontSize: 12, color: "var(--text-body)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                          <Icon name="calendar-clock" style={{ width: 12, height: 12, color: "var(--brand)" }} />
                          复访计划：{p.nextPlan}
                        </div>
                      )}
                      {placeVisits.length > 0 && (
                        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>
                          最近到访 {fmtTime(placeVisits[placeVisits.length - 1].at)}{placeVisits[placeVisits.length - 1].note ? ` · ${placeVisits[placeVisits.length - 1].note}` : ""}
                          {placeVisits.length > 1 && ` · 共 ${placeVisits.length} 次`}
                        </div>
                      )}

                      {/* ── action row ── */}
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {p.status !== "visited" && (
                          <button data-testid="workbench-place-visit" onClick={() => { setVisitFor(visitFor === p.id ? null : p.id); setVisitNote(""); setVisitPlan(""); }}
                            style={chipBtnStyle}>
                            <Icon name="check" style={{ width: 13, height: 13 }} />记录到访
                          </button>
                        )}
                        {p.status === "todo" && (
                          <button data-testid="workbench-place-skip" onClick={() => onStatus(p.id, "unsuitable")}
                            style={{ ...chipBtnStyle, color: "var(--text-faint)" }}>
                            标记不适合
                          </button>
                        )}
                        {p.status === "visited" && (
                          <button data-testid="workbench-place-revisit" onClick={() => onStatus(p.id, "revisit")}
                            style={chipBtnStyle}>
                            需复访
                          </button>
                        )}
                        <button data-testid="workbench-place-edit" onClick={() => { setEditingId(isEditing ? null : p.id); setEditName(p.name); setEditAddress(p.address || ""); }}
                          style={{ ...chipBtnStyle, color: "var(--text-faint)" }}>
                          <Icon name="pencil" style={{ width: 13, height: 13 }} />编辑
                        </button>
                        <button data-testid="workbench-place-history" onClick={() => setHistoryFor(historyFor === p.id ? null : p.id)}
                          disabled={placeVisits.length === 0}
                          style={{ ...chipBtnStyle, color: placeVisits.length === 0 ? "var(--text-faint)" : "var(--text-body)", opacity: placeVisits.length === 0 ? 0.5 : 1 }}>
                          <Icon name="clock" style={{ width: 13, height: 13 }} />到访历史{placeVisits.length > 0 ? `（${placeVisits.length}）` : ""}
                        </button>
                        <button data-testid="workbench-place-notes" onClick={() => { setNotesFor(notesFor === p.id ? null : p.id); setNoteDraft(""); }}
                          style={{ ...chipBtnStyle, color: placeNotes.length > 0 ? "var(--brand)" : "var(--text-faint)" }}>
                          <Icon name="notebook-pen" style={{ width: 13, height: 13 }} />笔记{placeNotes.length > 0 ? `（${placeNotes.length}）` : ""}
                        </button>
                        <span style={{ flex: 1 }} />
                        {onRemove && (
                          <button data-testid="workbench-place-remove" onClick={() => { if (window.confirm(`删除地点「${p.name}」？此操作不可撤销。`)) onRemove(p.id); }}
                            aria-label={"删除地点：" + p.name}
                            style={{
                              border: "none", background: "transparent", color: "var(--danger)",
                              fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "10px 10px", minHeight: 44,
                              display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-sans)",
                            }}>
                            <Icon name="trash-2" style={{ width: 13, height: 13 }} />删除
                          </button>
                        )}
                      </div>

                      {/* ── visit form ── */}
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
                              style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)", padding: "10px 10px", minHeight: 44 }}>
                              <Icon name="x" style={{ width: 16, height: 16 }} />
                            </button>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                            保存后到访时间记录为当前时间，地点状态自动变为{visitPlan.trim() ? "「需复访」" : "「已走访」"}。
                          </div>
                        </div>
                      )}

                      {/* ── visit history (expanded, newest first) ── */}
                      {historyFor === p.id && placeVisits.length > 0 && (
                        <div data-testid="workbench-place-history-list" style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: "var(--radius-sm)" }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-body)", marginBottom: 6 }}>
                            到访历史（{placeVisits.length} 次，最新在前）
                          </div>
                          {placeVisits.slice().reverse().map((v, i) => (
                            <div key={i} data-testid="workbench-place-history-entry" style={{
                              fontSize: 12, color: "var(--text-body)", padding: "5px 0",
                              borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none", lineHeight: 1.6,
                            }}>
                              <span style={{ color: "var(--text-faint)" }}>{fmtTime(v.at)}</span>
                              {v.note ? ` · ${v.note}` : ""}
                              {v.nextPlan ? <span style={{ color: "var(--brand)" }}> · 复访：{v.nextPlan}</span> : null}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── place notes ── */}
                      {notesFor === p.id && (
                        <div data-testid="workbench-place-notes-panel" style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: "var(--radius-sm)" }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: placeNotes.length > 0 ? 8 : 0 }}>
                            <input
                              aria-label="新地点笔记"
                              data-testid="workbench-place-note-input"
                              placeholder="记录这个地点的信息，例如：保安换班时间 12:00"
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") submitPlaceNote(); }}
                              style={{
                                flex: 1, minWidth: 180, border: "1px solid var(--border-subtle)", outline: "none",
                                borderRadius: "var(--radius-sm)", padding: "8px 11px", background: "var(--surface-card)",
                                fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)",
                              }}
                            />
                            <Button size="sm" variant="primary" onClick={submitPlaceNote} disabled={!noteDraft.trim()}>添加笔记</Button>
                          </div>
                          {placeNotes.map((n) => (
                            <div key={n.id} data-testid="workbench-place-note-item" style={{
                              display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0",
                              borderTop: "1px solid var(--border-subtle)", fontSize: 12.5, color: "var(--text-body)", lineHeight: 1.6,
                            }}>
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{fmtTime(n.createdAt)}</span>
                                <br />
                                {n.text}
                              </span>
                              {onRemovePlaceNote && (
                                <button data-testid="workbench-place-note-remove" onClick={() => onRemovePlaceNote(n.id)}
                                  aria-label="删除笔记"
                                  style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)", padding: "4px", minHeight: 32 }}>
                                  <Icon name="trash-2" style={{ width: 13, height: 13 }} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
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
