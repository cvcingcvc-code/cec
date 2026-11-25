// Gorgon Workbench — Search Skill (Phase 3, REAL retrieval reuse).
//
// This skill REUSES the existing Gorgon search capability — it does NOT
// implement a second search client (§9/§33). The actual network call lives
// in app/src/lib/api.js (`searchActivities`, the single API layer used by
// NaturalSearchScreen). The Runner injects that function as `deps.search`,
// so the skill can be unit-tested with a mock and the browser reuses the one
// real client. Only if no `deps.search` is supplied do we lazily import the
// real api module (never in tests, always in standalone use).
//
// Failure is HONEST (§12): unavailable API or provider error is reported as a
// failed SkillResult with a clear code — we never fabricate "live" results,
// and if the backend returns demo data we surface `isDemo` so the UI can show
// the DEMO DATA badge.
//
// V3M (P0 离线降级): when the search backend is unavailable/offline, the skill
// no longer just fails. It FIRST checks whether the goal can be satisfied
// locally (an organize/extract-style goal like "整理比赛报名资料清单" — matched
// here only via noun keywords after the V3M router fix). If so it returns a
// SUCCESSFUL result carrying a clearly-labelled LOCAL TEMPLATE (checklist
// skeleton) — never fabricated activity facts. Only goals that genuinely need
// external information (a verb like 找/查询 in the goal) report
// SEARCH_OFFLINE / SEARCH_NOT_CONFIGURED with the retry hint.

import { createSkillResult, createSkillError, CAP_NETWORK_READ } from "./skill-base.js";

/** Defensive source normalization (§11). Never assumes activity-specific fields. */
function normalizeSource(item) {
  if (!item || typeof item !== "object") return null;
  const a = item.activity && typeof item.activity === "object" ? item.activity : item;
  const title =
    a.title || a.name || (typeof item.title === "string" ? item.title : "") || "未命名结果";
  const url = a.sourceUrl || a.registrationUrl || a.url || a.link || null;
  const provider = a.source || a.provider || a.origin || null;
  return { type: "search", title: String(title).trim(), url: url ? String(url) : null, provider: provider ? String(provider) : null };
}

function detectDemo(data) {
  if (!data || typeof data !== "object") return false;
  if (data.providerMode === "demo") return true;
  if (data.dataOrigin === "demo") return true;
  if (data.__source === "static") return true;
  const results = Array.isArray(data.results) ? data.results : [];
  return results.some((r) => r && r.dataOrigin === "demo");
}

// ── V3M (P0 离线降级): local-template detection ─────────────────────────
//
// A goal qualifies for the offline local-template fallback when it mentions a
// COMPETITION/ACTIVITY topic noun (比赛/黑客松/活动/机会 — the terms the V3M
// router moved to noun-trigger) AND an ORGANIZE-style action (整理/清单/准备/
// 资料列表), and does NOT contain an explicit retrieval VERB (找/搜索/查询…).
// Such a goal is a local organizing job the search service is not needed for.
// The returned template is a fixed SUGGESTION skeleton — the engine never
// invents specific requirements (§12/§46: no fabricated activity facts).
const RE_OFFLINE_LOCAL_GOAL = /整理|清单|准备|资料列表|材料清单|报名清单|资料/;
const RE_OFFLINE_TOPIC_NOUN = /比赛|黑客松|竞赛|活动|机会|会议|面试/;
const RE_SEARCH_VERB = /找|搜索|查一下|查询|哪里|有哪些|附近|最近|检索|搜/;

function offlineTemplateFor(goal) {
  const g = String(goal || "");
  if (!RE_OFFLINE_LOCAL_GOAL.test(g)) return null;
  if (!RE_OFFLINE_TOPIC_NOUN.test(g)) return null;
  if (RE_SEARCH_VERB.test(g)) return null;
  return {
    title: "报名资料清单模板（本地生成）",
    note: "搜索服务当前不可用，未完成实时检索。以下为本地生成的整理模板，未包含任何虚构的报名要求 —— 具体要求请以官方页面为准。",
    items: [
      "报名资格与身份要求（从官方页面核对）",
      "报名截止时间与参赛时间段",
      "组队要求（队伍人数 / 是否允许跨校跨企业）",
      "需提交的材料（简历 / 作品集 / 项目计划书等）",
      "报名入口与提交方式（链接 / 邮箱 / 平台）",
      "评审标准与奖项设置",
    ],
  };
}

async function loadDefaultSearch() {
  try {
    const m = await import("../../lib/api.js");
    return m && typeof m.searchActivities === "function" ? m.searchActivities : null;
  } catch {
    return null;
  }
}

const searchSkill = {
  id: "search",
  name: "智能搜索",
  description: "复用 Gorgon 检索接口，从目标文本中查找活动 / 机会等信息。",
  capabilities: CAP_NETWORK_READ,

  canHandle(ctx) {
    const g = (ctx && ctx.goal) || "";
    const hit = /找|搜索|查询|哪里|有哪些|活动|机会|黑客松|比赛|附近|最近|检索|搜/.test(g);
    return { ok: hit, confidence: hit ? 0.92 : 0 };
  },

  /**
   * @param {object} ctx  { goal, previousResults?, task?, metadata? }
   * @param {object} deps { search?, maxResults?, now? }
   *   deps.search: (query) => Promise<{kind,data}|{kind:'error'}|{kind:'unavailable'}>
   */
  async execute(ctx = {}, deps = {}) {
    const goal = (ctx && ctx.goal) || "";
    if (!goal || !goal.trim()) {
      return createSkillError("search", "SEARCH_EMPTY_GOAL", "未提供搜索目标");
    }

    // Browser always injects a real `deps.search` (the Runnger passes
    // searchActivities). If it is explicitly null/empty the backend is NOT
    // configured — report that honestly (§12). Only when it is truly
    // `undefined` do we lazily resolve the real api client (standalone use).
    let search = deps.search;
    if (search === undefined) search = await loadDefaultSearch();

    // V3M (P0 离线降级): when the backend is not configured / unavailable,
    // a locally-satisfiable goal (organize-style, no retrieval verb) still
    // produces its local template instead of failing the whole task.
    const backendDown = typeof search !== "function";
    if (backendDown) {
      const tpl = offlineTemplateFor(goal);
      if (tpl) {
        return createSkillResult("search", {
          summary: `搜索服务未配置，已生成「${tpl.title}」（本地模板，未完成实时检索）`,
          sources: [],
          result: {
            type: "json",
            content: { checklist: { title: tpl.title, items: tpl.items }, offline: true, note: tpl.note },
          },
          metadata: {
            method: "local_template",
            offline: true,
            note: tpl.note,
          },
        });
      }
      return createSkillError("search", "SEARCH_NOT_CONFIGURED", "搜索后端未配置；如需在线检索，请在联网后重试");
    }

    let resp;
    try {
      resp = await search({ query: goal, maxResults: deps.maxResults || 30 });
    } catch (e) {
      const tpl = offlineTemplateFor(goal);
      if (tpl) {
        return createSkillResult("search", {
          summary: `搜索服务调用失败，已生成「${tpl.title}」（本地模板，未完成实时检索）`,
          sources: [],
          result: {
            type: "json",
            content: { checklist: { title: tpl.title, items: tpl.items }, offline: true, note: tpl.note },
          },
          metadata: {
            method: "local_template",
            offline: true,
            providerError: String((e && e.message) || e),
            note: tpl.note,
          },
        });
      }
      return createSkillError("search", "SEARCH_PROVIDER_ERROR", String((e && e.message) || e));
    }

    if (!resp || resp.kind === "unavailable") {
      const tpl = offlineTemplateFor(goal);
      if (tpl) {
        return createSkillResult("search", {
          summary: `搜索服务不可用，已生成「${tpl.title}」（本地模板，未完成实时检索）`,
          sources: [],
          result: {
            type: "json",
            content: { checklist: { title: tpl.title, items: tpl.items }, offline: true, note: tpl.note },
          },
          metadata: {
            method: "local_template",
            offline: true,
            note: tpl.note,
          },
        });
      }
      return createSkillError("search", "SEARCH_OFFLINE", "检索服务不可用（未连接 / 离线）；需要外部信息的任务未完成在线检索，可稍后重试");
    }
    if (resp.kind === "error") {
      return createSkillError("search", "SEARCH_API_ERROR", resp.detail || `检索失败（HTTP ${resp.status}）`);
    }

    // kind === "ok"
    const data = resp.data || {};
    const results = Array.isArray(data.results) ? data.results : [];
    const sources = results.map(normalizeSource).filter(Boolean);
    const isDemo = detectDemo(data);
    if (isDemo) sources.forEach((s) => { s.demo = true; });
    const count = results.length;

    const summary = isDemo
      ? `（DEMO 数据）找到 ${count} 个相关结果`
      : `找到 ${count} 个相关结果`;

    return createSkillResult("search", {
      summary,
      sources,
      result: { type: "search_results", content: results },
      metadata: {
        method: "api",
        isDemo,
        providerMode: data.providerMode || null,
        summary: data.summary || null,
        rawCount: count,
      },
    });
  },
};

export default searchSkill;
