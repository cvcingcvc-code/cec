// Gorgon Lite — SettingsScreen (engine status, archived data access & nav rollback).
//
// Truthfully displays Task Engine state, persistence health, AI provider status
// (deliberately NO model key inputs), plus:
//   1. Archived/hidden module entries so historical user data (activities,
//      places, weekend items) stays 100% accessible even with 3-tab Lite nav.
//   2. One-click rollback between Gorgon Lite 3-tab nav and classic full nav.

import React from "react";
import * as WB from "../store/workbench-store.js";
import { LITE_ARCHIVED_TABS } from "../workbench/navigation.js";
import { Icon } from "../components/Icon.jsx";

function backendLabel() {
  try {
    const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
    return env.VITE_API_BASE_URL ? "已配置检索服务地址" : "未配置（离线使用本地确定性能力）";
  } catch (e) {
    return "未配置（离线使用本地确定性能力）";
  }
}

const HEALTH_LABEL = {
  ok: "正常",
  empty: "空（尚无任务数据）",
  corrupt: "已损坏（已隔离保护，原数据未清除）",
  unknown_schema: "版本未知（已兼容读取）",
};

export function SettingsScreen({
  navMode = "lite",
  onChangeNavMode = null,
  onOpenWb = null,
  onOpenLegacy = null,
}) {
  const health = React.useMemo(() => WB.getStorageHealth(), []);
  const rows = [
    { k: "应用形态", v: "Gorgon Lite · 个人 AI 行动助手" },
    { k: "内核版本", v: "0.4.0-lite（兼容 v2 存储）" },
    { k: "主导航模式", v: navMode === "classic" ? "旧版完整导航（回滚兼容）" : "精简三入口（首页 / 任务 / 智能体）" },
    { k: "任务引擎", v: "本地引擎 / 就绪" },
    { k: "任务路由", v: "规则确定（关键词匹配，不猜测）" },
    { k: "本地技能", v: "6 个（搜索 / 活动清单 / 摘要 / 提取 / 规划 / 模板写作）" },
    { k: "数据保存", v: "保存在本机（Android 同步镜像至原生 Preferences），不自动上传" },
    { k: "数据结构版本", v: "2" },
    { k: "存储状态", v: HEALTH_LABEL[health.state] || health.state },
    { k: "检索服务", v: backendLabel() },
    { k: "AI 引擎", v: "未配置（电脑智能体可在「智能体」页按需配对连接）", muted: true },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-settings">
      <div style={{ padding: "24px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
          模型与设置
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.7, margin: "8px 0 18px" }}>
          查看本机引擎与存储状态、访问已归档的旧版模块数据，或在需要时切回旧版导航。
        </p>

        <div style={{
          background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)", padding: "4px 16px", maxWidth: 680,
        }} data-testid="workbench-settings-list">
          {rows.map((r, i) => (
            <div key={r.k} data-testid={"workbench-setting-" + (r.v.indexOf("未") === 0 || r.v.indexOf("Not ") === 0 ? "not-ready" : "info")} style={{
              display: "flex", alignItems: "baseline", gap: 14, padding: "12px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)", flexWrap: "wrap",
            }}>
              <span style={{ flex: "none", width: 100, fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>
                {r.k}
              </span>
              <span style={{
                minWidth: 0, flex: 1, fontSize: 13, lineHeight: 1.6, overflowWrap: "anywhere",
                color: r.muted ? "var(--text-faint)" : "var(--text-strong)", fontWeight: r.muted ? 500 : 600,
              }}>
                {r.v}
              </span>
            </div>
          ))}
        </div>

        {/* Navigation mode & instant rollback */}
        {onChangeNavMode && (
          <section data-testid="settings-nav-mode" style={{
            marginTop: 18, maxWidth: 680, background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "14px 16px",
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)", marginBottom: 6 }}>
              导航布局切换（随时可回滚）
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65, margin: "0 0 12px" }}>
              默认启用 Gorgon Lite 三入口（首页 / 任务 / 智能体）。切换布局不会修改或删除任何任务、笔记、项目或历史记录；也可通过网址参数 <code>?nav=classic</code> 临时预览旧版导航。
            </p>
            <button
              type="button"
              data-testid="settings-toggle-nav-mode"
              onClick={() => onChangeNavMode(navMode === "classic" ? "lite" : "classic")}
              style={{
                minHeight: 44, padding: "9px 14px", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)", background: "var(--bg-sunken)",
                color: "var(--text-strong)", fontSize: 13, fontWeight: 600,
                fontFamily: "var(--font-sans)", cursor: "pointer",
              }}
            >
              {navMode === "classic" ? "切回 Gorgon Lite 三入口（推荐）" : "回滚为旧版完整导航"}
            </button>
          </section>
        )}

        {/* Archived modules — guarantees historical data remains reachable */}
        {(onOpenWb || onOpenLegacy) && (
          <section data-testid="settings-archived-modules" style={{
            marginTop: 18, maxWidth: 680, background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "14px 16px",
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)", marginBottom: 6 }}>
              已隐藏模块与历史数据入口（冻结归档）
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65, margin: "0 0 12px" }}>
              以下旧版模块已从日常主导航中隐藏，但原有本地存档全部保留，点击即可查阅或导出历史数据：
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {LITE_ARCHIVED_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  data-testid={"settings-open-archived-" + t.key}
                  onClick={() => {
                    if (t.legacy && onOpenLegacy) onOpenLegacy(t.key);
                    else if (onOpenWb) onOpenWb(t.key);
                  }}
                  style={{
                    minHeight: 42, padding: "8px 12px", borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-subtle)", background: "var(--bg-sunken)",
                    color: "var(--text-body)", fontSize: 12.5, fontWeight: 600,
                    fontFamily: "var(--font-sans)", cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}
                >
                  <Icon name={t.icon} style={{ width: 14, height: 14, color: "var(--brand)" }} />
                  {t.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <div style={{ marginTop: 16, maxWidth: 680, display: "flex", gap: 9, alignItems: "flex-start", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", padding: "11px 14px" }}>
          <Icon name="info" style={{ width: 15, height: 15, color: "var(--text-faint)", flex: "none", marginTop: 2 }} />
          <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
            任务数据保存在本机，不会自动上传；旧版本创建的任务会在首次读取时自动迁移，不会被删除。
            出于安全考虑，任何云端模型密钥都不会在应用内存储或输入。
          </span>
        </div>
      </div>
    </div>
  );
}
