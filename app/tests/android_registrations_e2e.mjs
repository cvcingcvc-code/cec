// Gorgon Module C UI — Android E2E driver for the registration + prep loop.
//
// Companion to android_places_e2e.mjs (the 55/55 Phase-5 acceptance script
// stays UNTOUCHED — this is a separate driver for the Module C capability).
// Same plumbing: real app in the Android emulator WebView over CDP, real DOM
// clicks / real input events / real localStorage read-back, one true cold
// restart.
//
// Module C acceptance (registration tracking + prep lists + ICS):
//   R1. smart search (NL, offline DEMO payload) -> sr001 card -> detail
//   R2. honest status line: 未报名 -> 打开报名链接 records opened_registration
//       (NEVER registered) — pill flips to 已打开报名页
//   R3. 确认已报名 -> status registered + confirmedAt stamped + pill 已报名,
//       quick buttons unmount
//   R6. 导出日历 on sr001 (has a real startDate) -> NO missing-time note
//       (strong ICS string assertions live in the unit tests)
//   R4. 以此活动创建项目 -> project detail -> 生成默认清单 seeds >=3 items
//   R5. toggle a prep item done + add a custom item (persisted)
//   R7. force-stop -> cold restart -> registration + prep survive
//
// Usage (from app/):  node tests/android_registrations_e2e.mjs
// Prereq: emulator running, APK WITH the Module C UI installed
// (rebuild first — the Module D APK predates the registration UI),
// CDP forwarded on 127.0.0.1:9222.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADB = "F:/gorgon-android-toolchain/sdk/platform-tools/adb.exe";
const PKG = "cn.gorgon.workbench";
const CDP = "http://127.0.0.1:9222";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── ADB via ASYNC spawn (same facts as the places driver) ──────────── */

function adbOnce(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const p = spawn(ADB, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      resolve({ stdout: out, stderr: err, status });
    };
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { err = String(e && e.message || e); finish(-1); });
    p.on("close", (code) => finish(code == null ? -1 : code));
    setTimeout(() => { try { p.kill(); } catch (e) { /* gone */ } finish(-1); }, timeoutMs);
  });
}

async function adb(...args) {
  const first = await adbOnce(args);
  if (first.status !== 0 && (first.stderr.includes("offline") || first.stderr.includes("daemon"))) {
    await sleep(1500);
    const retry = await adbOnce(args);
    if (retry.status === 0 || !retry.stderr) return retry;
    await sleep(2500);
    return adbOnce(args);
  }
  return first;
}

/* ── CDP plumbing ────────────────────────────────────────────────────── */

let ws = null;
let msgId = 0;
const pending = new Map();

async function cdpConnect(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(CDP + "/json")).json();
      const page = list.find((t) => t.type === "page");
      if (page && page.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", () => rej(new Error("ws error")), { once: true });
        });
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            const { res, rej } = pending.get(m.id);
            pending.delete(m.id);
            if (m.error) rej(new Error(JSON.stringify(m.error)));
            else res(m.result);
          }
        });
        await send("Runtime.enable");
        return true;
      }
    } catch (e) { /* forward not ready yet */ }
    await sleep(500);
  }
  throw new Error("CDP never became reachable on " + CDP);
}

function cdpClose() {
  try { if (ws) ws.close(); } catch (e) { /* gone */ }
  ws = null;
  pending.clear();
}

function send(method, params = {}, timeout = 30000) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); rej(new Error("timeout: " + method)); }
    }, timeout);
  });
}

async function evalJs(body) {
  const r = await send("Runtime.evaluate", {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error("eval threw: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

async function waitFor(expr, { timeout = 25000, interval = 300 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await evalJs(`return (${expr});`)) return true; } catch (e) { /* keep polling */ }
    await sleep(interval);
  }
  return false;
}

const click = (sel) => evalJs(`
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  el.click(); return true;`);

const typeInto = (sel, text, proto = "HTMLInputElement") => evalJs(`
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  const setter = Object.getOwnPropertyDescriptor(window.${proto}.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;`);

async function pidOf(pkg, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await adb("shell", "pidof", pkg);
    const out = String(r.stdout || "").trim();
    const pid = out.split(/\s+/)[0];
    if (pid) return pid;
    await sleep(2000);
  }
  return null;
}

async function bootApp() {
  await adb("shell", "am", "start", "-n", PKG + "/.MainActivity");
  await sleep(2500);
  const pid = await pidOf(PKG, 10);
  if (!pid) throw new Error("app did not start (pidof empty)");
  await adb("forward", "--remove", "tcp:9222");
  await adb("forward", "tcp:9222", "localabstract:webview_devtools_remote_" + pid);
  cdpClose();
  await cdpConnect();
  const mounted = await waitFor(`!!document.querySelector('[data-gg-screen]')`, { timeout: 30000 });
  return { pid, mounted };
}

async function bootAppRetry() {
  const first = await bootApp();
  if (first.mounted) return first;
  console.log("  boot did not mount — retrying after a full cold cycle…");
  await adb("shell", "am", "force-stop", PKG);
  await sleep(3000);
  cdpClose();
  const second = await bootApp();
  return second;
}

/** Open the mobile 更多 drawer and pick a workbench/legacy nav key. */
async function drawerGo(navAttr, navKey) {
  await click('[data-workbench-nav="more"]');
  await waitFor(`!!document.querySelector('[data-testid="workbench-more-drawer"]')`);
  await click(`[data-${navAttr}="${navKey}"]`);
  await sleep(500);
}

const MARKER = "regc" + Date.now().toString(36);
const DEMO_QUERY = "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。";

/** Drive: drawer -> 智能搜索 -> 帮我找活动 -> sr001 card 详情 -> overlay. */
async function openSr001Detail() {
  await click('[data-workbench-nav="more"]');
  await waitFor(`!!document.querySelector('[data-testid="workbench-more-drawer"]')`);
  await click('[data-gg-nav="smart"]');
  const askUp = await waitFor(`!!document.querySelector('textarea[aria-label="告诉 Gorgon 你想参加什么活动"]')`, { timeout: 15000 });
  if (!askUp) return false;
  await typeInto('textarea[aria-label="告诉 Gorgon 你想参加什么活动"]', DEMO_QUERY, "HTMLTextAreaElement");
  await evalJs(`
    const b=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='帮我找活动');
    if(b){b.click();return true;} return false;`);
  const gotCards = await waitFor(`!!document.querySelector('[data-gg-card-id="sr001"]')`, { timeout: 40000 });
  if (!gotCards) return false;
  // NL result cards have no onClick on the card itself — the 详情 button
  // inside the card footer opens the overlay (phase-4 proven path).
  await evalJs(`
    const card=document.querySelector('[data-gg-card-id="sr001"]');
    const btn=[...(card||document).querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='详情');
    if(!btn) return false; btn.click(); return true;`);
  return waitFor(`!!document.querySelector('.gg-detail-overlay')`, { timeout: 15000 });
}

/* ── The acceptance run ──────────────────────────────────────────────── */

async function main() {
  console.log("── Gorgon Module C UI · Android E2E (registrations + prep) ──");
  console.log("marker:", MARKER);

  await adb("shell", "am", "force-stop", PKG);
  await sleep(1000);
  const boot = await bootAppRetry();
  check("R0: app cold-boots and React mounts (real WebView)", boot.mounted, "pid=" + boot.pid);
  if (!boot.mounted) finishAndExit();

  // Pre-clean: remove registration records + prep state from previous runs
  // of THIS driver (scoped to the registrations map the opportunities
  // repository owns). Old envelopes with other data keep everything else.
  await evalJs(`
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
    const env = JSON.parse(localStorage.getItem('gorgon_opportunities_v1') || '{}');
    env.registrations = {};
    localStorage.setItem('gorgon_opportunities_v1', JSON.stringify(env));
    if (P) {
      try { await P.set({ key: 'gorgon_opportunities_v1', value: JSON.stringify(env) }); }
      catch (e) { /* native write failed — the localStorage write stands */ }
    }
    return true;
  `);
  await adb("shell", "am", "force-stop", PKG);
  await sleep(3000);
  const boot2 = await bootAppRetry();
  check("R0b: clean-baseline boot after registrations cleanup", boot2.mounted, "pid=" + boot2.pid);
  if (!boot2.mounted) finishAndExit();

  // ── R1: smart search -> sr001 -> activity detail overlay ──────────────
  const detailOpen = await openSr001Detail();
  check("R1: smart search returns sr001 and the detail overlay opens", detailOpen);
  if (!detailOpen) finishAndExit();
  const activityTitle = await evalJs(`
    const h=document.querySelector('.gg-detail-overlay h1');
    return h ? h.innerText.trim() : '';`);
  check("R1: detail title is the sr001 activity", activityTitle === "AI Agent Builder Meetup",
    activityTitle.slice(0, 40));

  // ── R2: honest status line — 未报名 → 打开报名链接 → opened_registration ─
  const initialStatus = await evalJs(`
    const el = document.querySelector('[data-testid="workbench-reg-status"]');
    return el ? el.innerText : '';`);
  check("R2: initial status line shows 未报名 (never registered)",
    initialStatus.includes("未报名") && !initialStatus.includes("已报名"), initialStatus.slice(0, 50));
  const stored0 = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    return env.registrations && env.registrations["sr001"] ? "present" : "absent";`);
  check("R2: no registration record before any action", stored0 === "absent", String(stored0));

  // Stub window.open BEFORE clicking — we test the RECORD path, not the
  // WebView's popup behaviour (a real popup could navigate away and kill
  // the React tree mid-check).
  await evalJs(`window.open = function(){ return null; }; return true;`);
  const linkClicked = await evalJs(`
    const a = [...document.querySelectorAll('.gg-detail-aside a')]
      .find(a => (a.innerText||'').includes('打开报名链接'));
    if (!a) return false;
    a.scrollIntoView({ block: "center" });
    a.click(); return true;`);
  await sleep(800);
  check("R2: 打开报名链接 clicked (window.open stubbed)", linkClicked);
  const stored1 = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const r=env.registrations && env.registrations["sr001"];
    return r?JSON.stringify({status:r.status,openedAt:!!r.openedAt}):null;`);
  const S1 = stored1 ? JSON.parse(stored1) : {};
  check("R2: opening the link records opened_registration (NOT registered)",
    S1.status === "opened_registration" && S1.openedAt === true, String(stored1));
  const pill1 = await evalJs(`
    const el = document.querySelector('[data-testid="workbench-reg-status"]');
    return el ? el.innerText : '';`);
  check("R2: pill now reads 已打开报名页", pill1.includes("已打开报名页"), pill1.slice(0, 50));

  // ── R3: 确认已报名 → registered + confirmedAt stamped ─────────────────
  const confirmClicked = await click('[data-testid="workbench-reg-confirm"]');
  await sleep(800);
  check("R3: 确认已报名 button clicked", confirmClicked);
  const stored2 = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const r=env.registrations && env.registrations["sr001"];
    return r?JSON.stringify({status:r.status,confirmedAt:!!r.confirmedAt,openedAt:!!r.openedAt}):null;`);
  const S2 = stored2 ? JSON.parse(stored2) : {};
  check("R3: status persisted as registered with confirmedAt stamped",
    S2.status === "registered" && S2.confirmedAt === true, String(stored2));
  check("R3: openedAt preserved (opened → registered kept the earlier event)", S2.openedAt === true);
  const pill2 = await evalJs(`
    const el = document.querySelector('[data-testid="workbench-reg-status"]');
    return el ? el.innerText : '';`);
  check("R3: pill now reads 已报名 + 已确认", pill2.includes("已报名") && pill2.includes("已确认"), pill2.slice(0, 60));
  const quickGone = await evalJs(`
    return !document.querySelector('[data-testid="workbench-reg-confirm"]') &&
      !document.querySelector('[data-testid="workbench-reg-inprogress"]');`);
  check("R3: quick status buttons unmount once registered", quickGone);

  // ── R6: ICS export proceeds on a real-date activity ───────────────────
  // sr001 carries startDate=2026-09-19, so exportICS returns a real ICS and
  // the missing-time note must NOT appear. (The .ics blob itself cannot be
  // intercepted in the WebView; string-level assertions are unit-covered.)
  await evalJs(`
    const b=[...document.querySelectorAll('.gg-detail-aside button')]
      .find(b=>(b.innerText||'').includes('导出日历'));
    if(b){b.click();return true;} return false;`);
  await sleep(800);
  const noTimeNote = await evalJs(`
    const aside=document.querySelector('.gg-detail-aside');
    return aside && (aside.innerText||'').includes('缺少时间信息');`);
  check("R6: no missing-time note (export proceeded on real startDate)", !noTimeNote);

  // ── R4: 以此活动创建项目 → project detail → seed the prep checklist ────
  await click('[data-testid="activity-create-project"]');
  await sleep(800);
  const projUp = await waitFor(`!!document.querySelector('[data-testid="workbench-project-header"]')`);
  check("R4: project created from the activity → project detail opens", projUp);
  if (!projUp) finishAndExit();
  const projTitle = await evalJs(`
    const h=document.querySelector('[data-testid="workbench-project-header"] h1');
    return h?h.innerText.trim():'';`);
  check("R4: project title = activity title", projTitle === "AI Agent Builder Meetup", projTitle.slice(0, 40));

  const prepSection = await waitFor(`!!document.querySelector('[data-testid="workbench-project-prep-seed"]')`);
  check("R4: 出行准备 section renders with 生成默认清单 button", prepSection);
  await click('[data-testid="workbench-project-prep-seed"]');
  await sleep(800);
  const seeded = await waitFor(`
    (() => {
      const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
      const r=(env.registrations||{})["sr001"];
      return !!(r && r.prep && r.prep.length >= 3);
    })()`);
  check("R4: default prep checklist seeded (>=3 items)", seeded);
  const prepCount = await evalJs(`
    return document.querySelectorAll('[data-testid="workbench-project-prep-item"]').length;`);
  check("R4: prep items render in the UI", prepCount >= 3, "count=" + prepCount);

  // ── R5: toggle done + add a custom item ───────────────────────────────
  await click('[data-testid="workbench-project-prep-toggle"]'); // first checkbox
  await sleep(500);
  const toggled = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const r=(env.registrations||{})["sr001"];
    return !!(r && r.prep && r.prep.some(p => p.done === true));`);
  check("R5: toggling a prep item persists done=true", toggled);
  await typeInto('[data-testid="workbench-project-prep-input"]', MARKER + " 打印确认邮件");
  await evalJs(`
    const inp = document.querySelector('[data-testid="workbench-project-prep-input"]');
    if (!inp || !inp.parentElement) return false;
    const btn = [...inp.parentElement.querySelectorAll('button')]
      .find(b => (b.innerText||'').trim() === '添加');
    if (!btn) return false;
    btn.click(); return true;`);
  await sleep(600);
  const added = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const r=(env.registrations||{})["sr001"];
    return !!(r && r.prep && r.prep.some(p => (p.title||'').includes('打印确认邮件')));`);
  const afterAdd = await evalJs(`
    return document.querySelectorAll('[data-testid="workbench-project-prep-item"]').length;`);
  check("R5: custom prep item added (UI count +1)", afterAdd === prepCount + 1, "count=" + afterAdd);
  check("R5: custom item title persisted", added);

  // ── R7: cold restart → registration + prep survive ────────────────────
  await adb("shell", "am", "force-stop", PKG);
  await sleep(1500);
  const deadR = await adb("shell", "pidof", PKG);
  const dead = String(deadR.stdout || "").trim();
  check("R7: process killed (force-stop)", dead === "", "pidof=[" + dead + "]");
  const boot3 = await bootAppRetry();
  check("R7: app cold-restarts and React mounts", boot3.mounted, "new pid=" + boot3.pid);
  if (!boot3.mounted) finishAndExit();

  const restored = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1') || '{}');
    const r=(env.registrations||{})["sr001"];
    return r?JSON.stringify({status:r.status,confirmedAt:!!r.confirmedAt,prep:(r.prep||[]).length,done:(r.prep||[]).filter(p=>p.done).length,custom:(r.prep||[]).some(p=>(p.title||'').includes('打印确认邮件'))}):null;`);
  const R7 = restored ? JSON.parse(restored) : {};
  check("R7: registered + confirmedAt + prep survive cold restart",
    R7.status === "registered" && R7.confirmedAt === true && R7.prep >= 4 && R7.custom === true, String(restored));

  // UI level: the projects list still shows the project after restart.
  await drawerGo("workbench-nav", "projects");
  const projList = await waitFor(`!!document.querySelector('[data-gg-screen="workbench-projects"]')`);
  check("R7: projects screen opens after cold start", projList);
  const projText = await evalJs(`
    const s=document.querySelector('[data-gg-screen="workbench-projects"]');
    return s ? (s.innerText||'') : '';`);
  check("R7: projects list still shows the created project",
    projText.includes("AI Agent Builder Meetup"), projText.slice(0, 80));

  /* ── summary ─────────────────────────────────────────────────────────── */
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n── android-registrations-e2e: ${pass} passed, ${results.length - pass} failed ──`);
  cdpClose();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

/** Early summary + exit when a downstream step cannot run (upstream failed). */
function finishAndExit() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n── android-registrations-e2e (early exit): ${pass} passed, ${results.length - pass} failed ──`);
  cdpClose();
  process.exit(1);
}

main().catch((e) => { console.error("FATAL", e && e.stack || e); process.exit(2); });
