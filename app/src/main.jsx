// Gorgon V1 — frontend entry point.
//
// Replaces ui_kits/app/index.html's runtime stack (React development build
// + ReactDOM development build + Babel Standalone + window.lucide +
// _ds_bundle.js runtime fetch/compile) with a standard Vite module graph.
// Everything below is compiled at BUILD time; the production bundle ships
// the production React and no transpiler.

// Design system CSS — the SAME files the legacy app links, imported (not
// copied) so the two frontends can never drift apart visually.
import "../../styles.css";
import "../../ui_kits/app/responsive.css";

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { applyCategoryExtensions } from "./lib/categories.js";
import { initDemoReset } from "./lib/demo-reset.js";
import { initDemoMode } from "./lib/demo-mode.js";
import { initNativePersistence } from "./lib/native-persistence.js";

// Gorgon 2.0 Module A: on native (Android/Capacitor) restore durable data
// from Preferences INTO localStorage before anything reads it. On web this
// is an immediate no-op.
//
// HARD INVARIANT: React MUST mount. A white screen is worse than losing the
// native mirror, so persistence init is (a) raced against a timeout and
// (b) fully wrapped in try/catch, and render() runs in `finally`. If the
// bridge hangs or throws, we still show the app on session localStorage and
// record the degradation on window.__GORGON_PERSISTENCE__.
const PERSIST_TIMEOUT_MS = 3000;

const boot = async () => {
  let persistence = { native: false, mirrored: false, hydratedKeys: 0, timedOut: false };
  try {
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ __timeout: true }), PERSIST_TIMEOUT_MS)
    );
    const done = await Promise.race([initNativePersistence(), timeout]);
    if (done && done.__timeout) {
      persistence = Object.assign(persistence, { error: "persist-init-timeout", timedOut: true });
      console.warn("[gorgon] native persistence init timed out; booting on session storage");
    } else if (done) {
      persistence = done;
      if (done.error) console.warn("[gorgon] native persistence degraded:", done.error);
    }
  } catch (e) {
    persistence = Object.assign(persistence, { error: String((e && e.message) || e) });
    console.warn("[gorgon] native persistence threw:", e);
  } finally {
    window.__GORGON_PERSISTENCE__ = persistence; // observable in tests/acceptance
  }

  // Additive category extension (科技/黑客松/展览/市集/讲座/社交/校园/公益)
  // — must run BEFORE the first render so var(--cat-*) resolves everywhere.
  try { applyCategoryExtensions(); } catch (e) { console.warn("[gorgon] categories:", e); }

  // Phase 7: ?demo=1 seeds a reproducible, offline competition demo task
  // (idempotent), then mounts the reset chip. Must run BEFORE the first render
  // so the seeded task is present when App reads the repository.
  try { initDemoMode(); initDemoReset(); } catch (e) { console.warn("[gorgon] demo seed:", e); }

  createRoot(document.getElementById("root")).render(<App />);
};

// Register the PWA service worker in production builds only (skip the Vite
// dev server so it never caches dev assets). localhost is a secure context,
// so installability also works under `vite preview` and any HTTPS deploy.
// NOTE: skipped inside Capacitor (capacitor:// origin) — the native shell
// serves assets itself; a service worker there would only risk stale caches.
if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http") &&
  !window.Capacitor?.isNativePlatform?.()
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

boot();
