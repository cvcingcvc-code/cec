// E2E: gateway + workbuddy.submitTask over the real HTTP API path (what the phone does).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = path.resolve("F:/Gorgon-Parallel/v3i/.e2e-wbipc-test");
fs.rmSync(STATE_DIR, { recursive: true, force: true });
fs.mkdirSync(STATE_DIR, { recursive: true });

const PORT = 8791;
const gateway = spawn(process.env.NODE_EXE || "node", ["scripts/agent-gateway.mjs", "--port", String(PORT)], {
  cwd: "F:/Gorgon-Parallel/v3i",
  env: { ...process.env, GORGON_GATEWAY_STATE_DIR: "F:\\Gorgon-Parallel\\v3i\\.e2e-wbipc-test" },
  stdio: ["ignore", "pipe", "pipe"],
});
let gwLog = "";
gateway.stdout.on("data", (d) => { gwLog += d; });
gateway.stderr.on("data", (d) => { gwLog += d; });

const t0 = Date.now();
const log = (m) => console.log(`[+${String(Date.now() - t0).padStart(5)}ms] ${m}`);

// wait for token.json
let token = null;
for (let i = 0; i < 40 && !token; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    token = JSON.parse(fs.readFileSync(path.join(STATE_DIR, "token.json"), "utf8")).token;
  } catch { /* retry */ }
}
if (!token) { console.log("FAIL: no token.json\n" + gwLog); gateway.kill(); process.exit(1); }
log("gateway up, token acquired");

async function api(method, url, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
    method,
    headers: { "X-Gorgon-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitRun(runId, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const r = await api("GET", `/v1/runs/${runId}`);
    const run = r.json?.run;
    if (run && ["completed", "failed", "timed_out", "cancelled"].includes(run.status)) return run;
  }
  return null;
}

// 0. executors list — workbuddy.submitTask must be present
const ex = await api("GET", "/v1/executors");
const hasSubmit = JSON.stringify(ex.json).includes("workbuddy.submitTask");
log("executors: " + (ex.json?.executors || []).map((e) => e.id).join(", "));
if (!hasSubmit) { console.log("*** FAIL: submitTask not in executors ***"); gateway.kill(); process.exit(1); }

// 1. real read-only task: read_accounts
const run1 = await api("POST", "/v1/runs", { executor: "workbuddy.submitTask", input: { operation: "read_accounts" } });
if (!run1.json?.runId) { console.log("*** FAIL: no runId: " + JSON.stringify(run1.json)); gateway.kill(); process.exit(1); }
log("POST read_accounts -> " + run1.status + " runId=" + run1.json.runId);
const done1 = await waitRun(run1.json.runId);
log("read_accounts: status=" + done1?.status + " | " + String(done1?.result?.summary || done1?.error || "").slice(0, 120));
if (done1?.status !== "completed") {
  console.log("*** FAIL: read_accounts not completed: " + JSON.stringify(done1, null, 2).slice(0, 800));
  gateway.kill(); process.exit(1);
}
console.log("  accounts output: " + JSON.stringify(done1.result?.output?.accounts || done1.result?.output).slice(0, 300));

// 2. real read-only task: read_profile
const run2 = await api("POST", "/v1/runs", { executor: "workbuddy.submitTask", input: { operation: "read_profile" } });
const done2 = await waitRun(run2.json.runId);
log("read_profile: status=" + done2?.status + " | " + String(done2?.result?.summary || done2?.error || "").slice(0, 120));
if (done2?.status !== "completed") {
  console.log("*** FAIL: read_profile not completed: " + JSON.stringify(done2, null, 2).slice(0, 600));
  gateway.kill(); process.exit(1);
}

// 3. unsupported op must fail honestly
const run3 = await api("POST", "/v1/runs", { executor: "workbuddy.submitTask", input: { operation: "send_message" } });
const done3 = await waitRun(run3.json.runId);
log("send_message: status=" + done3?.status + " | " + String(done3?.error || done3?.result?.error || "").slice(0, 160));
if (done3?.status !== "failed") {
  console.log("*** FAIL: unsupported op should fail: " + JSON.stringify(done3).slice(0, 400));
  gateway.kill(); process.exit(1);
}

gateway.kill();
console.log("\nE2E PASS: workbuddy.submitTask real execution over HTTP API verified");
process.exit(0);
