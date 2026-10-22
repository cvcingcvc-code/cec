// Gorgon V3J — P1 笔记新建真实渲染 E2E。
//
// 驱动 REAL 生产构建（vite preview of dist/）+ headless Edge over CDP。
// 复现真机验收路径：不依赖导入文件，直接在 UI 上新建一篇笔记：
//
//   1. 笔记中心出现醒目「+ 新建笔记」按钮（P1 核心诉求）
//   2. 点击 → 表单打开（正文 + 可选关联任务/项目/地点）
//   3. 空文本 → 保存被禁用（不产生空笔记）
//   4. 填正文 + 关联任务 → 保存 → 笔记立即出现在列表（带任务关联徽标）
//   5. 编辑 → 文本改写 → 保存 → 列表更新
//   6. localStorage 里的 note envelope 带正确关联字段
//   7. 导入按钮仍在（TXT/Markdown 导入能力保留）
//   8. 任务详情「记一笔」快速新建关联笔记仍然工作（无回归）
//   9. 全程 console errors = 0
//
// Run:  node tests/v3j-note-create-e2e.mjs   (from app/)
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
const WEB_PORT = 4178;
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
  localStorage.removeItem('gorgon_opportunities_v1');
  localStorage.removeItem('gorgon_workbench_log');
  return true;`;

const TYPE_IN = (sel, text) => `
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;`;

async function main() {
  console.log("[v3j-e2e] starting vite preview (dist/) ...");
  start("web", process.execPath,
    [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "preview",
     "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], APP);
  const webUp = await waitHttp(BASE + "/");
  check("servers up (vite preview)", webUp);
  if (!webUp) throw new Error("preview did not start");

  const s = new Session({ port: 9362 });
  await s.launch({ width: 390, height: 844 });
  await s.connect();
  try {
    await s.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await s.goto(BASE + "/");
    await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);
    await s.eval(RESET_WB);
    await s.goto(BASE + "/");
    await s.waitFor(`!!document.querySelector('[data-gg-shell]')`);

    // ── create one task first (association target) ──
    await s.eval(TYPE_IN('[data-gg-screen="workbench-home"] textarea', "V3J 笔记关联目标"));
    await s.click(`[...document.querySelectorAll('[data-gg-screen="workbench-home"] button')].find(b => b.innerText.includes('开始任务'))`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`, { timeout: 8000 });
    await s.click(`document.querySelector('[data-testid="workbench-detail-back"]')`);
    await sleep(400);

    // ── open the notes center via the 更多 drawer ──
    await s.click(`[...document.querySelectorAll('[data-gg-region="tabbar"] button')].find(b => b.innerText.includes('更多'))`);
    await s.waitFor(`!!document.querySelector('[data-testid="workbench-more-drawer"]')`);
    await s.click(`document.querySelector('[data-testid="workbench-more-drawer"] [data-workbench-nav="notes"]')`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-notes"]')`);
    check("notes center opens", true);

    // ── step 1: the prominent 新建笔记 entry ──
    const newBtn = await s.waitFor(`!!document.querySelector('[data-testid="workbench-notes-new"]')`, { timeout: 5000 });
    check("P1: 醒目的「+ 新建笔记」入口存在", newBtn);
    const newBtnText = newBtn
      ? await s.eval(`return document.querySelector('[data-testid="workbench-notes-new"]').innerText;`) : "";
    check("P1: 按钮文案是 新建笔记", /新建笔记/.test(newBtnText || ""), newBtnText);

    // ── step 2: click → composer opens with optional link selects ──
    await s.click(`document.querySelector('[data-testid="workbench-notes-new"]')`);
    const composerUp = await s.waitFor(`!!document.querySelector('[data-testid="workbench-notes-composer"]')`, { timeout: 5000 });
    check("P1: 点击后新建表单打开", composerUp);
    const hasTaskSelect = await s.eval(
      `return !!document.querySelector('[data-testid="workbench-notes-composer-task"]');`);
    check("P1: 表单提供可选关联任务", hasTaskSelect);

    // ── step 3: empty text → save disabled ──
    const saveDisabled = await s.eval(`
      const b = document.querySelector('[data-testid="workbench-notes-composer-save"]');
      return b && b.disabled;`);
    check("P1: 空文本时保存按钮禁用（不产生空笔记）", saveDisabled);

    // ── step 4: fill text + link task → save → appears in the list ──
    const NOTE_TEXT = "V3J 新建笔记：房东说押一付三，周末签约";
    await s.eval(TYPE_IN('[data-testid="workbench-notes-composer-text"]', NOTE_TEXT));
    await s.eval(`
      const sel = document.querySelector('[data-testid="workbench-notes-composer-task"]');
      if (sel && sel.options.length > 1) { sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;`);
    await sleep(200);
    await s.click(`document.querySelector('[data-testid="workbench-notes-composer-save"]')`);
    const noteShown = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-note-text"]')]
        .some(e => (e.innerText || '').includes(${JSON.stringify(NOTE_TEXT)}))`, { timeout: 5000 });
    check("P1: 保存后笔记立即出现在列表", noteShown);
    const noteHasLink = await s.eval(`
      return [...document.querySelectorAll('[data-testid="workbench-note-item"]')]
        .some(e => (e.innerText || '').includes('房东说押一付三') && !!e.querySelector('[data-testid="workbench-note-task-link"]'));`);
    check("P1: 笔记带任务关联（点击可达）", noteHasLink);

    // ── step 5: envelope written with the link fields ──
    const stored = await s.eval(`
      const env = JSON.parse(localStorage.getItem('gorgon_opportunities_v1') || '{}');
      const n = (env.notes || []).find(n => (n.text || '').includes('房东说押一付三'));
      return n ? JSON.stringify({ taskId: n.taskId, kind: n.kind, deletedAt: n.deletedAt }) : null;`);
    const NS = stored ? JSON.parse(stored) : {};
    check("P1: note envelope 带正确关联字段（同一种数据模型）",
      NS.kind === "text" && NS.deletedAt === null && !!NS.taskId, String(stored));

    // ── step 6: edit → text updated ──
    await s.click(`[...document.querySelectorAll('[data-testid="workbench-note-edit"]')][0]`);
    await s.waitFor(`!!document.querySelector('[data-testid="workbench-notes-composer"]')`, { timeout: 5000 });
    const EDITED = NOTE_TEXT + "（已编辑）";
    await s.eval(TYPE_IN('[data-testid="workbench-notes-composer-text"]', EDITED));
    await s.click(`document.querySelector('[data-testid="workbench-notes-composer-save"]')`);
    const editedShown = await s.waitFor(`
      [...document.querySelectorAll('[data-testid="workbench-note-text"]')]
        .some(e => (e.innerText || '').includes('（已编辑）'))`, { timeout: 5000 });
    check("P1: 编辑后列表更新", editedShown);

    // ── step 7: import button still present ──
    const importBtn = await s.eval(
      `return !!document.querySelector('[data-testid="workbench-notes-import"]');`);
    check("P1: TXT/Markdown 导入按钮保留", importBtn);

    // ── step 8: task detail 记一笔 quick note still works ──
    await s.click(`[...document.querySelectorAll('[data-testid="workbench-note-task-link"]')][0]`);
    await s.waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`, { timeout: 5000 });
    await s.eval(TYPE_IN('[data-testid="workbench-detail-note-input"]', "V3J 快速记录：电话确认过"));
    await s.click(`[...document.querySelectorAll('[data-gg-screen="workbench-task-detail"] button')].find(b => b.innerText.includes('记一笔'))`);
    const quickNote = await s.waitFor(`!!document.querySelector('[data-testid="workbench-detail-note"]')`, { timeout: 5000 });
    check("P1: 任务详情「记一笔」快速新建仍工作", quickNote);

    // ── step 9: zero console errors ──
    const errs = appErrors(s);
    check("console errors = 0 across the whole flow", errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 200));

    await s.shot(path.join(REPO, "reports", "v3j-note-create.png"));
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
