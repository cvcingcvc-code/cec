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
const STATE_DIR = path.join(__dirname, ".agent-gateway");
const TOKEN_FILE = path.join(STATE_DIR, "token.json");
const AUDIT_FILE = path.join(STATE_DIR, "audit.log");
const RUNS_FILE = path.join(STATE_DIR, "runs.json");

const NAME = "gorgon-agent-gateway";
const VERSION = "0.1.0";
const HARD_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_RUNS_KEPT = 200;

// ── Executor allowlist (S2) ────────────────────────────────────────────
// Every executor: { description, input schema, run(input) }.
// run() MUST be bounded: no shell, no dynamic paths outside the repo,
// hard size caps on output. Results are structured, never fabricated.

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

// ── State: token / audit / runs ────────────────────────────────────────

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
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
let executing = false;
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
  run.status = "running";
  run.startedAt = new Date().toISOString();
  run.timeline.push({ ts: new Date().toISOString(), type: "running", message: "开始执行" });
  audit({ kind: "run_start", runId: run.runId, executor: run.executor });

  const ex = EXECUTORS[run.executor];
  const timer = setTimeout(() => {
    run.status = "failed";
    run.error = `hard timeout (${HARD_TIMEOUT_MS}ms)`;
    run.finishedAt = new Date().toISOString();
    run.timeline.push({ ts: new Date().toISOString(), type: "failed", message: run.error });
    audit({ kind: "run_timeout", runId: run.runId });
    saveRuns(runs);
    executing = false;
    processQueue();
  }, HARD_TIMEOUT_MS);

  Promise.resolve()
    .then(() => ex.run(run.input || {}))
    .then((res) => {
      clearTimeout(timer);
      if (cancelled.has(run.runId)) {
        run.status = "cancelled";
        run.timeline.push({ ts: new Date().toISOString(), type: "cancelled", message: "执行后标记取消（结果丢弃）" });
      } else {
        run.status = "completed";
        run.result = res; // { summary, output }
        run.timeline.push({ ts: new Date().toISOString(), type: "completed", message: (res && res.summary) || "执行完成" });
      }
      run.finishedAt = new Date().toISOString();
      audit({ kind: "run_done", runId: run.runId, status: run.status });
      saveRuns(runs);
    })
    .catch((e) => {
      clearTimeout(timer);
      run.status = "failed";
      run.error = String((e && e.message) || e);
      run.finishedAt = new Date().toISOString();
      run.timeline.push({ ts: new Date().toISOString(), type: "failed", message: run.error });
      audit({ kind: "run_error", runId: run.runId, error: run.error });
      saveRuns(runs);
    })
    .finally(() => {
      executing = false;
      processQueue();
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
    const list = Object.entries(EXECUTORS).map(([id, ex]) => ({ id, description: ex.description, input: ex.input }));
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
      cancelled.add(run.runId);
      run.timeline.push({ ts: new Date().toISOString(), type: "cancel_requested", message: "收到取消请求" });
      saveRuns(runs);
      return sendJson(res, 202, { ok: true, runId: run.runId, status: run.status, cancelRequested: true });
    }
  }

  if (req.method === "GET" && p === "/v1/runs") {
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
    return sendJson(res, 200, { ok: true, runs: runs.slice(0, limit).map((r) => ({
      runId: r.runId, executor: r.executor, status: r.status, createdAt: r.createdAt,
      finishedAt: r.finishedAt, summary: r.result ? r.result.summary : r.error,
    })) });
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
