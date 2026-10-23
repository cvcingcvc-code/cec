// V2.4 (feat/hackathon-discovery-v1) — AI match model.
//
// Pins the honesty contract:
//   * deterministic: same input -> same output (scores, order, reasons)
//   * reasons cite ONLY record fields; null eligibility -> 未知条件
//   * passed deadline -> excluded to unmatched with 已截止 reason
//   * no profile -> no matches, no invention
//   * prepList built from REAL fields only

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProfile, matchEvents, buildPrepList, MATCH_FLOOR } from "../src/workbench/match/match-model.js";
import { normalizeHackathon, HACKATHONS } from "../src/data/hackathons.js";

const NOW = new Date("2026-10-23T12:00:00+08:00");
const LIST = validated();

function validated() {
  return HACKATHONS.map(normalizeHackathon).filter(Boolean);
}

test("extractProfile: agent project hits AI/Agent domain + stacks", () => {
  const p = extractProfile("我在做一个基于大模型的 Agent 应用，React Native + Python FastAPI，涉及 RAG");
  assert.ok(p.domains.some((d) => d.id === "ai-agent"));
  assert.ok(p.domains.some((d) => d.id === "ai-app"));
  assert.ok(p.techStack.some((s) => s.id === "js"));
  assert.ok(p.techStack.some((s) => s.id === "python"));
});

test("extractProfile: empty input -> empty profile (no invention)", () => {
  const p = extractProfile("");
  assert.equal(p.domains.length, 0);
  assert.equal(p.techStack.length, 0);
  assert.equal(p.text, "");
});

test("extractProfile: deterministic", () => {
  const input = "具身智能机器人项目，用 PyTorch 做仿真";
  assert.deepEqual(extractProfile(input), extractProfile(input));
});

test("matchEvents: empty profile -> no matches, no invention", () => {
  const out = matchEvents({ projectInput: "", activities: LIST, now: NOW });
  assert.equal(out.matches.length, 0);
  assert.equal(out.unmatched.length, 0);
});

test("matchEvents: robot project matches the embodied-AI event with reasons", () => {
  const out = matchEvents({ projectInput: "机器人具身智能 VLA 模型仿真项目", activities: LIST, now: NOW });
  assert.ok(out.matches.length > 0);
  const top = out.matches[0];
  assert.equal(top.activity.id, "ht-2026-lingbot-vla");
  assert.ok(top.score >= MATCH_FLOOR);
  assert.ok(top.reasons.length > 0, "reasons must explain the match");
  // Eligibility IS present on this record — so no unknown caveat for it.
  assert.ok(top.mismatches.every((m) => m.indexOf("参赛条件未知") < 0));
});

test("matchEvents: reasons cite only real fields (no fabricated facts)", () => {
  const out = matchEvents({ projectInput: "AI Agent 应用", activities: LIST, now: NOW });
  for (const m of out.matches) {
    for (const r of m.reasons) {
      assert.ok(
        /命中赛事标签|出现在赛事介绍|技术栈相关|关键词命中/.test(r),
        "reason must be one of the closed templates: " + r);
    }
  }
});

test("matchEvents: passed deadline -> unmatched with 已截止", () => {
  const past = normalizeHackathon({
    id: "past", title: "已截止赛事", tags: ["AI", "Agent"],
    description: "AI Agent 黑客松", registrationDeadline: "2020-01-01T00:00:00+08:00",
  });
  const out = matchEvents({ projectInput: "AI Agent 项目", activities: [past], now: NOW });
  assert.equal(out.matches.length, 0);
  assert.equal(out.unmatched.length, 1);
  assert.match(out.unmatched[0].reason, /已截止/);
});

test("matchEvents: null eligibility -> 未知条件 mismatch (honest)", () => {
  const unknown = normalizeHackathon({
    id: "unknown-elig", title: "条件未知赛事", tags: ["AI", "Agent"],
    description: "AI Agent 开发者聚会",
  });
  const out = matchEvents({ projectInput: "AI Agent 项目", activities: [unknown], now: NOW });
  const m = out.matches.find((x) => x.activity.id === "unknown-elig");
  assert.ok(m, "weak-text event still scores via tags");
  assert.ok(m.mismatches.some((x) => x.indexOf("参赛条件未知") >= 0));
  assert.ok(m.prepList.some((p) => p.indexOf("获取报名方式") >= 0 || p.indexOf("来源页") >= 0));
});

test("matchEvents: deterministic ordering (score desc, id tiebreak)", () => {
  const a = matchEvents({ projectInput: "AI Agent 项目", activities: LIST, now: NOW });
  const b = matchEvents({ projectInput: "AI Agent 项目", activities: LIST, now: NOW });
  assert.deepEqual(a.matches.map((m) => m.activity.id), b.matches.map((m) => m.activity.id));
  for (let i = 1; i < a.matches.length; i++) {
    const prev = a.matches[i - 1], cur = a.matches[i];
    assert.ok(prev.score >= cur.score, "score descending");
    if (prev.score === cur.score) {
      assert.ok(String(prev.activity.id) <= String(cur.activity.id), "id tiebreak");
    }
  }
});

test("matchEvents: every match carries a prepList built from real fields", () => {
  const out = matchEvents({ projectInput: "具身智能机器人 VLA 项目", activities: LIST, now: NOW });
  for (const m of out.matches) {
    assert.ok(Array.isArray(m.prepList) && m.prepList.length > 0);
    const a = m.activity;
    if (a.registrationUrl) {
      assert.ok(m.prepList.some((p) => p.indexOf("官方报名页") >= 0));
    }
    if (a.registrationDeadline) {
      assert.ok(m.prepList.some((p) => p.indexOf("截止前完成报名") >= 0));
    }
  }
});

test("buildPrepList: hybrid event includes 行程 prep", () => {
  const hybrid = normalizeHackathon({ id: "h", title: "混合赛", mode: "hybrid", registrationUrl: "https://x.example" });
  const prep = buildPrepList(hybrid);
  assert.ok(prep.some((p) => p.indexOf("线下行程") >= 0));
});

test("matchEvents: offline event flags 需到场 mismatch", () => {
  const offline = normalizeHackathon({
    id: "off", title: "纯线下 AI 赛", tags: ["AI"], mode: "offline",
    description: "AI 开发者线下聚会，现场开发",
  });
  const out = matchEvents({ projectInput: "AI 项目", activities: [offline], now: NOW });
  const m = out.matches.find((x) => x.activity.id === "off");
  assert.ok(m);
  assert.ok(m.mismatches.some((x) => x.indexOf("纯线下") >= 0));
});
