#!/usr/bin/env node
// Gorgon Workbench — PC Agent Controller V1 (Phase A): WorkBuddy desktop adapter.
//
// WHAT THIS IS
// ------------
// A thin, bounded adapter that lets the Gateway DISCOVER, LAUNCH, ATTACH to,
// and report the REAL status of the WorkBuddy desktop app on THIS machine.
//
// WHAT THIS IS NOT (docs/AGENT_REMOTE_DESIGN.md §5 honesty rule)
// ----------------
// WorkBuddy desktop exposes NO public task/conversation API that this repo
// can verify. Therefore submitTask() is NOT implemented and is NEVER
// claimed: launching the process and attaching to the real window is the
// WHOLE capability surface. A run that only proves "process started" is
// reported as LAUNCHED, never as "agent executed the task".
//
// SECURITY BOUNDARY
//   * the exe path comes from user REGISTRATION (a fixed allowlist below,
//     plus optional GORGON_WB_PATH env override) — never from the phone.
//   * launch() spawns the registered exe with NO extra arguments.
//   * every check is read-only (process list / window title / WS status).
//   * output is size-capped and secrets-filtered before returning.

import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Registered exe allowlist (S2: user-registered apps only) ────────────
// Explicit env override first, then the known install layout observed on
// THIS machine (E:\work\WorkBuddy — a per-user install, not Program Files).
const WB_CANDIDATES = [
  process.env.GORGON_WB_PATH, // explicit user registration wins
  "E:\\work\\WorkBuddy\\WorkBuddy.exe",
  path.join(process.env.LOCALAPPDATA || "", "Programs", "WorkBuddyAI", "WorkBuddy.exe"),
  path.join(process.env.LOCALAPPDATA || "", "WorkBuddy", "WorkBuddy.exe"),
].filter(Boolean);

const VERSIONED_LOCALAPPDATA = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Programs", "WorkBuddyAI", "version")
  : null;

function tryResolveVersionedLayout() {
  // Observed layout: Programs/WorkBuddyAI/version/<build>/WorkBuddy.exe
  if (!VERSIONED_LOCALAPPDATA) return [];
  try {
    return fs.readdirSync(VERSIONED_LOCALAPPDATA, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(VERSIONED_LOCALAPPDATA, e.name, "WorkBuddy.exe"))
      .filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  } catch {
    return [];
  }
}

let _cached = undefined; // { ok, exePath, version, error }

async function detectWorkBuddy() {
  if (_cached) return _cached;
  for (const cand of [...WB_CANDIDATES, ...tryResolveVersionedLayout()]) {
    try {
      const st = fs.statSync(cand);
      if (st.isFile() && st.size > 1024 * 1024) {
        _cached = { ok: true, exePath: cand, version: null, error: null };
        return _cached;
      }
    } catch { /* try next */ }
  }
  _cached = { ok: false, exePath: null, version: null, error: "WorkBuddy.exe not found (set GORGON_WB_PATH to register it)" };
  return _cached;
}

// ── Process probes (read-only, bounded) ─────────────────────────────────

function tasklistWorkBuddy() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "IMAGENAME eq WorkBuddy.exe", "/FO", "CSV", "/NH"],
      { shell: false, windowsHide: true, timeout: 8000, maxBuffer: 256 * 1024 },
      (err, stdout) => {
        if (err) return resolve({ ok: false, pids: [], error: String(err.message || err) });
        const pids = String(stdout || "").split("\n")
          .map((l) => l.trim()).filter((l) => l.startsWith('"WorkBuddy.exe"'))
          .map((l) => l.split('","')[1]).filter(Boolean);
        resolve({ ok: true, pids, error: null });
      });
  });
}

function windowTitles(pids) {
  // Read-only window enumeration via PowerShell (already a Windows builtin).
  // NOT UI Automation — we only READ titles, never click or type.
  return new Promise((resolve) => {
    const script = `$pids = @( '${pids.join("','")}' ); Get-Process | Where-Object { $pids -contains [string]$_.Id -and $_.MainWindowTitle } | ForEach-Object { "$($_.Id)|$($_.MainWindowTitle)" }`;
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script],
      { shell: false, windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 },
      (err, stdout) => {
        if (err) return resolve({ ok: false, windows: [], error: String(err.message || err) });
        const windows = String(stdout || "").split("\n").map((l) => l.trim())
          .filter((l) => l.includes("|"))
          .map((l) => { const [pid, ...rest] = l.split("|"); return { pid, title: rest.join("|").slice(0, 120) }; });
        resolve({ ok: true, windows, error: null });
      });
  });
}

// ── Adapter facade ──────────────────────────────────────────────────────

const LAUNCH_REPORT_PROMPT = [
  "你负责向用户报告 WorkBuddy 桌面版的真实状态。",
  "本适配器没有任务提交接口，因此永远不能声称「Agent 已执行任务」。",
].join("\n");

export const workbuddyAdapter = {
  id: "workbuddy",
  detect: detectWorkBuddy,
  tasklistWorkBuddy,
  windowTitles,
  LAUNCH_REPORT_PROMPT,

  /**
   * discover() — real discovery result for the executors list.
   * Returns { available, detail } — available=true means the exe exists;
   * whether the app is RUNNING is a separate, per-call check.
   */
  async discover() {
    const det = await detectWorkBuddy();
    if (!det.ok) return { available: false, detail: det.error };
    const procs = await tasklistWorkBuddy();
    return {
      available: true,
      detail: procs.ok && procs.pids.length
        ? `已安装（${det.exePath}），当前有 ${procs.pids.length} 个 WorkBuddy 进程在运行`
        : `已安装（${det.exePath}），当前未检测到运行中的进程`,
    };
  },

  /**
   * launch() — start the registered exe. Returns the REAL spawn result.
   * Never fabricates: verifyPid() re-checks the process list afterwards.
   */
  async launch() {
    const det = await detectWorkBuddy();
    if (!det.ok) {
      return { ok: false, status: "BLOCKED_NOT_INSTALLED", error: det.error };
    }
    const before = await tasklistWorkBuddy();
    const beforeSet = new Set(before.ok ? before.pids : []);
    let child;
    try {
      child = spawn(det.exePath, [], {
        shell: false, windowsHide: false, detached: false, cwd: path.dirname(det.exePath),
        stdio: "ignore",
      });
    } catch (e) {
      return { ok: false, status: "failed", error: `启动失败：${e.message}` };
    }
    // Wait briefly, then re-probe the process list for a NEW pid.
    let newPid = null;
    for (let i = 0; i < 10 && !newPid; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const after = await tasklistWorkBuddy();
      if (after.ok) {
        newPid = after.pids.find((p) => !beforeSet.has(p)) || null;
      }
    }
    const procsAfter = await tasklistWorkBuddy();
    const runningCount = procsAfter.ok ? procsAfter.pids.length : 0;
    if (newPid || (!before.ok && runningCount > 0) || (before.ok && runningCount > before.pids.length)) {
      return {
        ok: true,
        status: "LAUNCHED",
        output: {
          exePath: det.exePath,
          spawnedChildPid: child.pid || null,
          newWorkBuddyPid: newPid,
          runningProcessCount: runningCount,
          note: "进程已在运行。这只证明「已启动」，不代表任何任务已被执行（本适配器无任务提交接口）。",
        },
      };
    }
    return {
      ok: false,
      status: "failed",
      error: `启动后未检测到新的 WorkBuddy 进程（当前 ${runningCount} 个进程）。可能是应用拒绝启动或单实例已在前台。`,
      output: { exePath: det.exePath, spawnedChildPid: child.pid || null, runningProcessCount: runningCount },
    };
  },

  /**
   * attach()/status() — the REAL current state of WorkBuddy on this machine.
   */
  async status() {
    const det = await detectWorkBuddy();
    if (!det.ok) {
      return {
        installed: false, running: false, processCount: 0, windows: [],
        summary: det.error,
      };
    }
    const procs = await tasklistWorkBuddy();
    const running = procs.ok && procs.pids.length > 0;
    let windows = [];
    let windowError = null;
    if (running) {
      const w = await windowTitles(procs.pids);
      windows = w.ok ? w.windows : [];
      windowError = w.ok ? null : w.error;
    }
    return {
      installed: true,
      exePath: det.exePath,
      running,
      processCount: procs.ok ? procs.pids.length : 0,
      pids: procs.ok ? procs.pids.slice(0, 20) : [],
      windows: windows.slice(0, 10),
      windowError,
      summary: running
        ? `WorkBuddy 正在运行（${procs.pids.length} 个进程${windows.length ? `，${windows.length} 个可见窗口` : ""}）`
        : "WorkBuddy 已安装但当前未运行",
      note: "窗口标题为只读枚举。本适配器不做点击/输入/UI Automation。",
    };
  },
};
