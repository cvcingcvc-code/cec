// Gorgon Workbench — Extract Skill (Phase 3, deterministic).
//
// Local, regex-based structured extraction. NO NLP library, NO network,
// NO LLM. Pulls simple, well-formed facts out of free text or a previous
// step's text result: dates, times, URLs, amounts, emails, phone numbers,
// and obvious todo lines. Anything semantically ambiguous is left UNRECOGNIZED
// (empty arrays + a clear "未识别" summary) rather than guessed (§14).
//
// V3I additions (P1 scenarios A/C, still 100% local + deterministic):
//   * numbered todo lines ("1. 买礼物" / "2、写周报" / "3) 预约牙医") are
//     recognized as todos — scenario C (structured list → editable todos);
//   * a rule-based SCENE CHECKLIST suggestion: when the input mentions
//     面试, a fixed interview-prep checklist is attached to the result as
//     content.checklist. It is clearly a SUGGESTION (the UI labels it
//     清单建议 and the save button creates pending, editable todos) —
//     never fabricated facts, never auto-completed (§12/§46).

import { createSkillResult, createSkillError, CAP_LOCAL } from "./skill-base.js";
import { withAiAssist } from "../ai/assist.js";

// ── regex kit (deterministic, order-stable) ───────────────────────────────
const RE = {
  isoDate: /\b\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\b/g,
  slashDate: /\b\d{1,2}[\/．.]\d{1,2}\b/g, // 10/12  (no year)
  cnDate: /(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g, // 10月12日 / 10月12
  // V3H fix: the old negative lookahead (?![一-日]) covered U+4E00–U+65E5,
  // which rejected "明天下午" (下 U+4E0B) and "明天我" (我 U+6211) — every
  // relative date followed by a common hanzi was silently dropped. The
  // lookahead now only excludes the characters that form ANOTHER date word
  // (天/末/周/一~五): "今天天气" stays unrecognized, "明天下午" matches.
  relDate: /(今天晚上|今天|明天|明早|明晚|后天|大后天|本周末|这周末|本周|下周末|下周[一二三四五]?)(?![天末周一二三四五])/g, // 明天 / 下周 …
  hhmm: /\b\d{1,2}:\d{2}\b/g, // 15:00
  cnTime: /([上下早晚]午\s*)?(\d{1,2})\s*点\s*(半|钟|钟左右)?/g, // 下午3点 / 3点半
  url: /\bhttps?:\/\/[^\s，。、）)】」]+/gi,
  amount: /[¥￥$]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|块|块钱|万元?|美元|欧元)/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  phone: /\b1[3-9]\d{9}\b/g,
};

function uniq(arr) {
  return Array.from(new Set(arr.map((s) => String(s).trim()).filter(Boolean)));
}

function extractDates(text) {
  const out = [];
  let m;
  while ((m = RE.isoDate.exec(text))) out.push(m[0].replace(/\//g, "-"));
  while ((m = RE.slashDate.exec(text))) out.push(m[0]);
  while ((m = RE.cnDate.exec(text))) out.push(`${m[1]}月${m[2]}日`);
  while ((m = RE.relDate.exec(text))) out.push(m[0]);
  return uniq(out);
}

function extractTimes(text) {
  const out = [];
  let m;
  while ((m = RE.hhmm.exec(text))) out.push(m[0]);
  while ((m = RE.cnTime.exec(text))) {
    const period = m[1] ? m[1].trim() : "";
    const h = m[2];
    const half = m[3] === "半" ? "半" : "";
    out.push(`${period}${h}点${half}`.trim());
  }
  return uniq(out);
}

function extractTodos(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    // A line is a todo only if it LEADS with a marker; a bare `✅?\s*` would
    // match an empty prefix and swallow every line, so it is not allowed.
    const m = l.match(/^(?:[-*·]\s+|待办[:：]|TODO[:：]|任务[:：]|【待办】|✅\s*)(.*)$/i);
    if (m) {
      const rest = m[1].trim();
      if (rest) out.push(rest);
    } else if (/待办/.test(l)) {
      out.push(l.replace(/待办/g, "").trim());
    }
  }
  return out;
}

// V3I: numbered-line todo marker (scenario C). A line like "1. 买礼物" /
// "2、写周报" / "3) 预约牙医" / "一、买礼物" is an obvious list item.
// Dot-separator ambiguity guard: "10.12 是截止日" is a DATE, not item #10 —
// so for a dot separator the remainder must not start with a 1-2 digit
// fragment followed by whitespace/dot/end (that pattern is a date/time
// fragment like 10.12 or 3.15). CJK/3+ digit remainders ("1.2026年目标")
// are still accepted.
const RE_NUM_LINE = /^(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*(?:[、)）:：]\s*|\.(?!\d{1,2}(?:[\s.、)）:：]|$))\s*)(.+)$/;

function extractNumberedTodos(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    const m = l.match(RE_NUM_LINE);
    // Remainder must have content AND not be a bare number — a lone "10.12"
    // line is a date, not a todo item.
    if (m && m[1].trim() && !/^\d+$/.test(m[1].trim())) out.push(m[1].trim());
  }
  return out;
}

// V3I (scenario A): rule-based scene checklists. Pure templates, keyed by a
// trigger keyword in the input. Each entry is a SUGGESTION the user must
// confirm via the save button — the engine never marks them done.
const SCENE_CHECKLISTS = [
  {
    trigger: /面试/,
    title: "面试准备清单",
    items: [
      "更新简历并针对目标岗位调整重点",
      "研究目标公司背景、业务与近期动态",
      "准备常见面试问题的回答思路",
      "准备要向面试官提出的问题",
      "确认面试时间、地点/链接与着装，预留路程时间",
    ],
  },
];

function sceneChecklistFor(text) {
  for (const scene of SCENE_CHECKLISTS) {
    if (scene.trigger.test(text)) {
      return { title: scene.title, items: scene.items.slice() };
    }
  }
  return null;
}

/** Public, pure extraction used by both the skill and unit tests. */
export function extractStructured(text) {
  const t = typeof text === "string" ? text : "";
  const dates = extractDates(t);
  const times = extractTimes(t);
  const urls = uniq(t.match(RE.url) || []);
  // Normalize amounts to a compact form (e.g. "500 元" -> "500元") per §14.
  const amounts = uniq((t.match(RE.amount) || []).map((s) => s.replace(/\s+/g, "")));
  const emails = uniq(t.match(RE.email) || []);
  const phones = uniq(t.match(RE.phone) || []);
  const todos = Array.from(new Set([...extractTodos(t), ...extractNumberedTodos(t)]));
  const checklist = sceneChecklistFor(t);
  return { dates, times, urls, amounts, emails, phones, todos, checklist };
}

function describe(data) {
  const parts = [];
  if (data.dates.length) parts.push(`${data.dates.length} 个日期`);
  if (data.times.length) parts.push(`${data.times.length} 个时间`);
  if (data.urls.length) parts.push(`${data.urls.length} 个链接`);
  if (data.amounts.length) parts.push(`${data.amounts.length} 个金额`);
  if (data.emails.length) parts.push(`${data.emails.length} 个邮箱`);
  if (data.phones.length) parts.push(`${data.phones.length} 个电话`);
  if (data.todos.length) parts.push(`${data.todos.length} 条待办`);
  if (data.checklist) parts.push("1 份场景清单建议");
  return parts;
}

const extractSkill = {
  id: "extract",
  name: "本地提取",
  description: "从文本中确定性地提取日期、时间、链接、金额、邮箱、电话与待办项（正则，无模型）。",
  capabilities: CAP_LOCAL,

  canHandle(ctx) {
    const g = (ctx && ctx.goal) || "";
    const hit = /提取|找出|列出日期|联系人|截止时间|地址|金额|链接|待办|抓取/.test(g);
    return { ok: hit, confidence: hit ? 0.85 : 0 };
  },

  // context: { goal, text?, previousResults?, task?, metadata? }
  // Local rules first; only if they found nothing meaningful do we consider an
  // AI-assisted extract (Phase 5). deps.aiClient is opt-in — absent ⇒ local,
  // and this stays fully SYNCHRONOUS (withAiAssist only returns a Promise when
  // a real model call actually happens).
  execute(ctx = {}, deps = {}) {
    const prevText = (ctx.previousResults || [])
      .map((r) => (r && r.result && typeof r.result.content === "string" ? r.result.content : ""))
      .join("\n");
    const text = (ctx.text != null ? ctx.text : ctx.goal) || "";
    const input = (text + "\n" + prevText).trim();

    const deterministic = () => {
      const data = extractStructured(input);
      const parts = describe(data);
      let summary;
      if (parts.length) {
        summary = `本地提取到：${parts.join("、")}`;
        if (data.checklist) {
          summary += `（已附「${data.checklist.title}」，可在下方一键保存为待办）`;
        }
      } else {
        summary = "未识别到结构化信息（已如实返回空结果，未猜测）";
      }
      return createSkillResult("extract", {
        summary,
        result: { type: "json", content: data },
        metadata: { method: "regex", recognized: parts.length },
      });
    };

    // Confidence: local rules are trusted when they actually found something.
    const probe = extractStructured(input);
    const found = describe(probe).length > 0;
    return withAiAssist({
      skill: "extract",
      purpose: "extract",
      input,
      intent: (ctx.task && ctx.task.metadata && ctx.task.metadata.router && ctx.task.metadata.router.intent) || "",
      deps,
      deterministic,
      // Local rules found nothing → low confidence → the gate may allow AI.
      confidence: found ? 0.9 : 0.1,
      method: "regex",
    });
  },
};

export const extractSkillObject = extractSkill;
export default extractSkill;
