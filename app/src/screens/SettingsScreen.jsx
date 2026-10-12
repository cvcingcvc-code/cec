// Gorgon Workbench — SettingsScreen (Phase 2: Task Engine status).
//
// Truthfully displays the Task Engine state (§21): local engine ready,
// LocalStorage persistence, schema version, AI provider not configured.
// Deliberately NO model key inputs and NO provider integration — the
// model layer is Phase 4.

import React from "react";
import * as WB from "../store/workbench-store.js";
import { Icon } from "../components/Icon.jsx";

// The shell never prints a raw backend address to the user (A4.1 in the UI
// audit): it only reports whether a search service is configured.
function backendLabel() {
  try {
    const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
    return env.VITE_API_BASE_URL ? "已连接（演示模式可用时自动连接）" : "未配置（演示模式可用时自动连接）";
  } catch (e) {
    return "未配置（演示模式可用时自动连接）";
  }
}

const HEALTH_LABEL = {
  ok: "正常",
  empty: "空（尚无任务数据）",
  corrupt: "已损坏（已隔离保护，应用降级运行）",
  unknown_schema: "版本未知（已尽量读取）",
};

export function SettingsScreen() {
  const health = React.useMemo(() => WB.getStorageHealth(), []);
  const rows = [
    { k: "应用", v: "Gorgon 智能工作台" },
    { k: "版本", v: "2.2.0" },
    { k: "任务引擎", v: "本地引擎 / 就绪" },
    { k: "任务路由", v: "规则确定（关键词匹配，不依赖模型）" },
    { k: "技能", v: "5 个（搜索 / 摘要 / 提取 / 规划 / 模板写作）" },
    { k: "数据保存", v: "保存在本机，不会上传" },
    { k: "数据结构版本", v: "2" },
    { k: "存储状态", v: HEALTH_LABEL[health.state] || health.state },
    { k: "搜索服务", v: backendLabel() },
    { k: "运行模式", v: "本机运行（无需后台服务）" },
    { k: "AI 引擎", v: "未配置（后续阶段提供）", muted: true },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-settings">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
          模型与设置
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.7, margin: "8px 0 18px" }}>
          这里展示应用与本机任务的运行情况。模型接入与密钥配置将在后续阶段提供。
        </p>

        <div style={{
          background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)", padding: "4px 16px", maxWidth: 640,
        }} data-testid="workbench-settings-list">
          {rows.map((r, i) => (
            <div key={r.k} data-testid={"workbench-setting-" + (r.v.indexOf("未") === 0 || r.v.indexOf("Not ") === 0 ? "not-ready" : "info")} style={{
              display: "flex", alignItems: "baseline", gap: 14, padding: "12px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
            }}>
              <span style={{ flex: "none", width: 100, fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>
                {r.k}
              </span>
              <span style={{
                minWidth: 0, fontSize: 13, lineHeight: 1.6, overflowWrap: "anywhere",
                color: r.muted ? "var(--text-faint)" : "var(--text-strong)", fontWeight: r.muted ? 500 : 600,
              }}>
                {r.v}
              </span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, maxWidth: 640, display: "flex", gap: 9, alignItems: "flex-start", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", padding: "11px 14px" }}>
          <Icon name="info" style={{ width: 15, height: 15, color: "var(--text-faint)", flex: "none", marginTop: 2 }} />
          <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
            任务数据保存在本机，不会上传；旧版本创建的任务会在首次读取时自动迁移，不会被删除。
            出于安全考虑，任何模型密钥都不会在应用内存储或输入。
          </span>
        </div>
      </div>
    </div>
  );
}
