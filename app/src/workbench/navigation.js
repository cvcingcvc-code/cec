// Gorgon Lite — navigation configuration, secondary data access & rollback layer.
//
// Core product loop (Gorgon Lite):
//   创建任务 → AI/电脑端受控辅助执行 → 查看真实结果 → 保存记录与复盘
//
// Primary navigation has ONLY THREE entries on both mobile and desktop:
//   1. home  ("首页")   — 一句话建任务、今日任务、最近执行与复盘
//   2. tasks ("任务")   — 任务列表、排期/提醒、状态机、详情与笔记/项目关联
//   3. agent ("智能体") — 电脑连接状态、可用执行器、受限提交、结果与人工审批
//
// Secondary data views (日程 / 笔记 / 项目 / 工作记录 / 人工确认 / 设置) stay
// reachable via the top header tools sheet, Tasks contextual shortcuts, and
// the desktop secondary group — zero historical user data is orphaned.
//
// Frozen/archived modules (周末活动发现 / 搜索 / 地图 / 走访地点 / 自建活动 / 进度中心)
// are hidden from the primary UI, kept reachable via Settings「已隐藏模块与历史数据」
// and /?legacy=1, and full classic navigation can be restored at any time via
// ?nav=classic or localStorage["gorgon_nav_mode"] = "classic".

export const NAV_MODE_KEY = "gorgon_nav_mode";

export const LITE_PRIMARY_TABS = [
  { key: "home", label: "首页", icon: "layout-dashboard", workbench: true },
  { key: "tasks", label: "任务", icon: "list-todo", workbench: true },
  { key: "agent", label: "智能体", icon: "bot", workbench: true },
];

export const WORKBENCH_SETTINGS = {
  key: "settings",
  label: "模型与设置",
  icon: "settings",
  workbench: true,
};

// Preserved user-data views reachable from the header menu / contextual links.
export const LITE_SECONDARY_TABS = [
  { key: "schedule", label: "日程", icon: "calendar-clock", workbench: true },
  { key: "notes", label: "笔记", icon: "notebook-pen", workbench: true },
  { key: "projects", label: "项目", icon: "folder-kanban", workbench: true },
  { key: "history", label: "工作记录", icon: "history", workbench: true },
  { key: "review", label: "人工确认", icon: "shield-check", workbench: true },
];

// Frozen modules hidden from the daily Lite surface, kept reachable from
// Settings so historical user records (activities/places/weekend) are never lost.
export const LITE_ARCHIVED_TABS = [
  { key: "useract", label: "自建活动", icon: "compass", workbench: true },
  { key: "places", label: "走访地点", icon: "map-pin", workbench: true },
  { key: "progress", label: "进度中心", icon: "trending-up", workbench: true },
  { key: "search", label: "智能搜索", icon: "search", workbench: true },
  { key: "weekend", label: "我的周末", icon: "calendar-heart", legacy: true },
  { key: "discover", label: "发现活动", icon: "compass", legacy: true },
  { key: "map", label: "活动地图", icon: "map", legacy: true },
];

// Legacy capability entries — kept intact for /?legacy=1 and E2E contracts.
export const LEGACY_TABS = [
  { key: "discover", label: "发现", icon: "compass" },
  { key: "search", label: "搜索", icon: "search" },
  { key: "smart", label: "智能", icon: "sparkles" },
  { key: "weekend", label: "我的周末", icon: "calendar-heart" },
  { key: "map", label: "地图", icon: "map" },
];

export const WORKBENCH_TO_LEGACY = {
  search: "smart",
};

export const LEGACY_SIDEBAR_KEYS = ["discover", "weekend", "map"];

// Gorgon Lite defaults: 3 primary tabs, secondary tools sheet, zero duplicate entries.
export const WORKBENCH_TABS = LITE_PRIMARY_TABS;
export const MOBILE_TABS = LITE_PRIMARY_TABS;
export const MOBILE_MORE_TABS = LITE_SECONDARY_TABS.concat([WORKBENCH_SETTINGS]);

// Rollback snapshots: exact pre-Lite Workbench navigation (?nav=classic).
export const CLASSIC_WORKBENCH_TABS = [
  { key: "home", label: "工作台", icon: "layout-dashboard" },
  { key: "projects", label: "我的项目", icon: "folder-kanban" },
  { key: "progress", label: "进度中心", icon: "trending-up" },
  { key: "tasks", label: "我的任务", icon: "list-todo" },
  { key: "schedule", label: "日程", icon: "calendar-clock" },
  { key: "notes", label: "笔记", icon: "notebook-pen" },
  { key: "places", label: "走访地点", icon: "map-pin" },
  { key: "useract", label: "自建活动", icon: "compass" },
  { key: "search", label: "智能搜索", icon: "search" },
  { key: "agent", label: "智能体", icon: "bot" },
  { key: "review", label: "审核中心", icon: "shield-check" },
  { key: "history", label: "工作记录", icon: "history" },
];

export const CLASSIC_MOBILE_TABS = [
  { key: "home", label: "工作台", icon: "layout-dashboard", workbench: true },
  { key: "search", label: "搜索", icon: "search", legacy: true },
  { key: "tasks", label: "任务", icon: "list-todo", workbench: true },
  { key: "more", label: "更多", icon: "menu", workbench: true },
];

export const CLASSIC_MOBILE_MORE_TABS = [
  { key: "projects", label: "我的项目", icon: "folder-kanban", workbench: true },
  { key: "progress", label: "进度中心", icon: "trending-up", workbench: true },
  { key: "tasks", label: "我的任务", icon: "list-todo", workbench: true },
  { key: "schedule", label: "日程", icon: "calendar-clock", workbench: true },
  { key: "notes", label: "笔记", icon: "notebook-pen", workbench: true },
  { key: "places", label: "走访地点", icon: "map-pin", workbench: true },
  { key: "useract", label: "自建活动", icon: "compass", workbench: true },
  { key: "smart", label: "智能找活动", icon: "sparkles", legacy: true },
  { key: "weekend", label: "我的周末", icon: "calendar-heart", legacy: true },
  { key: "map", label: "地图", icon: "map", legacy: true },
  { key: "agent", label: "智能体", icon: "bot", workbench: true },
  { key: "review", label: "审核中心", icon: "shield-check", workbench: true },
  { key: "history", label: "工作记录", icon: "history", workbench: true },
  { key: "settings", label: "模型与设置", icon: "settings", workbench: true },
];

/**
 * Resolve active navigation mode ("lite" default | "classic" rollback).
 * URL query ?nav=classic or ?nav=lite overrides persisted preference without
 * mutating storage; otherwise reads localStorage["gorgon_nav_mode"].
 */
export function getNavMode(search, storage) {
  try {
    const q = typeof search === "string"
      ? search
      : (typeof window !== "undefined" && window.location ? window.location.search : "");
    const param = new URLSearchParams(q).get("nav");
    if (param === "classic" || param === "full") return "classic";
    if (param === "lite") return "lite";
  } catch (e) { /* ignore malformed search */ }
  try {
    const st = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const saved = st && st.getItem(NAV_MODE_KEY);
    if (saved === "classic") return "classic";
  } catch (e) { /* private mode fallback */ }
  return "lite";
}

export function setNavMode(mode, storage) {
  const next = mode === "classic" ? "classic" : "lite";
  try {
    const st = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (st) st.setItem(NAV_MODE_KEY, next);
  } catch (e) { /* session-only fallback */ }
  return next;
}
