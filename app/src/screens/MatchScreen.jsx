// Gorgon Workbench — MatchScreen (V2.4 feat/hackathon-discovery-v1).
//
// AI 赛事匹配：输入项目简介（或 GitHub 地址），match-model 提取项目画像、
// 与经过验证的赛事要求比对，输出 Top N 排序结果 + 理由 + 不匹配因素 +
// 报名准备清单。
//
// HONESTY RULES:
//   * 匹配是确定性的（match-model.js 纯函数）：同样的输入永远同样的输出。
//     无 AI key 也完整可用；接入 aiClient 只增强「项目画像提取」的措辞，
//     不改变匹配依据（依据永远来自活动记录本身）。
//   * 结果卡只引用记录里真实存在的字段；参赛条件未知的赛事会明确标注
//     「未知条件」，绝不编造资格、奖金、截止时间或报名状态。
//   * 每张结果卡的 prepList 一键保存为该活动的报名准备清单（setPrep）。

import React from "react";
import { Button, Tag } from "../lib/ds.js";
import * as V from "../lib/activity-view.js";
import { matchEvents } from "../workbench/match/match-model.js";
import { Icon } from "../components/Icon.jsx";

const EXAMPLE = "我在做一个基于大模型的语音助手 App，用 React Native + Python FastAPI，涉及 Agent 编排和 RAG，想找 AI 方向的黑客松。";

export function MatchScreen({ activities, onOpen, onUsePrep, flash }) {
  const [input, setInput] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [savedPrep, setSavedPrep] = React.useState({});

  const run = () => {
    const text = input.trim();
    if (!text || running) return;
    setRunning(true);
    try {
      // Deterministic match over the CURRENT verified activity list.
      const out = matchEvents({ projectInput: text, activities });
      setResult(out);
    } finally {
      setRunning(false);
    }
  };

  const savePrep = (m) => {
    if (!onUsePrep) return;
    onUsePrep(m.activity, m.prepList);
    setSavedPrep((s) => ({ ...s, [m.activity.id]: true }));
    if (flash) flash("准备清单已保存到该活动的报名记录");
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-match">
      <div style={{ padding: "28px 16px 48px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="sparkles" style={{ width: 22, height: 22, color: "var(--brand)" }} />
          AI 赛事匹配
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.7, margin: "8px 0 16px" }}>
          输入你的项目简介或 GitHub 地址，Gorgon 提取项目方向与技术栈，对照经过验证的赛事要求，给出排序结果、匹配理由与报名准备清单。
          匹配为本地确定性计算——理由只引用赛事记录中的真实字段，参赛条件未知的赛事会明确标注。
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <textarea
            aria-label="项目简介"
            data-testid="match-input"
            placeholder={"例：" + EXAMPLE}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            style={{
              flex: 1, minWidth: 260, border: "1px solid var(--border-subtle)", outline: "none",
              borderRadius: "var(--radius-md)", padding: "12px 14px", background: "var(--surface-card)",
              fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-strong)", lineHeight: 1.6, resize: "vertical",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "none" }}>
            <Button variant="primary" data-testid="match-run" onClick={run} disabled={!input.trim() || running}
              leadingIcon={<Icon name="sparkles" style={{ width: 15, height: 15 }} />}>
              {running ? "匹配中…" : "开始匹配"}
            </Button>
            <Button variant="ghost" onClick={() => { setInput(EXAMPLE); }}
              leadingIcon={<Icon name="clipboard" style={{ width: 15, height: 15 }} />}>
              填入示例
            </Button>
          </div>
        </div>

        {!result && (
          <div style={{ marginTop: 22, fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, padding: "18px 20px", borderRadius: "var(--radius-md)", background: "var(--bg-sunken)" }}>
            匹配只针对当前活动库中经过验证的赛事（{activities.length} 条，DEMO 演示数据不参与）。
            输出内容：项目画像 → Top N 匹配分与理由 → 不匹配因素与未知条件 → 报名准备清单。
          </div>
        )}

        {result && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }} data-testid="match-results">
            {/* 项目画像 */}
            <div style={{
              border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)",
              padding: "12px 16px", background: "var(--surface-card)",
            }} data-testid="match-profile">
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.04em", marginBottom: 8 }}>项目画像</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {result.profile.domains.length === 0 && result.profile.techStack.length === 0 && (
                  <span style={{ fontSize: 13, color: "var(--text-faint)" }}>未识别出明确方向 —— 可以补充技术栈或领域关键词后重试。</span>
                )}
                {result.profile.domains.map((d) => <Tag key={d.id} size="sm" tone="brand">{d.label}</Tag>)}
                {result.profile.techStack.map((s) => <Tag key={s.id} size="sm" tone="neutral">{s.label}</Tag>)}
              </div>
            </div>

            {result.matches.length === 0 && (
              <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.8, padding: "18px 20px", borderRadius: "var(--radius-md)", background: "var(--bg-sunken)" }}>
                没有找到匹配的赛事。可以换个更具体的描述，或到「发现」页浏览全部活动。
              </div>
            )}

            {/* Top N 匹配结果 */}
            {result.matches.map((m, i) => (
              <div key={m.activity.id} data-testid="match-result-item" style={{
                border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)",
                padding: "16px 18px", background: "var(--surface-card)",
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--brand)", fontVariantNumeric: "tabular-nums" }}>
                    {m.score}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>匹配分</span>
                  <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>#{i + 1}</span>
                  <span style={{ minWidth: 0, flex: 1, fontSize: 15, fontWeight: 700, color: "var(--text-strong)", lineHeight: 1.4 }}>{m.activity.title}</span>
                  {m.activity.deadlineCountdown && (
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: m.activity.deadlineCountdown === "已截止" ? "var(--text-faint)" : "var(--danger)" }}>
                      {m.activity.deadlineCountdown === "已截止" ? "报名已截止" : "报名 " + m.activity.deadlineCountdown}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.6 }}>
                  {[m.activity.modeLabel, m.activity.city, m.activity.startDate && m.activity.startDate + " 起", m.activity.prizeType === "cash" ? "有奖金" : null]
                    .filter(Boolean).join(" · ")}
                </div>

                {m.reasons.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                    {m.reasons.map((r, j) => (
                      <div key={j} style={{ display: "flex", gap: 7, alignItems: "baseline", fontSize: 13, color: "var(--text-body)", lineHeight: 1.6 }}>
                        <Icon name="check" style={{ width: 14, height: 14, color: "var(--accent-strong, #00A277)", flex: "none" }} />
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>
                )}

                {m.mismatches.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                    {m.mismatches.map((r, j) => (
                      <div key={j} style={{ display: "flex", gap: 7, alignItems: "baseline", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                        <Icon name="alert-triangle" style={{ width: 14, height: 14, color: "var(--warning-ink)", flex: "none" }} />
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 准备清单预览 + 保存 */}
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Button size="sm" variant={savedPrep[m.activity.id] ? "mint" : "secondary"}
                    data-testid={"match-save-prep-" + m.activity.id}
                    onClick={() => savePrep(m)}
                    leadingIcon={<Icon name={savedPrep[m.activity.id] ? "check" : "list-checks"} style={{ width: 14, height: 14 }} />}>
                    {savedPrep[m.activity.id] ? "准备清单已保存" : "创建报名准备清单"}
                  </Button>
                  {onOpen && (
                    <Button size="sm" variant="ghost" onClick={() => onOpen(V.toView(m.activity))}
                      trailingIcon={<Icon name="chevron-right" style={{ width: 14, height: 14 }} />}>
                      查看详情
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {/* 未匹配原因 */}
            {result.unmatched.length > 0 && (
              <div style={{
                border: "1px dashed var(--border-subtle)", borderRadius: "var(--radius-md)",
                padding: "12px 16px",
              }} data-testid="match-unmatched">
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>未列入匹配（{result.unmatched.length} 条）</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {result.unmatched.map((u) => (
                    <div key={u.activity.id} style={{ fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
                      {u.activity.title} —— {u.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
