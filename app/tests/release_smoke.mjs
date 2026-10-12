// Gorgon A3 — release APK smoke check (Module D UI + workbench core).
// SELF-SUFFICIENT driver (same lesson as android_phase4_e2e.mjs): the adb
// daemon is reaped between external calls and every reap drops the tcp:9222
// forward, so this script owns the whole chain — pidof → forward → CDP —
// inside one process, then verifies the RELEASE build renders the workbench
// and the places screen works (create → status pill → storage read-back).

import { spawn } from "node:child_process";

const ADB = "F:/gorgon-android-toolchain/sdk/platform-tools/adb.exe";
const PKG = "cn.gorgon.workbench";
const CDP = "http://127.0.0.1:9222";
let ws = null;
let msgId = 0;
const pending = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function pidOf(pkg, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await adb("shell", "pidof", pkg);
    const out = String(r.stdout || "").trim();
    const pid = out.split(/\s+/)[0];
    if (pid) return pid;
    await sleep(2000);
  }
  return null;
}

async function cdpConnect(tries = 20) {
  // Re-establish the forward RIGHT before connecting (a forward set up by an
  // earlier process is gone — the daemon is reaped between calls).
  const pid = await pidOf(PKG);
  if (!pid) throw new Error("app process not found (pidof empty) — is the release app running?");
  await adb("forward", "--remove", "tcp:9222");
  await adb("forward", "tcp:9222", "localabstract:webview_devtools_remote_" + pid);
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
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error("CDP unreachable");
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

async function waitFor(expr, { timeout = 20000, interval = 300 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await evalJs(`return (${expr});`)) return true; } catch { /* poll */ }
    await sleep(interval);
  }
  return false;
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const click = (sel) => evalJs(`
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  el.click(); return true;`);

const typeInto = (sel, text) => evalJs(`
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;`);

async function main() {
  console.log("── Gorgon A3 · release APK smoke ──");
  await cdpConnect();

  // S1: React mounted on the release build
  const mounted = await waitFor(`!!document.querySelector('[data-gg-screen]')`);
  check("S1: React mounts (release WebView)", mounted);
  if (!mounted) { process.exit(1); }

  // S2: workbench home renders the core surfaces
  const home = await waitFor(`!!document.querySelector('[data-testid="workbench-home-projects"]') || !!document.querySelector('[data-gg-screen="workbench-home"]')`);
  check("S2: workbench home renders", home);

  // S3: places screen opens via the drawer
  await click('[data-workbench-nav="more"]');
  await waitFor(`!!document.querySelector('[data-testid="workbench-more-drawer"]')`);
  await click('[data-workbench-nav="places"]');
  const placesUp = await waitFor(`!!document.querySelector('[data-gg-screen="workbench-places"]')`);
  check("S3: 走访地点 screen opens", placesUp);

  // S4: create a place (release-build persistence through the same repo)
  const NAME = "release-smoke-" + Date.now().toString(36);
  await typeInto('[data-testid="workbench-place-new-name"]', NAME);
  await evalJs(`
    const b=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim()==='添加');
    if(b){b.click();return true;} return false;`);
  const created = await waitFor(`document.querySelectorAll('[data-testid="workbench-place-item"]').length > 0`);
  check("S4: place created and listed", created);
  const pill = await evalJs(`
    const el=document.querySelector('[data-testid="workbench-place-status"]');
    return el?el.innerText.trim():'';`);
  check("S5: status pill renders Chinese label", pill === "待走访", pill);

  // S6: persisted in the opportunities envelope
  const stored = await evalJs(`
    const env=JSON.parse(localStorage.getItem('gorgon_opportunities_v1')||'{}');
    return (env.places||[]).some(p=>(p.name||'')===${JSON.stringify(NAME)});`);
  check("S6: place persisted in the envelope", stored);

  const pass = results.filter(Boolean).length;
  console.log(`\n── release smoke: ${pass}/${results.length} passed ──`);
  try { ws && ws.close(); } catch { /* gone */ }
  process.exit(results.every(Boolean) ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e && e.stack || e); process.exit(2); });
