// V3E 任务包 C — 地点/笔记删除对齐任务包 A 的软删除语义。
//
// 缺口：PlacesScreen/NotesScreen 的删除原来是 window.confirm 一键硬删
// （"此操作不可撤销"），与任务包 A 建立的任务软删除 + 回收站模式不一致。
// 本文件锁定对齐后的语义：
//   * removePlace/removeNote → 软删除（deletedAt 标记，30 天窗口内可恢复）
//   * restorePlace/restoreNote → 清除标记，数据完整保留
//   * removePlaceForever/removeNoteForever → 显式硬删除（向后兼容）
//   * purgeExpiredDeletedPlaces/Notes → 仅清理超窗记录
//   * 软删除记录对 listPlaces/listNotes/getPlace 隐藏（回收站语义）
//
// localStorage is unavailable in plain Node — the repository degrades to its
// in-memory fallback (same path as a private-mode browser session). Tests
// self-clean via removePlaceForever/removeNoteForever.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as WB from "../src/store/workbench-store.js";
import * as Opp from "../src/store/opportunity-repository.js";

/* ── places: soft delete / restore ─────────────────────────────────── */

test("v3e C: removePlace soft-deletes (deletedAt set, lists hide, getPlace null, repeat false)", () => {
  const p = Opp.upsertPlace({ name: "软删除地点", address: "某路 1 号" });
  assert.ok(p && p.id);
  assert.ok(!p.deletedAt, "fresh place has no deletedAt");

  assert.equal(Opp.removePlace(p.id), true, "first delete succeeds");
  assert.equal(Opp.listPlaces().some((x) => x.id === p.id), false, "deleted place hidden from listPlaces");
  assert.equal(Opp.getPlace(p.id), null, "getPlace returns null for soft-deleted place");
  assert.equal(Opp.removePlace(p.id), false, "repeat delete is a no-op (false)");

  const deleted = Opp.getDeletedPlaces();
  const hit = deleted.find((x) => x.id === p.id);
  assert.ok(hit, "soft-deleted place is in the trash list");
  assert.ok(typeof hit.deletedAt === "string" && hit.deletedAt, "deletedAt is an ISO string");
  assert.equal(hit.name, "软删除地点", "record data kept");
  assert.equal(hit.deletedAt, Opp.getDeletedPlaces().find((x) => x.id === p.id).deletedAt, "timestamp stable");
  // cleanup
  Opp.removePlaceForever(p.id);
});

test("v3e C: restorePlace brings the place back with visit data intact", () => {
  const p = Opp.upsertPlace({ name: "待恢复地点", address: "恢复路 2 号", projectId: "proj-c" });
  Opp.addVisit(p.id, { note: "店长有兴趣", nextPlan: "下周三带资料再来" });
  const before = Opp.getPlace(p.id);
  assert.equal(before.status, Opp.PLACE_STATUS.REVISIT);
  assert.equal(before.visits.length, 1);

  assert.equal(Opp.removePlace(p.id), true);
  assert.equal(Opp.getPlace(p.id), null);

  const restored = Opp.restorePlace(p.id);
  assert.ok(restored, "restorePlace returns the restored record");
  assert.ok(!restored.deletedAt, "deletedAt cleared after restore");
  assert.equal(Opp.listPlaces().some((x) => x.id === p.id), true, "place visible again");
  assert.equal(restored.name, "待恢复地点", "name kept");
  assert.equal(restored.address, "恢复路 2 号", "address kept");
  assert.equal(restored.projectId, "proj-c", "project link kept");
  assert.equal(restored.status, Opp.PLACE_STATUS.REVISIT, "status kept");
  assert.equal(restored.visits.length, 1, "visits kept");
  assert.equal(restored.visits[0].note, "店长有兴趣", "visit note kept");
  assert.equal(restored.nextPlan, "下周三带资料再来", "nextPlan kept");

  // restore on a live place and on a missing id are safe no-ops
  assert.equal(Opp.restorePlace(p.id), null, "restore on a live place is a no-op");
  assert.equal(Opp.restorePlace("v3e-missing-place"), null, "restore on a missing place is a no-op");
  // cleanup
  Opp.removePlaceForever(p.id);
});

test("v3e C: addVisit on a soft-deleted place is a safe no-op", () => {
  const p = Opp.upsertPlace({ name: "已删地点访问测试" });
  assert.equal(Opp.removePlace(p.id), true);
  assert.equal(Opp.addVisit(p.id, { note: "不应生效" }), null, "addVisit on a soft-deleted place returns null");
  const deleted = Opp.getDeletedPlaces().find((x) => x.id === p.id);
  assert.equal(deleted.visits.length, 0, "no visit was appended to the deleted record");
  // cleanup
  Opp.removePlaceForever(p.id);
});

test("v3e C: removePlaceForever hard-deletes (gone from the trash list too)", () => {
  const p = Opp.upsertPlace({ name: "彻底删除地点" });
  assert.equal(Opp.removePlace(p.id), true);
  assert.ok(Opp.getDeletedPlaces().some((x) => x.id === p.id), "in trash first");
  assert.equal(Opp.removePlaceForever(p.id), true);
  assert.equal(Opp.getDeletedPlaces().some((x) => x.id === p.id), false, "gone from trash");
  assert.equal(Opp.getPlace(p.id), null, "gone for good");
  assert.equal(Opp.removePlaceForever(p.id), false, "second forever-delete is a no-op");
});

test("v3e C: purgeExpiredDeletedPlaces drops only past-window records", () => {
  const a = Opp.upsertPlace({ name: "窗口内地点" });
  const b = Opp.upsertPlace({ name: "窗口外地点" });
  Opp.removePlace(a.id);
  Opp.removePlace(b.id);
  // Both were deleted just now — inside the 30-day window, nothing dropped.
  const r1 = Opp.purgeExpiredDeletedPlaces(new Date().toISOString());
  assert.equal(r1.dropped, 0, "in-window records kept");
  assert.ok(Opp.getDeletedPlaces().some((x) => x.id === a.id));
  assert.ok(Opp.getDeletedPlaces().some((x) => x.id === b.id));
  // A cutoff far in the future drops everything deleted before it.
  const r2 = Opp.purgeExpiredDeletedPlaces(new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString());
  assert.equal(r2.dropped, 2, "records older than the cutoff are dropped");
  assert.equal(Opp.getDeletedPlaces().length, 0, "trash emptied by future cutoff");
  assert.equal(Opp.getPlace(a.id), null, "expired records are hard-removed");
  assert.equal(Opp.getPlace(b.id), null, "expired records are hard-removed");
});

/* ── notes: soft delete / restore ──────────────────────────────────── */

test("v3e C: removeNote soft-deletes (lists hide, repeat false, trash lists it)", () => {
  const n = Opp.addNote({ kind: "text", text: "软删除笔记", placeId: "p-c1" });
  assert.ok(n && n.id);
  assert.ok(!n.deletedAt, "fresh note has no deletedAt");

  assert.equal(Opp.removeNote(n.id), true, "first delete succeeds");
  assert.equal(Opp.listNotes().some((x) => x.id === n.id), false, "deleted note hidden from listNotes");
  assert.equal(Opp.listNotes({ placeId: "p-c1" }).length, 0, "deleted note hidden from filtered listNotes");
  assert.equal(Opp.removeNote(n.id), false, "repeat delete is a no-op (false)");

  const hit = Opp.getDeletedNotes().find((x) => x.id === n.id);
  assert.ok(hit, "soft-deleted note is in the trash list");
  assert.ok(typeof hit.deletedAt === "string" && hit.deletedAt, "deletedAt is an ISO string");
  // cleanup
  Opp.removeNoteForever(n.id);
});

test("v3e C: restoreNote brings the note back with content and associations intact", () => {
  const n = Opp.addNote({ kind: "text", text: "待恢复笔记", placeId: "p-c2", taskId: "t-c2", projectId: "proj-c2" });
  assert.equal(Opp.removeNote(n.id), true);
  assert.equal(Opp.getDeletedNotes().some((x) => x.id === n.id), true);

  const restored = Opp.restoreNote(n.id);
  assert.ok(restored, "restoreNote returns the restored record");
  assert.ok(!restored.deletedAt, "deletedAt cleared after restore");
  assert.equal(Opp.listNotes().some((x) => x.id === n.id), true, "note visible again");
  assert.equal(restored.text, "待恢复笔记", "text kept");
  assert.equal(restored.kind, "text", "kind kept");
  assert.equal(restored.placeId, "p-c2", "place link kept");
  assert.equal(restored.taskId, "t-c2", "task link kept");
  assert.equal(restored.projectId, "proj-c2", "project link kept");

  assert.equal(Opp.restoreNote(n.id), null, "restore on a live note is a no-op");
  assert.equal(Opp.restoreNote("v3e-missing-note"), null, "restore on a missing note is a no-op");
  // cleanup
  Opp.removeNoteForever(n.id);
});

test("v3e C: removeNoteForever hard-deletes; purgeExpiredDeletedNotes drops only past-window", () => {
  const a = Opp.addNote({ kind: "text", text: "窗口内笔记" });
  const b = Opp.addNote({ kind: "text", text: "窗口外笔记" });
  Opp.removeNote(a.id);
  Opp.removeNote(b.id);
  const r1 = Opp.purgeExpiredDeletedNotes(new Date().toISOString());
  assert.equal(r1.dropped, 0, "in-window notes kept");
  assert.ok(Opp.getDeletedNotes().some((x) => x.id === a.id));
  const r2 = Opp.purgeExpiredDeletedNotes(new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString());
  assert.ok(r2.dropped >= 2, "records older than the cutoff are dropped");
  assert.equal(Opp.getDeletedNotes().some((x) => x.id === a.id), false, "a purged");
  assert.equal(Opp.getDeletedNotes().some((x) => x.id === b.id), false, "b purged");
  // forever-delete on a live note also works (explicit hard delete)
  const c = Opp.addNote({ kind: "text", text: "直接硬删除" });
  assert.equal(Opp.removeNoteForever(c.id), true);
  assert.equal(Opp.getDeletedNotes().some((x) => x.id === c.id), false, "never entered trash");
  assert.equal(Opp.removeNoteForever(c.id), false, "second forever-delete is a no-op");
});

/* ── facade: log trail + passthrough ───────────────────────────────── */

test("v3e C: facade logs place_remove once and place_restore on restore", () => {
  const p = WB.upsertPlace({ name: "日志验证地点" });
  assert.equal(WB.removePlace(p.id), true);
  assert.ok(WB.getLog().some((e) => e.type === "place_remove" && e.text.includes("日志验证地点")), "place_remove logged");
  const removeCount = WB.getLog().filter((e) => e.type === "place_remove" && e.text.includes("日志验证地点")).length;
  WB.removePlace(p.id); // repeat — no duplicate log
  assert.equal(WB.getLog().filter((e) => e.type === "place_remove" && e.text.includes("日志验证地点")).length, removeCount, "no duplicate place_remove log");
  assert.equal(WB.getPlace(p.id), null, "facade getPlace hides soft-deleted");

  const restored = WB.restorePlace(p.id);
  assert.ok(restored, "facade restorePlace returns the record");
  assert.ok(WB.getLog().some((e) => e.type === "place_restore"), "place_restore logged");
  assert.ok(WB.getPlaces().some((x) => x.id === p.id), "facade getPlaces shows it again");
  // cleanup
  WB.removePlaceForever(p.id);
});

test("v3e C: facade restoreNote logs note_restore; getDeletedNotes passthrough", () => {
  const n = WB.addNote({ kind: "text", text: "日志验证笔记" });
  assert.equal(WB.removeNote(n.id), true);
  assert.ok(!WB.getNotes({}).some((x) => x.id === n.id), "facade getNotes hides soft-deleted");
  assert.ok(WB.getDeletedNotes().some((x) => x.id === n.id), "facade trash lists it");

  const restored = WB.restoreNote(n.id);
  assert.ok(restored, "facade restoreNote returns the record");
  assert.ok(WB.getLog().some((e) => e.type === "note_restore"), "note_restore logged");
  assert.ok(WB.getNotes({}).some((x) => x.id === n.id), "facade getNotes shows it again");
  // cleanup
  WB.removeNoteForever(n.id);
});

/* ── compatibility: v23 G-6 "removes exactly one" still holds ──────── */

test("v3e C: v23 G-6 semantics hold — remove hides exactly one visible place/note", () => {
  const a = WB.upsertPlace({ name: "G6 地点A" });
  const b = WB.upsertPlace({ name: "G6 地点B" });
  assert.ok(WB.removePlace(a.id));
  const rest = WB.getPlaces();
  assert.ok(!rest.some((x) => x.id === a.id), "a hidden");
  assert.ok(rest.some((x) => x.id === b.id), "b still visible");
  WB.removePlaceForever(a.id);
  WB.removePlaceForever(b.id);

  const na = WB.addNote({ kind: "text", text: "G6 笔记A" });
  const nb = WB.addNote({ kind: "text", text: "G6 笔记B" });
  assert.ok(WB.removeNote(na.id));
  const restNotes = WB.getNotes({});
  assert.ok(!restNotes.some((x) => x.id === na.id), "na hidden");
  assert.ok(restNotes.some((x) => x.id === nb.id), "nb still visible");
  WB.removeNoteForever(na.id);
  WB.removeNoteForever(nb.id);
});

/* ── constants ─────────────────────────────────────────────────────── */

test("v3e C: DELETED_RETENTION_MS exported and equals 30 days", () => {
  assert.equal(typeof Opp.DELETED_RETENTION_MS, "number");
  assert.equal(Opp.DELETED_RETENTION_MS, 30 * 24 * 3600 * 1000);
});
