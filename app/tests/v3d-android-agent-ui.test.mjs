// V3D Android AgentScreen regression tests. Real React DOM in headless Edge,
// at a 390px phone viewport; Gateway responses are deterministic fixtures.
// No Android emulator, APK build, model invocation, or new dependency.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Session } from "../../pipeline/tests/cdp_session.mjs";
import {
  executorLabel, getAvailability, getInputMode, buildTaskInput,
  isTerminalRun, runStatusLabel, mergeRunsForMirror, createAgentClient,
} from "../src/screens/agent-screen-model.js";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AVAILABLE = { id: "repo.status", agent: "gateway", availability: "AVAILABLE", input: {}, description: "读取仓库状态" };
const DOCUMENT = { ...AVAILABLE, id: "repo.readDoc", input: { path: "string, repo-relative, docs/*.md or readme.md" } };
const CODEX = { ...AVAILABLE, id: "codex.readonly-diagnosis", agent: "codex", description: "Codex 只读诊断" };
const UNAVAILABLE = { ...CODEX, availability: "UNAVAILABLE" };
const UNKNOWN = { ...AVAILABLE, id: "future.agent", agent: "future", availability: "MAYBE", input: { goal: "string" }, description: "未来任务" };
const ADVANCED = { ...AVAILABLE, id: "future.task", input: { goal: "string" }, description: "未来任务" };

test("Android UX: real availability controls submission and Codex detection stays unverified", () => {
  assert.equal(getAvailability(AVAILABLE).canSubmit, true);
  assert.equal(getAvailability(CODEX).canSubmit, true);
  assert.match(getAvailability(CODEX).detail, /未验证|尚未验证|检测/);
  for (const executor of [UNAVAILABLE, UNKNOWN, null, { ...AVAILABLE, availability: undefined }]) {
    assert.equal(getAvailability(executor).canSubmit, false);
  }
  assert.match(executorLabel(AVAILABLE), /仓库|项目/);
  assert.match(executorLabel(DOCUMENT), /文档/);
});

test("Android UX: empty schema needs no JSON, documents use a path, other schemas use an object", () => {
  assert.equal(getInputMode(AVAILABLE), "none");
  assert.equal(getInputMode(DOCUMENT), "document");
  assert.equal(getInputMode(ADVANCED), "json");
  assert.deepEqual(buildTaskInput(AVAILABLE, { inputJson: "not JSON" }), {});
  assert.deepEqual(buildTaskInput(DOCUMENT, { documentPath: "  readme.md  " }), { path: "readme.md" });
  assert.throws(() => buildTaskInput(DOCUMENT, { documentPath: " " }));
  assert.deepEqual(buildTaskInput(ADVANCED, { inputJson: '{"goal":"检查项目"}' }), { goal: "检查项目" });
  for (const inputJson of ["[]", "null", "42", '"text"', "{broken"]) {
    assert.throws(() => buildTaskInput(ADVANCED, { inputJson }), `reject ${inputJson}`);
  }
});

test("Android UX: cancellation request and final cancellation are distinct, including a completion race", () => {
  assert.equal(runStatusLabel({ status: "running" }, true), "已请求取消");
  assert.equal(runStatusLabel({ status: "running", timeline: [{ type: "cancel_requested" }] }), "已请求取消");
  assert.equal(runStatusLabel({ status: "cancelled" }, true), "已取消");
  assert.equal(runStatusLabel({ status: "completed", timeline: [{ type: "cancel_requested" }] }, true), "已完成");
  for (const status of ["completed", "failed", "timed_out", "cancelled"]) assert.equal(isTerminalRun({ status }), true);
  assert.equal(isTerminalRun({ status: "running" }), false);
});

test("Android UX: summary-only polling retains detail output and existing local mirror records", () => {
  const detail = { runId: "run_full", executor: "repo.status", status: "completed", result: { output: "完整结果", summary: "已完成" } };
  const rows = [{ runId: "run_full", executor: "repo.status", status: "completed", summary: "已完成" }];
  const merged = mergeRunsForMirror(rows, { [detail.runId]: detail }, [{ runId: "run_older", outputText: "离线结果" }]);
  assert.equal(merged.find((run) => run.runId === detail.runId).result.output, "完整结果");
  const polled = mergeRunsForMirror(rows, {}, [{ runId: "run_full", status: "completed", outputText: "已存结果" }]);
  assert.equal(polled.find((run) => run.runId === detail.runId).outputText, "已存结果");
});

test("Android UX: Gateway client preserves authentication, submission body, query and cancel methods", async () => {
  const requests = [];
  const client = createAgentClient("http://fixture.invalid/", "pair-fixture", async (url, options = {}) => {
    requests.push({ url, options });
    const route = new URL(url).pathname;
    const body = route === "/health" ? { ok: true, name: "gateway", version: "test" }
      : route === "/v1/executors" ? { ok: true, executors: [AVAILABLE] }
      : route === "/v1/runs" && options.method === "POST" ? { ok: true, runId: "run_one", status: "queued" }
      : route === "/v1/runs" ? { ok: true, runs: [] }
      : route.endsWith("/cancel") ? { ok: true, runId: "run_one", status: "running", cancelRequested: true }
      : { ok: true, run: { runId: "run_one", status: "running" } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  await client.health();
  await client.executors();
  await client.runs();
  await client.run("run_one");
  await client.submit("repo.status", {});
  await client.cancel("run_one");
  assert.equal(requests.length, 6);
  for (const { options } of requests.slice(1)) assert.equal(new Headers(options.headers).get("X-Gorgon-Token"), "pair-fixture");
  const submission = requests.find(({ url, options }) => new URL(url).pathname === "/v1/runs" && options.method === "POST");
  assert.deepEqual(JSON.parse(submission.options.body), { executor: "repo.status", input: {} });
  assert.equal(requests.at(-1).options.method, "POST");
  assert.match(requests.at(-1).url, /\/v1\/runs\/run_one\/cancel$/);
});

test("Android UX: Gateway client rejects HTTP, application, invalid JSON and network failures", async () => {
  for (const response of [
    () => new Response('{"ok":true,"executors":[]}', { status: 503 }),
    () => new Response('{"ok":false,"error":"unauthorized"}', { status: 401 }),
    () => new Response('{"ok":false,"error":"真实错误"}', { status: 200 }),
    () => new Response("not-json", { status: 200 }),
    () => Promise.reject(new TypeError("Failed to fetch")),
  ]) {
    const client = createAgentClient("http://fixture.invalid", "pair-fixture", response);
    await assert.rejects(() => client.executors());
  }
});

// Existing CDP helper intentionally leaves command timers alive. This local
// subclass clears them when resolved so node:test exits promptly.
class TestSession extends Session {
  async goto(url) { await this.send("Page.navigate", { url }); }
  send(method, params = {}, timeout = 15000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, timeout);
      this.pending.set(id, {
        res: (value) => { clearTimeout(timer); resolve(value); },
        rej: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

let session, server, base;
const selector = (id) => `[data-testid="workbench-agent-${id}"]`;
const nodeExpr = (id) => `document.querySelector(${JSON.stringify(selector(id))})`;
async function wait(expression, message) {
  assert.equal(await session.waitFor(expression, { timeout: 8000, interval: 30 }), true, message || expression);
}
async function click(id) { assert.equal(await session.click(nodeExpr(id)), true, `click ${id}`); }
async function type(id, value) {
  assert.equal(await session.eval(`
    const element = ${nodeExpr(id)};
    if (!element) return false;
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `), true, `type ${id}`);
}
async function select(id, value, scope = "document") {
  assert.equal(await session.eval(`
    const element = ${scope}.querySelector(${JSON.stringify(selector(id))});
    if (!element) return false;
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `), true, `select ${id}`);
}
async function configure(patch) {
  await session.eval(`Object.assign(window.fixture, ${JSON.stringify(patch)}); return true;`);
}
async function connect() {
  await click("connect");
  await wait(`${nodeExpr("conn-ok")} !== null`, "paired connection is displayed");
  await wait(`window.requests.some(r => r.path === '/v1/runs' && r.method === 'GET')`, "initial runs are queried");
}
async function poll() {
  await wait(`${nodeExpr("refresh")} && !${nodeExpr("refresh")}.disabled`);
  const before = await session.eval("return window.requests.filter(request => request.path === '/v1/runs' && request.method === 'GET').length;");
  await click("refresh");
  await wait(`window.requests.filter(request => request.path === '/v1/runs' && request.method === 'GET').length > ${before}`);
  await wait(`!${nodeExpr("refresh")}.disabled`);
}

const HARNESS = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { AgentScreen } from './src/screens/AgentScreen.jsx';
  import * as WBStore from './src/store/workbench-store.js';
  import { readRunsMirror } from './src/lib/agent-runs-mirror.js';
  const nativeFetch = window.fetch;
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    if (!parsed.hostname.endsWith('.invalid')) return nativeFetch(url, options);
    const method = options.method || 'GET';
    const key = method + ' ' + parsed.pathname;
    window.requests.push({ path: parsed.pathname, method, url: String(url), headers: Object.fromEntries(new Headers(options.headers)), body: options.body ? JSON.parse(options.body) : null });
    const failure = window.fixture.failures[key];
    if (failure === 'network') throw new TypeError('Failed to fetch');
    if (failure) return response(failure.body, failure.status);
    if (parsed.pathname === '/health') return response({ ok: true, name: 'Fixture Gateway', version: '0.2.0' });
    if (parsed.pathname === '/v1/executors') return response({ ok: true, executors: window.fixture.executors });
    if (parsed.pathname === '/v1/runs' && method === 'GET') return response({ ok: true, runs: window.fixture.runs });
    if (parsed.pathname === '/v1/runs' && method === 'POST') {
      const runId = 'run_submitted_' + window.requests.filter(request => request.path === '/v1/runs' && request.method === 'POST').length;
      const run = { runId, executor: JSON.parse(options.body).executor, status: 'queued', createdAt: '2026-10-13T07:00:00.000Z', timeline: [{ type: 'queued', message: '任务已排队' }] };
      window.fixture.details[runId] = run;
      window.fixture.runs.unshift(run);
      return response({ ok: true, runId, status: 'queued' }, 202);
    }
    const match = parsed.pathname.match(/^\\/v1\\/runs\\/([^/]+)(\\/cancel)?$/);
    if (match && match[2]) {
      const run = window.fixture.details[match[1]];
      const terminal = ['completed', 'failed', 'timed_out', 'cancelled'].includes(run.status);
      if (!terminal) run.timeline = [...(run.timeline || []), { type: 'cancel_requested', message: '收到取消请求' }];
      return response(window.fixture.cancelResponse || { ok: true, runId: run.runId, status: run.status, cancelRequested: !terminal }, 202);
    }
    if (match) return response({ ok: true, run: window.fixture.details[match[1]] });
    return response({ ok: false, error: 'fixture route missing' }, 404);
  };
  let root;
  window.mountAgent = () => {
    root?.unmount();
    localStorage.clear();
    localStorage.setItem('gorgon_agent_gateway_url', 'http://gateway.invalid');
    localStorage.setItem('gorgon_agent_gateway_token', 'pair-fixture');
    window.fixture = { executors: ${JSON.stringify([AVAILABLE, DOCUMENT, CODEX, UNAVAILABLE, UNKNOWN, ADVANCED])}, runs: [], details: {}, failures: {}, cancelResponse: null };
    // Give the unavailable variant a distinct ID in the test capabilities.
    window.fixture.executors[3].id = 'unavailable.agent';
    window.requests = [];
    window.messages = [];
    window.links = [];
    window.localTask = WBStore.addTask('已有本地任务')[0];
    window.readRunsMirror = readRunsMirror;
    window.readTask = () => WBStore.getTasks().find(task => task.id === window.localTask.id);
    root = createRoot(document.getElementById('root'));
    root.render(React.createElement(AgentScreen, {
      flash: message => window.messages.push(message),
      linkableTasks: [window.localTask],
      linkTask: (runId, taskId, run) => {
        window.links.push({ runId, taskId, run });
        return WBStore.linkTaskToAgentRun(taskId, runId, { executor: run?.executor, summary: run?.summary });
      },
    }));
  };
  window.mountAgent();
`;

before(async () => {
  const tokens = ['fonts', 'colors', 'typography', 'spacing', 'effects', 'base', 'mobile']
    .map(name => fs.readFileSync(path.join(APP, '..', 'tokens', `${name}.css`), 'utf8').replace(/@import[^;]+;/g, ''))
    .join('\n');
  const fixtureCss = tokens + `
    html[data-test-theme="dark"] {
      --bg-base:#10141d;--bg-sunken:#1b2230;--surface-card:#161b26;
      --text-strong:#f3f5fa;--text-body:#e1e6ef;--text-muted:#b8c2d2;
      --text-faint:#a6b2c6;--border-subtle:#394357;--border-default:#46536b;
      --brand:#a49bff;--brand-soft:#2b254d;--danger:#ffafb6;--danger-soft:#3a1e2a;
    }
  `;
  const bundle = await build({
    stdin: { contents: HARNESS, resolveDir: APP, sourcefile: 'v3d-android-agent-test.jsx', loader: 'jsx' },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    nodePaths: [path.join(APP, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{}' },
    logLevel: 'silent',
  });
  server = http.createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(bundle.outputFiles[0].contents);
    } else if (request.url === '/fixture.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(fixtureCss);
    } else if (request.url === '/favicon.ico') {
      response.writeHead(204); response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
    }
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  base = `http://127.0.0.1:${server.address().port}`;
  const profile = path.join(APP, 'tests', '.e2e-logs', `v3d-android-agent-${process.pid}-${Date.now()}`);
  fs.mkdirSync(profile, { recursive: true });
  session = new TestSession({ port: await unusedPort(), profile });
  await session.launch({ width: 390, height: 844 });
  await session.connect();
  await session.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await session.goto(base);
  await wait(`${nodeExpr("connect")} !== null`, "real React page renders");
}, { timeout: 40000 });

after(async () => {
  if (session) {
    try { await session.send('Browser.close', {}, 3000); } catch { /* CDP closes along with the browser. */ }
    await session.close();
  }
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(async () => {
  await session.eval('window.mountAgent(); return true;');
  await wait(`${nodeExpr("connect")} !== null`);
});

test("Android UI: no-argument task submits {} with one click and queries actual records", async () => {
  await connect();
  assert.equal(await session.eval(`return ${nodeExpr("input")} === null;`), true);
  assert.match(await session.eval(`return ${nodeExpr("submit-btn")}.textContent;`), /一键执行/);
  await click("submit-btn");
  await wait(`window.requests.some(r => r.path === '/v1/runs' && r.method === 'POST')`);
  const request = await session.eval(`return window.requests.find(r => r.path === '/v1/runs' && r.method === 'POST');`);
  assert.deepEqual(request.body, { executor: "repo.status", input: {} });
  assert.equal(request.headers['x-gorgon-token'], "pair-fixture");
  await poll();
  await wait(`${nodeExpr("run")} !== null`, "submitted execution appears in queried records");
  assert.equal(await session.eval('return document.documentElement.scrollWidth <= 390;'), true, "390px screen does not overflow horizontally");
});

test("Android UI: availability blocks unavailable and unknown agents and labels detected Codex honestly", async () => {
  await connect();
  await select("executor", "codex.readonly-diagnosis");
  await wait(`${nodeExpr("availability")}.textContent.includes('未验证') || ${nodeExpr("availability")}.textContent.includes('尚未验证')`);
  assert.equal(await session.eval(`return ${nodeExpr("submit-btn")}.disabled;`), false);
  for (const id of ["unavailable.agent", "future.agent"]) {
    await select("executor", id);
    await wait(`${nodeExpr("submit-btn")}.disabled`);
    await click("submit-btn");
  }
  assert.equal(await session.eval(`return window.requests.filter(r => r.path === '/v1/runs' && r.method === 'POST').length;`), 0);
});

test("Android UI: document path submits without JSON and advanced inputs reject non-object JSON", async () => {
  await connect();
  await select("executor", "repo.readDoc");
  await wait(`${nodeExpr("document-path")} !== null`);
  assert.equal(await session.eval(`return ${nodeExpr("input")} === null;`), true);
  await type("document-path", "readme.md");
  await click("submit-btn");
  await wait(`window.requests.some(r => r.method === 'POST' && r.body?.executor === 'repo.readDoc')`);
  assert.deepEqual(await session.eval(`return window.requests.find(r => r.method === 'POST' && r.body?.executor === 'repo.readDoc').body.input;`), { path: "readme.md" });
  await select("executor", "future.task");
  await wait(`${nodeExpr("input")} !== null`);
  await type("input", "[]");
  await click("submit-btn");
  await wait(`${nodeExpr("input-error")} !== null`);
  assert.equal(await session.eval(`return window.requests.filter(r => r.method === 'POST' && r.body?.executor === 'future.task').length;`), 0);
  await type("input", '{"goal":"检查项目"}');
  await click("submit-btn");
  await wait(`window.requests.some(r => r.method === 'POST' && r.body?.executor === 'future.task')`);
  assert.deepEqual(await session.eval(`return window.requests.find(r => r.method === 'POST' && r.body?.executor === 'future.task').body.input;`), { goal: "检查项目" });
});

test("Android UI: cancel stays requested until Gateway reports cancelled", async () => {
  const run = { runId: "run_cancel", executor: "repo.status", status: "running", createdAt: "2026-10-13T07:00:00.000Z", timeline: [{ type: "running" }] };
  await configure({ runs: [{ ...run, timeline: undefined }], details: { [run.runId]: run } });
  await connect();
  await wait(`${nodeExpr("run-cancel")} !== null`);
  await click("run-cancel");
  await wait(`${nodeExpr("run-status")}.textContent.includes('已请求取消')`);
  assert.equal(await session.eval(`return ${nodeExpr("run-status")}.textContent.includes('已取消');`), false);
  const cancelled = { ...run, status: "cancelled", timeline: [{ type: "cancel_requested" }, { type: "cancelled" }] };
  await configure({ runs: [cancelled], details: { [run.runId]: cancelled } });
  await poll();
  await wait(`${nodeExpr("run-status")}.textContent.includes('已取消')`);
  assert.equal(await session.eval(`return ${nodeExpr("run-cancel")} === null;`), true);
});

test("Android UI: real automatic polling refreshes Gateway records", async () => {
  await connect();
  const before = await session.eval("return window.requests.filter(request => request.path === '/v1/runs' && request.method === 'GET').length;");
  await wait(`window.requests.filter(request => request.path === '/v1/runs' && request.method === 'GET').length > ${before}`, "recursive timer performs automatic polling");
});

test("Android UI: a prior-session cancel request survives summary refresh and clears at final state", async () => {
  const run = { runId: "run_prior_cancel", executor: "repo.status", status: "running", createdAt: "2026-10-13T07:00:00.000Z", timeline: [{ type: "running" }, { type: "cancel_requested" }] };
  const summary = { runId: run.runId, executor: run.executor, status: run.status, createdAt: run.createdAt };
  await configure({ runs: [summary], details: { [run.runId]: run } });
  await connect();
  await wait(`${nodeExpr("run-detail")} !== null`);
  await click("run-detail");
  await wait(`${nodeExpr("detail")} !== null`);
  assert.equal(await session.click("document.querySelector('[aria-label=\"关闭详情\"]')"), true);
  await wait(`${nodeExpr("detail")} === null`);
  await poll();
  await wait(`${nodeExpr("run-status")}.textContent.includes('已请求取消')`);
  const cancelled = { ...run, status: "cancelled", timeline: [...run.timeline, { type: "cancelled" }] };
  await configure({ runs: [{ ...summary, status: "cancelled" }], details: { [run.runId]: cancelled } });
  await poll();
  await wait(`${nodeExpr("run-status")}.textContent.includes('已取消')`);
  assert.equal(await session.eval(`return ${nodeExpr("run-status")}.textContent.includes('已请求取消');`), false);
});

test("Android UI: cancellation racing completion keeps the real completed state", async () => {
  const run = { runId: "run_race", executor: "repo.status", status: "running", createdAt: "2026-10-13T07:00:00.000Z", timeline: [] };
  await configure({ runs: [run], details: { [run.runId]: run } });
  await connect();
  await wait(`${nodeExpr("run-cancel")} !== null`);
  const completed = { ...run, status: "completed", result: { output: "完成结果" } };
  await configure({ runs: [completed], details: { [run.runId]: completed }, cancelResponse: { ok: true, runId: run.runId, status: "completed", cancelRequested: false } });
  await click("run-cancel");
  await wait(`${nodeExpr("run-status")}.textContent.includes('已完成')`);
  assert.equal(await session.eval(`return ${nodeExpr("run-status")}.textContent.includes('已请求取消');`), false);
});

test("Android UI: full result links to a real local task and mirror output survives summary polling", async () => {
  const output = "完整执行内容\n" + "结果段落。".repeat(1300) + "\n结果结尾";
  const run = { runId: "run_full", executor: "repo.status", status: "completed", createdAt: "2026-10-13T07:00:00.000Z", summary: "执行完成", result: { output }, timeline: [] };
  const summary = { runId: run.runId, executor: run.executor, status: run.status, createdAt: run.createdAt, summary: run.summary };
  await configure({ runs: [summary], details: { [run.runId]: run } });
  await connect();
  await wait(`${nodeExpr("run-detail")} !== null`);
  await click("run-detail");
  await wait(`${nodeExpr("detail-result")} !== null`);
  assert.equal(await session.eval(`return ${nodeExpr("detail-result")}.textContent;`), output, "full output is not truncated");
  const taskId = await session.eval('return window.localTask.id;');
  await select("run-link", taskId);
  await wait(`window.readTask().agentRunIds.includes('run_full')`);
  assert.equal(await session.eval(`return window.readTask().timeline.filter(event => event.type === 'agent_run_linked').length;`), 1);
  await poll();
  await wait(`window.readRunsMirror().some(run => run.runId === 'run_full' && run.outputText?.startsWith('完整执行内容'))`);
  assert.equal(await session.eval(`return window.readRunsMirror().find(run => run.runId === 'run_full').outputText.length;`), 4000, "existing mirror's bounded offline format remains intact");
  assert.equal(await session.eval(`return window.links[0].run.runId;`), "run_full");
});

test("Android UI: connection, submit, result and polling failures remain visible", async () => {
  await configure({ failures: { "GET /v1/executors": { status: 401, body: { ok: false, error: "unauthorized" } } } });
  await click("connect");
  await wait(`${nodeExpr("conn-error")} !== null`);
  assert.equal(await session.eval(`return ${nodeExpr("submit-btn")} === null;`), true);
  await configure({ failures: {} });
  await connect();
  await configure({ failures: { "POST /v1/runs": { status: 500, body: { ok: false, error: "执行器真实错误" } } } });
  await click("submit-btn");
  await wait(`${nodeExpr("action-error")}?.textContent.includes('执行器真实错误')`);
  assert.equal(await session.eval(`return ${nodeExpr("action-error")}.getAttribute('role');`), 'alert');
  const run = { runId: "run_error", executor: "repo.status", status: "failed", createdAt: "2026-10-13T07:00:00.000Z" };
  await configure({ runs: [run], failures: { "GET /v1/runs/run_error": "network" } });
  await poll();
  await wait(`${nodeExpr("run-detail")} !== null`);
  await click("run-detail");
  await wait(`${nodeExpr("action-error")}?.textContent.includes('无法联系电脑')`);
  await configure({ failures: { "GET /v1/runs": "network" } });
  await poll();
  await wait(`document.body.textContent.includes('无法联系电脑')`);
  assert.equal(await session.eval(`return ${nodeExpr("run")} !== null;`), true, "last real records remain visible after network failure");
});

test("Android UI: changing pairing settings invalidates old capabilities before any submission", async () => {
  await connect();
  await type("token", "changed-fixture");
  await wait(`${nodeExpr("conn-ok")} === null`);
  assert.equal(await session.eval(`return ${nodeExpr("submit-btn")} === null || ${nodeExpr("submit-btn")}.disabled;`), true);
  assert.equal(await session.eval(`return window.requests.filter(r => r.method === 'POST').length;`), 0);
});

test("Android UI: phone and landscape layouts fit long results, enlarged text, light and dark tokens", async () => {
  const run = {
    runId: 'run_layout', executor: 'repo.status', status: 'completed', createdAt: '2026-10-13T07:00:00.000Z',
    result: { summary: '项目状态检查已完成', output: 'branch/long-unbroken-reference-'.repeat(150) + '\n完整结果末尾' },
    timeline: [{ type: 'completed', message: '项目状态检查已完成' }],
  };
  await configure({ runs: [{ runId: run.runId, executor: run.executor, status: run.status }], details: { [run.runId]: run } });
  await connect();
  await wait(`${nodeExpr('run-detail')} !== null`);
  await click('run-detail');
  await wait(`${nodeExpr('detail-result')} !== null`);
  for (const width of [375, 812]) {
    await session.send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 375, deviceScaleFactor: 1, mobile: true });
    for (const theme of ['light', 'dark']) {
      await session.eval(`document.documentElement.dataset.testTheme = ${JSON.stringify(theme)}; return true;`);
      assert.equal(await session.eval(`return document.documentElement.scrollWidth <= ${width};`), true, `${theme} ${width}px result layout has no horizontal overflow`);
      const shortTargets = await session.eval(`
        return [...document.querySelectorAll('[data-gg-screen="workbench-agent"] button, [data-gg-screen="workbench-agent"] input, [data-gg-screen="workbench-agent"] select, [data-gg-screen="workbench-agent"] summary')]
          .filter(element => element.getClientRects().length && element.getBoundingClientRect().height < 48)
          .map(element => ({ testId: element.dataset.testid, text: element.textContent, height: element.getBoundingClientRect().height }));
      `);
      assert.deepEqual(shortTargets, [], `${theme} ${width}px interactive controls meet the 48px touch floor`);
      assert.equal(await session.eval(`
        return [...document.querySelectorAll('[data-gg-screen="workbench-agent"] input, [data-gg-screen="workbench-agent"] select')]
          .every(element => [...element.labels].some(label => label.textContent.trim() && label.getClientRects().length));
      `), true, 'visible input and select labels');
    }
  }
  await session.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await session.eval(`
    document.documentElement.dataset.testTheme = 'light';
    const sizes = [...document.querySelectorAll('#root *')].map(element => [element, parseFloat(getComputedStyle(element).fontSize)]);
    for (const [element, size] of sizes) element.style.setProperty('font-size', (size * 1.5) + 'px', 'important');
    return true;
  `);
  assert.equal(await session.eval('return document.documentElement.scrollWidth <= 375;'), true, '150% enlarged text keeps the phone layout within its viewport');
  const screenshot = path.join(APP, 'tests', '.e2e-logs', 'v3d-android-agent-375-light-150pct.png');
  await session.eval('window.scrollTo(0,0); return true;');
  await session.shot(screenshot);
  assert.deepEqual(session.errors, [], 'no React or browser console errors');
});
