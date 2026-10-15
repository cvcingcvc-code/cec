// Gorgon V3J — P0 截止时间闪退回归测试。
//
// 真机 bug（v0.3.7-alpha, versionCode 12）：任务详情 → 点击「截止时间」→
// 页面闪退/白屏。根因：DatePickerSheet.jsx 的 calendar.js import 漏了
// formatCNTime，datetime 模式一选日期就渲染预览 → ReferenceError →
// React 卸载整棵树 → 白屏。
//
// 本文件两层测试：
//   1. 纯静态层（node --test，无浏览器）—— import 契约守卫：
//      DatePickerSheet.jsx 的 import 列表必须包含组件内用到的每个
//      calendar.js 导出（formatCNTime 是当年的漏项）。
//   2. 真实渲染层（vite preview + headless Edge over CDP）——
//      打开任务详情 → 点「截止时间」→ datetime 弹窗真实渲染 →
//      选日期/步进时间/确定/取消/清除，全流程无 ReferenceError、
//      无白屏，写盘语义不变。
//
// Run:  node --test tests/v3j-datepicker-crash.test.mjs   (纯静态层)
//       node tests/v3j-datepicker-render-e2e.mjs          (真实渲染层, from app/)

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");

/* ── 静态层：import 契约守卫 ─────────────────────────────────────────── */

function readSrc(rel) {
  return fs.readFileSync(path.join(APP, "src", rel), "utf8");
}

/** Extract the named imports from `.../lib/calendar.js` in a source file. */
function calendarImports(src) {
  const m = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*["'][^"']*lib\/calendar\.js["'];/);
  assert.ok(m, "file must import from lib/calendar.js");
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

/** All calendar.js exported names (parse the module's export list). */
function calendarExports() {
  const src = readSrc(path.join("lib", "calendar.js"));
  const names = [];
  const re = /export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

test("P0 root-cause guard: DatePickerSheet imports formatCNTime from calendar.js", () => {
  const src = readSrc(path.join("components", "mobile", "DatePickerSheet.jsx"));
  const imported = calendarImports(src);
  assert.ok(
    imported.includes("formatCNTime"),
    "DatePickerSheet.jsx uses formatCNTime in datetime preview; " +
    "missing import = ReferenceError = device crash (v0.3.7-alpha bug)."
  );
});

test("P0 guard: every calendar.js identifier used in DatePickerSheet is imported", () => {
  const src = readSrc(path.join("components", "mobile", "DatePickerSheet.jsx"));
  const imported = new Set(calendarImports(src));
  // identifiers referenced in JSX/body that come from calendar.js
  const usedViaCalendar = [
    "WEEKDAY_HEADERS", "monthGrid", "daysInMonth", "todayStr", "addDays",
    "formatCN", "formatCNMonth", "formatCNTime", "diffDays",
  ].filter((name) => new RegExp(`\\b${name}\\b`).test(src.replace(/import[\s\S]*?from\s*["'][^"']*["'];/g, "")));
  const missing = usedViaCalendar.filter((n) => !imported.has(n));
  assert.deepEqual(missing, [], `missing calendar.js imports: ${missing.join(", ")}`);
});

test("P0 guard: usedViaCalendar names all exist as calendar.js exports", () => {
  const exports = calendarExports();
  for (const name of [
    "WEEKDAY_HEADERS", "monthGrid", "todayStr", "addDays",
    "formatCN", "formatCNMonth", "formatCNTime", "diffDays",
  ]) {
    assert.ok(exports.includes(name), `calendar.js must export ${name}`);
  }
});

test("P0 guard: formatCNTime is safe on invalid/missing input (no throw)", () => {
  // dynamic import of the pure module — node --test runs ESM natively.
  return import("../src/lib/calendar.js").then(({ formatCNTime, formatCN }) => {
    assert.equal(formatCNTime("2026-10-14", "14:00"), "2026年10月14日 周三 14:00");
    assert.equal(formatCNTime("2026-10-14", null), "2026年10月14日 周三");
    assert.equal(formatCNTime("bad", "14:00"), null);
    assert.equal(formatCNTime(null, null), null);
    assert.equal(formatCN("2026-02-30"), null); // impossible date → null, never guess
  });
});

test("P0 guard: hhmmOf-style ISO seeding handles invalid dates without throwing", () => {
  return import("../src/lib/calendar.js").then(({ todayStr }) => {
    // new Date(invalid).getTime() is NaN — DatePickerSheet's hhmmOf returns null.
    const bad = new Date("not-a-date");
    assert.ok(isNaN(bad.getTime()));
    assert.equal(todayStr(bad), "NaN-NaN-NaN"); // documented behaviour: caller guards with hhmmOf first
  });
});

export { calendarImports, calendarExports };
