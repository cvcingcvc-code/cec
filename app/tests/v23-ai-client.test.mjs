// V2.3 Phase 7 — AI Client 安全接入（store facade 层）。
//
// 任务书硬约束：
//   * 不将 key 编译进 APK / 浏览器 bundle —— hostEnv(GORGON_AI_*) 只在
//     Node 宿主（桌面壳 / CLI）存在，Vite 浏览器构建里是死代码。
//   * AI 失败时本地可用 —— provider 挂掉 / 限流 / 断网都必须落到
//     deterministic 路径，任务仍完成，内容仍保留。
//   * opt-in 语义 —— 默认（无 aiClient）每个 step 保持纯本地确定性，
//     竞赛 demo AI_CALLS = 0 不变。
//
// 唯一缺口（Phase 7 修复前）：workbench-store.runTask 不透传 aiClient，
// UI / 宿主永远走纯确定性路径。

import assert from "node:assert/strict";
import { test } from "node:test";

import * as WB from "../src/store/workbench-store.js";
import { createAIClient, resolveProviderConfig } from "../src/workbench/ai/index.js";

/** Long material that pushes the summarize past the LONG_INPUT_CHARS gate. */
const LONG_MATERIAL = "上海人工智能生态发展观察与产业政策解读。".repeat(80);
const longGoal = "总结以下调研材料。" + LONG_MATERIAL;

/** A client whose provider always fails the way a real outage does. */
function brokenClient(code) {
  let calls = 0;
  return {
    calls: () => calls,
    budget: { maxCalls: 3, usedCalls: 0, maxInputTokens: 8000 },
    generate: async () => {
      calls++;
      return { ok: false, error: { code, message: "provider unavailable" } };
    },
  };
}

/** A client labelled as a real (hunyuan) provider, returning fixed content. */
function fakeAiClient(content = "AI 生成的总结") {
  let calls = 0;
  return {
    calls: () => calls,
    budget: { maxCalls: 3, usedCalls: 0, maxInputTokens: 8000 },
    generate: async () => {
      calls++;
      return {
        ok: true, content, provider: "hunyuan", model: "hunyuan-turbos-latest",
        usage: { inputTokens: 100, outputTokens: 20 }, cached: false,
      };
    },
  };
}

// ── G-1: 默认路径保持纯确定性（opt-in 语义不变） ─────────────────────────

test("G-1: store.runTask without aiClient keeps every step deterministic", async () => {
  WB.deleteTask("ai-g1");
  const list = WB.addTask(longGoal);
  const id = list[0].id;
  const out = await WB.runTask(id);
  assert.equal(out.ok, true, "task must complete");
  const task = WB.getTask(id);
  assert.equal(task.status, "completed");
  assert.ok(task.steps.length > 0, "steps must be created");
  for (const s of task.steps) {
    // No client → the bridge still records WHY it stayed local, never AI.
    // `simulated` is always a Boolean on bridged skills (false = no simulated
    // call); skills that bypass the bridge (search) simply omit the field.
    if (s.metadata && "aiAssisted" in s.metadata) {
      assert.equal(s.metadata.aiAssisted, false, "no step may claim AI without a client");
      assert.equal(s.metadata.aiProvider, null);
      assert.equal(s.metadata.simulated, false, "no simulated call without a client");
    }
  }
  WB.deleteTask(id);
});

// ── G-2: 透传 aiClient → 长 summarize 升级为 AI 辅助 ─────────────────────

test("G-2: store.runTask forwards aiClient; long summarize becomes AI-assisted", async () => {
  WB.deleteTask("ai-g2");
  const list = WB.addTask(longGoal);
  const id = list[0].id;
  const client = fakeAiClient();
  const out = await WB.runTask(id, { aiClient: client });
  assert.equal(out.ok, true);
  const task = WB.getTask(id);
  assert.equal(task.status, "completed");
  const aiStep = task.steps.find((s) => s.metadata && s.metadata.aiAssisted === true);
  assert.ok(aiStep, "the long summarize step must be AI-assisted via the forwarded client");
  assert.equal(aiStep.metadata.aiProvider, "hunyuan");
  assert.equal(aiStep.metadata.aiModel, "hunyuan-turbos-latest");
  assert.equal(aiStep.result && aiStep.result.content, "AI 生成的总结");
  assert.ok(client.calls() >= 1, "the injected client must actually be called");
  WB.deleteTask(id);
});

// ── G-3: AI 失败 → fallback，任务仍完成，本地内容保留 ────────────────────

test("G-3: a broken provider keeps the task completed with local content (AI 失败本地可用)", async () => {
  WB.deleteTask("ai-g3");
  const list = WB.addTask(longGoal);
  const id = list[0].id;
  const client = brokenClient("AI_RATE_LIMITED");
  const out = await WB.runTask(id, { aiClient: client });
  assert.equal(out.ok, true, "provider failure must not fail the task");
  assert.equal(out.failed, false);
  const task = WB.getTask(id);
  assert.equal(task.status, "completed", "AI failing must leave the task completable");
  const fb = task.steps.find(
    (s) => s.metadata && s.metadata.aiFallbackReason === "AI_RATE_LIMITED",
  );
  assert.ok(fb, "the fallback reason must be surfaced on the step");
  assert.equal(fb.metadata.aiAssisted, false, "must NOT claim AI assistance");
  assert.ok(fb.result && fb.result.content && fb.result.content.length > 0,
    "deterministic content must be preserved");
  assert.equal(fb.metadata.aiProvider, null);
  assert.equal(client.calls(), 1, "exactly one provider attempt");
  WB.deleteTask(id);
});

test("G-3b: a throwing provider is contained — the task still completes", async () => {
  WB.deleteTask("ai-g3b");
  const list = WB.addTask(longGoal);
  const id = list[0].id;
  const client = {
    budget: { maxCalls: 3, usedCalls: 0, maxInputTokens: 8000 },
    generate: async () => { throw new Error("socket hang up"); },
  };
  const out = await WB.runTask(id, { aiClient: client });
  assert.equal(out.ok, true);
  const task = WB.getTask(id);
  assert.equal(task.status, "completed");
  const fb = task.steps.find(
    (s) => s.metadata && s.metadata.aiFallbackReason === "AI_NETWORK_ERROR",
  );
  assert.ok(fb, "a throwing provider maps to AI_NETWORK_ERROR fallback");
  WB.deleteTask(id);
});

// ── G-4: hostEnv 注入路径（方案 A） ──────────────────────────────────────

test("G-4: host env injection configures a real provider (key stays out of the bundle)", () => {
  const prev = {
    provider: process.env.GORGON_AI_PROVIDER,
    key: process.env.GORGON_AI_API_KEY,
    model: process.env.GORGON_AI_MODEL,
  };
  process.env.GORGON_AI_PROVIDER = "hunyuan";
  process.env.GORGON_AI_API_KEY = "test-key-123";
  process.env.GORGON_AI_MODEL = "hunyuan-turbos-latest";
  try {
    const cfg = resolveProviderConfig();
    assert.equal(cfg.mode, "real", "host env must promote the config to real mode");
    assert.equal(cfg.provider, "hunyuan");
    assert.equal(cfg.apiKey, "test-key-123");
    assert.equal(cfg.model, "hunyuan-turbos-latest");
    const client = createAIClient({});
    assert.equal(client.mode, "real");
  } finally {
    // restore
    if (prev.provider === undefined) delete process.env.GORGON_AI_PROVIDER;
    else process.env.GORGON_AI_PROVIDER = prev.provider;
    if (prev.key === undefined) delete process.env.GORGON_AI_API_KEY;
    else process.env.GORGON_AI_API_KEY = prev.key;
    if (prev.model === undefined) delete process.env.GORGON_AI_MODEL;
    else process.env.GORGON_AI_MODEL = prev.model;
  }
});

test("G-4b: without env or explicit input the config stays mock with no key", () => {
  const cfg = resolveProviderConfig();
  assert.equal(cfg.mode, "mock", "no credentials → mock, never a guessed provider");
  assert.equal(cfg.apiKey, "", "no key may be invented");
});

test("G-4c: explicit input always wins over host env", () => {
  const prev = process.env.GORGON_AI_PROVIDER;
  process.env.GORGON_AI_PROVIDER = "hunyuan";
  try {
    const cfg = resolveProviderConfig({ provider: "mock" });
    assert.equal(cfg.provider, "mock");
  } finally {
    if (prev === undefined) delete process.env.GORGON_AI_PROVIDER;
    else process.env.GORGON_AI_PROVIDER = prev;
  }
});

// ── G-5: skillIds 透传保持不变（回归守卫） ────────────────────────────────

test("G-5: store.runTask still forwards skillIds (manual selection path)", async () => {
  WB.deleteTask("ai-g5");
  const list = WB.addTask("找上海 AI 活动");
  const id = list[0].id;
  const out = await WB.runTask(id, { skillIds: ["search"] });
  assert.equal(out.ok, true);
  assert.ok(out.routed, "manual route must be recorded");
  assert.equal(out.routed.intent, "manual");
  WB.deleteTask(id);
});
