// Gorgon Workbench — Phase C: Codex Adapter (REAL AI execution).
//
// WHAT THIS IS
// ------------
// A thin, bounded wrapper around the locally installed Codex CLI
// (`codex exec`). The Gateway calls it for whitelisted read-only tasks.
// Every run maps onto the Gateway's unified run lifecycle:
//   queued -> running -> completed | failed | timed_out | cancelled
//
// SECURITY BOUNDARY (phase-c task §3.2/§3.4):
//   * default sandbox is READ-ONLY (`--sandbox read-only`); this module
//     NEVER passes danger-full-access and never auto-approves writes.
//   * workspace is FIXED per executor (no arbitrary paths from the phone).
//   * prompt comes from a PRE-APPROVED TEMPLATE — the phone cannot send
//     raw commands or arbitrary prompts.
//   * output is size-capped and sensitive-info filtered before returning.
//   * no shell interpolation: spawn with argv array, shell: false.
//
// STATUS HONESTY (§3.3):
//   The adapter reports what actually happened:
//     completed            — a real model call returned real output
//     BLOCKED_USAGE_LIMIT  — Codex reported a usage/credit limit
//     BLOCKED_AUTH         — login/token expired or unauthorized
//     BLOCKED_NETWORK      — connection/proxy failure
//     failed               — anything else (nonzero exit, bad output)
//   Failure is NEVER disguised as success.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ── Codex CLI discovery (detect, version, callability) ─────────────────

const CODEX_CANDIDATES = [
  process.env.GORGON_CODEX_PATH, // explicit override first
  path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin", "codex.exe"),
  // versioned bin subdirs (codex installer layout: bin/<hash>/codex.exe)
  ...(process.env.LOCALAPPDATA
    ? tryListVersionedBins(path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin"))
    : []),
  "codex.exe",
  "codex",
  "codex.cmd",
].filter(Boolean);

function tryListVersionedBins(binRoot) {
  // codex.exe lives under bin/<version-hash>/codex.exe — pick the newest.
  try {
    const entries = fs.readdirSync(binRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(binRoot, e.name, "codex.exe"))
      .filter((p) => { try { return fs.statSync(p).isFile(); } catch (err) { return false; } });
    return entries;
  } catch (e) {
    return [];
  }
}

let _cached = undefined; // { ok, codexPath, version, error }

export async function detectCodex() {
  if (_cached) return _cached;
  for (const cand of CODEX_CANDIDATES) {
    try {
      const res = await spawnSyncVersion(cand);
      if (res.ok) {
        _cached = { ok: true, codexPath: cand, version: res.version, error: null };
        return _cached;
      }
    } catch (e) { /* try next */ }
  }
  _cached = { ok: false, codexPath: null, version: null, error: "not found" };
  return _cached;
}

function spawnSyncVersion(cand) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cand, ["--version"], { shell: false, windowsHide: true });
    } catch (e) {
      resolve({ ok: false });
      return;
    }
    let out = "";
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) {} resolve({ ok: false }); }, 8000);
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", () => { clearTimeout(timer); resolve({ ok: false }); });
    p.on("close", (code) => {
      clearTimeout(timer);
      const m = out.match(/codex-cli\s+(\S+)/);
      if (code === 0 && m) resolve({ ok: true, version: m[1] });
      else resolve({ ok: false });
    });
  });
}

// ── Sensitive-output filtering (§3.2 #10) ───────────────────────────────

const SECRET_PATTERNS = [
  [/\b(sk-[A-Za-z0-9_-]{16,})\b/g, "sk-***REDACTED***"],
  [/\b(Bearer\s+)[A-Za-z0-9._-]{16,}/g, "$1***REDACTED***"],
  [/\b(ghp_[A-Za-z0-9]{20,})\b/g, "ghp_***REDACTED***"],
  [/\b(github_pat_[A-Za-z0-9_]{20,})\b/g, "github_pat_***REDACTED***"],
  [/\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, "xox-***REDACTED***"],
  [/\b(AIza[0-9A-Za-z_-]{30,})\b/g, "AIza***REDACTED***"],
  [/\b([0-9a-f]{64})\b(?=[^\n]{0,20}(token|key|secret|password))/gi, "***64HEX***"],
];

export function filterSecrets(text) {
  let out = String(text || "");
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

// ── Classifier: map Codex failures to honest statuses ───────────────────

function classifyFailure(stderr, exitCode) {
  const s = String(stderr || "");
  if (/usage limit|usage_limit|hit your usage|try again at \d|purchase more credits/i.test(s)) {
    return { kind: "BLOCKED_USAGE_LIMIT", message: firstLine(/(?:hit your usage limit[^\n]*|try again at \d[^\n]*)/i.exec(s)?.[0] || s) };
  }
  if (/unauthorized|unauthorised|not logged in|login expired|invalid[_ ]api[_ ]key|401|ExpiredAuthorization|please sign in|auth (?:error|failed)/i.test(s)) {
    return { kind: "BLOCKED_AUTH", message: firstLine(s) };
  }
  if (/proxy connection failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|connection (?:refused|reset|failed)|websocket.*(failed|error)|HTTP \d{3}.*(Forbidden|Bad Gateway|timeout)/i.test(s)) {
    return { kind: "BLOCKED_NETWORK", message: firstLine(s) };
  }
  return { kind: "failed", message: firstLine(s) || `codex exited ${exitCode}` };
}

function firstLine(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  const line = t.split("\n").find((l) => l.trim().length > 0) || "";
  return line.trim().slice(0, 300);
}

// ── The one real Codex call ─────────────────────────────────────────────
//
// execCodex({ codexPath, cwd, prompt, timeoutMs, onChild, signal }) ->
//   { ok, status, output, exitCode, durationMs, sessionId, error }

export function execCodex(opts) {
  const {
    codexPath,
    cwd,
    prompt,
    timeoutMs = 300_000,
    maxOutputChars = 60_000,
    onChild = () => {},
    signal,
  } = opts;

  if (signal?.aborted) return Promise.resolve({ ok: false, status: "cancelled", error: "codex cancelled", exitCode: null });
  if (!codexPath) return Promise.resolve({ ok: false, status: "failed", error: "codex CLI not found" });
  if (!prompt || typeof prompt !== "string") {
    return Promise.resolve({ ok: false, status: "failed", error: "prompt required" });
  }
  let st;
  try { st = fs.statSync(cwd); } catch (e) {
    return Promise.resolve({ ok: false, status: "failed", error: `workspace not found: ${cwd}` });
  }
  if (!st.isDirectory()) return Promise.resolve({ ok: false, status: "failed", error: `workspace not a directory: ${cwd}` });

  const startedAt = Date.now();
  return new Promise((resolve) => {
    // Proxy passthrough: the codex CLI needs a working proxy to reach
    // chatgpt.com. Windows sandboxes often inject a broken proxy — when
    // GORGON_CODEX_PROXY is set we override the child's proxy env with it
    // (explicit user config; never guessed).
    const childEnv = Object.assign({}, process.env, { CODEX_SANDBOX_MODE: "read-only" });
    if (process.env.GORGON_CODEX_PROXY) {
      for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
        childEnv[k] = process.env.GORGON_CODEX_PROXY;
      }
    }

    const p = spawn(codexPath, ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-C", cwd, prompt], {
      shell: false,
      windowsHide: true,
      cwd,
      env: childEnv,
      // codex exec appends piped stdin even when PROMPT is supplied.
      // An unused open pipe blocks prompt intake before any model request.
      stdio: ["ignore", "pipe", "pipe"],
    });
    onChild(p);

    let stdout = "";
    let stderr = "";
    let capped = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(Object.assign({ durationMs: Date.now() - startedAt, stderr: filterSecrets(stderr).slice(0, 4000) }, result));
    };

    const onAbort = () => {
      killTree(p, "codex cancelled");
      finish({ ok: false, status: "cancelled", error: "codex cancelled", exitCode: null });
    };
    const timer = setTimeout(() => {
      killTree(p, "codex timeout");
      const cls = classifyFailure(filterSecrets(stderr + "\n" + stdout), null);
      finish({ ok: false, status: "timed_out", failureKind: cls.kind, error: `codex hard timeout (${timeoutMs}ms)`, exitCode: null, output: filterSecrets(stdout).slice(0, maxOutputChars) });
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    p.stdout.on("data", (d) => {
      if (stdout.length < maxOutputChars * 2) stdout += d;
      else capped = true;
    });
    p.stderr.on("data", (d) => {
      if (stderr.length < 40_000) stderr += d;
    });
    p.on("error", (e) => {
      finish({ ok: false, status: "failed", error: filterSecrets(`spawn failed: ${e.message}`), exitCode: null });
    });
    p.on("close", (code) => {
      if (settled) return;
      const outText = filterSecrets(stdout).slice(0, maxOutputChars);
      if (code === 0 && outText.trim()) {
        const sid = /session id:\s*(\S+)/.exec(stdout)?.[1] || null;
        finish({
          ok: true,
          status: "completed",
          output: outText + (capped ? "\n…[output truncated]" : ""),
          exitCode: 0,
          sessionId: sid,
        });
      } else {
        const cls = classifyFailure(filterSecrets(stderr + "\n" + stdout), code);
        finish({
          ok: false,
          status: cls.kind, // BLOCKED_USAGE_LIMIT | BLOCKED_AUTH | BLOCKED_NETWORK | failed
          error: cls.message || `codex exited ${code}`,
          exitCode: code,
          output: outText,
        });
      }
    });
  });
}

function killTree(p, label) {
  try {
    if (process.platform === "win32" && p.pid) {
      spawn("taskkill", ["/T", "/F", "/PID", String(p.pid)], { shell: false, windowsHide: true })
        .on("error", () => {});
    } else if (p.pid) {
      try { process.kill(-p.pid, "SIGKILL"); } catch (e) { try { p.kill("SIGKILL"); } catch (e2) {} }
    }
  } catch (e) { /* best effort */ }
}

// ── Read-only diagnosis prompt template (pre-approved, §3.3) ────────────

export const READONLY_DIAGNOSIS_PROMPT = [
  "你是 Gorgon Workbench 项目的只读诊断助手。",
  "请分析启动参数 -C 指定的当前固定工作区，输出一份简明诊断报告，包含以下小节：",
  "1. 项目架构概览（主要目录与职责，200 字以内）",
  "2. 当前主功能（列出最重要的 3-5 个功能模块）",
  "3. 存在的明确问题（只列有真实证据的问题，标注证据文件位置）",
  "4. 问题的证据位置（文件路径 + 关键行/内容摘录）",
  "5. 推荐下一步修复顺序（按优先级 1-2-3）",
  "6. 不能确定的事项（明确列出你无法只读确认的部分）",
  "约束：只读分析，不要修改任何文件；引用真实文件路径；不要编造内容。",
].join("\n");

// ── Adapter facade: maps onto the Gateway run lifecycle ────────────────

export const codexAdapter = {
  id: "codex",
  detect: detectCodex,
  filterSecrets,
  execCodex,
};
