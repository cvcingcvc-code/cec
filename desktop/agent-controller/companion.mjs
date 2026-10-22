#!/usr/bin/env node
// Gorgon PC Agent Controller V1 — Windows Companion 常驻启动器 (Phase B).
//
// WHAT THIS IS
// ------------
// A thin wrapper that keeps the agent gateway ALIVE: auto-restart on crash,
// optional auto-start at Windows login (Startup shortcut), and a stable
// state location under the user profile so task records survive reboots.
//
//   node desktop/agent-controller/companion.mjs [--port 8765] [--lan]
//   node desktop/agent-controller/companion.mjs install-startup   # 登录自启
//   node desktop/agent-controller/companion.mjs remove-startup
//
// SECURITY: the companion adds NO new network surface. It only supervises
// scripts/agent-gateway.mjs (token auth, executor allowlist — unchanged).
//
// RECOVERY (§一): the gateway already persists runs.json + audit.log and
// marks in-flight rows failed honestly on restart. The companion sets
// GORGON_GATEWAY_STATE_DIR to %USERPROFILE%\.gorgon-agent-controller by
// default so records survive repo rebuilds and reboots.
//
// V3L P0 FIX: the Startup .bat now runs THIS FILE (companion.mjs), not the
// gateway directly, and pins GORGON_GATEWAY_STATE_DIR in the bat itself —
// so autostart and manual start share the same keepalive AND the same state
// directory (previously the bat bypassed keepalive and let the gateway fall
// back to scripts/.agent-gateway/, splitting the task records).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GATEWAY = path.join(REPO_ROOT, "scripts", "agent-gateway.mjs");

const DEFAULT_STATE = path.join(os.homedir(), ".gorgon-agent-controller");
export const STATE_DIR = process.env.GORGON_GATEWAY_STATE_DIR
  ? path.resolve(process.env.GORGON_GATEWAY_STATE_DIR)
  : DEFAULT_STATE;

const portIdx = process.argv.indexOf("--port");
const PORT = Math.max(1, parseInt(portIdx >= 0 ? process.argv[portIdx + 1] : "", 10) || 8765);
const LAN = process.argv.includes("--lan");
const RESTART_DELAY_MS = 5000;

function startupDir() {
  return path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}
function shortcutPath() {
  // A .bat in the Startup folder — no extra tooling required.
  return path.join(startupDir(), "gorgon-agent-controller.bat");
}

/**
 * The bat runs companion.mjs (keepalive included) with the SAME state dir
 * the manual start uses. Paths are quoted; the state dir is pinned via a
 * set so the child gateway resolves exactly the same record location.
 */
export function batContent({ nodeExe = process.execPath, companionPath = path.resolve(__filename), gatewayPath = GATEWAY, port = PORT, lan = LAN, stateDir = STATE_DIR } = {}) {
  const win = (p) => String(p).replace(/\//g, "\\");
  return [
    "@echo off",
    "rem Gorgon PC Agent Controller — login autostart (runs the companion supervisor, not the gateway directly)",
    `set "GORGON_GATEWAY_STATE_DIR=${win(stateDir)}"`,
    `start "Gorgon Agent Controller" /min "${win(nodeExe)}" "${win(companionPath)}" --port ${port}${lan ? " --lan" : ""}`,
    "",
  ].join("\r\n");
}

function installStartup() {
  if (!LAN) {
    // A phone must reach the PC — startup without --lan would silently
    // bind localhost only and look "online" to nothing.
    console.error("[companion] install-startup 需要 --lan（手机要能访问电脑）。");
    process.exit(2);
  }
  fs.mkdirSync(startupDir(), { recursive: true });
  fs.writeFileSync(shortcutPath(), batContent());
  console.log(`[companion] 已安装登录自启: ${shortcutPath()}`);
  console.log(`[companion] 自启与手动启动共用状态目录: ${STATE_DIR}`);
}
function removeStartup() {
  try { fs.rmSync(shortcutPath(), { force: true }); console.log("[companion] 已移除登录自启。"); }
  catch (e) { console.error(`[companion] 移除失败：${e.message}`); process.exit(2); }
}

function supervise() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const args = [GATEWAY, "--port", String(PORT)];
  if (LAN) args.push("--lan");
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, GORGON_GATEWAY_STATE_DIR: STATE_DIR },
  });
  console.log(`[companion] gateway pid=${child.pid} port=${PORT} lan=${LAN} state=${STATE_DIR}`);
  child.on("exit", (code) => {
    console.error(`[companion] gateway 退出（code=${code}），${RESTART_DELAY_MS / 1000}s 后重启。`);
    setTimeout(supervise, RESTART_DELAY_MS);
  });
}

// Main guard: tests import { batContent, STATE_DIR } without side effects;
// routine execution only when run directly. ESM has no __filename — resolve
// from import.meta.url (this was the silent-exit bug: realpathSync(undefined)
// threw and isMain was always false).
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
const isMain = (() => {
  try {
    return realpathSync(process.argv[1] || "") === realpathSync(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  } catch { return false; }
})();
if (!isMain) {
  // Imported as a module (tests) — export only, never supervise.
} else {
  const cmd = process.argv[2];
  if (cmd === "install-startup") { installStartup(); process.exit(0); }
  if (cmd === "remove-startup") { removeStartup(); process.exit(0); }
  if (cmd === "--help" || cmd === "-h") {
    console.log([
      "Gorgon PC Agent Controller — Windows Companion",
      "",
      "  node desktop/agent-controller/companion.mjs [--port 8765] [--lan]",
      "  node desktop/agent-controller/companion.mjs install-startup   # 登录自启（需 --lan）",
      "  node desktop/agent-controller/companion.mjs remove-startup",
      "",
      "状态目录（任务记录，重启可恢复）: " + STATE_DIR,
    ].join("\n"));
    process.exit(0);
  }
  supervise();
}
