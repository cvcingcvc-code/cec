// Gorgon Workbench — note-view.js (Phase 4: 笔记与录音纯视图助手).
//
// Pure functions only — no store, no React, no persistence. Mirrors the
// style of lib/place-view.js. The audio recording itself never lives in
// the note envelope — only the pointer (audioPath) + duration.

/**
 * Case-insensitive substring search over text + audioPath.
 * Empty/whitespace query returns the list unchanged (no filter).
 * Null/undefined list returns [].
 */
export function searchNotes(notes, query) {
  if (!Array.isArray(notes)) return [];
  const q = String(query == null ? "" : query).trim().toLowerCase();
  if (!q) return notes.slice();
  return notes.filter((n) => {
    if (!n) return false;
    const text = String(n.text || "").toLowerCase();
    const audioPath = String(n.audioPath || "").toLowerCase();
    return text.includes(q) || audioPath.includes(q);
  });
}

function pad2(n) { return String(n).padStart(2, "0"); }

function fmtCN(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "时间未知";
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch (e) { return "时间未知"; }
}

function fmtDuration(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return "";
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

/**
 * Render a readable plain-text digest (oldest first — reading order).
 * Used by the export action (clipboard / file share); no external deps.
 */
export function exportNotesText(notes, { title = "Gorgon Workbench 笔记导出" } = {}) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return `${title}\n\n（没有笔记）\n`;
  }
  const sorted = notes.slice().sort((a, b) => {
    const ta = new Date(a && a.createdAt ? a.createdAt : 0).getTime() || 0;
    const tb = new Date(b && b.createdAt ? b.createdAt : 0).getTime() || 0;
    return ta - tb;
  });
  const lines = [title, `共 ${sorted.length} 条`, ""];
  sorted.forEach((n, i) => {
    const kind = n && n.kind === "audio" ? "录音" : "文本";
    const dur = n && n.kind === "audio" ? fmtDuration(n.audioDurationMs) : "";
    const body = n && n.text ? String(n.text) : (n && n.audioPath ? `（音频文件：${n.audioPath}）` : "（空笔记）");
    lines.push(`[${i + 1}] ${fmtCN(n && n.createdAt)} · ${kind}${dur ? ` · ${dur}` : ""}`);
    lines.push(body);
    lines.push("");
  });
  return lines.join("\n");
}
