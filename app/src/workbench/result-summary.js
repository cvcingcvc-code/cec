// Gorgon Workbench — Task Result Summary (Issue #3, readable results).
//
// The task runner persists skill output as structured data:
//   * search-skill  -> { type:"search_results", content:[activity...] }
//   * multi-skill   -> { type:"workflow_result", content:[{skillId,result}] }
//   * extract-skill -> { type:"json", content:{dates,times,urls,...} }
//   * plan/write/summarize/text -> { type:"plan"|"text", content:string|array }
//
// TaskDetailScreen used to JSON.stringify anything non-string straight onto
// the page — a wall of raw JSON for an ordinary reader. This module turns
// that output into a human summary view model WITHOUT changing the stored
// data: it is a pure rendering aid, read-only over the result object.
//
// Honesty rules (§12/§46): nothing is invented. A missing field stays null
// and the UI renders "未提供"; demo data keeps its DEMO mark; the raw JSON
// stays available behind an expandable "技术详情" disclosure.

/** Strip markup for a one-line description (mirrors activity-view.plainText). */
function shortText(value, limit) {
  if (value == null) return null;
  let text = String(value)
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, "")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/[#*`>~_]/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (limit && text.length > limit) text = text.slice(0, limit).trimEnd() + "…";
  return text || null;
}

/** Canonical pipeline date + time -> "9月19日 14:00–17:00". null when absent. */
function whenOf(a) {
  if (!a || typeof a !== "object") return null;
  const parts = [];
  if (a.startDate) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(a.startDate));
    if (m) parts.push(`${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`);
    else parts.push(String(a.startDate));
  } else if (a.date) {
    parts.push(String(a.date));
  }
  if (a.startTime) {
    parts.push(a.endTime ? `${a.startTime}–${a.endTime}` : String(a.startTime));
  } else if (a.time) {
    parts.push(a.end ? `${a.time}–${a.end}` : String(a.time));
  }
  return parts.length ? parts.join(" ") : null;
}

/** district / venue / address -> one readable line. null when all absent. */
function whereOf(a) {
  if (!a || typeof a !== "object") return null;
  const parts = [a.district, a.venue, a.address].filter(Boolean).map(String);
  return parts.length ? parts.join(" · ") : null;
}

/** priceType/price -> 免费 / ¥N / the source string. null when absent. */
function priceOf(a) {
  if (!a || typeof a !== "object") return null;
  if (a.priceType === "free") return "免费";
  if (a.priceType === "paid" && a.price != null) return "¥" + a.price;
  if (typeof a.price === "string" && a.price) return a.price;
  return null;
}

/** One activity record -> the card the reader sees. */
export function activityItem(rec) {
  if (!rec || typeof rec !== "object") return null;
  const a = rec.activity && typeof rec.activity === "object" ? rec.activity : rec;
  const title = shortText(a.title || a.name, 80) || "未命名结果";
  const description = shortText(a.description || a.desc, 90);
  const url = a.sourceUrl || a.registrationUrl || a.url || a.link || null;
  const demo = rec.dataOrigin === "demo" || a.dataOrigin === "demo" || !!rec.demo || !!a.demo;
  return {
    title,
    description,
    when: whenOf(a),
    where: whereOf(a),
    price: priceOf(a),
    organizer: shortText(a.organizer || a.host, 40),
    url: url ? String(url) : null,
    demo,
  };
}

/** search_results content -> { kind:"activities", items } */
function searchSummary(content) {
  const list = Array.isArray(content) ? content : [];
  const items = list.map(activityItem).filter(Boolean);
  return { kind: "activities", count: items.length, items };
}

/** extract json content -> { kind:"facts", groups } (only non-empty groups). */
const FACT_LABEL = {
  dates: "日期", times: "时间", urls: "链接", amounts: "金额",
  emails: "邮箱", phones: "电话", todos: "待办",
};
function extractSummary(content) {
  if (!content || typeof content !== "object") return null;
  const groups = [];
  for (const key of Object.keys(FACT_LABEL)) {
    const list = Array.isArray(content[key]) ? content[key] : [];
    if (list.length) groups.push({ label: FACT_LABEL[key], values: list.map(String) });
  }
  if (!groups.length) return null;
  return { kind: "facts", groups };
}

/** workflow_result content -> { kind:"workflow", steps } (per-skill summary). */
function workflowSummary(content) {
  const list = Array.isArray(content) ? content : [];
  const steps = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const sid = entry.skillId || "";
    const inner = entry.result || {};
    let headline = null;
    let items = [];
    if (inner.type === "search_results") {
      const s = searchSummary(inner.content);
      headline = `找到 ${s.count} 个相关结果`;
      items = s.items;
    } else if (inner.type === "plan" && Array.isArray(inner.content)) {
      headline = `生成 ${inner.content.length} 步行动计划`;
      items = inner.content.map((x) => ({
        title: shortText(x && typeof x === "object" ? (x.title || x.text) : x, 80) || "（空步骤）",
      }));
    } else if (inner.type === "text" && typeof inner.content === "string" && inner.content.trim()) {
      headline = "已生成文本内容";
      items = [{ title: shortText(inner.content, 120) }];
    } else if (inner.type === "json") {
      const s = extractSummary(inner.content);
      if (s) {
        headline = s.groups.map((g) => `${g.label} ${g.values.length} 项`).join("、");
        items = s.groups.flatMap((g) => g.values.map((v) => ({ title: `${g.label}：${v}` })));
      }
    }
    steps.push({ skillId: sid, headline: headline || "已完成", items });
  }
  return { kind: "workflow", steps };
}

/** Fallback for unknown object shapes: key/value lines, read-only. */
function genericSummary(content) {
  if (!content || typeof content !== "object") return null;
  const lines = [];
  for (const [k, v] of Object.entries(content)) {
    if (v == null || typeof v === "function") continue;
    const label = shortText(k, 30) || k;
    const val = Array.isArray(v)
      ? `${v.length} 项`
      : typeof v === "object" ? "（结构化数据）" : shortText(v, 60);
    lines.push({ label, value: val });
  }
  return lines.length ? { kind: "fields", lines } : null;
}

/**
 * The single entry point TaskDetailScreen calls.
 * @returns {object} { kind, ... } | null — null means "nothing readable;
 *   the caller falls back to the raw JSON disclosure".
 */
export function summarizeResult(result) {
  if (!result || typeof result !== "object") return null;
  const type = result.type;
  if (type === "search_results") return searchSummary(result.content);
  if (type === "workflow_result") return workflowSummary(result.content);
  if (type === "json") return extractSummary(result.content);
  if (type === "text" || type === "plan") return null; // already a string/array the screen renders
  return genericSummary(result.content);
}

/** Human label for the stored result type (never a raw developer string). */
export const RESULT_TYPE_LABEL = {
  search_results: "检索结果",
  workflow_result: "多步工作流结果",
  json: "结构化信息",
  text: "文本内容",
  plan: "行动计划",
};
