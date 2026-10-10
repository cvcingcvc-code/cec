// Gorgon 2.0 — Android restart-persistence acceptance probe (Module A).
//
// Drives the running app through Chrome DevTools Protocol (adb forward):
//   1. read window.__GORGON_PERSISTENCE__ (boot diagnostics)
//   2. write a unique token via localStorage (exactly what the repositories do)
//   3. wait for the debounced Preferences mirror flush
//   4. verify the token landed in Capacitor Preferences (native durable store)
//   5. CALLER then force-stops + relaunches the app (real process death)
//   6. read the token back from localStorage AND Preferences
//
// Phases are separate invocations (--phase write|verify-native|read-after)
// so the kill/restart happens OUTSIDE this process — a genuine cold start.
//
// Usage:
//   node tests/cdp-probe.mjs --phase write   --token T
//   node tests/cdp-probe.mjs --phase verify-native --token T
//   node tests/cdp-probe.mjs --phase read-after   --token T
// Exit 0 = phase assertion passed.

const WS_URL_TARGET = "http://127.0.0.1:9222/json";

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function getPageWs() {
  const res = await fetch(WS_URL_TARGET);
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target — is the app running?");
  return page.webSocketDebuggerUrl;
}

async function evaluate(expression) {
  const wsUrl = await getPageWs();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const send = (id, method, params) =>
    ws.send(JSON.stringify({ id, method, params }));
  const result = await new Promise((resolve, reject) => {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    send(1, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 20000,
    });
  });
  ws.close();
  if (result.exceptionDetails) {
    throw new Error("page exception: " + JSON.stringify(result.exceptionDetails.exception || result.exceptionDetails.text));
  }
  return result.result.value;
}

const KEY = "gorgon_persist_probe_token";

async function main() {
  const phase = arg("phase", "write");
  const token = arg("token", "gorgon-android-" + Date.now());

  if (phase === "write") {
    const boot = await evaluate("JSON.stringify(window.__GORGON_PERSISTENCE__ || null)");
    console.log("BOOT_PERSISTENCE=" + boot);
    const wrote = await evaluate(
      `(function(){ try { localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(token)}); return localStorage.getItem(${JSON.stringify(KEY)}); } catch(e){ return 'ERR:'+e.message; } })()`
    );
    console.log("WRITE_TOKEN=" + wrote);
    if (wrote !== token) { console.log("PHASE=write RESULT=FAIL"); process.exit(1); }
    // wait out the 250ms mirror debounce + native round-trip slack
    await new Promise((r) => setTimeout(r, 2500));
    console.log("PHASE=write RESULT=PASS token=" + token);
    return;
  }

  if (phase === "verify-native") {
    // read through the Preferences plugin Capacitor registered natively.
    // Use the global plugin bridge (window.Capacitor.Plugins.Preferences) —
    // a bare `import('@capacitor/preferences')` would not resolve at runtime
    // inside the already-bundled page.
    const native = await evaluate(
      `(async function(){ try {
        const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
        if (!P) return 'NO_PLUGIN';
        const r = await P.get({ key: ${JSON.stringify(KEY)} });
        return r.value;
      } catch(e){ return 'ERR:'+e.message; } })()`
    );
    console.log("NATIVE_PREFERENCES_TOKEN=" + native);
    if (native !== token) { console.log("PHASE=verify-native RESULT=FAIL"); process.exit(1); }
    console.log("PHASE=verify-native RESULT=PASS");
    return;
  }

  if (phase === "read-after") {
    const boot = await evaluate("JSON.stringify(window.__GORGON_PERSISTENCE__ || null)");
    console.log("BOOT_PERSISTENCE_AFTER_RESTART=" + boot);
    const ls = await evaluate(
      `(function(){ try { return localStorage.getItem(${JSON.stringify(KEY)}); } catch(e){ return 'ERR:'+e.message; } })()`
    );
    console.log("LOCALSTORAGE_TOKEN_AFTER_RESTART=" + ls);
    const native = await evaluate(
      `(async function(){ try {
        const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
        if (!P) return 'NO_PLUGIN';
        const r = await P.get({ key: ${JSON.stringify(KEY)} });
        return r.value;
      } catch(e){ return 'ERR:'+e.message; } })()`
    );
    console.log("NATIVE_TOKEN_AFTER_RESTART=" + native);
    if (ls === token) { console.log("PHASE=read-after RESULT=PASS (localStorage)"); return; }
    if (native === token) { console.log("PHASE=read-after RESULT=PASS (native mirror; localStorage hydrate pending)"); return; }
    console.log("PHASE=read-after RESULT=FAIL");
    process.exit(1);
  }

  console.error("unknown phase: " + phase);
  process.exit(2);
}

main().catch((e) => {
  console.error("PROBE_ERROR: " + e.message);
  process.exit(1);
});
