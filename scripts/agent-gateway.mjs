#!/usr/bin/env node
// Gorgon Workbench — V3 Phase A (Task #3): PC Agent Gateway (minimal safe loop).
//
// WHAT THIS IS
// ------------
// A single-file, zero-dependency Node gateway the PHONE talks to over the
// LOCAL network. The phone submits agent task runs; the gateway executes
// whitelisted, read-mostly actions on THIS machine and returns structured
// results the phone can display.
//
// SECURITY BOUNDARY (docs/AGENT_REMOTE_DESIGN.md S1-S7, minimal subset):
//   S1 identity     — every request must carry the pairing token
//                     (X-Gorgon-Token). The token is generated on first
//                     start, stored under scripts/.agent-gateway/ (gitignored).
//   S2 authorization — executor allowlist only (see EXECUTORS). Nothing else
//                     runs. No shell, no arbitrary commands, no eval.
//   S3 timeouts     — every executor runs under a hard timeout (60s default).
//   S4 audit        — every request/execution appends to audit.log (JSONL).
//   S5 honesty      — results carry real status + real output; the gateway
//                     never fabricates success.
//   S6 network      — binds 127.0.0.1 BY DEFAULT. --lan exposes to the local
//                     network ONLY when the user explicitly passes the flag
//                     (needed for a physical phone to reach the PC).
//   S7 rate         — one concurrent execution max; extra requests queue.
//
// WHAT THIS IS NOT
// ----------------
// Not a general remote shell. Not a Codex/WorkBuddy controller (those tools'
// real integration surfaces are NOT verified yet — design doc §5: no claims).
// Executors are local, read-mostly, and bounded.
//
// USAGE
// -----
//   node scripts/agent-gateway.mjs [--port 8765] [--lan]
//
// API (all JSON; all except /health require X-Gorgon-Token):
//   GET  /health                       -> { ok, name, version, uptimeSec }
//   GET  /v1/executors                 -> allowlist + input shapes
//   POST /v1/runs                      -> { executor, input } => { runId, status }
//   GET  /v1/runs/:id                  -> run record (status, result, timeline)
//   GET  /v1/runs                      -> recent runs (phone polling)
//   POST /v1/runs/:id/cancel           -> cooperative cancel

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const NAME = "gorgon-agent-gateway";
const VERSION = "0.2.0";
const HARD_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RUNS_KEPT = 200;

// Phase C: the state dir can be redirected for isolated tests (GORGON_GATEWAY_STATE_DIR).
// Production default is unchanged: scripts/.agent-gateway/ (gitignored).
const STATE_DIR = process.env.GORGON_GATEWAY_STATE_DIR
  ? path.resolve(process.env.GORGON_GATEWAY_STATE_DIR)
  : path.join(__dirname, ".agent-gateway");
const TOKEN_FILE = path.join(STATE_DIR, "token.json");
const AUDIT_FILE = path.join(STATE_DIR, "audit.log");
const RUNS_FILE = path.join(STATE_DIR, "runs.json");

// ── Executor allowlist (S2) ────────────────────────────────────────────
// Every executor: { description, input schema, run(input) }.
// run() MUST be bounded: no shell, no dynamic paths outside the repo,
// hard size caps on output. Results are structured, never fabricated.

// Phase C (§3.3): the real Codex adapter — read-only project diagnosis.
// Adapter module import is dynamic so the gateway still starts when the
// adapter file is missing (older checkouts).
let CODEX_ADAPTER = null;
try {
  const mod = await import("./agent-adapters/codex-adapter.mjs");
  CODEX_ADAPTER = mod;
} catch (e) {
  audit({ kind: "codex_adapter_load_error", error: String((e && e.message) || e) });
}

function gitSnapshot(label, cwd) {
  // §3.4: record git status before/after an AI run — read-only proof.
  return execGit(["status", "--porcelain=v1"], cwd)
    .then((out) => ({ label, dirty: out.trim().length, statusHash: crypto.createHash("sha256").update(out).digest("hex"), output: out.slice(0, 2000) }))
    .catch((e) => ({ label, error: String((e && e.message) || e) }));
}

function safeReadText(absPath, maxBytes) {
  const st = fs.statSync(absPath);
  if (!st.isFile()) throw new Error("not a file");
  if (st.size > maxBytes) throw new Error(`file too large (${st.size} > ${maxBytes} bytes)`);
  return fs.readFileSync(absPath, "utf8");
}

// Minimal git runner via child_process spawn (no shell), promise-wrapped,
// hard timeout, output capped.
function execGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { cwd, shell: false });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("git timeout"));
    }, 10_000);
    p.stdout.on("data", (d) => { if (out.length < 100_000) out += d; });
    p.stderr.on("data", (d) => { if (err.length < 10_000) err += d; });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`git exited ${code}: ${err.slice(0, 500)}`));
    });
  });
}

const EXECUTORS = {
  // Read repo status — the safest possible "what is the machine working on".
  "repo.status": {
    description: "读取 Gorgon 仓库的 git 状态（分支/HEAD/脏文件列表）",
    input: {},
    run() {
      return execGit(["status", "--porcelain=v1", "-b"], REPO_ROOT).then((out) => ({
        summary: "git status (porcelain+b)",
        output: out,
      }));
    },
  },
  // Read a bounded repo doc — path must be INSIDE the repo, docs only,
  // and must not touch .git.
  "repo.readDoc": {
    description: "读取仓库内文本文档（限 docs/*.md、readme.md；1MB 上限）",
    input: { path: "string, repo-relative, docs/*.md or readme.md" },
    async run(input) {
      const rel = String(input.path || "");
      const allowed = /^docs\/[A-Za-z0-9_\-]+\.md$/.test(rel) || rel === "readme.md";
      if (!allowed) throw new Error("path not allowed (docs/*.md or readme.md only)");
      const abs = path.resolve(REPO_ROOT, rel);
      if (!abs.startsWith(REPO_ROOT + path.sep) && abs !== REPO_ROOT) throw new Error("path escapes repo");
      if (abs.includes(".git")) throw new Error("path touches .git");
      const text = safeReadText(abs, 1024 * 1024);
      return { summary: `read ${rel} (${text.length} chars)`, output: text.slice(0, 20000) };
    },
  },
  // Health snapshot of the machine — CPU/mem, no processes, no internals.
  "host.stats": {
    description: "读取本机概览（平台/CPU/内存，不含进程与路径细节）",
    input: {},
    async run() {
      return {
        summary: "host overview",
        output: {
          platform: os.platform(),
          release: os.release(),
          cpuCount: os.cpus().length,
          cpuModel: os.cpus()[0] ? os.cpus()[0].model : null,
          totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
          freeMemGB: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
          uptimeH: Math.round(os.uptime() / 3600),
        },
      };
    },
  },
};

// Test fixtures can execute local code, so an inherited injection variable
// alone MUST NOT enable them. Require explicit test mode, a separate state
// directory and loopback binding before reading or importing either format.
function isWithin(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel !== "" && !rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel);
}

const productionStateDir = path.join(__dirname, ".agent-gateway");
const TEST_EXECUTORS_ENABLED = process.env.NODE_ENV === "test"
  && process.env.GORGON_GATEWAY_TEST_MODE === "1"
  && Boolean(process.env.GORGON_GATEWAY_STATE_DIR)
  && path.relative(productionStateDir, STATE_DIR) !== ""
  && !isWithin(productionStateDir, STATE_DIR)
  && !isWithin(STATE_DIR, productionStateDir)
  && !process.argv.includes("--lan");

function testExecutorFile(file) {
  // Resolve symlinks before checking containment; fixtures belong to the
  // isolated state directory, not arbitrary files inherited from the shell.
  const state = fs.realpathSync(STATE_DIR);
  const production = fs.existsSync(productionStateDir) ? fs.realpathSync(productionStateDir) : productionStateDir;
  if (path.relative(production, state) === "" || isWithin(production, state) || isWithin(state, production)) {
    throw new Error("test executor state directory overlaps production state");
  }
  const resolved = fs.realpathSync(path.resolve(file));
  if (!isWithin(state, resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("test executor fixture must be inside the isolated state directory");
  }
  return resolved;
}

function canAddTestExecutor(id) {
  // A test fixture may add executors, never replace the shipped allowlist.
  return id !== "codex.readonly-diagnosis" && !Object.hasOwn(EXECUTORS, id)
    && id !== "__proto__" && id !== "constructor" && id !== "prototype";
}

if (!TEST_EXECUTORS_ENABLED && (process.env.GORGON_GATEWAY_EXTRA_EXECUTORS
  || process.env.GORGON_GATEWAY_EXTRA_EXECUTORS_FILE)) {
  audit({ kind: "test_executor_injection_ignored", reason: "requires explicit isolated loopback test mode" });
}

// Preserve the JSON+runSource fixture format only behind the same gates as
// ESM fixtures. In particular, reject built-in IDs BEFORE evaluating source.
const EXTRA_FILE = process.env.GORGON_GATEWAY_EXTRA_EXECUTORS;
if (TEST_EXECUTORS_ENABLED && EXTRA_FILE) {
  try {
    const patch = JSON.parse(fs.readFileSync(testExecutorFile(EXTRA_FILE), "utf8"));
    for (const [id, spec] of Object.entries(patch)) {
      if (!canAddTestExecutor(id)) continue;
      if (!spec || typeof spec !== "object" || typeof spec.runSource !== "string") continue;
      // eslint-disable-next-line no-new-func
      const fn = new Function(`"use strict"; return (${spec.runSource});`)();
      if (typeof fn !== "function") continue;
      EXECUTORS[id] = { description: String(spec.description || id), input: spec.input || {}, run: fn };
    }
  } catch (e) {
    audit({ kind: "extra_executors_json_error", error: String((e && e.message) || e) });
  }
}

// ESM fixtures retain real functions/imports for child-process tests. Finish
// loading before HTTP startup so the advertised allowlist is deterministic.
async function loadExtraExecutorModule() {
  const file = process.env.GORGON_GATEWAY_EXTRA_EXECUTORS_FILE;
  if (!TEST_EXECUTORS_ENABLED || !file) return;
  try {
    const { pathToFileURL } = await import("node:url");
    const mod = await import(pathToFileURL(testExecutorFile(file)).href);
    const extra = mod && mod.default;
    let count = 0;
    if (extra && typeof extra === "object") {
      for (const [id, spec] of Object.entries(extra)) {
        if (!canAddTestExecutor(id) || !spec || typeof spec.run !== "function") continue;
        EXECUTORS[id] = spec;
        count++;
      }
      audit({ kind: "extra_executors_module_loaded", count });
    }
  } catch (e) {
    audit({ kind: "extra_executors_module_error", file, error: String((e && e.message) || e) });
  }
}
await loadExtraExecutorModule();

// ── Phase C (§3.3): whitelisted real-AI executor ────────────────────────
// codex.readonly-diagnosis: runs the pre-approved read-only diagnosis
// template through the real Codex CLI, in the FIXED workspace
// this Gateway checkout (or a local administrator's fixed override).
// Input from the phone is IGNORED by design — the
// prompt is server-side only. Status maps onto the unified state machine;
// BLOCKED_* statuses surface honestly (never disguised as completed).
if (CODEX_ADAPTER) {
  const CODEX_WORKSPACE = path.resolve(process.env.GORGON_CODEX_WORKSPACE || REPO_ROOT);
  const CODEX_TIMEOUT_MS = Math.min(600_000, Math.max(30_000,
    parseInt(process.env.GORGON_CODEX_TIMEOUT_MS || "420000", 10) || 420000));

  // availability is resolved async once at startup (detectCodex is async).
  let codexAvailability = "UNAVAILABLE";
  CODEX_ADAPTER.detectCodex().then((det) => {
    codexAvailability = det.ok ? "AVAILABLE" : "UNAVAILABLE";
  }).catch(() => {});

  EXECUTORS["codex.readonly-diagnosis"] = {
    description: "Codex · 项目只读诊断（真实 AI 分析 Gorgon 项目，只读沙箱，约 3-7 分钟）",
    agent: "codex",
    // Leave room for bounded before/after snapshots; the adapter times out first.
    timeoutMs: CODEX_TIMEOUT_MS + 25_000,
    get availability() { return codexAvailability; },
    input: {}, // no phone input: pre-approved template only
    async run(_input, ctx) {
      const det = await CODEX_ADAPTER.detectCodex();
      if (!det.ok) {
        throw Object.assign(new Error(`Codex CLI 不可用：${det.error}`), { kind: "UNAVAILABLE" });
      }
      // §3.4: git snapshot BEFORE the run (read-only proof).
      const before = await gitSnapshot("before", CODEX_WORKSPACE);
      const res = await CODEX_ADAPTER.execCodex({
        codexPath: det.codexPath,
        cwd: CODEX_WORKSPACE,
        prompt: CODEX_ADAPTER.READONLY_DIAGNOSIS_PROMPT,
        timeoutMs: CODEX_TIMEOUT_MS,
        signal: ctx?.signal,
        onChild: (child) => { if (ctx && typeof ctx.setCancellable === "function") ctx.setCancellable(child); },
      });
      // §3.4: git snapshot AFTER — confirm no working-tree changes.
      const after = await gitSnapshot("after", CODEX_WORKSPACE);
      const unchanged = !before.error && !after.error && before.statusHash === after.statusHash;
      const clean = unchanged && after.dirty === 0;

      // Map adapter status onto the unified run result. BLOCKED_* are
      // honest failures — they become run.status via a thrown error so
      // the gateway records them as `failed` with the real reason.
      if (res.ok) {
        return {
          summary: `Codex 只读诊断完成（${Math.round(res.durationMs / 1000)}s，git 干净：${clean ? "是" : "需检查"}）`,
          output: res.output,
          meta: {
            codexVersion: det.version,
            sessionId: res.sessionId || null,
            durationMs: res.durationMs,
            gitClean: clean,
            gitUnchanged: unchanged,
            workspace: CODEX_WORKSPACE,
          },
        };
      }
      // blocked/failed: surface the real reason (no fabrication)
      const err = new Error(`[${res.status}] ${res.error || "codex 执行失败"}`);
      err.kind = res.status;
      err.output = res.output || "";
      audit({ kind: "codex_failure", status: res.status, failureKind: res.failureKind, exitCode: res.exitCode,
        durationMs: res.durationMs, stderr: res.stderr, gitUnchanged: unchanged });
      throw err;
    },
  };
}

// V3L (PC Agent Controller V1 Phase A): the WorkBuddy desktop adapter —
// discover/launch/attach/status for the registered WorkBuddy desktop app.
// Dynamic import so the gateway still starts when the adapter is missing
// (older checkouts). NO submitTask: WorkBuddy desktop has no verified
// public task API, so this executor never claims "task executed".
let WORKBUDDY_ADAPTER = null;
try {
  const mod = await import("./agent-adapters/workbuddy-adapter.mjs");
  WORKBUDDY_ADAPTER = mod;
} catch (e) {
  audit({ kind: "workbuddy_adapter_load_error", error: String((e && e.message) || e) });
}

// ── V3L Phase A (§一): WorkBuddy desktop executors ──────────────────────
// Two executors, both read-only or process-level:
//   workbuddy.status  — the REAL running state (processes, window titles)
//   workbuddy.launch  — start the registered exe; verify a NEW pid appeared
// The launch executor honestly reports LAUNCHED — never "task executed".
// No submitTask executor exists for WorkBuddy: no verified public task API.
if (WORKBUDDY_ADAPTER) {
  let wbAvailability = "UNAVAILABLE";
  WORKBUDDY_ADAPTER.workbuddyAdapter.discover().then((d) => {
    wbAvailability = d.available ? "AVAILABLE" : "UNAVAILABLE";
  }).catch(() => {});

  const wbExecBase = {
    agent: "workbuddy",
    get availability() { return wbAvailability; },
  };

  EXECUTORS["workbuddy.status"] = {
    ...wbExecBase,
    description: "WorkBuddy · 查看真实运行状态（进程数、窗口标题；只读）",
    input: {},
    async run() {
      const st = await WORKBUDDY_ADAPTER.workbuddyAdapter.status();
      if (!st.installed) {
        const err = new Error(st.summary);
        err.kind = "UNAVAILABLE";
        throw err;
      }
      return { summary: st.summary, output: st };
    },
  };

  EXECUTORS["workbuddy.launch"] = {
    ...wbExecBase,
    description: "WorkBuddy · 启动桌面应用（仅启动并验证进程出现；无任务提交接口）",
    input: {},
    timeoutMs: 30_000,
    async run() {
      const res = await WORKBUDDY_ADAPTER.workbuddyAdapter.launch();
      if (!res.ok) {
        const err = new Error(res.error || "launch failed");
        err.kind = res.status;
        err.output = res.output || null;
        audit({ kind: "workbuddy_launch_failed", status: res.status, error: res.error });
        throw err;
      }
      audit({ kind: "workbuddy_launched", pid: res.output?.newWorkBuddyPid, count: res.output?.runningProcessCount });
      return { summary: `WorkBuddy 已启动（当前 ${res.output.runningProcessCount} 个进程）`, output: res.output };
    },
  };
}

// ── V3L Phase D (§四): task handoff materials ───────────────────────────
// When an executor is unavailable or a run fails after retries, the phone
// (or another executor, once actually available and approved) can pick the
// task up from a COMPLETE handoff record: the original task input, the run
// timeline, the real error, and any partial output. Handoff records live in
// runs.json (already restart-safe); a dedicated endpoint lists resumable
// runs so a second executor can continue WITHOUT re-running finished work.
function handoffPayload(run) {
  return {
    runId: run.runId,
    executor: run.executor,
    input: run.input,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    error: run.error,
    timeline: run.timeline,
    partialOutput: run.result?.output ?? null,
    summary: run.result?.summary ?? null,
    note: "交接材料 = 原始任务 + 真实时间线 + 真实错误 + 部分产物。接续的执行器应先读取本材料，不要重跑已完成的部分。",
  };
}

function isResumableRun(run) {
  // A failed/timed_out run MAY be resumed (real error is known). A
  // cancelled run is NOT auto-resumable (user said stop). Completed runs
  // must NEVER be re-executed.
  return ["failed", "timed_out"].includes(run.status);
}

// ── State: token / audit / runs ────────────────────────────────────────

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

// Phase C (§6.3): runs.json survives gateway restarts; stale "running" rows
// from a previous process can never resume — mark them failed honestly.
function reconcileStaleRuns() {
  let changed = false;
  for (const r of runs) {
    if (r.status === "running" || r.status === "queued") {
      r.status = "failed";
      r.error = "gateway restarted while the run was in flight";
      r.finishedAt = new Date().toISOString();
      r.timeline = (r.timeline || []).concat([{ ts: new Date().toISOString(), type: "failed", message: r.error }]);
      changed = true;
    }
  }
  if (changed) saveRuns(runs);
}

function loadOrCreateToken() {
  ensureStateDir();
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j.token === "string" && j.token.length >= 32) return j.token;
  } catch (e) { /* first run */ }
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return token;
}

function audit(event) {
  try {
    ensureStateDir();
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString() }, event)) + "\n";
    fs.appendFileSync(AUDIT_FILE, line);
  } catch (e) { /* audit failure must never crash the gateway */ }
}

function loadRuns() {
  try {
    const raw = fs.readFileSync(RUNS_FILE, "utf8");
    const j = JSON.parse(raw);
    if (Array.isArray(j.runs)) return j.runs;
  } catch (e) { /* first run */ }
  return [];
}

function saveRuns(runsList) {
  try {
    ensureStateDir();
    fs.writeFileSync(RUNS_FILE, JSON.stringify({ savedAt: new Date().toISOString(), runs: runsList.slice(0, MAX_RUNS_KEPT) }, null, 2));
  } catch (e) { /* non-fatal */ }
}

// ── Run engine: one concurrent execution (S7), hard timeout (S3) ──────

const runs = loadRuns();
reconcileStaleRuns();
let executing = false;
let executingRunId = null;
const cancelHooks = new Map();
const queue = [];
const cancelled = new Set();

function newRunId() {
  return "run_" + crypto.randomBytes(8).toString("hex");
}

function getRun(id) {
  return runs.find((r) => r.runId === id) || null;
}

function enqueueRun(executor, input) {
  const run = {
    runId: newRunId(),
    executor,
    input,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    timeline: [{ ts: new Date().toISOString(), type: "queued", message: "任务已排队" }],
  };
  runs.unshift(run);
  if (runs.length > MAX_RUNS_KEPT) runs.length = MAX_RUNS_KEPT;
  saveRuns(runs);
  queue.push(run);
  processQueue();
  return run;
}

function processQueue() {
  if (executing) return;
  const run = queue.shift();
  if (!run) return;
  if (cancelled.has(run.runId)) {
    run.status = "cancelled";
    run.finishedAt = new Date().toISOString();
    run.timeline.push({ ts: new Date().toISOString(), type: "cancelled", message: "排队中已取消" });
    saveRuns(runs);
    processQueue();
    return;
  }
  executing = true;
  executingRunId = run.runId;
  run.status = "running";
  run.startedAt = new Date().toISOString();
  run.timeline.push({ ts: new Date().toISOString(), type: "running", message: "开始执行" });
  audit({ kind: "run_start", runId: run.runId, executor: run.executor });
  executeRun(run);
}

// ── Phase C: single-final-state run engine ─────────────────────────────
// Invariants (docs/AGENT_REMOTE_DESIGN.md + phase-c task §2.1):
//   1. a run enters its final state EXACTLY ONCE (first writer wins);
//   2. a timed-out run can never flip to completed afterwards (the late
//      Promise result is discarded, and the executor's cancel hook fires);
//   3. a cancelled run can never flip to completed (same discard rule);
//   4. the execution slot is ALWAYS released (finally), the queue keeps
//      flowing after timeouts/cancels/crashes;
//   5. an executor throwing synchronously or a run() without a cancel hook
//      never crashes the gateway process.

function killProcessTree(pid, label) {
  // Windows: taskkill /T /F /PID kills the tree (codex/git spawn children).
  // POSIX: negative-PID group kill when available, fallback SIGKILL.
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/T", "/F", "/PID", String(pid)], { shell: false, windowsHide: true })
        .on("error", () => { /* best effort */ });
    } else {
      try { process.kill(-pid, "SIGKILL"); } catch (e) { /* not a group leader */ }
    }
  } catch (e) {
    audit({ kind: "kill_tree_error", pid, label, error: String((e && e.message) || e) });
  }
}

function finalizeRunOnce(run, status, patch) {
  if (run.__finalized) return false; // invariant 1/2/3: first final state wins
  run.__finalized = true;
  run.status = status;
  if (patch && typeof patch === "object") {
    if (patch.result !== undefined) run.result = patch.result;
    if (patch.error !== undefined) run.error = patch.error;
  }
  run.finishedAt = new Date().toISOString();
  return true;
}

function executeRun(run) {
  const ex = EXECUTORS[run.executor];
  const timeoutMs = Number.isFinite(ex.timeoutMs) && ex.timeoutMs > 0
    ? Math.min(ex.timeoutMs, 625_000) : HARD_TIMEOUT_MS;
  let child = null; // Phase C: track the executor's spawned child (if any)
  let done = false;
  const controller = new AbortController();

  const setCancellable = (c) => {
    child = c;
    if (child && (cancelled.has(run.runId) || run.__finalized)) {
      // cancel arrived between enqueue and spawn — kill immediately
      killProcessTree(child.pid, run.executor);
    }
  };

  const ctx = {
    setCancellable,
    signal: controller.signal,
    // Adapters call this to register the real child process for
    // timeout/cancel tree-kill. No hook = pure in-process promise.
  };

  const timer = setTimeout(() => {
    controller.abort();
    // Phase C: kill the real child tree FIRST, then finalize as timed_out.
    if (child && child.pid) killProcessTree(child.pid, "timeout");
    if (finalizeRunOnce(run, "timed_out", { error: `hard timeout (${timeoutMs}ms)` })) {
      run.timeline.push({ ts: new Date().toISOString(), type: "timed_out", message: run.error });
      audit({ kind: "run_timeout", runId: run.runId });
      saveRuns(runs);
      executing = false;
      executingRunId = null;
      processQueue();
    }
  }, timeoutMs);

  cancelHooks.set(run.runId, () => {
    controller.abort();
    if (child?.pid) killProcessTree(child.pid, "cancel");
    if (!finalizeRunOnce(run, "cancelled", {})) return;
    clearTimeout(timer);
    run.timeline.push({ ts: new Date().toISOString(), type: "cancelled", message: "执行已取消" });
    audit({ kind: "run_done", runId: run.runId, status: "cancelled" });
    saveRuns(runs);
    if (executingRunId === run.runId) {
      executing = false;
      executingRunId = null;
      processQueue();
    }
  });

  let promise;
  try {
    promise = Promise.resolve().then(() => ex.run(run.input || {}, ctx));
  } catch (e) {
    // synchronous throw — must not crash the gateway (invariant 5)
    promise = Promise.reject(e);
  }

  promise
    .then((res) => {
      clearTimeout(timer);
      if (cancelled.has(run.runId)) {
        if (finalizeRunOnce(run, "cancelled", {})) {
          run.timeline.push({ ts: new Date().toISOString(), type: "cancelled", message: "执行后标记取消（结果丢弃）" });
          audit({ kind: "run_done", runId: run.runId, status: "cancelled" });
          saveRuns(runs);
        }
      } else if (finalizeRunOnce(run, "completed", { result: res })) {
        run.timeline.push({ ts: new Date().toISOString(), type: "completed", message: (res && res.summary) || "执行完成" });
        audit({ kind: "run_done", runId: run.runId, status: "completed" });
        saveRuns(runs);
      }
    })
    .catch((e) => {
      clearTimeout(timer);
      if (cancelled.has(run.runId) && run.__finalized) {
        // already timed out/cancelled — keep that state, record the noise
        audit({ kind: "run_late_error", runId: run.runId, error: String((e && e.message) || e) });
        return;
      }
      const status = e?.kind === "timed_out" ? "timed_out" : "failed";
      if (finalizeRunOnce(run, status, { error: String((e && e.message) || e) })) {
        run.timeline.push({ ts: new Date().toISOString(), type: status, message: run.error });
        audit({ kind: "run_error", runId: run.runId, error: run.error });
        saveRuns(runs);
      }
    })
    .finally(() => {
      clearTimeout(timer);
      cancelHooks.delete(run.runId);
      done = true;
      if (!run.__finalized) {
        // safety net: never leave a run stuck in "running" (invariant 4)
        finalizeRunOnce(run, "failed", { error: "executor ended without a final state (gateway bug)" });
        saveRuns(runs);
      }
      if (executingRunId === run.runId) {
        executing = false;
        executingRunId = null;
        processQueue();
      }
    });
}

// ── HTTP surface ───────────────────────────────────────────────────────

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const portIdx = process.argv.indexOf("--port");
const argPort = Math.max(1, parseInt(portIdx >= 0 ? process.argv[portIdx + 1] : "", 10) || 8765);
const lanMode = process.argv.includes("--lan");

const TOKEN = loadOrCreateToken();

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: "bad url" });
  }
  const p = url.pathname.replace(/\/+$/, "") || "/";

  // Health: no token needed, no internals echoed.
  if (p === "/health" && (req.method === "GET" || req.method === "HEAD")) {
    return sendJson(res, 200, { ok: true, name: NAME, version: VERSION, uptimeSec: Math.round(process.uptime()) });
  }

  // Everything else: token check (S1).
  const token = req.headers["x-gorgon-token"];
  if (!token || token !== TOKEN) {
    audit({ kind: "auth_fail", path: p, ip: req.socket.remoteAddress });
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }

  if (req.method === "GET" && p === "/v1/executors") {
    const list = Object.entries(EXECUTORS).map(([id, ex]) => ({
      id, description: ex.description, input: ex.input,
      // Phase C (§6.1): backward-compatible capability fields.
      agent: ex.agent || "gateway",
      availability: ex.availability || "AVAILABLE",
    }));
    return sendJson(res, 200, { ok: true, executors: list });
  }

  if (req.method === "POST" && p === "/v1/runs") {
    let body;
    try { body = JSON.parse((await readBody(req, MAX_BODY_BYTES)) || "{}"); }
    catch (e) { return sendJson(res, 400, { ok: false, error: "invalid JSON" }); }
    const executor = String(body.executor || "");
    if (!EXECUTORS[executor]) {
      audit({ kind: "reject_executor", executor });
      return sendJson(res, 400, { ok: false, error: "unknown executor (allowlist only)" });
    }
    const run = enqueueRun(executor, body.input && typeof body.input === "object" ? body.input : {});
    return sendJson(res, 202, { ok: true, runId: run.runId, status: run.status });
  }

  const runMatch = p.match(/^\/v1\/runs\/([a-zA-Z0-9_]+)(\/cancel)?$/);
  if (runMatch) {
    const run = getRun(runMatch[1]);
    if (!run) return sendJson(res, 404, { ok: false, error: "run not found" });
    if (req.method === "GET") return sendJson(res, 200, { ok: true, run });
    if (req.method === "POST" && runMatch[2] === "/cancel") {
      // Phase C: distinguish「已申请取消」from「已实际取消」. The final
      // cancelled status is only written by the engine (queue skip /
      // finalize-once); here we only mark the request and kill the live
      // child tree when the run is already executing.
      cancelled.add(run.runId);
      const isFinal = ["completed", "failed", "timed_out", "cancelled"].includes(run.status);
      if (!isFinal) run.timeline.push({ ts: new Date().toISOString(), type: "cancel_requested", message: "收到取消请求" });
      if (!isFinal) cancelHooks.get(run.runId)?.();
      saveRuns(runs);
      return sendJson(res, 202, { ok: true, runId: run.runId, status: run.status, cancelRequested: !isFinal });
    }
  }

  if (req.method === "GET" && p === "/v1/runs") {
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
    return sendJson(res, 200, { ok: true, runs: runs.slice(0, limit).map((r) => ({
      runId: r.runId, executor: r.executor, status: r.status, createdAt: r.createdAt,
      finishedAt: r.finishedAt, summary: r.result ? r.result.summary : r.error,
    })) });
  }

  // V3L Phase D: handoff materials for resumable runs (§四).
  if (req.method === "GET" && p === "/v1/handoffs") {
    return sendJson(res, 200, { ok: true, handoffs: runs.filter(isResumableRun).map(handoffPayload) });
  }
  const handoffMatch = p.match(/^\/v1\/runs\/([a-zA-Z0-9_]+)\/handoff$/);
  if (req.method === "GET" && handoffMatch) {
    const run = getRun(handoffMatch[1]);
    if (!run) return sendJson(res, 404, { ok: false, error: "run not found" });
    if (!isResumableRun(run)) {
      return sendJson(res, 409, { ok: false, error: "该任务不可交接：已完成/已取消的任务不能重跑，请查看其结果或状态。" });
    }
    return sendJson(res, 200, { ok: true, handoff: handoffPayload(run) });
  }

  return sendJson(res, 404, { ok: false, error: "not found" });
});

ensureStateDir();
audit({ kind: "gateway_start", version: VERSION, lan: lanMode });

server.listen(argPort, lanMode ? "0.0.0.0" : "127.0.0.1", () => {
  const addr = server.address();
  const ifs = [];
  const nets = os.networkInterfaces();
  for (const k of Object.keys(nets)) {
    for (const n of nets[k] || []) {
      if (n.family === "IPv4" && !n.internal) ifs.push(n.address);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[${NAME}] v${VERSION} listening on ${addr.address}:${addr.port}${lanMode ? " (LAN)" : " (localhost only)"}`);
  // eslint-disable-next-line no-console
  console.log(`[${NAME}] token: ${TOKEN.slice(0, 8)}...${TOKEN.slice(-8)} (full token in ${TOKEN_FILE})`);
  if (lanMode) {
    // eslint-disable-next-line no-console
    console.log(`[${NAME}] phone should point at: http://${ifs[0] || "<lan-ip>"}:${addr.port}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[${NAME}] executors: ${Object.keys(EXECUTORS).join(", ")}`);
});
