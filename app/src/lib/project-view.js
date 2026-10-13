// Gorgon Workbench — project-view.js (Phase 6: 项目统一纯视图助手).
//
// Pure functions only — no store, no React, no persistence. Mirrors the
// style of lib/place-view.js and lib/note-view.js.

/**
 * Task completion percentage for a project.
 * Returns 0-100, or null when there are no tasks (an honest "no signal"
 * beats a fake 0%).
 */
export function projectProgressPercent(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const done = tasks.filter((t) => t && t.status === "completed").length;
  return Math.round((done / tasks.length) * 100);
}

function pad2(n) { return String(n).padStart(2, "0"); }

function fmtAt(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch (e) { return ""; }
}

/**
 * Merge every module's records into ONE timeline for a project:
 *   * task timeline events (status changes, priority, schedule, links…)
 *   * progress entries (project-side + task-side, already user-written)
 *   * notes (project-linked)
 *
 * input: { tasks, progress, notes, taskById }
 *   tasks     — tasks belonging to the project (already filtered)
 *   progress  — progress entries (project + task side, already filtered)
 *   notes     — notes linked to the project
 *   taskById  — (id) => task, to resolve task-side progress subjects
 *
 * Returns [{ at, source, label, text }], newest first. source is
 * "task" | "progress" | "note"; label is a human-readable tag.
 */
export function projectTimeline(input) {
  if (!input || typeof input !== "object") return [];
  const { tasks, progress, notes, taskById } = input;
  const taskIds = new Set((Array.isArray(tasks) ? tasks : []).map((t) => t.id));
  const taskTitle = (id) => {
    const t = typeof taskById === "function" ? taskById(id) : null;
    return (t && t.title) || null;
  };

  const out = [];

  // 1. task timeline events (field is `timestamp`, not `at`)
  for (const t of Array.isArray(tasks) ? tasks : []) {
    for (const ev of Array.isArray(t.timeline) ? t.timeline : []) {
      const at = ev && (ev.timestamp || ev.at);
      if (!ev || !at) continue;
      out.push({
        at: String(at),
        source: "task",
        label: ev.message || "任务事件",
        text: null,
        taskId: t.id,
        type: ev.type || null,
      });
    }
  }

  // 2. progress entries
  for (const e of Array.isArray(progress) ? progress : []) {
    if (!e || !e.createdAt) continue;
    let label = e.text || "";
    if (e.subjectType === "task") {
      const title = taskTitle(e.subjectId);
      if (title) label = `【${title}】${label}`;
    }
    out.push({
      at: String(e.createdAt),
      source: "progress",
      label,
      text: null,
      kind: e.kind || null,
    });
  }

  // 3. notes
  for (const n of Array.isArray(notes) ? notes : []) {
    if (!n || !n.createdAt) continue;
    out.push({
      at: String(n.createdAt),
      source: "note",
      label: n.text || "",
      text: null,
      noteId: n.id,
    });
  }

  // newest first; stable for equal timestamps
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Human-readable source tag for the merged timeline. */
export function timelineSourceLabel(source) {
  return { task: "任务", progress: "进度", note: "笔记" }[source] || source;
}

/** Render a timeline entry's at field as "M月D日 HH:MM". */
export function timelineAtLabel(iso) {
  return fmtAt(iso);
}
