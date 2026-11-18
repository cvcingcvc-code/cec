// Gorgon Lite — navigation & chrome components extracted from App.jsx.
//
// Keeps App.jsx focused on repository orchestration while rendering:
//   * LiteMobileHeader — top brand + independent secondary tools & settings triggers
//   * WorkbenchTabBar  — 3 primary tabs in Lite mode (首页 / 任务 / 智能体), 4 in classic rollback
//   * MoreDrawer       — secondary user-data sheet (日程 / 笔记 / 项目 / 记录 / 人工确认 / 设置)
//   * WorkbenchSidebar — desktop 3-primary + secondary data rail (or classic full rail)
//   * Toast            — single non-stacking in-app feedback banner

import React from "react";
import { Icon } from "./Icon.jsx";
import {
  LITE_PRIMARY_TABS, LITE_SECONDARY_TABS, WORKBENCH_SETTINGS,
  LEGACY_TABS, LEGACY_SIDEBAR_KEYS,
  CLASSIC_WORKBENCH_TABS, CLASSIC_MOBILE_TABS, CLASSIC_MOBILE_MORE_TABS,
} from "../workbench/navigation.js";

const LEGACY_BY_KEY = LEGACY_TABS.reduce((m, t) => { m[t.key] = t; return m; }, {});

export function LiteMobileHeader({ active, onHome, onOpenTools, onOpenSettings, pendingReviewCount = 0, dark = false }) {
  const onSettings = active === "settings";
  const fg = dark ? "var(--v3k-ink)" : "var(--text-strong)";
  const muted = dark ? "var(--v3k-muted)" : "var(--text-muted)";
  const accent = dark ? "var(--v3k-primary)" : "var(--brand)";
  const accentSoft = dark ? "var(--v3k-primary-soft)" : "var(--brand-soft)";
  const line = dark ? "var(--v3k-line)" : "var(--border-subtle)";
  const surface = dark ? "var(--v3k-surface)" : "var(--bg-sunken)";
  return (
    <header
      className="v3k-mobile-header"
      data-testid="lite-mobile-header"
      style={dark ? undefined : {
        background: "var(--surface-card)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <button type="button" data-workbench-nav="home" aria-label="回到首页" onClick={onHome} style={{ color: fg }}>
        <span className="v3k-brand-mark" aria-hidden="true" style={dark ? undefined : {
          borderColor: "var(--border-subtle)",
          color: "var(--brand)",
          background: "var(--brand-soft)",
          boxShadow: "none",
        }}>G</span>
        <span>GORGON</span>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em",
          padding: "2px 6px", borderRadius: 999,
          background: accentSoft,
          color: accent,
        }}>LITE</span>
      </button>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          data-testid="lite-tools-trigger"
          aria-label="日程、笔记与更多数据"
          onClick={onOpenTools}
          style={{
            minWidth: 48, minHeight: 48, padding: "0 10px", borderRadius: 12,
            border: `1px solid ${line}`,
            background: surface,
            color: fg,
            fontSize: 12, fontWeight: 600, letterSpacing: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
            position: "relative", cursor: "pointer",
          }}
        >
          <Icon name="folder-kanban" style={{ width: 16, height: 16 }} />
          <span>工具</span>
          {pendingReviewCount > 0 && (
            <span data-testid="lite-review-dot" style={{
              position: "absolute", top: 6, right: 6, width: 8, height: 8,
              borderRadius: "50%", background: "var(--warning-ink, #f59e0b)",
            }} />
          )}
        </button>
        <button
          type="button"
          data-workbench-nav="settings"
          aria-label="模型与设置"
          aria-current={onSettings ? "page" : undefined}
          onClick={onOpenSettings}
          style={{
            minWidth: 48, minHeight: 48, padding: 0, borderRadius: 12,
            border: onSettings ? `1px solid ${accent}` : "1px solid transparent",
            background: onSettings ? accentSoft : "transparent",
            color: onSettings ? accent : muted,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            letterSpacing: 0, cursor: "pointer",
          }}
        >
          <Icon name="settings" style={{ width: 19, height: 19 }} />
        </button>
      </div>
    </header>
  );
}

export function WorkbenchSidebar({ active, onWb, onLegacy, syncedCount, navMode = "lite", pendingReviewCount = 0 }) {
  const renderItem = (t, attr, onClick, badgeCount = 0) => (
    <button
      key={attr + "-" + t.key}
      data-workbench-nav={attr === "workbench" ? t.key : undefined}
      data-gg-nav={attr === "legacy" ? t.key : undefined}
      className={"gg-nav-item" + (active === t.key ? " is-active" : "")}
      aria-current={active === t.key ? "page" : undefined}
      onClick={() => onClick(t.key)}
    >
      <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
        <Icon name={t.icon} style={{ width: 20, height: 20, flex: "none" }} />
        {badgeCount > 0 && (
          <span style={{
            position: "absolute", top: -7, right: -10, minWidth: 16, height: 16,
            padding: "0 4px", borderRadius: "var(--radius-pill)", background: "var(--accent)",
            color: "#06241B", fontSize: 10.5, fontWeight: 700, display: "inline-flex",
            alignItems: "center", justifyContent: "center",
          }}>{badgeCount}</span>
        )}
      </span>
      <span className="gg-nav-label">{t.label}</span>
    </button>
  );

  if (navMode === "classic") {
    const classicAll = CLASSIC_WORKBENCH_TABS.concat([WORKBENCH_SETTINGS]);
    return (
      <nav className="gg-sidebar" data-gg-region="sidebar" data-gg-shell-nav="workbench" aria-label="主导航">
        {classicAll.map((t) => renderItem(t, "workbench", onWb))}
        <div className="gg-nav-spacer" />
        <div className="gg-sidebar-divider" />
        <div className="gg-nav-label" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", padding: "2px 12px 6px", letterSpacing: "0.04em" }}>
          专业能力
        </div>
        {LEGACY_SIDEBAR_KEYS.map((k) => renderItem(LEGACY_BY_KEY[k], "legacy", onLegacy, k === "weekend" ? syncedCount : 0))}
        <div style={{ display: "none" }}>
          {["search", "smart"].map((k) => renderItem(LEGACY_BY_KEY[k], "legacy", onLegacy))}
        </div>
      </nav>
    );
  }

  return (
    <nav className="gg-sidebar" data-gg-region="sidebar" data-gg-shell-nav="workbench" aria-label="主导航">
      <div className="gg-nav-label" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", padding: "2px 12px 6px", letterSpacing: "0.04em" }}>
        核心入口
      </div>
      {LITE_PRIMARY_TABS.map((t) => renderItem(t, "workbench", onWb))}
      <div className="gg-sidebar-divider" style={{ margin: "10px 0" }} />
      <div className="gg-nav-label" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", padding: "2px 12px 6px", letterSpacing: "0.04em" }}>
        数据与记录
      </div>
      {LITE_SECONDARY_TABS.map((t) => renderItem(t, "workbench", onWb, t.key === "review" ? pendingReviewCount : 0))}
      <div className="gg-nav-spacer" />
      <div className="gg-sidebar-divider" />
      {renderItem(WORKBENCH_SETTINGS, "workbench", onWb)}
      {/* Frozen legacy & search routes stay mounted out of visual flow for programmatic compatibility;
          human access to archived data lives in SettingsScreen「已隐藏模块与历史数据」. */}
      <div style={{ display: "none" }} aria-hidden="true">
        <button type="button" data-workbench-nav="search" tabIndex={-1} onClick={() => onWb("search")}>智能搜索</button>
        {LEGACY_TABS.map((t) => (
          <button key={"compat-" + t.key} type="button" data-gg-nav={t.key} tabIndex={-1} onClick={() => onLegacy(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function WorkbenchTabBar({ active, onChange, syncedCount, navMode = "lite", pendingReviewCount = 0 }) {
  const tabs = navMode === "classic" ? CLASSIC_MOBILE_TABS : LITE_PRIMARY_TABS;
  return (
    <div className="gg-workbench-tabbar" data-gg-region="tabbar" aria-label="主导航" style={{
      flex: "none", display: "flex", padding: "8px 12px 22px",
      background: "color-mix(in oklch, var(--surface-card) 88%, transparent)",
      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      borderTop: "1px solid var(--border-subtle)",
    }}>
      {tabs.map((t) => {
        const on = t.key === active;
        const badgeCount = t.key === "weekend" ? syncedCount : (t.key === "agent" ? pendingReviewCount : 0);
        return (
          <button key={t.key}
            type="button"
            className={"gg-workbench-tab" + (on ? " is-active" : "")}
            aria-current={on ? "page" : undefined}
            aria-label={t.label}
            data-workbench-nav={t.workbench ? t.key : undefined}
            data-gg-nav={t.legacy ? t.key : undefined}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1, border: "none", background: "transparent", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
              color: on ? "var(--brand)" : "var(--text-faint)",
            }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon name={t.icon} style={{ width: 23, height: 23 }} />
              {badgeCount > 0 && (
                <span style={{
                  position: "absolute", top: -6, right: -10, minWidth: 16, height: 16,
                  padding: "0 4px", borderRadius: "var(--radius-pill)", background: "var(--accent)",
                  color: "#06241B", fontSize: 10.5, fontWeight: 700, display: "inline-flex",
                  alignItems: "center", justifyContent: "center",
                }}>{badgeCount}</span>
              )}
            </span>
            <span style={{ fontSize: 12, fontWeight: on ? 700 : 500, fontFamily: "var(--font-sans)" }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function MoreDrawer({ open, onClose, active, onPick, syncedCount, navMode = "lite", pendingReviewCount = 0 }) {
  if (!open) return null;
  const rows = navMode === "classic"
    ? CLASSIC_MOBILE_MORE_TABS
    : LITE_SECONDARY_TABS.concat([WORKBENCH_SETTINGS]);
  const heading = navMode === "classic" ? "更多入口" : "数据与辅助工具（不丢历史记录）";
  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, zIndex: 40,
      background: "color-mix(in oklch, #000 45%, transparent)",
      display: "flex", alignItems: "flex-end",
    }} data-testid="workbench-more-drawer">
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", background: "var(--surface-card)", borderRadius: "18px 18px 0 0",
        padding: "14px 14px 26px", boxShadow: "var(--shadow-xl)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 8px 10px" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)" }}>
            {heading}
          </span>
          <button type="button" onClick={onClose} aria-label="关闭工具菜单" style={{
            minWidth: 44, minHeight: 44, border: "none", background: "transparent",
            color: "var(--text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>关闭</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {rows.map((t) => {
            const on = t.key === active;
            const badge = t.key === "weekend" ? syncedCount : (t.key === "review" ? pendingReviewCount : 0);
            return (
              <button key={t.key}
                type="button"
                data-workbench-nav={t.workbench ? t.key : undefined}
                data-gg-nav={t.legacy ? t.key : undefined}
                onClick={() => onPick(t.key)}
                style={{
                  border: "1px solid var(--border-subtle)", background: on ? "var(--brand-soft)" : "var(--bg-sunken)",
                  color: on ? "var(--brand)" : "var(--text-body)", borderRadius: "var(--radius-md)",
                  padding: "12px 6px", minHeight: 64, cursor: "pointer", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600,
                  position: "relative",
                }}>
                <Icon name={t.icon} style={{ width: 20, height: 20 }} />
                {t.label}
                {badge > 0 && (
                  <span style={{
                    position: "absolute", top: 6, right: 8, minWidth: 15, height: 15,
                    borderRadius: "var(--radius-pill)", background: "var(--accent)", color: "#06241B",
                    fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center",
                    justifyContent: "center", padding: "0 3px",
                  }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      position: "absolute", top: "var(--gg-toast-top)", left: "50%", transform: "translateX(-50%)", zIndex: 50,
      background: "var(--ink)", color: "#fff", padding: "11px 18px", borderRadius: "var(--radius-pill)",
      display: "flex", alignItems: "center", gap: 9, boxShadow: "var(--shadow-lg)",
      animation: "gg-toast-in var(--dur-base) var(--ease-out)", whiteSpace: "nowrap", maxWidth: "calc(100% - 24px)",
    }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Icon name="check" style={{ width: 14, height: 14, color: "#06241B" }} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{msg}</span>
    </div>
  );
}
