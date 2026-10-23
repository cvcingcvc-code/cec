// Gorgon Workbench — Hackathon Match Model (V2.4 feat/hackathon-discovery-v1).
//
// PURE FUNCTION. No network, no localStorage, no React. The AI client is an
// OPTIONAL injected enhancer — without it the matcher runs on deterministic
// keyword rules, and it NEVER fabricates anything either way.
//
// The one question this module answers: "given my project, which verified
// events fit, in what order, and why?"
//
// HONESTY RULES (task charter, non-negotiable):
//   * Reasons cite ONLY fields that exist on the activity record.
//   * eligibility === null  -> the record goes to unknowns (「未知条件」),
//     never guessed into a match.
//   * A passed registration deadline -> the record is excluded from matches
//     and reported in mismatches as 已截止.
//   * No fabricated prize, deadline, or registration status — the matcher
//     reads what the record says and nothing else.
//
// Output shape (aligned with the HackerTrip /ht-scan-project pattern, but
// Gorgon's own vocabulary):
//   {
//     profile: { domains[], techStack[], text },
//     matches:   [{ activity, score, reasons[], mismatches[], prepList[] }],
//     unmatched: [{ activity, reason }],
//   }

import { isDeadlinePassed } from "../../lib/activity-view.js";

// ── Step 1: project profile extraction (deterministic keyword rules) ──

// Domain keyword table. Order here defines the canonical profile order.
const DOMAIN_RULES = [
  { id: "embodied",   label: "具身智能/机器人", keywords: ["具身", "机器人", "robot", "vla", "仿真", "真机"] },
  { id: "ai-agent",   label: "AI Agent/智能体", keywords: ["agent", "智能体", "rag", "mcp", "llm", "大模型", "多模态"] },
  { id: "ai-app",     label: "AI 应用", keywords: ["ai app", "ai应用", "ai 应用", "chatbot", "copilot", "助手", "应用"] },
  { id: "web3",       label: "Web3", keywords: ["web3", "区块链", "blockchain", "nft", "dao"] },
  { id: "hardware",   label: "硬件/IoT", keywords: ["硬件", "开发板", "传感器", "iot", "嵌入式", "芯片", "3d打印"] },
  { id: "payment",    label: "支付/商业化", keywords: ["支付", "payment", "收款", "商业化", "订阅"] },
  { id: "music",      label: "音乐/音频", keywords: ["音乐", "音乐", "audio", "音频", "歌曲"] },
  { id: "science",    label: "AI for Science", keywords: ["ai for science", "科学", "科研", "math", "数学"] },
  { id: "social",     label: "公益/社会", keywords: ["公益", "社会问题", "无障碍", "养老", "残障", "环保"] },
  { id: "ecommerce",  label: "电商/零售", keywords: ["电商", "零售", "购物", "天猫", "淘宝"] },
  { id: "cloud",      label: "云服务", keywords: ["cloud", "云开发", "云服务", "serverless"] },
  { id: "gaming",     label: "游戏/内容", keywords: ["游戏", "game", "aigc", "内容生成", "数字人"] },
];

// Tech-stack keyword table (the CLI pattern: read package.json/README —
// here the user's own project description plays that role).
const STACK_RULES = [
  { id: "js",      label: "JavaScript/TS", keywords: ["javascript", "typescript", " node", "react", "vue", "next.js", "前端"] },
  { id: "python",  label: "Python", keywords: ["python", "django", "flask", "fastapi", "pytorch", "tensorflow"] },
  { id: "rust",    label: "Rust", keywords: ["rust", "cargo"] },
  { id: "go",      label: "Go", keywords: ["golang", " go "] },
  { id: "flutter", label: "Flutter", keywords: ["flutter", "dart"] },
  { id: "mobile",  label: "移动端", keywords: ["android", "ios", "app", "小程序", "移动"] },
];

function hits(hay, keywords) {
  const out = [];
  const low = " " + hay.toLowerCase() + " ";
  for (const k of keywords) {
    if (low.includes(k.toLowerCase())) out.push(k);
  }
  return out;
}

/**
 * Extract the project profile from a free-text description (or a GitHub
 * URL — the path/repo name participates in keyword matching like any text).
 * Pure: the same input always yields the same profile.
 */
export function extractProfile(projectInput) {
  const text = String(projectInput || "").trim();
  if (!text) return { domains: [], techStack: [], text: "" };

  const domains = [];
  for (const rule of DOMAIN_RULES) {
    const h = hits(text, rule.keywords);
    if (h.length) domains.push({ id: rule.id, label: rule.label, keywords: h });
  }
  const techStack = [];
  for (const rule of STACK_RULES) {
    const h = hits(text, rule.keywords);
    if (h.length) techStack.push({ id: rule.id, label: rule.label, keywords: h });
  }
  return { domains, techStack, text };
}

// ── Step 2: match one activity against the profile ────────────────────

// Score weights (deterministic, explainable). Domain hits dominate; a
// text-search fallback keeps keyword-only projects in play.
const W = {
  domainTag: 30,       // a profile domain label appears in the activity's tags
  domainText: 18,      // a domain keyword appears in description/eligibility
  stackText: 12,       // a tech-stack keyword appears anywhere
  anyText: 25,         // a raw input word (>=2 chars) appears in title/tags —
                       // a tag literally matching the input's core word is
                       // strong evidence for table-less profiles
  base: 10,            // every not-excluded event gets a base score
};
export const MATCH_FLOOR = 30; // below this the event goes to unmatched

function matchOne(profile, activity, now) {
  const reasons = [];
  const mismatches = [];
  let score = W.base;

  if (isDeadlinePassed(activity.registrationDeadline, now)) {
    return {
      activity, score: 0,
      reasons: [],
      mismatches: ["报名已截止（" + (activity.registrationDeadline || "").slice(0, 10) + "）"],
      excluded: true,
    };
  }

  const tags = (activity.tags || []).map((t) => String(t).toLowerCase());
  const body = [activity.description, activity.eligibility, activity.title, activity.venue]
    .filter(Boolean).join(" ").toLowerCase();

  // Domain hits.
  for (const d of profile.domains) {
    const tagHit = tags.some((t) => t.includes(d.label.toLowerCase()) || d.keywords.some((k) => t.includes(k.toLowerCase())));
    const bodyHit = d.keywords.some((k) => body.includes(k.toLowerCase()));
    if (tagHit) {
      score += W.domainTag;
      reasons.push("方向匹配：「" + d.label + "」命中赛事标签");
    } else if (bodyHit) {
      score += W.domainText;
      reasons.push("方向相关：「" + d.label + "」出现在赛事介绍");
    }
  }

  // Tech-stack hits (weaker signal, dedup with domain keywords is fine —
  // a stack hit adds independent evidence about fit).
  for (const s of profile.techStack) {
    if (s.keywords.some((k) => body.includes(k.toLowerCase()))) {
      score += W.stackText;
      reasons.push("技术栈相关：「" + s.label + "」");
    }
  }

  // Raw-word fallback: distinctive input words the tables missed.
  if (!profile.domains.length && !profile.techStack.length) {
    const words = profile.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
    for (const w of words.slice(0, 8)) {
      if ((" " + tags.join(" ") + " " + body + " ").includes(w)) {
        score += W.anyText;
        reasons.push("关键词命中：「" + w + "」");
        if (reasons.length >= 3) break;
      }
    }
  }

  // Honest caveats — read from the record, never guessed.
  if (activity.eligibility == null) {
    mismatches.push("参赛条件未知（需查看官方页面确认）");
  }
  if (activity.mode === "offline") {
    mismatches.push("纯线下赛事（需到场）");
  }
  if (activity.registrationUrl == null) {
    mismatches.push("报名链接未收录（需从来源页获取）");
  }

  return { activity, score: Math.min(100, score), reasons, mismatches, excluded: false };
}

/** Build a registration prep checklist from the record's REAL fields. */
export function buildPrepList(activity) {
  const prep = [];
  if (activity.registrationUrl) prep.push("打开官方报名页填写报名信息");
  else prep.push("从来源页获取报名方式");
  if (activity.registrationDeadline) prep.push("在截止前完成报名（" + String(activity.registrationDeadline).slice(0, 10) + "）");
  if (activity.eligibility) prep.push("核对参赛条件： " + String(activity.eligibility).slice(0, 40) + (String(activity.eligibility).length > 40 ? "…" : ""));
  if (activity.teamSize) prep.push("确认组队安排： " + activity.teamSize);
  if (activity.mode === "offline" || activity.mode === "hybrid") prep.push("安排线下行程与住宿");
  if (activity.prize) prep.push("了解奖金与评审规则");
  return prep;
}

// ── Step 3: the matcher ───────────────────────────────────────────────

/**
 * @param {{projectInput?:string, activities?:Array, now?:Date|string}} input
 * @returns {{profile, matches:[], unmatched:[]}}
 */
export function matchEvents(input = {}) {
  const profile = extractProfile(input.projectInput);
  const list = Array.isArray(input.activities) ? input.activities : [];
  const now = input.now || new Date();
  if (!profile.text) {
    return { profile, matches: [], unmatched: [] };
  }

  const scored = [];
  const unmatched = [];
  for (const activity of list) {
    if (!activity) continue;
    const r = matchOne(profile, activity, now);
    if (r.excluded) {
      unmatched.push({ activity: r.activity, reason: r.mismatches.join("；") });
    } else if (r.score < MATCH_FLOOR) {
      unmatched.push({ activity: r.activity, reason: "与项目方向关联较弱" });
    } else {
      scored.push(r);
    }
  }

  // Sort by score desc; ties broken by id for determinism (tested).
  scored.sort((a, b) => (b.score - a.score) || String(a.activity.id).localeCompare(String(b.activity.id)));

  const matches = scored.map((r) => ({
    activity: r.activity,
    score: r.score,
    reasons: r.reasons,
    mismatches: r.mismatches,
    prepList: buildPrepList(r.activity),
  }));

  return { profile, matches, unmatched };
}
