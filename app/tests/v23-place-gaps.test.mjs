// V2.3 Phase 3 (地点管理) — gap tests for the place loop.
//
// 用户指令的验收场景：创建地点 → 安排走访 → 关联任务 → 完成访问 →
// 记录结果 → 再次查看。本文件覆盖 store + 纯视图助手层的缺口：
//
//   G-1  地点编辑（upsertPlace 已支持更新，验证 store facade 往返）
//   G-2  地点搜索（name/address 大小写不敏感）
//   G-3  重复地点提示（同名地点检测，含自排除）
//   G-4  访问历史（addVisit 追加 + 复访计划更新 + 状态自动流转）
//   G-5  地点笔记（addNote 支持 placeId；getNotes({placeId}) 过滤）
//   G-6  删除地点
//
// localStorage is unavailable in plain Node — the repository degrades to its
// in-memory fallback, same as v23-store-gaps.test.mjs. Pure helpers come
// from lib/place-view.js (new file); store assertions go through the facade.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── pure helpers under test ─────────────────────────────────────────────
import { searchPlaces, duplicatePlaceName } from "../src/lib/place-view.js";

// ── store facade under test ─────────────────────────────────────────────
import * as WB from "../src/store/workbench-store.js";

test("P3 G-1: store upsertPlace roundtrip — update keeps id/createdAt, bumps updatedAt", () => {
  const created = WB.upsertPlace({ name: "某园区 A 座前台", address: "科技路 1 号" });
  assert.ok(created && created.id);
  const firstUpdatedAt = created.updatedAt;

  const updated = WB.upsertPlace({
    id: created.id,
    name: "某园区 A 座 3F 前台",
    address: "科技路 1 号 3F",
  });
  assert.equal(updated.id, created.id);
  assert.equal(updated.name, "某园区 A 座 3F 前台");
  assert.equal(updated.address, "科技路 1 号 3F");
  assert.equal(updated.createdAt, created.createdAt);
  assert.ok(updated.updatedAt >= firstUpdatedAt);

  const reread = WB.getPlace(created.id);
  assert.equal(reread.name, "某园区 A 座 3F 前台");
  // cleanup: remove the test place from the in-memory store
  WB.removePlace(created.id);
});

test("P3 G-2: searchPlaces matches name and address case-insensitively", () => {
  const list = [
    { id: "1", name: "科技园 A 座", address: "高新南一路" },
    { id: "2", name: "文创园 B 馆", address: "Garden Road 8 号楼" },
    { id: "3", name: "写字楼 C", address: "" },
  ];
  assert.deepEqual(searchPlaces(list, "园").map((p) => p.id), ["1", "2"]);
  assert.deepEqual(searchPlaces(list, "garden").map((p) => p.id), ["2"]);
  assert.deepEqual(searchPlaces(list, "8 号楼").map((p) => p.id), ["2"]);
  assert.deepEqual(searchPlaces(list, "写字楼").map((p) => p.id), ["3"]);
  assert.deepEqual(searchPlaces(list, "").map((p) => p.id), ["1", "2", "3"]);
  assert.deepEqual(searchPlaces(list, "不存在的关键词"), []);
  assert.deepEqual(searchPlaces(null, "园区"), []);
});

test("P3 G-3: duplicatePlaceName flags exact-name duplicates (trimmed, case-insensitive)", () => {
  const list = [
    { id: "1", name: "科技园 A 座" },
    { id: "2", name: "  科技园 a 座 " },
    { id: "3", name: "其他大厦" },
  ];
  assert.equal(duplicatePlaceName(list, "科技园 A 座"), "1");
  assert.equal(duplicatePlaceName(list, "科技园 a 座"), "1");
  assert.equal(duplicatePlaceName(list, "  科技园 A 座  "), "1");
  assert.equal(duplicatePlaceName(list, "新大楼"), null);
  assert.equal(duplicatePlaceName(list, null), null);
  assert.equal(duplicatePlaceName(list, "   "), null);
});

test("P3 G-3b: duplicate check excludes the place being edited (self-exclusion)", () => {
  const list = [
    { id: "1", name: "科技园 A 座" },
    { id: "2", name: "文创园 B 馆" },
  ];
  // editing place 1, name unchanged -> no duplicate (self excluded)
  assert.equal(duplicatePlaceName(list, "科技园 A 座", "1"), null);
  // editing place 1, renamed to place 2's name -> duplicate = 2
  assert.equal(duplicatePlaceName(list, "文创园 B 馆", "1"), "2");
});

test("P3 G-4: addVisit appends history and flips status; nextPlan updates", () => {
  const p = WB.upsertPlace({ name: "某园区前台(测试)", address: "科技路 1 号" });
  const v1 = WB.addPlaceVisit(p.id, { note: "前台拒收，需预约", nextPlan: "下周一带材料再来" });
  assert.equal(v1.status, "revisit");
  assert.equal(v1.visits.length, 1);
  assert.equal(v1.visits[0].note, "前台拒收，需预约");
  assert.equal(v1.nextPlan, "下周一带材料再来");

  const v2 = WB.addPlaceVisit(p.id, { note: "顺利对接" });
  assert.equal(v2.status, "visited");
  assert.equal(v2.visits.length, 2);
  assert.ok(v2.visits[0].at <= v2.visits[1].at);
  WB.removePlace(p.id);
});

test("P3 G-5: notes support placeId association and filter", () => {
  const p = WB.upsertPlace({ name: "某园区前台(笔记测试)" });
  const n = WB.addNote({ text: "前台 9:00-18:00，午休拒访", placeId: p.id, kind: "text" });
  assert.ok(n && n.id);
  assert.equal(n.placeId, p.id);

  const filtered = WB.getNotes({ placeId: p.id });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].text, "前台 9:00-18:00，午休拒访");

  // other place sees nothing
  const other = WB.upsertPlace({ name: "另一栋楼(笔记测试)" });
  assert.equal(WB.getNotes({ placeId: other.id }).length, 0);

  // cleanup
  WB.removeNote(n.id);
  WB.removePlace(p.id);
  WB.removePlace(other.id);
});

test("P3 G-6: removePlace removes exactly one place", () => {
  const a = WB.upsertPlace({ name: "P3删除测试A" });
  const b = WB.upsertPlace({ name: "P3删除测试B" });
  assert.ok(WB.removePlace(a.id));
  const rest = WB.getPlaces();
  assert.ok(!rest.some((x) => x.id === a.id));
  assert.ok(rest.some((x) => x.id === b.id));
  WB.removePlace(b.id);
});
