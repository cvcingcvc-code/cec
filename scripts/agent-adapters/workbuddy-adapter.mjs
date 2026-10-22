#!/usr/bin/env node
// Gorgon Workbench — PC Agent Controller V1 (V3L): WorkBuddy desktop adapter.
//
// WHAT THIS IS
// ------------
// A thin, bounded adapter that lets the Gateway DISCOVER, LAUNCH, ATTACH to,
// report the REAL status of, and submit VERIFIED READ-ONLY tasks to the
// WorkBuddy desktop app on THIS machine.
//
// TASK SUBMISSION (V3L): the WorkBuddy desktop app ships an OFFICIAL local
// IPC channel ("wbipc", a named pipe discovered via
// %USERPROFILE%\.workbuddy\wbipc\endpoint.json). This adapter implements the
// full HMAC-SHA256 challenge-response handshake and calls the
// wb.request/http.fetch pipe — the app's own proxy to its cloud API, running
// with the USER's own login session. Verified live (real 200 responses with
// real account data; see docs/V3L_PC_AGENT_CONTROLLER_GUIDE.md). Only
// READ-ONLY operations are exposed: message-sending / write operations are
// NOT implemented and NEVER claimed (see SUBMIT_OPERATIONS below).
//
// WHAT THIS IS NOT (docs/AGENT_REMOTE_DESIGN.md §5 honesty rule)
// ----------------
// A run that only proves "process started" is reported as LAUNCHED, never
// as "agent executed the task". submitTask() only supports the read-only
// operations listed in SUBMIT_OPERATIONS; anything else returns
// BLOCKED_UNSUPPORTED_OPERATION.
//
// SECURITY BOUNDARY
//   * the exe path comes from user REGISTRATION (a fixed allowlist below,
//     plus optional GORGON_WB_PATH env override) — never from the phone.
//   * launch() spawns the registered exe with NO extra arguments.
//   * every check is read-only (process list / window title / WS status).
//   * wbipc ticket comes from the local endpoint.json written by WorkBuddy
//     itself — it never leaves this machine (the Gateway runs locally).
//   * output is size-capped and secrets-filtered before returning.

import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { wbipcCall } from "./wbipc-client.mjs";

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
  "submitTask 仅支持只读操作（read_profile / read_accounts / list_cloud_agents / describe_ipc），永远不能把「已启动」说成「已执行任务」。",
].join("\n");

// ── Verified read-only task operations (V3L) ────────────────────────────
// Each entry: { desc, run(params) -> {ok, summary, output} }
// Only GET requests and local status probes. NO writes, NO message sending.
const SUBMIT_OPERATIONS = {
  describe_ipc: {
    desc: "检查 wbipc 本地 IPC 通道是否可用（只读自检）",
    async run(_params) {
      const t0 = Date.now();
      const conn = await wbipcCall(undefined, "wb.request", "http.fetch", { method: "GET", path: "/" }, { mode: "call", timeoutMs: 15000 });
      return {
        ok: true,
        summary: `wbipc 通道可用，http.fetch 代理返回 HTTP ${conn.status}（耗时 ${Date.now() - t0}ms）`,
        output: { status: conn.status, contentType: conn.headers?.["content-type"] || null, elapsedMs: Date.now() - t0 },
      };
    },
  },
  read_accounts: {
    desc: "读取 WorkBuddy 当前登录账号（GET /v2/accounts，只读）",
    async run(_params) {
      const r = await wbipcCall(undefined, "wb.request", "http.fetch", { method: "GET", path: "/v2/accounts" }, { mode: "call", timeoutMs: 20000 });
      const body = JSON.parse(Buffer.from(r.body_b64 || "", "base64").toString("utf8"));
      if (body.code !== 0) return { ok: false, status: "failed", error: `后端返回 code=${body.code}: ${body.msg}` };
      const accounts = (body.data?.accounts || []).map((a) => ({
        uid: a.uid, nickname: a.nickname, type: a.type, lastLogin: a.lastLogin, pluginEnabled: a.pluginEnabled,
      }));
      return {
        ok: true,
        summary: `WorkBuddy 已登录 ${accounts.length} 个账号：${accounts.map((a) => `${a.nickname}(${a.type}${a.lastLogin ? "，当前" : ""})`).join("；")}`,
        output: { accounts, requestId: body.requestId, httpStatus: r.status },
      };
    },
  },
  read_profile: {
    desc: "读取用户记忆档案前 600 字（GET /api/memory/profile，只读）",
    async run(_params) {
      const r = await wbipcCall(undefined, "wb.request", "http.fetch", { method: "GET", path: "/api/memory/profile" }, { mode: "call", timeoutMs: 20000 });
      const body = JSON.parse(Buffer.from(r.body_b64 || "", "base64").toString("utf8"));
      if (body.code !== 0) return { ok: false, status: "failed", error: `后端返回 code=${body.code}: ${body.msg}` };
      const profileText = String(body.data?.foryou_prompt || "");
      return {
        ok: true,
        summary: `已读取记忆档案（${profileText.length} 字）：${profileText.slice(0, 600)}`,
        output: { userId: body.data?.user_id || null, length: profileText.length, excerpt: profileText.slice(0, 600) },
      };
    },
  },
  list_cloud_agents: {
    desc: "列出云端 Agent 授权（GET /v2/user/cloudagent/agents，只读）",
    async run(_params) {
      const r = await wbipcCall(undefined, "wb.request", "http.fetch", { method: "GET", path: "/v2/user/cloudagent/agents" }, { mode: "call", timeoutMs: 20000 });
      const body = JSON.parse(Buffer.from(r.body_b64 || "", "base64").toString("utf8"));
      if (body.code !== 0) return { ok: false, status: "failed", error: `后端返回 code=${body.code}: ${body.msg}` };
      const items = body.data?.items || [];
      return {
        ok: true,
        summary: `云端 Agent 授权共 ${body.data?.total ?? items.length} 条，当前页 ${items.length} 条`,
        output: { total: body.data?.total ?? null, items, httpStatus: r.status },
      };
    },
  },
};

export const workbuddyAdapter = {
  id: "workbuddy",
  detect: detectWorkBuddy,
  tasklistWorkBuddy,
  windowTitles,
  LAUNCH_REPORT_PROMPT,
  SUBMIT_OPERATIONS,

  /**
   * submitTask({operation, params}) — VERIFIED read-only operations over the
   * official wbipc local IPC channel. Unknown operations return
   * BLOCKED_UNSUPPORTED_OPERATION (never simulated success).
   */
  async submitTask({ operation, params } = {}) {
    const op = SUBMIT_OPERATIONS[operation];
    if (!op) {
      return {
        ok: false,
        status: "BLOCKED_UNSUPPORTED_OPERATION",
        error: `不支持的操作「${operation || "(空)"}」。当前只支持只读操作：${Object.keys(SUBMIT_OPERATIONS).join("、")}。消息发送/写操作未实现，不允许模拟通过。`,
      };
    }
    try {
      const result = await op.run(params || {});
      return result;
    } catch (e) {
      const code = e.code || "";
      const friendly = code === "WBIPC_NO_ENDPOINT"
        ? "wbipc 端点文件不存在（WorkBuddy 未运行或版本过旧），无法提交任务"
        : code === "WBIPC_CONNECT_FAILED" || code === "WBIPC_CONNECT_TIMEOUT"
          ? "wbipc 管道连接失败（WorkBuddy 可能未运行）"
          : code === "WBIPC_AUTH_FAILED"
            ? `wbipc 握手被拒绝：${e.detail || e.message}`
            : null;
      return {
        ok: false,
        status: "BLOCKED",
        error: friendly || `wbipc 调用失败：${e.message}`,
        detail: { code, message: e.message },
      };
    }
  },

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
