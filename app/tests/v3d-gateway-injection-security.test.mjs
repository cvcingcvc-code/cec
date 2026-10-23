// Test executor hooks run local code. Exercise startup side effects as well
// as HTTP rejection, with copied gateway scripts and all state under work/.
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
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = path.join(REPO, "work", "gateway-injection-security");
const SOURCE = path.join(REPO, "scripts", "agent-gateway.mjs");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert.notEqual(port, 8765);
  return port;
}

async function fixture(t, options = {}) {
  fs.mkdirSync(ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(ROOT, "case-"));
  const scripts = path.join(dir, "scripts");
  const state = path.join(dir, "state");
  fs.mkdirSync(scripts);
  fs.mkdirSync(state);
  const script = path.join(scripts, "agent-gateway.mjs");
  fs.copyFileSync(SOURCE, script);
  const moduleMarker = path.join(dir, "module-evaluated");
  const jsonMarker = path.join(dir, "json-evaluated");
  const moduleFile = path.join(options.outside ? dir : state, "fixtures.mjs");
  const jsonFile = path.join(options.outside ? dir : state, "fixtures.json");
  const moduleId = options.replaceBuiltin ? "repo.status" : "test.module";
  const jsonId = options.replaceBuiltin ? "host.stats" : "test.json";
  fs.writeFileSync(moduleFile, [
    'import fs from "node:fs";',
    `fs.writeFileSync(${JSON.stringify(moduleMarker)}, "evaluated");`,
    `export default { ${JSON.stringify(moduleId)}: { description: "injected module", input: {},`,
    '  run() { return { summary: "module fixture completed", output: "fixture only" }; } } };',
  ].join("\n"));
  fs.writeFileSync(jsonFile, JSON.stringify({
    [jsonId]: {
      description: "injected json", input: {},
      runSource: `(() => { process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(jsonMarker)}, "evaluated"); return () => ({ summary: "json fixture completed", output: "fixture only" }); })()`,
    },
  }));
  const env = { ...process.env };
  for (const name of ["NODE_ENV", "GORGON_GATEWAY_TEST_MODE", "GORGON_GATEWAY_STATE_DIR",
    "GORGON_GATEWAY_EXTRA_EXECUTORS", "GORGON_GATEWAY_EXTRA_EXECUTORS_FILE"]) delete env[name];
  Object.assign(env, {
    GORGON_GATEWAY_STATE_DIR: state,
    GORGON_GATEWAY_EXTRA_EXECUTORS: jsonFile,
    GORGON_GATEWAY_EXTRA_EXECUTORS_FILE: moduleFile,
  }, options.env || {});
  if (options.noState) delete env.GORGON_GATEWAY_STATE_DIR;
  if (options.productionState) env.GORGON_GATEWAY_STATE_DIR = path.join(scripts, ".agent-gateway");
  const activeState = env.GORGON_GATEWAY_STATE_DIR || path.join(scripts, ".agent-gateway");
  const port = await freePort();
  const child = spawn(process.execPath, [script, "--port", String(port), ...(options.lan ? ["--lan"] : [])], {
    cwd: dir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume(); // gateway prints its pairing token; never log it
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill("SIGKILL");
      await closed;
    }
    const relative = path.relative(ROOT, dir);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    rmSyncBestEffort(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      if (health.ok) { ready = true; break; }
    } catch { /* startup not ready */ }
    await sleep(30);
  }
  assert.ok(ready, `gateway startup failed: ${stderr}`);
  const token = JSON.parse(fs.readFileSync(path.join(activeState, "token.json"), "utf8")).token;
  async function api(method, route, body) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { "X-Gorgon-Token": token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }
  return { api, moduleMarker, jsonMarker, activeState };
}

const enabled = { NODE_ENV: "test", GORGON_GATEWAY_TEST_MODE: "1" };
const denied = [
  ["production without explicit gates", {}],
  ["NODE_ENV=production even with explicit flag", { env: { NODE_ENV: "production", GORGON_GATEWAY_TEST_MODE: "1" } }],
  ["NODE_ENV=test alone", { env: { NODE_ENV: "test" } }],
  ["explicit flag alone", { env: { GORGON_GATEWAY_TEST_MODE: "1" } }],
  ["non-exact explicit flag", { env: { NODE_ENV: "test", GORGON_GATEWAY_TEST_MODE: "true" } }],
  ["missing isolated state directory", { env: enabled, noState: true }],
  ["production state directory", { env: enabled, productionState: true }],
  ["LAN mode even with all test gates", { env: enabled, lan: true }],
  ["fixture paths outside isolated state directory", { env: enabled, outside: true }],
];

for (const [name, options] of denied) {
  test(`test injection denied: ${name}`, async (t) => {
    const gateway = await fixture(t, options);
    const list = await gateway.api("GET", "/v1/executors");
    assert.equal(list.status, 200);
    assert.ok(list.body.executors.every((executor) => !executor.id.startsWith("test.")));
    for (const executor of ["test.module", "test.json"]) {
      const result = await gateway.api("POST", "/v1/runs", { executor, input: {} });
      assert.equal(result.status, 400, "HTTP must not expose injected commands");
    }
    assert.equal(fs.existsSync(gateway.moduleMarker), false, "module startup side effect must not run");
    assert.equal(fs.existsSync(gateway.jsonMarker), false, "JSON source expression must not be evaluated");
  });
}

test("test injection enabled only in explicit isolated loopback test mode", async (t) => {
  const gateway = await fixture(t, { env: enabled });
  assert.equal(fs.existsSync(gateway.moduleMarker), true);
  assert.equal(fs.existsSync(gateway.jsonMarker), true);
  const list = await gateway.api("GET", "/v1/executors");
  for (const executor of ["test.module", "test.json"]) {
    assert.ok(list.body.executors.some((entry) => entry.id === executor));
    const result = await gateway.api("POST", "/v1/runs", { executor, input: {} });
    assert.equal(result.status, 202);
    let run;
    for (let i = 0; i < 50; i++) {
      run = (await gateway.api("GET", `/v1/runs/${result.body.runId}`)).body.run;
      if (run.status === "completed") break;
      await sleep(20);
    }
    assert.equal(run.status, "completed");
    assert.match(run.result.summary, /fixture completed/);
  }
});

test("test fixtures cannot replace shipped executors or evaluate replacement JSON source", async (t) => {
  const gateway = await fixture(t, { env: enabled, replaceBuiltin: true });
  const list = await gateway.api("GET", "/v1/executors");
  assert.ok(list.body.executors.some((entry) => entry.id === "repo.status"));
  assert.ok(list.body.executors.every((entry) => !entry.description.startsWith("injected")));
  assert.equal(fs.existsSync(gateway.jsonMarker), false, "reject existing IDs before evaluating JSON source");
});
