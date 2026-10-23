// Gorgon Workbench — Activity Checklist Skill (V3N, P1 closed loop).
//
// THE one real closed loop from §5 scenario 2 of ONE_SHOT_AGENT_REDESIGN.md:
//   搜索真实活动 → 按用户条件筛选（日期/城市/免费） → 给出来源 → 生成可保存清单
//
// HONESTY CONTRACT (§2/§3 — the rules this skill never breaks):
//   * search results come ONLY from deps.search (the SAME real client the
//     NaturalSearchScreen uses — no second searcher, §9);
//   * every checklist item carries its source (title/url/provider) so the
//     result is auditable;
//   * when the backend is unavailable/offline the skill returns a FAILED
//     result (SEARCH_OFFLINE) — it NEVER dresses a local template up as a
//     completed online query. The offline template path stays in the search
//     skill's local-template branch (organize-style goals only), clearly
//     labelled 本地生成;
//   * starting WorkBuddy / creating the task is NOT counted as completing
//     the query — only real `kind:"ok"` search responses produce a
//     checklist (metadata.method="api_search_filter").
//
// Filtering is deterministic: city keywords, a relative date window
// (未来 N 天 from `now`), and price (免费) are extracted from the goal by
// pure regex; activities that cannot be matched on a REQUIRED condition are
// excluded and the exclusion is reported in the summary.

import { createSkillResult, createSkillError, CAP_NETWORK_READ } from "./skill-base.js";

/** Defensive source normalization (same shape as search-skill). */
function normalizeSource(item) {
  if (!item || typeof item !== "object") return null;
  const a = item.activity && typeof item.activity === "object" ? item.activity : item;
  const title = a.title || a.name || (typeof item.title === "string" ? item.title : "") || "未命名结果";
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

// ── pure goal parsing (deterministic, unit-testable) ─────────────────────

/** Extract a day-window: 未来 N 天 / 接下来 N 天 / 本周 (7). Default 7. */
export function parseDayWindow(goal) {
  const g = String(goal || "");
  const m = /(?:未来|接下来|今后|后)\s*(\d{1,2})\s*天/.exec(g);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 365) return n;
  }
  if (/本周|这周|这一周|未来一周/.test(g)) return 7;
  if (/本月|这个月/.test(g)) return 30;
  return 7;
}

/** Extract city keywords: 上海/北京/深圳… + 通用「城市名+市」pattern. */
const CITIES = ["上海", "北京", "深圳", "广州", "杭州", "成都", "南京", "武汉", "西安", "苏州", "天津", "重庆", "长沙", "郑州", "青岛", "合肥", "福州", "厦门", "昆明", "大连"];
export function parseCities(goal) {
  const g = String(goal || "");
  const found = CITIES.filter((c) => g.includes(c));
  // 「X市」pattern for unlisted cities (e.g. 宁波市)
  const m = g.match(/([\u4e00-\u9fa5]{2,4})市/g);
  if (m) {
    for (const raw of m) {
      const name = raw.slice(0, -1);
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
}

/** Is the goal asking for FREE activities? (免费/不花钱/零成本) */
export function parseFreeOnly(goal) {
  return /免费|不花钱|零成本|无费用/.test(String(goal || ""));
}

/** Activity date "YYYY-MM-DD…" → ISO date string or null. */
function actDate(a) {
  const s = a && (a.startDate || a.date);
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** ISO date (local) of a Date. */
function isoDay(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Deterministic filter over REAL search results.
 * @returns {{matched: Array, excluded: {city:number, window:number, free:number}}}
 */
export function filterActivities(results, { cities = [], freeOnly = false, windowDays = 7, now = null } = {}) {
  const list = Array.isArray(results) ? results : [];
  const today = now ? new Date(now) : new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + windowDays);
  const excluded = { city: 0, window: 0, free: 0 };
  const matched = list.filter((raw) => {
    const a = raw && raw.activity && typeof raw.activity === "object" ? raw.activity : raw;
    if (!a || typeof a !== "object") { excluded.window += 1; return false; }
    if (cities.length) {
      const text = [a.district, a.venue, a.address, a.city, a.title].filter(Boolean).join(" ");
      const hit = cities.some((c) => text.includes(c));
      if (!hit) { excluded.city += 1; return false; }
    }
    const d = actDate(a);
    if (d) {
      const t = new Date(`${d}T00:00:00`);
      if (Number.isFinite(t.getTime())) {
        if (t < new Date(today.getFullYear(), today.getMonth(), today.getDate()) || t > lastDay) {
          excluded.window += 1; return false;
        }
      }
    }
    // No parseable date: keep (honest — we do not silently drop undated
    // entries; the checklist marks them 日期待确认).
    if (freeOnly) {
      const free = a.priceType === "free" || (a.price != null && /免费/.test(String(a.price)));
      if (!free) { excluded.free += 1; return false; }
    }
    return true;
  });
  return { matched, excluded };
}

/** One checklist line for an activity (auditable, source-carrying). */
function checklistLine(a) {
  const title = String(a.title || a.name || "未命名活动").trim();
  const when = actDate(a) || "日期待确认";
  const where = [a.district, a.venue, a.address].filter(Boolean).join(" · ") || "地点待确认";
  const price = a.priceType === "free" ? "免费" : (a.price != null ? String(a.price) : "费用待确认");
  return `${title}｜${when}｜${where}｜${price}`;
}

const activityChecklistSkill = {
  id: "activity-checklist",
  name: "活动参加清单",
  description: "检索真实活动，按日期/城市/免费等条件筛选，生成带来源的可保存参加清单。",
  capabilities: CAP_NETWORK_READ,

  canHandle(ctx) {
    const g = (ctx && ctx.goal) || "";
    // A retrieval verb (找/搜索…) + an activity/机会 noun + 清单/参加 intent.
    const hit = /(找|搜索|查询|有哪些|检索|搜)/.test(g) &&
      /(活动|机会|黑客松|比赛|展览|讲座|会议)/.test(g) &&
      /(清单|参加|整理|筛选|报名)/.test(g);
    return { ok: hit, confidence: hit ? 0.9 : 0 };
  },

  /**
   * @param {object} deps { search?, now?, maxResults? }
   *   deps.search MUST be the real client — absent ⇒ SEARCH_NOT_CONFIGURED.
   *   No local-template masquerade here: this skill's deliverable IS the
   *   online query, so without it the honest answer is failure.
   */
  async execute(ctx = {}, deps = {}) {
    const goal = (ctx && ctx.goal) || "";
    if (!goal.trim()) {
      return createSkillError("activity-checklist", "CHECKLIST_EMPTY_GOAL", "未提供清单目标");
    }
    const search = deps.search;
    if (typeof search !== "function") {
      return createSkillError("activity-checklist", "SEARCH_NOT_CONFIGURED",
        "搜索后端未配置，无法完成在线活动检索；请在联网并配置检索服务后重试");
    }

    let resp;
    try {
      resp = await search({ query: goal, maxResults: deps.maxResults || 30 });
    } catch (e) {
      return createSkillError("activity-checklist", "SEARCH_PROVIDER_ERROR",
        `检索服务调用失败（${String((e && e.message) || e)}），未完成在线检索；已成功的部分不受影响，可稍后重试`);
    }
    if (!resp || resp.kind === "unavailable") {
      return createSkillError("activity-checklist", "SEARCH_OFFLINE",
        "检索服务不可用（设备离线或服务未连接），未完成在线检索；恢复网络后可重试");
    }
    if (resp.kind === "error") {
      return createSkillError("activity-checklist", "SEARCH_API_ERROR",
        resp.detail || "检索服务返回错误，未完成在线检索");
    }

    // kind === "ok" — REAL data. Parse the goal's conditions, filter, build.
    const data = resp.data || {};
    const results = Array.isArray(data.results) ? data.results : [];
    const conditions = {
      cities: parseCities(goal),
      freeOnly: parseFreeOnly(goal),
      windowDays: parseDayWindow(goal),
    };
    const { matched, excluded } = filterActivities(results, {
      cities: conditions.cities,
      freeOnly: conditions.freeOnly,
      windowDays: conditions.windowDays,
      now: deps.now ? deps.now() : null,
    });

    const sources = matched.map(normalizeSource).filter(Boolean);
    const isDemo = detectDemo(data);
    if (isDemo) sources.forEach((s) => { s.demo = true; });

    const condText = [
      conditions.cities.length ? `城市：${conditions.cities.join("、")}` : null,
      `未来 ${conditions.windowDays} 天`,
      conditions.freeOnly ? "仅免费" : null,
    ].filter(Boolean).join(" · ");

    const lines = matched.map((a) => {
      const act = a && a.activity && typeof a.activity === "object" ? a.activity : a;
      return checklistLine(act);
    });

    const exclText = [];
    if (excluded.city) exclText.push(`${excluded.city} 条不符合城市条件`);
    if (excluded.window) exclText.push(`${excluded.window} 条不在日期范围内或缺日期`);
    if (excluded.free) exclText.push(`${excluded.free} 条非免费`);

    const summary = isDemo
      ? `（DEMO 数据）按「${condText}」筛选：${results.length} 条结果中 ${matched.length} 条入选${exclText.length ? `（排除 ${exclText.join("、")}）` : ""}`
      : `按「${condText}」筛选：${results.length} 条真实结果中 ${matched.length} 条入选${exclText.length ? `（排除 ${exclText.join("、")}）` : ""}`;

    return createSkillResult("activity-checklist", {
      summary,
      sources,
      result: {
        type: "json",
        content: {
          checklist: {
            title: `活动参加清单（${condText}）`,
            items: lines,
          },
          conditions,
          matchedCount: matched.length,
          rawCount: results.length,
          excluded,
          offline: false,
          note: isDemo
            ? "数据来自演示数据源（providerMode=demo），非实时检索结果；来源与筛选条件如实标注。"
            : "清单条目均来自在线检索结果，来源见下方来源列表；日期/地点/费用以官方页面为准。",
        },
      },
      metadata: {
        method: "api_search_filter", // REAL online query + deterministic filter
        isDemo,
        conditions,
        matchedCount: matched.length,
        rawCount: results.length,
        excluded,
      },
    });
  },
};

export default activityChecklistSkill;
