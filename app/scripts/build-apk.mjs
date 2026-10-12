// Gorgon — APK build script: production bundle with the real retrieval API.
//
// The phone APK has no backend of its own: the WebView runs on
// https://localhost (Capacitor androidScheme) and a same-origin /api/search
// fetch finds nothing. The retrieval server (pipeline/api/server.py) is
// deployed separately, so the APK bundle must point VITE_API_BASE_URL at it
// (see src/lib/api.js — the ONE API configuration layer; nothing else in the
// app may hard-code an API URL).
//
// This script exists because VITE_* variables are BUILD-TIME: a plain
// `npm run build` produces a bundle that talks to same-origin /api, which is
// correct for `vite preview` / a co-hosted deploy but useless inside the
// APK. It sets the env var, runs the normal vite build, and syncs the
// result into the Android project — one command:
//
//     node scripts/build-apk.mjs
//
// Override the server address with GORGON_APK_API_BASE (default: the public
// deployment). No secret is involved: the base URL is public information by
// design (docs/PUBLIC_DEPLOYMENT.md), and provider keys never reach the
// browser — they stay on the Python server.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");

// Default: the CORS-enabled public deployment (the legacy
// shanghai-activity-search host runs the pre-CORS server and MUST NOT be
// used for APK builds — the WebView fetch would be blocked there).
const API_BASE = (process.env.GORGON_APK_API_BASE || "https://2109679843717304320.app.workbuddy.host").replace(/\/+$/, "");

function run(cmd, args, label) {
  console.log(`[build-apk] ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: APP,
    stdio: "inherit",
    env: { ...process.env, VITE_API_BASE_URL: API_BASE },
  });
  if (r.status !== 0) {
    console.error(`[build-apk] ${label} FAILED (exit ${r.status})`);
    process.exit(r.status == null ? 1 : r.status);
  }
}

console.log(`[build-apk] VITE_API_BASE_URL=${API_BASE}`);
run(process.execPath, [path.join(APP, "node_modules", "vite", "bin", "vite.js"), "build"], "vite build");
run(process.execPath, [path.join(APP, "node_modules", "@capacitor", "cli", "bin", "capacitor"), "sync", "android"], "cap sync");
console.log("[build-apk] done — next: gradle assembleRelease (see release/HANDOFF_CONTEXT.md)");
