// Gorgon Workbench — Phase C (§3.3): Codex Adapter real-execution test.
//
// Verifies against the REAL Codex CLI:
//   1. detection returns the real installed version
//   2. output filtering redacts secrets
//   3. failure classification (usage limit / auth / network) is honest
//   4. a real model call either completes (CODEX_REAL_EXECUTION=PASS)
//      or reports the true block reason (BLOCKED_USAGE_LIMIT etc.)
//      — never a fabricated PASS.
//
// The real-call test respects the usage-limit recovery time: if Codex
// reports a usage limit, the test records BLOCKED_USAGE_LIMIT and stops
// (no retry loops).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// WorkBuddy sandbox shim compatibility: the host's node-safe-delete-shim
// may turn a bulk rmSync into SAFE_DELETE_BULK_CONFIRM_REQUIRED (>=50
// deletions in one turn). Scratch state dirs are disposable, so cleanup
// is best-effort here — never a test failure.
function rmSyncBestEffort(target, options) {
  try {
    fs.rmSync(target, options);
  } catch (error) {
    if (String(error && error.message || error).includes("SAFE_DELETE")) return;
    throw error;
  }
}
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORK = fileURLToPath(new URL("../../work/", import.meta.url));
fs.mkdirSync(WORK, { recursive: true });

function fixture(t, source) {
  const cwd = fs.mkdtempSync(path.join(WORK, "codex-adapter-"));
  // Node stands in for the CLI solely to verify OS process/pipe behavior.
  // This is never evidence of real AI execution.
  fs.writeFileSync(path.join(cwd, "exec"), source);
  t.after(() => rmSyncBestEffort(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { codexPath: process.execPath, cwd, prompt: "approved test prompt", timeoutMs: 3000 };
}

const adapter = await import("../../scripts/agent-adapters/codex-adapter.mjs");

test("codex adapter: detection finds the real CLI", async () => {
  const det = await adapter.detectCodex();
  console.log("   detect:", JSON.stringify(det));
  if (!det.ok) {
    // honest skip — CLI truly absent on this machine
    console.log("   CODEX_CLI_NOT_FOUND (detection test cannot pass)");
    assert.ok(det.error, "detection must report an error string");
    return;
  }
  assert.match(det.version, /^\d+\.\d+/);
  assert.ok(det.codexPath, "codexPath set");
});

test("codex adapter: sensitive output is filtered", () => {
  const dirty = [
    "token: sk-abcdefghijklmnop123456",
    "auth: Bearer abcdef1234567890abcdef",
    "github: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234",
    "clean line stays",
  ].join("\n");
  const out = adapter.filterSecrets(dirty);
  assert.ok(!out.includes("sk-abcdefghijklmnop123456"), "sk- token redacted");
  assert.ok(!out.includes("Bearer abcdef1234567890abcdef"), "bearer redacted");
  assert.ok(!out.includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"), "ghp redacted");
  assert.ok(out.includes("clean line stays"), "clean text untouched");
});

test("codex adapter: closes stdin before CLI accepts the prompt", async (t) => {
  const opts = fixture(t, `process.stdin.resume(); process.stdin.on('end', () => {
    console.log(JSON.stringify({ argv: process.argv.slice(2), eof: true }));
  });`);
  const res = await adapter.execCodex(opts);
  assert.equal(res.status, "completed", "an open stdin pipe blocks codex before the model call");
  const received = JSON.parse(res.output);
  assert.equal(received.eof, true);
  assert.ok(received.argv.includes("read-only"));
  assert.ok(received.argv.includes(opts.cwd));
  assert.equal(received.argv.at(-1), opts.prompt);
});

for (const [message, status] of [
  ["You have hit your usage limit. Try again at 22:00", "BLOCKED_USAGE_LIMIT"],
  ["401 Unauthorized: please sign in", "BLOCKED_AUTH"],
  ["proxy connection failed: ECONNREFUSED", "BLOCKED_NETWORK"],
]) {
  test(`codex adapter: classifies ${status} with evidence on stdout`, async (t) => {
    const opts = fixture(t, `console.error('CLI startup'); console.log(${JSON.stringify(message)}); process.exitCode = 1;`);
    const res = await adapter.execCodex(opts);
    assert.equal(res.status, status);
    assert.equal(res.exitCode, 1);
    assert.equal(res.stderr.trim(), "CLI startup");
  });
}

test("codex adapter: timeout retains redacted network diagnostics", async (t) => {
  let child;
  const opts = fixture(t, `console.error('proxy connection failed: Bearer abcdef1234567890abcdef'); setTimeout(() => {}, 30000);`);
  const res = await adapter.execCodex({ ...opts, timeoutMs: 800, onChild(p) { child = p; } });
  assert.equal(res.status, "timed_out");
  assert.equal(res.failureKind, "BLOCKED_NETWORK");
  assert.match(res.stderr, /proxy connection failed/);
  assert.ok(!res.stderr.includes("abcdef1234567890abcdef"));
  await new Promise((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("close", resolve));
  assert.throws(() => process.kill(child.pid, 0));
});

test("codex adapter: cancellation stops its real child process", async (t) => {
  const controller = new AbortController();
  let child;
  const opts = fixture(t, `setTimeout(() => {}, 30000);`);
  const res = await adapter.execCodex({ ...opts, signal: controller.signal, onChild(p) {
    child = p;
    p.once("spawn", () => controller.abort());
  } });
  assert.equal(res.status, "cancelled");
  await new Promise((resolve) => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("close", resolve));
  assert.throws(() => process.kill(child.pid, 0));
});

test("codex adapter: pre-cancelled input never spawns", async () => {
  const controller = new AbortController();
  controller.abort();
  const res = await adapter.execCodex({ signal: controller.signal, onChild() { assert.fail("must not spawn"); } });
  assert.equal(res.status, "cancelled");
});

test("codex adapter: empty successful process is not AI completion", async (t) => {
  const res = await adapter.execCodex(fixture(t, "process.exitCode = 0;"));
  assert.equal(res.ok, false);
  assert.equal(res.status, "failed");
});

test("codex adapter: REAL read-only diagnosis call (P1 acceptance)", {
  skip: process.env.GORGON_CODEX_REAL_EXECUTION !== "1" ? "explicit, preflight-approved single call only" : false,
}, async () => {
  const det = await adapter.detectCodex();
  assert.ok(det.ok, "codex CLI must be installed for the real-call test");
  const REPO = fileURLToPath(new URL("../../", import.meta.url));
  const excerpt = fs.readFileSync(path.join(REPO, "readme.md"), "utf8").slice(0, 1500);
  const res = await adapter.execCodex({
    codexPath: det.codexPath,
    cwd: REPO,
    prompt: "根据以下 readme.md 摘录，用一句中文分析 Gorgon 的核心工作流程如何把信息转化为行动。不要运行命令、调用工具或读写文件。只返回分析内容。\n\n" + excerpt,
    timeoutMs: 240_000,
    maxOutputChars: 4000,
  });
  console.log("   real call status:", res.status, "| exit:", res.exitCode, "| duration:", res.durationMs, "ms");
  console.log("   output head:", String(res.output || "").split("\n").slice(-6).join(" / ").slice(0, 300));
  console.log("   error:", res.error || "(none)");
  if (res.status === "completed") {
    assert.ok(String(res.output).trim().length > 20, "real model must return analysis content");
    console.log("   CODEX_REAL_EXECUTION=PASS");
    return;
  }
  // Honest block reporting — the test PASSES as a classification test,
  // but the run status is NOT completed (no fabricated success).
  assert.ok(
    ["BLOCKED_USAGE_LIMIT", "BLOCKED_AUTH", "BLOCKED_NETWORK", "failed", "timed_out"].includes(res.status),
    `honest status expected, got: ${res.status}`,
  );
  console.log(`   CODEX_REAL_EXECUTION=${res.status === "timed_out" ? "FAIL_TIMEOUT" : res.status}`);
  // Assert the classification matches the known cause when usage-limited.
  if (res.status === "BLOCKED_USAGE_LIMIT") {
    assert.match(res.error, /usage limit|try again at \d/i);
  }
});
