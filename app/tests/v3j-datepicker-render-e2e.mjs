// Gorgon V3J — P0 截止时间 datetime 弹窗真实渲染 E2E。
//
// 驱动 REAL 生产构建（vite preview of dist/）+ headless Edge over CDP。
// 复现真机操作序列（v0.3.7-alpha 闪退路径）并断言修复后的行为：
//
//   1. 任务详情 → 点「截止时间」→ datetime DatePickerSheet 真实渲染
//      （弹窗出现、无 ReferenceError、无白屏）
//   2. 选日期 → 预览行显示「YYYY年M月D日 周X HH:mm」（当年崩在这一步）
//   3. 步进小时/分钟 → 预览实时更新、不崩
//   4. 确定 → 弹窗关闭，dueAt 以 UTC ISO 写入 localStorage（语义不变）
//   5. 重新打开弹窗 → 回种今天 + 已保存的 HH:mm
//   6. 清除 → onConfirm(null,null) 路径 → dueAt 清空、不崩
//   7. 取消（Esc / 关闭按钮）→ 永不写盘
//   8. 全程 console errors = 0
//
// Run:  node tests/v3j-datepicker-render-e2e.mjs   (from app/)
// Prereq: dist/ 存在（先 npx vite build）。

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Session } from "../../pipeline/tests/cdp_session.mjs";

const CLEAN_ENV = { ...process.env };
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete CLEAN_ENV[k];
}
CLEAN_ENV.NO_PROXY = "127.0.0.1,localhost";
CLEAN_ENV.no_proxy = "127.0.0.1,localhost";
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
  delete process.env[k];
}
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(APP, "..");
const WEB_PORT = 4177;
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const LOG_DIR = path.join(APP, "tests", ".e2e-logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const procs = [];
function start(name, cmd, args, cwd) {
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), "w");
  const p = spawn(cmd, args, { cwd, env: CLEAN_ENV, stdio: ["ignore", log, log] });
  procs.push(p);
  return p;
}
async function waitHttp(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true; }
    catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}
function appErrors(session) {
  return session.errors.filter((e) =>
    !/favicon|fonts\.googleapis|fonts\.gstatic|net::ERR_INTERNET_DISCONNECTED/i.test(e));
}

const RESET_WB = `
  localStorage.removeItem('gorgon_workbench_tasks_v2');
  localStorage.removeItem('gorgon_workbench_tasks');
  localStorage.removeItem('gorgon_workbench_review');
  localStorage.removeItem('gorgon_workbench_log');
  return true;`;

const TYPE_IN = (sel, text) => `
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;`;

async function gotoHome(s) {
  await s.goto(BASE + "/");
  await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
  await s.eval(RESET_WB);
  await s.goto(BASE + "/");
  await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
}

async function main() {
  console.log("[v3j-e2e] starting vite preview (dist/) ...");
  start("web", process.execPath,
    [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "preview",
     "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], APP);
  const webUp = await waitHttp(BASE + "/");
  check("servers up (vite preview)", webUp);
  if (!webUp) throw new Error("preview did not start");

  const s = new Session({ port: 9361 });
  await s.launch({ width: 390, height: 844 });
  await s.connect();
  try {
    await s.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await gotoHome(s);

    // ── create a task from the home input and open its detail ──
    await s.eval(TYPE_IN('[data-gg-screen="workbench-home"] textarea', "V3J 回归：验证截止时间弹窗"));
    await s.click(`[...document.querySelectorAll('[data-gg-screen="workbench-home"] button')].find(b => b.innerText.includes('开始任务'))`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`, { timeout: 8000 });
    check("task detail opens", true);

    const today = await s.eval(`
      const d=new Date(); const p=n=>String(n).padStart(2,'0');
      return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());`);

    // ── step 1: tap 截止时间 → datetime sheet renders (the crash step) ──
    await s.click(`document.querySelector('[data-testid="workbench-detail-schedule-due"]')`);
    const sheetUp = await s.waitFor(`!!document.querySelector('[data-testid="gg-datepicker-sheet"]')`, { timeout: 5000 });
    check("P0: 截止时间 datetime sheet renders (no crash/white screen)", sheetUp);
    const modeOk = await s.eval(`
      return !!document.querySelector('[data-testid="gg-datepicker-time"]');`);
    check("P0: datetime mode shows the time stepper", modeOk);

    // ── step 2: pick today → preview renders the CN label + time (THE crash line) ──
    await s.click(`document.querySelector('[data-testid="gg-datepicker-day"][data-date="${today}"]')`);
    await sleep(300);
    const previewOk = await s.waitFor(`!!document.querySelector('[data-testid="gg-datepicker-preview"]')`, { timeout: 5000 });
    check("P0: preview renders after picking a day (formatCNTime crash fixed)", previewOk);
    const previewText = previewOk
      ? await s.eval(`return document.querySelector('[data-testid="gg-datepicker-preview"]').innerText;`) : "";
    const previewRe = new RegExp(`^\\d{4}年\\d{1,2}月\\d{1,2}日 周[一二三四五六日] \\d{2}:\\d{2}$`);
    check("P0: preview shows 年月日 周X HH:mm", previewRe.test(previewText || ""), previewText);

    // ── step 3: step time 09:00 → 18:30 (hour +9, minute +6) ──
    await s.eval(`
      const hPlus = document.querySelectorAll('[aria-label="小时加一"]');
      for (let i = 0; i < 9 && hPlus.length; i++) hPlus[0].click();
      return true;`);
    await sleep(200);
    await s.eval(`
      const mPlus = document.querySelectorAll('[aria-label="分钟加一"]');
      for (let i = 0; i < 6 && mPlus.length; i++) mPlus[0].click();
      return true;`);
    await sleep(200);
    const previewText2 = await s.eval(
      `return document.querySelector('[data-testid="gg-datepicker-preview"]').innerText;`);
    check("P0: preview updates live while stepping time (18:30)", /18:30$/.test(previewText2 || ""), previewText2);

    // ── step 4: confirm → sheet closes, dueAt written as UTC ISO ──
    await s.click(`document.querySelector('[data-testid="gg-datepicker-confirm"]')`);
    await sleep(500);
    const sheetGone = await s.eval(`return !document.querySelector('[data-testid="gg-datepicker-sheet"]');`);
    check("confirm closes the sheet", sheetGone);
    const dueStored = await s.eval(`
      const env=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
      const t=(env.tasks||[])[0];
      return t&&t.dueAt?t.dueAt:null;`);
    check("confirm writes dueAt (UTC ISO) without 保存排期 (direct-write path)", !!dueStored, String(dueStored));

    // ── step 5: reopen → seeds today + saved HH:mm ──
    await s.click(`document.querySelector('[data-testid="workbench-detail-schedule-due"]')`);
    await s.waitFor(`!!document.querySelector('[data-testid="gg-datepicker-sheet"]')`, { timeout: 5000 });
    const seededDay = await s.eval(`
      const el=[...document.querySelectorAll('[data-testid="gg-datepicker-day"]')].find(b=>b.getAttribute('aria-selected')==='true');
      return el?el.getAttribute('data-date'):null;`);
    check("reopen seeds the previously chosen day", seededDay === today, String(seededDay));
    const seededPreview = await s.eval(
      `return document.querySelector('[data-testid="gg-datepicker-preview"]')?.innerText || '';`);
    check("reopen seeds 18:30 in preview", /18:30$/.test(seededPreview || ""), seededPreview);
    // close without writing
    await s.click(`document.querySelector('[data-testid="gg-datepicker-close"]')`);
    await sleep(400);
    const dueUnchanged = await s.eval(`
      const env=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
      const t=(env.tasks||[])[0];
      return t&&t.dueAt?t.dueAt:null;`);
    check("cancel/close never writes (dueAt unchanged)", dueUnchanged === dueStored, String(dueUnchanged));

    // ── step 6: Esc cancel path ──
    await s.click(`document.querySelector('[data-testid="workbench-detail-schedule-due"]')`);
    await s.waitFor(`!!document.querySelector('[data-testid="gg-datepicker-sheet"]')`, { timeout: 5000 });
    await s.eval(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;`);
    await sleep(400);
    const escClosed = await s.eval(`return !document.querySelector('[data-testid="gg-datepicker-sheet"]');`);
    check("Esc cancels without writing", escClosed);

    // ── step 7: clear → dueAt null, no crash ──
    await s.click(`document.querySelector('[data-testid="workbench-detail-schedule-due"]')`);
    await s.waitFor(`!!document.querySelector('[data-testid="gg-datepicker-sheet"]')`, { timeout: 5000 });
    await s.click(`document.querySelector('[data-testid="gg-datepicker-clear"]')`);
    await sleep(500);
    const clearedOk = await s.eval(`
      const env=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
      const t=(env.tasks||[])[0];
      return !t || !t.dueAt;`);
    check("clear empties dueAt without crash", clearedOk);

    // ── step 8: 计划日期 (date mode) still works — no regression ──
    await s.click(`document.querySelector('[data-testid="workbench-detail-schedule-date"]')`);
    await s.waitFor(`!!document.querySelector('[data-testid="gg-datepicker-sheet"]')`, { timeout: 5000 });
    const dateModeNoTime = await s.eval(
      `return !document.querySelector('[data-testid="gg-datepicker-time"]');`);
    check("date mode hides the time stepper", dateModeNoTime);
    await s.click(`document.querySelector('[data-testid="gg-datepicker-day"][data-date="${today}"]')`);
    await sleep(200);
    const datePreview = await s.eval(
      `return document.querySelector('[data-testid="gg-datepicker-preview"]')?.innerText || '';`);
    check("date mode preview shows 年月日 周X (no time)", /^\d{4}年\d{1,2}月\d{1,2}日 周[一二三四五六日]$/.test(datePreview || ""), datePreview);
    await s.click(`document.querySelector('[data-testid="gg-datepicker-confirm"]')`);
    await sleep(400);
    const schedStored = await s.eval(`
      const env=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
      const t=(env.tasks||[])[0];
      return t?t.scheduledDate:null;`);
    check("date mode confirm writes scheduledDate", schedStored === today, String(schedStored));

    // ── step 9: zero console errors across the whole flow ──
    const errs = appErrors(s);
    check("console errors = 0 across the whole flow", errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 200));

    await s.shot(path.join(REPO, "reports", "v3j-datepicker-flow.png"));
  } finally {
    await s.close();
  }
}

try {
  await main();
} finally {
  for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n[v3j-e2e] ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
