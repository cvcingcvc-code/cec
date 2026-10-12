// Gorgon Workbench — result-summary unit tests (Issue #3).
//
// Pins down the human summary view model over the REAL skill output shapes:
//   * search_results content (canonical + legacy activity shapes)
//   * workflow_result envelope (search + plan / multi skill)
//   * extract json content (dates/times/urls/...)
// Honest rules: missing fields stay null (rendered 未提供), demo stays demo,
// unknown shapes degrade to key/value lines, nothing throws.
//
// Run:  node --test tests/result-summary.test.mjs   (from app/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeResult, activityItem, RESULT_TYPE_LABEL } from "../src/workbench/result-summary.js";

/* ── search_results ─────────────────────────────────────────────────── */

test("summary: canonical search_results content -> activity cards", () => {
  const result = {
    type: "search_results",
    content: [{
      id: "sr001",
      title: "AI Agent Builder Meetup",
      description: "Agent Builder 线下聚会：3 个项目现场拆解。",
      startDate: "2026-09-19",
      startTime: "14:00",
      endTime: "17:00",
      venue: "徐汇滨江 AI 创新中心",
      address: "上海市徐汇区龙腾大道2600号",
      district: "徐汇",
      priceType: "free",
      organizer: "上海 AI 开发者社区",
      sourceUrl: "https://example.com/a",
      dataOrigin: "demo",
    }],
  };
  const s = summarizeResult(result);
  assert.equal(s.kind, "activities");
  assert.equal(s.count, 1);
  assert.equal(s.items[0].title, "AI Agent Builder Meetup");
  assert.ok(s.items[0].when.includes("9月19日"));
  assert.ok(s.items[0].when.includes("14:00–17:00"));
  assert.ok(s.items[0].where.includes("徐汇"));
  assert.equal(s.items[0].price, "免费");
  assert.equal(s.items[0].demo, true, "demo origin stays honest");
  assert.equal(s.items[0].url, "https://example.com/a");
});

test("summary: legacy activity shape (date/time/location/host) is handled", () => {
  const item = activityItem({
    title: "周末沙龙",
    date: "周六 6.20",
    time: "14:00",
    end: "17:00",
    venue: "某咖啡",
    district: "静安",
    price: "免费",
    host: "老王",
  });
  assert.equal(item.title, "周末沙龙");
  assert.ok(item.when.includes("周六 6.20"));
  assert.ok(item.where.includes("静安"));
  assert.equal(item.price, "免费");
  assert.equal(item.organizer, "老王");
});

test("summary: missing fields stay null, title falls back to 未命名结果", () => {
  const item = activityItem({ title: "" });
  assert.equal(item.title, "未命名结果");
  assert.equal(item.when, null);
  assert.equal(item.where, null);
  assert.equal(item.price, null);
  assert.equal(item.url, null);
  assert.equal(item.demo, false);
});

/* ── workflow_result ────────────────────────────────────────────────── */

test("summary: workflow_result envelope -> per-skill headlines", () => {
  const result = {
    type: "workflow_result",
    content: [
      { skillId: "search", result: { type: "search_results", content: [{ title: "A" }, { title: "B" }] } },
      { skillId: "plan", result: { type: "plan", content: ["查看排名靠前的 2 个候选", "核对时间"] } },
    ],
  };
  const s = summarizeResult(result);
  assert.equal(s.kind, "workflow");
  assert.equal(s.steps.length, 2);
  assert.equal(s.steps[0].skillId, "search");
  assert.equal(s.steps[0].headline, "找到 2 个相关结果");
  assert.equal(s.steps[0].items.length, 2);
  assert.equal(s.steps[1].headline, "生成 2 步行动计划");
  assert.equal(s.steps[1].items[0].title, "查看排名靠前的 2 个候选");
});

/* ── extract json ───────────────────────────────────────────────────── */

test("summary: extract json content -> fact groups (non-empty only)", () => {
  const result = {
    type: "json",
    content: {
      dates: ["10月12日"], times: ["下午3点"], urls: ["https://example.com"],
      amounts: [], emails: [], phones: [], todos: ["提交材料"],
    },
  };
  const s = summarizeResult(result);
  assert.equal(s.kind, "facts");
  assert.equal(s.groups.length, 4);
  assert.deepEqual(s.groups.map((g) => g.label), ["日期", "时间", "链接", "待办"]);
  assert.deepEqual(s.groups[0].values, ["10月12日"]);
});

test("summary: extract with all-empty arrays -> null (fallback to raw JSON)", () => {
  const result = {
    type: "json",
    content: { dates: [], times: [], urls: [], amounts: [], emails: [], phones: [], todos: [] },
  };
  assert.equal(summarizeResult(result), null);
});

/* ── passthrough / fallback ─────────────────────────────────────────── */

test("summary: text and plan results return null (screen renders them directly)", () => {
  assert.equal(summarizeResult({ type: "text", content: "已确认 3 场目标活动" }), null);
  assert.equal(summarizeResult({ type: "plan", content: ["a", "b"] }), null);
});

test("summary: unknown object shape -> key/value fields", () => {
  const s = summarizeResult({ type: "mystery", content: { alpha: "one", beta: 2, gamma: null } });
  assert.equal(s.kind, "fields");
  assert.deepEqual(s.lines, [{ label: "alpha", value: "one" }, { label: "beta", value: "2" }]);
});

test("summary: null/absent result -> null, never throws", () => {
  assert.equal(summarizeResult(null), null);
  assert.equal(summarizeResult(undefined), null);
  assert.equal(summarizeResult({}), null);
});

/* ── labels ─────────────────────────────────────────────────────────── */

test("summary: RESULT_TYPE_LABEL is fully Chinese", () => {
  assert.equal(RESULT_TYPE_LABEL.search_results, "检索结果");
  assert.equal(RESULT_TYPE_LABEL.workflow_result, "多步工作流结果");
  assert.equal(RESULT_TYPE_LABEL.json, "结构化信息");
  for (const v of Object.values(RESULT_TYPE_LABEL)) {
    assert.ok(/[\u4e00-\u9fff]/.test(v), `label must be Chinese: ${v}`);
  }
});
