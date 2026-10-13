// Gorgon Workbench — NotesScreen (Phase 4: 笔记与录音, notes center).
//
// ONE surface for every note in the workbench: project notes, place
// notes, task notes — with global search, kind filter, and a plain-text
// export. The note objects come straight from the opportunities
// repository via the facade (App passes the full list; this screen
// filters).
//
// V2.3 Phase 4 scope (数据层先行):
//   * 全局搜索（text + audioPath，lib/note-view.js）
//   * kind 过滤（全部/文本/录音）
//   * 来源展示（关联任务/地点/项目，点击可达 —— 关联 id 显示）
//   * 导出（plain-text digest，clipboard 写入）
//   * 删除（facade onRemoveNote）
//
// 录音诚实纪律：audio 笔记以指针形状展示（audioPath + 时长）；真机录音
// 入口在 Capacitor 录音插件安装前标 NOT_IMPLEMENTED —— 本屏不渲染一个
// 假的录音按钮。
//
// Data + handlers come in through props (App owns the facade calls),
// mirroring PlacesScreen. Screen never touches localStorage.

import React from "react";
import { Button } from "../lib/ds.js";
import { Icon } from "../components/Icon.jsx";
import { searchNotes, exportNotesText } from "../lib/note-view.js";

const KIND_FILTERS = [
  { key: "all", label: "全部" },
  { key: "text", label: "文本" },
  { key: "audio", label: "录音" },
];

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

function fmtDuration(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return "";
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export function NotesScreen({
  notes, tasks, places, projects,
  onRemoveNote, onOpenTask, flash,
}) {
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState("all");

  const list = React.useMemo(() => {
    let out = notes || [];
    if (kind !== "all") out = out.filter((n) => (n.kind === "audio" ? "audio" : "text") === kind);
    out = searchNotes(out, query);
    return out;
  }, [notes, kind, query]);

  // id -> title lookup for association display
  const taskTitle = React.useMemo(() => {
    const m = {};
    for (const t of tasks || []) m[t.id] = t.title;
    return m;
  }, [tasks]);
  const placeName = React.useMemo(() => {
    const m = {};
    for (const p of places || []) m[p.id] = p.name;
    return m;
  }, [places]);
  const projectTitle = React.useMemo(() => {
    const m = {};
    for (const p of projects || []) m[p.id] = p.title;
    return m;
  }, [projects]);

  const doExport = () => {
    const text = exportNotesText(list);
    try {
      navigator.clipboard.writeText(text).then(
        () => { if (flash) flash(`已复制 ${list.length} 条笔记到剪贴板`); },
        () => { if (flash) flash("复制失败，请手动选择文本"); }
      );
    } catch (e) {
      if (flash) flash("剪贴板不可用");
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-notes">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            笔记
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
              {(notes || []).length} 条 · 本地数据
            </span>
            <button data-testid="workbench-notes-export" onClick={doExport}
              disabled={(notes || []).length === 0}
              style={{
                border: "1px solid var(--border-subtle)", background: "var(--surface-card)",
                color: (notes || []).length === 0 ? "var(--text-faint)" : "var(--text-body)",
                fontSize: 12, fontWeight: 600, cursor: (notes || []).length === 0 ? "default" : "pointer",
                padding: "7px 13px", minHeight: 40, borderRadius: "var(--radius-pill)", fontFamily: "var(--font-sans)",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
              <Icon name="share-2" style={{ width: 13, height: 13 }} />导出
            </button>
          </div>
        </div>

        {/* search + kind filter */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input
            aria-label="搜索笔记"
            data-testid="workbench-notes-search-input"
            placeholder="搜索笔记内容"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1, minWidth: 200, border: "1px solid var(--border-subtle)", outline: "none",
              borderRadius: "var(--radius-md)", padding: "8px 12px", background: "var(--surface-card)",
              fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {KIND_FILTERS.map((f) => {
            const on = f.key === kind;
            return (
              <button key={f.key} data-testid={"workbench-notes-filter-" + f.key} onClick={() => setKind(f.key)}
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
            {(query || kind !== "all")
              ? "没有符合条件的笔记。换个关键词或筛选试试。"
              : "还没有笔记。在项目、地点或任务详情里记一笔，都会汇总到这里。"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="workbench-notes-list">
            {list.map((n) => {
              const isAudio = n.kind === "audio";
              return (
                <div key={n.id} data-testid="workbench-note-item" style={{
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", padding: "12px 16px", minWidth: 0,
                }}>
                  <div style={{ fontSize: 13.5, color: "var(--text-body)", lineHeight: 1.65, whiteSpace: "pre-wrap" }} data-testid="workbench-note-text">
                    {n.text || (isAudio ? `（音频文件：${n.audioPath}）` : "（空笔记）")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{fmtTime(n.createdAt)}</span>
                    <span data-testid="workbench-note-kind" style={{
                      fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-pill)",
                      background: isAudio ? "var(--warning-soft)" : "var(--brand-soft)",
                      color: isAudio ? "#9A6300" : "var(--brand)",
                    }}>
                      {isAudio ? `录音${fmtDuration(n.audioDurationMs) ? ` ${fmtDuration(n.audioDurationMs)}` : ""}` : "文本"}
                    </span>
                    {n.taskId && taskTitle[n.taskId] && (
                      <button data-testid="workbench-note-task-link" onClick={() => onOpenTask && onOpenTask(n.taskId)}
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--brand)", fontSize: 11.5, fontWeight: 600, padding: 0, display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Icon name="list-todo" style={{ width: 11, height: 11 }} />{taskTitle[n.taskId]}
                      </button>
                    )}
                    {n.placeId && placeName[n.placeId] && (
                      <span style={{ fontSize: 11.5, color: "var(--text-faint)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Icon name="map-pin" style={{ width: 11, height: 11 }} />{placeName[n.placeId]}
                      </span>
                    )}
                    {n.projectId && projectTitle[n.projectId] && (
                      <span style={{ fontSize: 11.5, color: "var(--text-faint)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Icon name="folder-kanban" style={{ width: 11, height: 11 }} />{projectTitle[n.projectId]}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    {onRemoveNote && (
                      <button data-testid="workbench-note-remove" onClick={() => { if (window.confirm("删除这条笔记？此操作不可撤销。")) onRemoveNote(n.id); }}
                        aria-label="删除笔记"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--danger)", fontSize: 11.5, fontWeight: 600, padding: "6px", minHeight: 36, display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Icon name="trash-2" style={{ width: 12, height: 12 }} />删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
