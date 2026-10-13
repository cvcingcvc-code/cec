// V3 Phase A (gap 2) — TXT / Markdown note import: pure parser contract.
//
// Pins down:
//   * Extension accept list (.txt / .md / .markdown; case-insensitive).
//   * Single-note default: verbatim text, nothing lost.
//   * Multi-note convention: ONLY with the explicit "### gorgon-notes-v1"
//     marker line; --- / *** separators split blocks.
//   * Rejections: empty / too-large / unsupported-type — never guess.
//   * 防覆盖 contract: parseNoteText is pure (no mutation possible); the
//     facade layer (App.handleImportNotes) appends new records only.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isImportableFileName, parseNoteText, MAX_IMPORT_BYTES, MULTI_NOTE_MARKER,
} from "../src/lib/note-import.js";

test("isImportableFileName: txt/md/markdown, case-insensitive", () => {
  assert.equal(isImportableFileName("a.txt"), true);
  assert.equal(isImportableFileName("A.MD"), true);
  assert.equal(isImportableFileName("b.Markdown"), true);
  assert.equal(isImportableFileName("c.pdf"), false);
  assert.equal(isImportableFileName("d.docx"), false);
  assert.equal(isImportableFileName(""), false);
  assert.equal(isImportableFileName(null), false);
});

test("parseNoteText: single txt file imports verbatim as one note", () => {
  const r = parseNoteText("todo.txt", "买牛奶\n顺便取快递");
  assert.equal(r.ok, true);
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].text, "买牛奶\n顺便取快递");
  assert.equal(r.notes[0].source, "text");
  assert.equal(r.notes[0].fileName, "todo.txt");
});

test("parseNoteText: md file imports as one note with source=markdown", () => {
  const r = parseNoteText("notes.md", "# 标题\n\n正文内容，多行保留。");
  assert.equal(r.ok, true);
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].source, "markdown");
  assert.ok(r.notes[0].text.includes("# 标题"));
  assert.ok(r.notes[0].text.includes("正文内容"));
});

test("parseNoteText: BOM is stripped", () => {
  const r = parseNoteText("bom.txt", "\uFEFF第一行");
  assert.equal(r.ok, true);
  assert.equal(r.notes[0].text, "第一行");
});

test(`parseNoteText: multi-note requires explicit marker ${MULTI_NOTE_MARKER}`, () => {
  const r = parseNoteText("batch.txt", `### gorgon-notes-v1\n第一条\n---\n第二条\n***\n第三条`);
  assert.equal(r.ok, true);
  assert.equal(r.notes.length, 3);
  assert.deepEqual(r.notes.map((n) => n.text), ["第一条", "第二条", "第三条"]);
});

test("parseNoteText: --- in a plain file does NOT split (no marker)", () => {
  const r = parseNoteText("plain.txt", "第一段\n---\n第二段");
  assert.equal(r.ok, true);
  assert.equal(r.notes.length, 1);
});

test("parseNoteText: multi-note with empty blocks skips empties", () => {
  const r = parseNoteText("batch.txt", `### gorgon-notes-v1\n有内容\n---\n\n\n---\n还有内容`);
  assert.equal(r.ok, true);
  assert.equal(r.notes.length, 2);
});

test("parseNoteText: marker-only file rejected as empty", () => {
  const r = parseNoteText("batch.txt", `### gorgon-notes-v1\n---\n---`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty");
});

test("parseNoteText: rejections — empty / unsupported / too-large", () => {
  assert.deepEqual(parseNoteText("a.txt", ""), { ok: false, reason: "empty" });
  assert.deepEqual(parseNoteText("a.txt", "   \n  "), { ok: false, reason: "empty" });
  assert.deepEqual(parseNoteText("a.pdf", "内容"), { ok: false, reason: "unsupported-type" });
  assert.deepEqual(parseNoteText("a.txt", "x".repeat(MAX_IMPORT_BYTES + 1)), { ok: false, reason: "too-large" });
});

test("parseNoteText: never throws on weird input", () => {
  assert.equal(parseNoteText(null, null).ok, false);
  assert.equal(parseNoteText(undefined, undefined).ok, false);
  assert.equal(parseNoteText("a.txt", null).ok, false);
});

test("MAX_IMPORT_BYTES: 2MB boundary", () => {
  assert.equal(MAX_IMPORT_BYTES, 2 * 1024 * 1024);
});
