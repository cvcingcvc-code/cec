// Gorgon Workbench — V3 Phase A (gap 2): TXT / Markdown note import.
//
// PURE MODULE: parses raw .txt / .md file content into note objects the
// opportunity-repository can store. No DOM file pickers here — the UI
// (NotesScreen) owns the <input type="file"> / Capacitor Filesystem call
// and passes decoded UTF-8 text to importNoteText().
//
// 防覆盖纪律 (charter: "防止导入文件覆盖已有数据"):
//   * Import NEVER overwrites existing notes. Every import call creates
//     NEW note records (append-only); existing data is untouched.
//   * The UI is responsible for calling the repository addNote per record;
//     this module only converts text -> records.
//
// 格式约定:
//   * A .md file imports as ONE note (whole document, first heading line
//     becomes the note's first line — we keep the raw text verbatim so
//     nothing is lost).
//   * A .txt file may contain a "===" separator convention: lines between
//     blank-line-delimited blocks become separate notes ONLY when the file
//     starts with an explicit "### gorgon-notes-v1" marker line. Plain
//     files import as one note. This keeps ambiguity at zero.
//
// Contents:
//   * isImportableFileName(name) — .txt / .md / .markdown accept list
//   * parseNoteText(fileName, rawText) -> [{ text, source }] | null
//     (null = rejected: empty content, oversized, unknown extension)
//   * MAX_IMPORT_BYTES — data boundary (2 MB per file)

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2 MB per file
export const MULTI_NOTE_MARKER = "### gorgon-notes-v1";

const IMPORTABLE_EXT = [".txt", ".md", ".markdown"];

export function isImportableFileName(name) {
  const n = String(name || "").toLowerCase();
  return IMPORTABLE_EXT.some((ext) => n.endsWith(ext));
}

function fileExt(name) {
  const n = String(name || "").toLowerCase();
  for (const ext of IMPORTABLE_EXT) {
    if (n.endsWith(ext)) return ext;
  }
  return "";
}

/** First non-empty line, trimmed to a reasonable first-line length. */
function firstLine(text) {
  const idx = text.indexOf("\n");
  const head = (idx >= 0 ? text.slice(0, idx) : text).trim();
  return head;
}

/**
 * Parse raw file text into note records.
 * Returns { ok: true, notes: [{ text, source, fileName }] } or
 *         { ok: false, reason: "empty" | "too-large" | "unsupported-type" }.
 * Never throws. Never mutates anything.
 */
export function parseNoteText(fileName, rawText, opts = {}) {
  const name = String(fileName || "");
  if (!isImportableFileName(name)) {
    return { ok: false, reason: "unsupported-type" };
  }
  const text = String(rawText == null ? "" : rawText);
  // Byte-length guard (UTF-8). String.length counts UTF-16 units, close
  // enough for a boundary check; the exact byte count is enforced by the
  // file reader before decode when available.
  if (text.length === 0 || !text.trim()) {
    return { ok: false, reason: "empty" };
  }
  const maxChars = opts.maxChars || MAX_IMPORT_BYTES;
  if (text.length > maxChars) {
    return { ok: false, reason: "too-large" };
  }

  const ext = fileExt(name);
  const source = ext === ".md" || ext === ".markdown" ? "markdown" : "text";

  // Multi-note convention: ONLY when the explicit marker line is present.
  const trimmedHead = text.replace(/^\uFEFF/, ""); // strip BOM
  const lines = trimmedHead.split(/\r?\n/);
  if (lines[0] && lines[0].trim() === MULTI_NOTE_MARKER) {
    // Split on "---" separator lines (a line that is exactly --- or ***).
    const blocks = [];
    let cur = [];
    for (let i = 1; i < lines.length; i += 1) { // skip the marker line
      const l = lines[i];
      if (/^(---+|\*\*\*+)$/.test(l.trim())) {
        blocks.push(cur);
        cur = [];
      } else {
        cur.push(l);
      }
    }
    blocks.push(cur);
    const notes = blocks
      .map((b) => b.join("\n").trim())
      .filter((b) => b.length > 0)
      .map((b) => ({ text: b, source, fileName: name }));
    if (notes.length === 0) {
      return { ok: false, reason: "empty" };
    }
    return { ok: true, notes };
  }

  // Default: one note per file, verbatim (first line = note text head).
  const body = trimmedHead.trim();
  const head = firstLine(body) || name;
  return {
    ok: true,
    notes: [{ text: body, source, fileName: name, title: head.slice(0, 40) }],
  };
}
