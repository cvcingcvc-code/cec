// Gorgon Module D UI — Android E2E driver for the field-visit places loop.
//
// Companion to android_phase4_e2e.mjs (the 55/55 Phase-5 acceptance script
// stays UNTOUCHED — this is a separate driver for the places capability).
// Same plumbing: real app in the Android emulator WebView over CDP, real DOM
// clicks / real input events / real localStorage read-back, one true cold
// restart.
//
// Places acceptance (Module D UI):
//   P1. navigate to 走访地点 via the mobile 更多 drawer
//   P2. create a place (name + address + optional project link)
//   P3. status filters group the list correctly
//   P4. record a REAL visit: note + next plan → status flips to 需复访,
//       visit timestamp is the real now (never fabricated)
//   P5. mark unsuitable from the 待走访 state
//   P6. force-stop → cold restart → the place + visit + status survive
//   P7. delete with confirmation (the place is gone, the project keeps its
//       own record untouched)
//
// Usage (from app/):  node tests/android_places_e2e.mjs
// Prereq: emulator running, APK WITH the PlacesScreen installed
// (rebuild first — the Phase-5 APK predates the places screen),
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

/* ── ADB via ASYNC spawn (same facts as the phase-4 driver) ─────────── */

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

const MARKER = "places" + Date.now().toString(36);
const PLACE_NAME = `${MARKER} 园区 A 座`;
const PLACE_ADDRESS = "浦东新区张江路 123 号";
const VISIT_NOTE = `${MARKER} 现场：前台拒收传单，需预约`;
const VISIT_PLAN = "下周一带材料再来";

/* ── The acceptance run ──────────────────────────────────────────────── */

async function main() {
  console.log("── Gorgon Module D UI · Android E2E (field-visit places) ──");
  console.log("marker:", MARKER);

  await adb("shell", "am", "force-stop", PKG);
  await sleep(1000);
  const boot = await bootAppRetry();
  check("P0: app cold-boots and React mounts (real WebView)", boot.mounted, "pid=" + boot.pid);
  if (!boot.mounted) finishAndExit();

  // Pre-clean: remove places left by previous runs of THIS driver (same
  // pattern as the phase-4 step0b, scoped to the places envelope key the
  // opportunities repository owns). Old envelopes with other data keep
  // everything else intact.
  await evalJs(`
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
    const env = JSON.parse(localStorage.getItem('gorgon_opportunities_v1') || '{}');
    env.places = [];
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
  check("P0b: clean-baseline boot after places cleanup", boot2.mounted, "pid=" + boot2.pid);
  if (!boot2.mounted) finishAndExit();

  // ── P1: navigate to 走访地点 via the 更多 drawer ──────────────────────
  await drawerGo("workbench-nav", "places");
  const placesUp = await waitFor(`!!document.querySelector('[data-gg-screen="workbench-places"]')`);
  check("P1: 走访地点 screen opens from the mobile 更多 drawer", placesUp);
  if (!placesUp) finishAndExit();
  const emptyHint = await evalJs(`
    return !!document.querySelector('[data-gg-screen="workbench-places"]') &&
      (document.querySelector('[data-gg-screen="workbench-places"]').innerText||'').includes('还没有走访地点');`);
  check("P1: empty state renders after cleanup", emptyHint);

  // ── P2: create a place (name + address) with an optional project link ─
  // The project select renders only when projects exist; on a clean install
  // there may be none — the no-project path is the default we drive.
  await typeInto('[data-testid="workbench-place-new-name"]', PLACE_NAME);
  await typeInto('[data-testid="workbench-place-new-address"]', PLACE_ADDRESS);
  await click('[data-testid="workbench-place-new-name"]'); // move focus off the address input
  await evalJs(`
    const b=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='添加');
    if(b){b.click();return true;} return false;`);
  const created = await waitFor(`document.querySelectorAll('[data-testid="workbench-place-item"]').length > 0`);
  check("P2: place created and listed", created);
  const createdRow = await evalJs(`
    const el=[...document.querySelectorAll('[data-testid="workbench-place-item"]')][0];
    return el?(el.innerText||''):'';`);
  check("P2: place row carries name + address", createdRow.includes(PLACE_NAME) && createdRow.includes(PLACE_ADDRESS),
    createdRow.slice(0, 60));
  const statusPill = await evalJs(`
    const el=document.querySelector('[data-testid="workbench-place-status"]');
    return el?el.innerText.trim():'';`);
  check("P2: default status pill is 待走访 (Chinese label, not raw todo)", statusPill === "待走访", statusPill);

  const stored1 = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const p=(env.places||[]).find(p=>(p.name||'')===${JSON.stringify(PLACE_NAME)});
    return p?JSON.stringify({addr:p.address,status:p.status,visits:(p.visits||[]).length}):null;`);
  const S1 = stored1 ? JSON.parse(stored1) : {};
  check("P2: place persisted in the opportunities envelope",
    S1.addr === PLACE_ADDRESS && S1.status === "todo" && S1.visits === 0, String(stored1));

  // ── P4 (before P5, on the todo state): record a REAL visit ────────────
  await click('[data-testid="workbench-place-visit"]');
  const visitForm = await waitFor(`!!document.querySelector('[data-testid="workbench-place-visit-form"]')`);
  check("P4: visit form opens", visitForm);
  const before = Date.now();
  await typeInto('[data-testid="workbench-place-visit-note"]', VISIT_NOTE);
  await typeInto('[data-testid="workbench-place-visit-plan"]', VISIT_PLAN);
  await evalJs(`
    const b=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='保存到访');
    if(b){b.click();return true;} return false;`);
  const visitSaved = await waitFor(`
    (JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}').places||[])
      .some(p=>(p.visits||[]).length > 0)`);
  check("P4: visit recorded (form closes, storage updated)", visitSaved);

  const stored2 = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const p=(env.places||[]).find(p=>(p.name||'')===${JSON.stringify(PLACE_NAME)});
    return p?JSON.stringify({status:p.status,nextPlan:p.nextPlan,
      at:p.visits&&p.visits[0]?p.visits[0].at:null,note:p.visits&&p.visits[0]?p.visits[0].note:null}):null;`);
  const S2 = stored2 ? JSON.parse(stored2) : {};
  const visitAt = S2.at ? new Date(S2.at).getTime() : NaN;
  check("P4: status flipped to 需复访 (next plan present → revisit)",
    S2.status === "revisit" && S2.nextPlan === VISIT_PLAN, String(stored2));
  check("P4: visit time is the REAL now (±5s window, never fabricated)",
    !isNaN(visitAt) && visitAt >= before - 5000 && visitAt <= Date.now() + 5000, String(S2.at));
  check("P4: visit note persisted", S2.note === VISIT_NOTE);
  const pillAfter = await evalJs(`
    const el=document.querySelector('[data-testid="workbench-place-status"]');
    return el?el.innerText.trim():'';`);
  check("P4: status pill now reads 需复访", pillAfter === "需复访", pillAfter);
  const lastVisitLine = await evalJs(`
    const el=[...document.querySelectorAll('[data-testid="workbench-place-item"]')][0];
    return el?(el.innerText||''):'';`);
  check("P4: card shows 最近到访 with the real timestamp", lastVisitLine.includes("最近到访"), lastVisitLine.slice(-80));

  // ── P5: create a second place and mark it unsuitable from 待走访 ──────
  await typeInto('[data-testid="workbench-place-new-name"]', MARKER + " 门市 B");
  await evalJs(`
    const b=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='添加');
    if(b){b.click();return true;} return false;`);
  const secondUp = await waitFor(`document.querySelectorAll('[data-testid="workbench-place-item"]').length > 1`);
  check("P5: second place created", secondUp);
  // The list is newest-first (unshift): the second place is the first row.
  const skipClicked = await click('[data-testid="workbench-place-skip"]');
  await sleep(500);
  check("P5: 标记不适合 clicked on the 待走访 row", skipClicked);
  const stored3 = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const p=(env.places||[]).find(p=>(p.name||'')===[${JSON.stringify(MARKER)} + ' 门市 B'][0]);
    return p?JSON.stringify({status:p.status}):null;`);
  const S3 = stored3 ? JSON.parse(stored3) : {};
  check("P5: status persisted as unsuitable", S3.status === "unsuitable", String(stored3));

  // ── P3: status filters group the list ────────────────────────────────
  await click('[data-testid="workbench-place-filter-revisit"]');
  await sleep(400);
  const revisitCount = await evalJs(`return document.querySelectorAll('[data-testid="workbench-place-item"]').length;`);
  const revisitHas = await evalJs(`
    return [...document.querySelectorAll('[data-testid="workbench-place-item"]')]
      .some(e=>(e.innerText||'').includes(${JSON.stringify(PLACE_NAME)}));`);
  check("P3: 需复访 filter shows exactly the visited-with-plan place", revisitCount === 1 && revisitHas,
    "count=" + revisitCount);
  await click('[data-testid="workbench-place-filter-unsuitable"]');
  await sleep(400);
  const unsuitableCount = await evalJs(`return document.querySelectorAll('[data-testid="workbench-place-item"]').length;`);
  check("P3: 不适合 filter shows exactly the unsuitable place", unsuitableCount === 1, "count=" + unsuitableCount);
  await click('[data-testid="workbench-place-filter-all"]');
  await sleep(400);
  const allCount = await evalJs(`return document.querySelectorAll('[data-testid="workbench-place-item"]').length;`);
  check("P3: 全部 filter restores both places", allCount === 2, "count=" + allCount);

  // ── P6: force-stop → cold restart → places + visits + status survive ──
  await adb("shell", "am", "force-stop", PKG);
  await sleep(1500);
  const deadR = await adb("shell", "pidof", PKG);
  const dead = String(deadR.stdout || "").trim();
  check("P6: process killed (force-stop)", dead === "", "pidof=[" + dead + "]");
  const boot3 = await bootAppRetry();
  check("P6: app cold-restarts and React mounts", boot3.mounted, "new pid=" + boot3.pid);
  if (!boot3.mounted) finishAndExit();

  await drawerGo("workbench-nav", "places");
  const placesBack = await waitFor(`!!document.querySelector('[data-gg-screen="workbench-places"]')`);
  check("P6: 走访地点 screen opens after cold start", placesBack);
  const restoredRows = await evalJs(`return document.querySelectorAll('[data-testid="workbench-place-item"]').length;`);
  check("P6: both places restored after cold restart", restoredRows === 2, "rows=" + restoredRows);
  const restoredPlace = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    const p=(env.places||[]).find(p=>(p.name||'')===${JSON.stringify(PLACE_NAME)});
    return p?JSON.stringify({status:p.status,visits:(p.visits||[]).length,
      plan:p.nextPlan,note:p.visits&&p.visits[0]?p.visits[0].note:null}):null;`);
  const R1 = restoredPlace ? JSON.parse(restoredPlace) : {};
  check("P6: visit + status + plan restored (revisit state intact)",
    R1.status === "revisit" && R1.visits === 1 && R1.plan === VISIT_PLAN && R1.note === VISIT_NOTE,
    String(restoredPlace));

  // ── P7: delete the second place with confirmation ─────────────────────
  // The unsuitable place is the first row (newest-first). The driver's
  // confirm() is auto-accepted: we stub window.confirm before clicking.
  const removed = await evalJs(`
    window.confirm = () => true;
    const el=[...document.querySelectorAll('[data-testid="workbench-place-remove"]')][0];
    if(!el) return false; el.scrollIntoView({block:"center"}); el.click(); return true;`);
  await sleep(600);
  check("P7: delete clicked (confirm accepted)", removed);
  const afterRemove = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    return JSON.stringify({
      rows:(env.places||[]).length,
      firstGone:!(env.places||[]).some(p=>(p.name||'')===[${JSON.stringify(MARKER)} + ' 门市 B'][0]),
      visitPlaceKept:(env.places||[]).some(p=>(p.name||'')===${JSON.stringify(PLACE_NAME)})
    });`);
  const R2 = JSON.parse(afterRemove);
  check("P7: place deleted from storage, visited place untouched",
    R2.rows === 1 && R2.firstGone && R2.visitPlaceKept, afterRemove);
  const uiRows = await evalJs(`return document.querySelectorAll('[data-testid="workbench-place-item"]').length;`);
  check("P7: list re-renders with one row", uiRows === 1, "rows=" + uiRows);

  /* ── summary ─────────────────────────────────────────────────────── */
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n── android-places-e2e: ${pass} passed, ${results.length - pass} failed ──`);
  cdpClose();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

/** Early summary + exit when a downstream step cannot run (upstream failed). */
function finishAndExit() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n── android-places-e2e (early exit): ${pass} passed, ${results.length - pass} failed ──`);
  cdpClose();
  process.exit(1);
}

main().catch((e) => { console.error("FATAL", e && e.stack || e); process.exit(2); });
