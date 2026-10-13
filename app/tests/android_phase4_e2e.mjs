// Gorgon Phase 4 — Android E2E acceptance driver (P0-E).
//
// Drives the REAL app inside the Android emulator WebView over CDP
// (adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>).
// NOT a mock test: every step is a real DOM click / real input event /
// real localStorage read-back, and step 8 kills the process with
// `adb shell am force-stop` and re-launches it (true cold start).
//
// WHY TWO TASKS: running the plan skill makes the Phase-3 engine auto-move
// that task to `completed` (task-runner.js). To prove BOTH capabilities
// honestly and separately we use:
//   • Task A (计划任务): run plan skill → save the SUGGESTED steps as
//     EDITABLE pending todos (they must NOT be auto-completed) → edit one →
//     set schedule. Proves P0-B plan→todos + "suggestion ≠ done" + scheduling.
//   • Task B (执行任务): driven by the USER through the legal state machine
//     created→ready→running→completed, then an execution note is attached.
//     Proves P0-B manual completion + P0-C note.
// Both live under one project created from a (DEMO) activity; the project
// review (P0-C step 4) is saved by the user.
//
// 10-step acceptance (charter P0-E):
//   1. search an activity (offline demo payload, DEMO badge visible)
//   2. create a project FROM the activity detail
//   3. create tasks inside the project
//   4. run plan skill and save suggestions as editable pending todos
//   5. set schedule (planned date + due time)
//   6. complete a task via the state machine and attach a note
//   7. save the project review (outcome + next action, user-written)
//   8. force-stop → cold restart → everything restored
//   9. legacy data still readable (old keys untouched)
//  10. DEMO markers honest throughout
//
// Usage (from app/):  node tests/android_phase4_e2e.mjs
// Prereq: emulator running, v4 APK installed, CDP forwarded on 127.0.0.1:9222
// (android_phase4_accept.sh sets the forward up per PID before calling this).

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

/* ── ADB via ASYNC spawn ─────────────────────────────────────────────── */
// Two environment facts (verified 2026-10-10 with/without sandbox):
//   1. spawnSync on this machine throws EBUSY for ANY binary (cmd.exe,
//      python.exe, adb.exe, node itself) — but ASYNC spawn() works.
//   2. The adb server may be reaped between calls; the first call after a
//      reap restarts the daemon and fails with "device offline", the retry
//      succeeds. All bridged commands are idempotent (devices/pidof/
//      forward/force-stop/am start), so a retry never double-applies.

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
    setTimeout(() => { try { p.kill(); } catch { /* gone */ } finish(-1); }, timeoutMs);
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

/* ── CDP plumbing (reconnectable: the process dies in step 8) ────────── */

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
    } catch { /* forward not ready yet */ }
    await sleep(500);
  }
  throw new Error("CDP never became reachable on " + CDP);
}

function cdpClose() {
  try { ws && ws.close(); } catch { /* gone */ }
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
    try { if (await evalJs(`return (${expr});`)) return true; } catch { /* keep polling */ }
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

/** Click a button (within an optional scope selector) whose text includes `text`. */
const clickButton = (text, scope = "document") => evalJs(`
  const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`} || document;
  const btns = [...root.querySelectorAll('button')];
  const el = btns.find(b => (b.innerText || "").includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  el.click(); return true;`);

/** pidof with retry: the adb daemon can be slow/flaky under spawnSync. */
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

async function forwardToPid() {
  const pid = await pidOf(PKG);
  if (!pid) throw new Error("app process not found (pidof empty after retries)");
  await adb("forward", "--remove", "tcp:9222");
  await adb("forward", "tcp:9222", "localabstract:webview_devtools_remote_" + pid);
  return pid;
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

/**
 * bootApp with one full cold-cycle retry: a rapid force-stop/start loop can
 * leave the WebView devtools channel wedged (evaluate hangs after connect).
 * If the first boot does not mount, kill the app again, wait out the churn,
 * and boot once more before giving up.
 */
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

/**
 * Reach the project detail screen from anywhere via the drawer. The projects
 * tab re-opens the LAST project directly when detailProjectId is preserved
 * (App.changeWbTab keeps it for "projects"); from the list it clicks the
 * first project row. Handles both.
 */
async function openProjectDetailViaDrawer() {
  await drawerGo("workbench-nav", "projects");
  const onDetail = await evalJs(`return !!document.querySelector('[data-gg-screen="workbench-project-detail"]');`);
  if (!onDetail) {
    await waitFor(`!!document.querySelector('[data-gg-screen="workbench-projects"]')`);
    await click('[data-testid="workbench-project-item"]');
    await waitFor(`!!document.querySelector('[data-gg-screen="workbench-project-detail"]')`);
  }
}

const DEMO_QUERY = "这个周末上海有什么 AI / Agent / Vibe Coding 的活动？最好免费，徐汇附近，下午开始。";
const MARKER = "p4acc" + Date.now().toString(36);
const PLAN_GOAL = `为${MARKER}活动制定参加计划`;
const EXEC_GOAL = `${MARKER}执行：现场签到并收集资料`;

/* ── The acceptance run ──────────────────────────────────────────────── */

async function main() {
  console.log("── Gorgon Phase 4 · Android E2E acceptance ──");
  console.log("marker:", MARKER);

  await adb("shell", "am", "force-stop", PKG);
  await sleep(1000);
  let boot = await bootAppRetry();
  check("step0: app cold-boots and React mounts (real WebView)", boot.mounted, "pid=" + boot.pid);
  if (!boot.mounted) finishAndExit();

  // step0b: clear STALE acceptance artifacts — projects left by previous
  // acceptance runs. The demo payload is deterministic, so its activity ids
  // re-link to an old project and the「以此活动创建项目」button would never
  // render again (findProjectByActivity hits). keysBefore (step 9) is
  // captured AFTER this cleanup, so the no-destruction check still honestly
  // covers everything THIS run itself touches.
  //
  // PHASE 5 fix (root-caused 2026-10-10 via CDP): a plain removeItem lost
  // step2 on the second run. The wrapper's Preferences removal is
  // fire-and-forget, and force-stop SIGKILLs the process before Chromium
  // flushes the localStorage deletion to disk — verified state after the
  // failed run: Preferences had NO projects key (native removal landed)
  // while localStorage still held the 2 old projects (restored from disk
  // on reboot), so the demo activity ids re-linked. Now: removeItem +
  // AWAIT the native Preferences removal explicitly (kills the hydrate
  // resurrection source) before the cold cycle; step0c guards against a
  // disk resurrection after reboot.
  await evalJs(`
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
    localStorage.removeItem('gorgon_workbench_projects_v1');
    if (P) {
      try {
        await P.remove({ key: 'gorgon_workbench_projects_v1' });
        await P.remove({ key: 'gorgon__rev_gorgon_workbench_projects_v1' });
      } catch (e) { /* native removal failed — step0c guard will verify */ }
    }
    return true;
  `);
  await adb("shell", "am", "force-stop", PKG);
  await sleep(3000);
  boot = await bootAppRetry();
  check("step0b: clean-baseline boot after artifact cleanup", boot.mounted, "pid=" + boot.pid);
  if (!boot.mounted) finishAndExit();

  // step0c (PHASE 5): disk-resurrection guard. If the localStorage deletion
  // did not reach disk before force-stop, the old projects come back from
  // the WebView's own storage on reboot. Clear them again IN THE RUNNING
  // WebView and move on — Preferences is already clean, so a later reboot
  // (step 8) cannot resurrect them via hydrate, and this run's own writes
  // will reflush the deletion to disk within the normal commit window.
  const resurrected = await evalJs(`return localStorage.getItem('gorgon_workbench_projects_v1') != null;`);
  if (resurrected) {
    await evalJs(`localStorage.removeItem('gorgon_workbench_projects_v1'); return true;`);
    check("step0c: stale projects resurrected from disk — re-cleared in the running WebView (P5 baseline guard)", true);
  } else {
    check("step0c: clean baseline holds after reboot (no disk resurrection)", true);
  }

  // Capture the pre-run key set (step 9: old keys must survive untouched).
  const KEY_FILTER = `k => !k.startsWith('gorgon__rev_') && k !== 'setItem' && k !== 'removeItem' && k !== 'clear'`;
  const keysBefore = await evalJs(`return Object.keys(localStorage).filter(${KEY_FILTER}).sort();`);
  check("step9-pre: existing localStorage keys captured", Array.isArray(keysBefore) && keysBefore.length > 0,
    JSON.stringify(keysBefore));

  // ── step 1: search an activity (real retrieval API) ──────────────────
  // The mobile tabbar's data-gg-nav="search" is the LEGACY 搜索 tab
  // (SearchScreen, static keyword search). The NL search lives behind the
  // 更多 drawer as data-gg-nav="smart" (NaturalSearchScreen) — drive that.
  // G_DATE_PICKER G4.1 sync + real-API adaptation (2026-10-13): the APK now
  // points at the deployed retrieval server (providerMode:"real"), so the
  // cold WebView's first real fetch (TLS + planner + crawl) can take 25-40s+
  // — the card wait is 90s. The DEMO-marker assertion became a providerMode
  // honesty assertion: a REAL result honestly carries NO demo badge, and the
  // screen must show the 真实检索 provider badge instead.
  await click('[data-workbench-nav="more"]');
  await waitFor(`!!document.querySelector('[data-testid="workbench-more-drawer"]')`);
  await click('[data-gg-nav="smart"]');
  const askUp = await waitFor(`!!document.querySelector('textarea[aria-label="告诉 Gorgon 你想参加什么活动"]')`, { timeout: 15000 });
  check("step1: 智能搜索 (NaturalSearchScreen) opens from the mobile 更多 drawer", askUp);
  await typeInto('textarea[aria-label="告诉 Gorgon 你想参加什么活动"]', DEMO_QUERY, "HTMLTextAreaElement");
  await clickButton("帮我找活动");
  const gotResults = await waitFor(`document.querySelectorAll('[data-gg-card-id]').length > 0`, { timeout: 90000 });
  const cardCount = gotResults ? await evalJs(`return document.querySelectorAll('[data-gg-card-id]').length;`) : 0;
  check("step1: activity search returns results (real retrieval API)", gotResults, "cards=" + cardCount);

  const realBadge = await evalJs(`
    return [...document.querySelectorAll('*')].some(e => (e.innerText||'').trim() === '真实来源');`);
  const demoBadge = await evalJs(`
    return [...document.querySelectorAll('*')].some(e => (e.innerText||'').trim() === 'DEMO DATA');`);
  // Honesty: exactly ONE of the two — a real result must not be labelled
  // demo, and a demo result must not be labelled real. (The ProviderBadge
  // renders「真实来源」for providerMode:"real" /「演示数据」+ the DEMO DATA
  // NoticeBlock for demo.)
  check("step10a: search results are honestly labelled (真实来源 XOR DEMO DATA)",
    realBadge !== demoBadge, `real=${realBadge} demo=${demoBadge}`);

  // The NL result card has no onClick on the card itself — the「详情」button
  // in its footer opens the overlay. Click that.
  const openedDetail = await evalJs(`
    const card=document.querySelector('[data-gg-card-id]');
    const btn=[...(card||document).querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='详情');
    if(!btn) return false; btn.click(); return true;`);
  check("step1: 「详情」button present on the result card", openedDetail);
  const detailUp = await waitFor(`!!document.querySelector('.gg-detail-overlay')`);
  check("step1: activity detail opens from the card", detailUp);
  const activityTitle = await evalJs(`
    const h=document.querySelector('.gg-detail-overlay h1');
    return h ? h.innerText.trim() : '';`);
  check("step1: activity title present", !!activityTitle, activityTitle.slice(0, 40));

  // ── step 2: create a project FROM the activity ───────────────────────
  const created = await click('[data-testid="activity-create-project"]');
  check("step2: 「以此活动创建项目」clicked", created);
  const onDetail = await waitFor(`!!document.querySelector('[data-gg-screen="workbench-project-detail"]')`);
  check("step2: navigates to the new project detail", onDetail);
  const projectTitle = await evalJs(`
    const h=document.querySelector('[data-gg-screen="workbench-project-detail"] h1');
    return h?h.innerText.trim():'';`);
  check("step2: project title = activity title", projectTitle === activityTitle, projectTitle.slice(0, 40));
  const actLinked = await waitFor(`!!document.querySelector('[data-testid="workbench-project-activity"]')`);
  check("step2: activity is linked into the project", actLinked);
  const actDemo = await evalJs(`return !!document.querySelector('[data-testid="workbench-project-activity-demo"]');`);
  check("step10b: linked DEMO activity keeps its badge inside the project", actDemo);

  // ── step 3 + 4 + 5: Task A — plan → editable pending todos → schedule ─
  await typeInto('[data-testid="workbench-project-task-input"]', PLAN_GOAL);
  await clickButton("添加任务", '[data-testid="workbench-project-tasks"]');
  const taskAShown = await waitFor(`document.querySelectorAll('[data-testid="workbench-project-task"]').length > 0`);
  check("step3: Task A created inside the project", taskAShown);

  // open Task A detail (first task row's clickable title area) — guarded:
  // if step 2 failed there is no task row, and this must not FATAL the run.
  const rowOpened = await evalJs(`
    const rows=[...document.querySelectorAll('[data-testid="workbench-project-task"]')];
    if(!rows.length) return false;
    const row=rows.find(r=>(r.innerText||'').includes(${JSON.stringify(MARKER)})) || rows[0];
    const clickable=row.querySelector('div'); if(clickable){clickable.click();return true;} return false;`);
  if (!rowOpened) {
    check("step3: Task A detail opens", false, "skipped — no task rows (step 2 failed)");
    finishAndExit();
  }
  const taskADetail = await waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`);
  check("step3: Task A detail opens", taskADetail);
  const planTaskId = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
    const t=(env.tasks||[]).find(t=>(t.goal||'')===${JSON.stringify(PLAN_GOAL)});
    return t?t.id:null;`);
  check("step3: Task A persisted in the v2 engine store", !!planTaskId, "id=" + planTaskId);

  // run the plan skill (manual selection) → engine produces a plan result
  await click('[data-testid="workbench-detail-manual-plan"]');
  const planDone = await waitFor(`!!document.querySelector('[data-testid="workbench-detail-save-plan"]')`, { timeout: 40000 });
  check("step4: plan skill executed → suggestions rendered with a save button", planDone);
  const planCopy = await evalJs(`
    const z=document.querySelector('[data-testid="workbench-detail-plan-todos"]');
    return z?(z.innerText||''):'';`);
  check("step10c: plan zone labels them 建议 and never claims completion",
    planCopy.includes("建议") && planCopy.includes("不会替你标记完成"), planCopy.slice(0, 50));

  await click('[data-testid="workbench-detail-save-plan"]');
  await sleep(700);
  const planSteps = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-detail-step"]')]
      .filter(e=>e.innerText.includes('来自规划建议')).length;`);
  const pendingCount = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-detail-step"]')]
      .filter(e=>e.innerText.includes('待执行')).length;`);
  const completedSteps = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-detail-step"]')]
      .filter(e=>/已完成/.test(e.innerText)).length;`);
  check("step4: plan suggestions saved as todo steps", planSteps > 0, "planSteps=" + planSteps);
  check("step4: every saved suggestion starts as 待执行 (AI never marks a suggestion done)",
    pendingCount >= planSteps && planSteps > 0, "pending=" + pendingCount + " plan=" + planSteps);

  // edit one suggestion's title (P0-B: 可编辑)
  const EDITED = `${MARKER}-已人工改写`;
  await click('[data-testid="workbench-detail-step-edit"]');
  const editUp = await waitFor(`!!document.querySelector('[data-testid="workbench-detail-step-edit-input"]')`);
  if (editUp) {
    await typeInto('[data-testid="workbench-detail-step-edit-input"]', EDITED);
    await click('[data-testid="workbench-detail-step-edit-save"]');
    await sleep(500);
  }
  const edited = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-detail-step"]')]
      .some(e=>(e.innerText||'').includes(${JSON.stringify(EDITED)}));`);
  check("step4: a saved suggestion is editable by the user", editUp && edited);

  // step 5: schedule Task A (planned date + due time)
  // G_DATE_PICKER G4.1 sync (2026-10-13): the two schedule testids are now
  // TRIGGER BUTTONS that open the DatePickerSheet — the native inputs are
  // gone. Drive: open the field → click today's grid cell → 确定. The
  // localStorage assertions below (:456-459) are UNCHANGED — they are the
  // "storage format + timezone semantics unchanged" guard and must not be
  // weakened (weakening them = faking results).
  const today = await evalJs(`
    const d=new Date(); const p=n=>String(n).padStart(2,'0');
    return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());`);
  // planned date via the DatePickerSheet
  await click('[data-testid="workbench-detail-schedule-date"]');
  await waitFor(`!!document.querySelector('[data-testid="gg-datepicker-confirm"]')`);
  await click(`[data-testid="gg-datepicker-day"][data-date="${today}"]`);
  await click('[data-testid="gg-datepicker-confirm"]');
  await sleep(500);
  // due time via the datetime DatePickerSheet (18:30 local)
  await click('[data-testid="workbench-detail-schedule-due"]');
  await waitFor(`!!document.querySelector('[data-testid="gg-datepicker-confirm"]')`);
  await click(`[data-testid="gg-datepicker-day"][data-date="${today}"]`);
  // step the time to 18:30: the sheet seeds 09:00 (hh=9, mm=0)
  //   hour +1 x9  → 18:00 ; minute +5 x6 → :30
  await evalJs(`
    const hPlus = document.querySelectorAll('[aria-label="小时加一"]');
    for (let i = 0; i < 9 && hPlus.length; i++) hPlus[0].click();
    return true;`);
  await sleep(200);
  await evalJs(`
    const mPlus = document.querySelectorAll('[aria-label="分钟加一"]');
    for (let i = 0; i < 6 && mPlus.length; i++) mPlus[0].click();
    return true;`);
  await sleep(200);
  await click('[data-testid="gg-datepicker-confirm"]');
  await sleep(500);
  await click('[data-testid="workbench-detail-schedule-save"]');
  const schedSaved = await waitFor(`!!document.querySelector('[data-testid="workbench-detail-schedule-current"]')`);
  check("step5: schedule saved (planned date + due time via DatePickerSheet)", schedSaved);
  const schedStored = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
    const t=(env.tasks||[]).find(t=>t.id===${JSON.stringify(planTaskId)});
    return t?JSON.stringify({s:t.scheduledDate,d:(t.dueAt||'').slice(0,10),st:t.status}):null;`);
  const SS = schedStored ? JSON.parse(schedStored) : {};
  check("step5: schedule persisted on Task A", SS.s === today && SS.d === today, String(schedStored));

  // ── step 6: Task B — user-driven state machine completion + note ─────
  // Back to the project, create Task B.
  await evalJs(`const b=document.querySelector('[data-testid="workbench-detail-back"]'); if(b){b.click();return true;} return false;`);
  await sleep(400);
  await openProjectDetailViaDrawer();
  await typeInto('[data-testid="workbench-project-task-input"]', EXEC_GOAL);
  await clickButton("添加任务", '[data-testid="workbench-project-tasks"]');
  await sleep(500);
  // open Task B
  await evalJs(`
    const rows=[...document.querySelectorAll('[data-testid="workbench-project-task"]')];
    const row=rows.find(r=>(r.innerText||'').includes('执行：现场签到'));
    const clickable=row?row.querySelector('div'):null; if(clickable){clickable.click();return true;} return false;`);
  const taskBDetail = await waitFor(`!!document.querySelector('[data-gg-screen="workbench-task-detail"]')`);
  check("step6: Task B detail opens", taskBDetail);
  const execTaskId = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
    const t=(env.tasks||[]).find(t=>(t.goal||'')===${JSON.stringify(EXEC_GOAL)});
    return t?t.id:null;`);

  // Drive the LEGAL state machine via the sim buttons (they only render for
  // legal transitions, so an illegal move is impossible from the UI).
  for (const [testid, label] of [
    ["workbench-detail-sim-ready", "created→ready"],
    ["workbench-detail-sim-running", "ready→running"],
    ["workbench-detail-sim-completed", "running→completed"],
  ]) {
    const appeared = await waitFor(`!!document.querySelector('[data-testid="${testid}"]')`, { timeout: 8000 });
    const clicked = appeared ? await click(`[data-testid="${testid}"]`) : false;
    await sleep(500);
    check(`step6: state machine ${label}`, appeared && clicked);
  }
  const statusNow = await evalJs(`
    const el=document.querySelector('[data-testid="workbench-detail-status"]');
    return el?el.innerText.trim():'';`);
  check("step6: Task B status = 已完成 through the legal path only", statusNow === "已完成", statusNow);
  const illegalGone = await evalJs(`return !document.querySelector('[data-testid="workbench-detail-sim-completed"]');`);
  check("step6: no further transition offered on a completed task", illegalGone);

  const noteText = `${MARKER} 实际执行记录：材料已备齐，电话确认过场地`;
  await typeInto('[data-testid="workbench-detail-note-input"]', noteText);
  await clickButton("记一笔", '[data-testid="workbench-detail-notes"]');
  await sleep(600);
  const noteShown = await waitFor(`!!document.querySelector('[data-testid="workbench-detail-note"]')`);
  check("step6: execution note attached to Task B", noteShown);
  const noteStored = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const n=(env.notes||[]).find(n=>(n.text||'').includes(${JSON.stringify(MARKER)}));
    return n?JSON.stringify({task:n.taskId,project:!!n.projectId}):null;`);
  const NS = noteStored ? JSON.parse(noteStored) : {};
  check("step6: note persisted with task + project links",
    NS.task === execTaskId && NS.project === true, String(noteStored));

  // ── step 7: save the project review (user-written) ───────────────────
  await evalJs(`const b=document.querySelector('[data-testid="workbench-detail-back"]'); if(b){b.click();return true;} return false;`);
  await sleep(400);
  await openProjectDetailViaDrawer();
  // openProjectDetailViaDrawer lands on the DETAIL screen when the projects
  // tab preserved detailProjectId — the 含 DEMO 活动 badge lives on the LIST
  // screen, the DEMO 数据 badge lives on the detail's activity card. Check
  // both: the detail badge here, the list badge after「返回项目列表」.
  const demoBadgeDetail = await evalJs(`return !!document.querySelector('[data-testid="workbench-project-activity-demo"]');`);
  const backBtn = await evalJs(`return !!document.querySelector('[data-testid="workbench-project-back"]');`);
  let demoBadgeList = false;
  if (backBtn) {
    await evalJs(`document.querySelector('[data-testid="workbench-project-back"]').click(); return true;`);
    await sleep(500);
    demoBadgeList = await evalJs(`return !!document.querySelector('[data-testid="workbench-project-demo-badge"]');`);
    // go back into the detail for the review steps below
    await click('[data-testid="workbench-project-item"]');
    await sleep(500);
  }
  check("step10d: project keeps the DEMO badges (detail 活动 DEMO 数据 + list 含 DEMO 活动)",
    demoBadgeDetail && demoBadgeList, `detail=${demoBadgeDetail} list=${demoBadgeList}`);

  const outcomeText = `${MARKER} 复盘：完成报名并到场，认识 3 位开发者`;
  const nextText = `${MARKER} 下一步：周三前发合作方案`;
  await typeInto('[data-testid="workbench-project-review-outcome"]', outcomeText, "HTMLTextAreaElement");
  await typeInto('[data-testid="workbench-project-review-next"]', nextText);
  await click('[data-testid="workbench-project-review-save"]');
  await sleep(700);
  const reviewStored = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const rs=Object.values(env.projectReviews||{});
    const r=rs.find(r=>(r.outcome||'').includes(${JSON.stringify(MARKER)}));
    return r?JSON.stringify({o:(r.outcome||'').slice(0,16),n:(r.nextAction||'').slice(0,16)}):null;`);
  check("step7: review (outcome + next action) persisted", !!reviewStored, String(reviewStored));

  const hubCompleted = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-project-task"]')]
      .some(e=>(e.innerText||'').includes('已完成'));`);
  check("step7: project hub shows a completed task", hubCompleted);
  const hubSched = await waitFor(`document.querySelectorAll('[data-testid="workbench-project-schedule-item"]').length > 0`);
  check("step7: project schedule view shows the dated task", hubSched);
  const hubNote = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-project-note-text"]')]
      .some(e=>(e.innerText||'').includes(${JSON.stringify(MARKER)}));`);
  check("step7: project hub shows the execution note", hubNote);

  // ── step 8: force-stop → true cold restart → everything restored ─────
  await adb("shell", "am", "force-stop", PKG);
  await sleep(1500);
  const deadR = await adb("shell", "pidof", PKG);
  const dead = String(deadR.stdout || "").trim();
  check("step8: process killed (force-stop)", dead === "", "pidof=[" + dead + "]");
  boot = await bootAppRetry();
  check("step8: app cold-restarts and React mounts", boot.mounted, "new pid=" + boot.pid);

  const homeOk = await waitFor(`!!document.querySelector('[data-testid="workbench-home-projects"]')`);
  check("step8: home renders the project section after cold start", homeOk);
  const homeProject = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-home-project"]')]
      .some(e=>(e.innerText||'').includes(${JSON.stringify(activityTitle.slice(0, 10))}));`);
  check("step8: the project survived the cold restart (home list)", homeProject);
  const homeToday = await evalJs(`return document.querySelectorAll('[data-testid="workbench-today-item"]').length;`);
  check("step8: today's scheduled task restored on home (今日待办)", homeToday >= 1, "todayItems=" + homeToday);
  const homeNote = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-recent-note"]')]
      .some(e=>(e.innerText||'').includes(${JSON.stringify(MARKER)}));`);
  check("step8: execution note restored on home (最近记录)", homeNote);

  const restored = await evalJs(`
    const tEnv=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
    const A=(tEnv.tasks||[]).find(t=>(t.goal||'')===${JSON.stringify(PLAN_GOAL)});
    const B=(tEnv.tasks||[]).find(t=>(t.goal||'')===${JSON.stringify(EXEC_GOAL)});
    const oEnv=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const n=(oEnv.notes||[]).find(n=>(n.text||'').includes(${JSON.stringify(MARKER)}));
    const rs=Object.values(oEnv.projectReviews||{});
    const r=rs.find(r=>(r.outcome||'').includes(${JSON.stringify(MARKER)}));
    const pEnv=JSON.parse(localStorage.getItem('gorgon_workbench_projects_v1')||'{}');
    const p=(pEnv.projects||[]).find(p=>(p.title||'')===${JSON.stringify(activityTitle)});
    return JSON.stringify({
      planTask:!!A, planStatus:A?A.status:null, sched:A?A.scheduledDate:null, due:A?(A.dueAt||'').slice(0,10):null,
      planSteps:A?(A.steps||[]).filter(s=>s.metadata&&s.metadata.origin==='plan_suggestion').length:0,
      pendingSteps:A?(A.steps||[]).filter(s=>s.status==='pending').length:0,
      execTask:!!B, execStatus:B?B.status:null, note:!!n, review:!!r,
      project:!!p, projectActivity:p?(p.activities||[]).length:0
    });`);
  const Rr = JSON.parse(restored);
  check("step8: Task A restored (plan) with schedule", Rr.planTask && Rr.sched === today && Rr.due === today, restored);
  check("step8: Task A plan todos restored, still pending (not auto-completed)",
    Rr.planSteps > 0 && Rr.pendingSteps >= 1, `planSteps=${Rr.planSteps} pending=${Rr.pendingSteps}`);
  check("step8: Task B restored with completed status", Rr.execTask && Rr.execStatus === "completed", `B=${Rr.execStatus}`);
  check("step8: note restored", Rr.note);
  check("step8: review restored", Rr.review);
  check("step8: project + activity link restored", Rr.project && Rr.projectActivity >= 1);

  const nativeMirror = await evalJs(`
    const p=window.__GORGON_PERSISTENCE__;
    return p?JSON.stringify({native:p.native,mirrored:p.mirrored,hydrated:p.hydratedKeys}):null;`);
  check("step8: persistence bridge reports native + mirrored + hydrated",
    !!nativeMirror && nativeMirror.includes('"native":true') && nativeMirror.includes('"mirrored":true'),
    String(nativeMirror));

  // ── step 9: legacy data still readable ───────────────────────────────
  const keysAfter = await evalJs(`return Object.keys(localStorage).filter(${KEY_FILTER}).sort();`);
  const missing = keysBefore.filter((k) => keysAfter.indexOf(k) < 0);
  check("step9: every pre-run localStorage key still exists (no data destroyed)",
    missing.length === 0, "missing=" + JSON.stringify(missing));
  const envelope = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_workbench_tasks_v2')||'{}');
    return JSON.stringify({n:(env.tasks||[]).length, schema:env.schemaVersion});`);
  const EN = JSON.parse(envelope);
  check("step9: task engine v2 envelope intact (schemaVersion=2)", EN.schema === 2 && EN.n >= 2, envelope);

  await drawerGo("gg-nav", "weekend");
  const weekendOk = await waitFor(`!!document.querySelector('[data-gg-screen="weekend"]')`);
  check("step9: legacy 我的周末 surface still opens", weekendOk);

  // ── step 10: DEMO honesty sweep on the home ──────────────────────────
  await click('[data-workbench-nav="home"]');
  await waitFor(`!!document.querySelector('[data-testid="workbench-home-projects"]')`);
  const homeDemoMark = await evalJs(`
    const p=document.querySelector('[data-testid="workbench-home-project"]');
    return p?(p.innerText||'').includes('DEMO'):false;`);
  check("step10e: home project row keeps the DEMO tag (demo never masquerades as real)", homeDemoMark);

  /* ── summary ─────────────────────────────────────────────────────── */
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n── android-phase4-e2e: ${pass} passed, ${results.length - pass} failed ──`);
  cdpClose();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

/** Early summary + exit when a downstream step cannot run (upstream failed). */
function finishAndExit() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n── android-phase4-e2e (early exit): ${pass} passed, ${results.length - pass} failed ──`);
  cdpClose();
  process.exit(1);
}

main().catch((e) => { console.error("FATAL", e && e.stack || e); process.exit(2); });
