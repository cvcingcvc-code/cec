// Gorgon V1 — the root component.
//
// Ported from the inline <script type="text/babel"> bootstrap in
// ui_kits/app/index.html. State ownership is UNCHANGED: the synced set,
// active tab, detail overlay, map focus, district selection and the toast
// all live here and are shared by both chromes (phone frame / app shell).
//
// PHASE 2 (TASK_ENGINE_FOUNDATION): the Workbench is now the DEFAULT boot
// screen (desktop + mobile). The legacy contract is preserved through an
// explicit legacy entry: loading /?legacy=1 boots into the legacy
// "discover" tab exactly as Phase 1 did, so e2e_v1_frontend.mjs keeps
// verifying the five legacy capabilities (discover/search/smart/weekend/
// map) with zero coverage loss. data-gg-nav keys, .gg-disc-card and the
// mobile 搜索 tab label are untouched.
//
// Task state now flows through the formal Task Engine: workbench-store.js
// (facade) -> task-repository.js (persistence) -> task-model.js (pure
// state machine). Screens never write localStorage directly.

import React from "react";
import { StatusBar, PhoneFrame, DesktopHeader } from "./components/AppShell.jsx";
import { DiscoverScreen } from "./screens/DiscoverScreen.jsx";
import { ActivityDetailScreen } from "./screens/ActivityDetailScreen.jsx";
import { SearchScreen } from "./screens/SearchScreen.jsx";
import { NaturalSearchScreen } from "./screens/NaturalSearchScreen.jsx";
import { MyWeekendScreen } from "./screens/MyWeekendScreen.jsx";
import { MapScreen } from "./screens/MapScreen.jsx";
import { WorkbenchHome } from "./screens/WorkbenchHome.jsx";
import { ProjectsScreen } from "./screens/ProjectsScreen.jsx";
import { ProjectDetailScreen } from "./screens/ProjectDetailScreen.jsx";
import { ProgressCenterScreen } from "./screens/ProgressCenterScreen.jsx";
import { PlacesScreen } from "./screens/PlacesScreen.jsx";
import { TasksScreen } from "./screens/TasksScreen.jsx";
import { TaskDetailScreen } from "./screens/TaskDetailScreen.jsx";
import { ScheduleScreen } from "./screens/ScheduleScreen.jsx";
import { NotesScreen } from "./screens/NotesScreen.jsx";
import { UserActivitiesScreen } from "./screens/UserActivitiesScreen.jsx";
import { ReviewCenterScreen } from "./screens/ReviewCenterScreen.jsx";
import { HistoryScreen } from "./screens/HistoryScreen.jsx";
import { SettingsScreen } from "./screens/SettingsScreen.jsx";
import { useResponsive } from "./lib/useResponsive.js";
import * as Store from "./store/store.js";
import * as WBStore from "./store/workbench-store.js";
import * as ActivityView from "./lib/activity-view.js";
import { GORGON_DATA } from "./lib/data.js";
import { Icon } from "./components/Icon.jsx";
import {
  WORKBENCH_TABS, WORKBENCH_SETTINGS, LEGACY_TABS, LEGACY_SIDEBAR_KEYS,
  WORKBENCH_TO_LEGACY, MOBILE_TABS, MOBILE_MORE_TABS,
} from "./workbench/navigation.js";

/* ── legacy-mode detection (§17/§18) ────────────────────────────────── */
// /?legacy=1 boots into the Phase-1 default (discover). Anything else
// boots into the Workbench home. The flag is read ONCE at startup.
function isLegacyBoot() {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("legacy") === "1";
  } catch (e) {
    return false;
  }
}
const LEGACY_MODE = typeof window !== "undefined" ? isLegacyBoot() : false;

/* ── Workbench chrome (desktop sidebar + mobile tabbar/drawer) ─────── */

const WORKBENCH_ALL = WORKBENCH_TABS.concat([WORKBENCH_SETTINGS]);
const LEGACY_BY_KEY = LEGACY_TABS.reduce((m, t) => { m[t.key] = t; return m; }, {});
const WB_BY_KEY = WORKBENCH_ALL.reduce((m, t) => { m[t.key] = t; return m; }, {});

function WorkbenchSidebar({ active, onWb, onLegacy, syncedCount }) {
  const item = (t, attr, onClick) => {
    return (
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
          {t.key === "weekend" && attr === "legacy" && syncedCount > 0 && (
            <span style={{
              position: "absolute", top: -7, right: -10, minWidth: 16, height: 16,
              padding: "0 4px", borderRadius: "var(--radius-pill)", background: "var(--accent)",
              color: "#06241B", fontSize: 10.5, fontWeight: 700, display: "inline-flex",
              alignItems: "center", justifyContent: "center",
            }}>{syncedCount}</span>
          )}
        </span>
        <span className="gg-nav-label">{t.label}</span>
      </button>
    );
  };

  return (
    <nav className="gg-sidebar" data-gg-region="sidebar" data-gg-shell-nav="workbench" aria-label="主导航">
      {WORKBENCH_ALL.map((t) => item(t, "workbench", onWb))}
      <div className="gg-nav-spacer" />
      <div className="gg-sidebar-divider" />
      <div className="gg-nav-label" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", padding: "2px 12px 6px", letterSpacing: "0.04em" }}>
        专业能力
      </div>
      {LEGACY_SIDEBAR_KEYS.map((k) => item(LEGACY_BY_KEY[k], "legacy", onLegacy))}
      {/* Compatibility entries kept reachable but out of the visual flow:
          the E2E drives data-gg-nav="search" / "smart" directly. */}
      <div style={{ display: "none" }}>
        {["search", "smart"].map((k) => item(LEGACY_BY_KEY[k], "legacy", onLegacy))}
      </div>
    </nav>
  );
}

function WorkbenchTabBar({ active, onChange, syncedCount }) {
  return (
    <div data-gg-region="tabbar" style={{
      flex: "none", display: "flex", padding: "8px 12px 22px",
      background: "color-mix(in oklch, var(--surface-card) 88%, transparent)",
      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      borderTop: "1px solid var(--border-subtle)",
    }}>
      {MOBILE_TABS.map((t) => {
        const on = t.key === active;
        const badge = t.key === "weekend" && syncedCount > 0;
        return (
          <button key={t.key}
            data-workbench-nav={t.workbench ? t.key : undefined}
            data-gg-nav={t.legacy ? t.key : undefined}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1, border: "none", background: "transparent", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              color: on ? "var(--brand)" : "var(--text-faint)",
            }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon name={t.icon} style={{ width: 24, height: 24 }} />
              {badge && (
                <span style={{
                  position: "absolute", top: -6, right: -10, minWidth: 16, height: 16,
                  padding: "0 4px", borderRadius: "var(--radius-pill)", background: "var(--accent)",
                  color: "#06241B", fontSize: 10.5, fontWeight: 700, display: "inline-flex",
                  alignItems: "center", justifyContent: "center",
                }}>{syncedCount}</span>
              )}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, fontFamily: "var(--font-sans)" }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Mobile drawer: exposes the remaining Workbench + legacy tabs. */
function MoreDrawer({ open, onClose, active, onPick, syncedCount }) {
  if (!open) return null;
  const rows = MOBILE_MORE_TABS;
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
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-faint)", padding: "2px 8px 10px" }}>
          更多入口
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {rows.map((t) => {
            const on = t.key === active;
            return (
              <button key={t.key}
                data-workbench-nav={t.workbench ? t.key : undefined}
                data-gg-nav={t.legacy ? t.key : undefined}
                onClick={() => onPick(t.key)}
                style={{
                  border: "1px solid var(--border-subtle)", background: on ? "var(--brand-soft)" : "var(--bg-sunken)",
                  color: on ? "var(--brand)" : "var(--text-body)", borderRadius: "var(--radius-md)",
                  padding: "12px 6px", cursor: "pointer", display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 6, fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600,
                  position: "relative",
                }}>
                <Icon name={t.icon} style={{ width: 20, height: 20 }} />
                {t.label}
                {t.key === "weekend" && syncedCount > 0 && (
                  <span style={{
                    position: "absolute", top: 6, right: 8, minWidth: 15, height: 15,
                    borderRadius: "var(--radius-pill)", background: "var(--accent)", color: "#06241B",
                    fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center",
                    justifyContent: "center", padding: "0 3px",
                  }}>{syncedCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ position: "absolute", top: "var(--gg-toast-top)", left: "50%", transform: "translateX(-50%)", zIndex: 50,
      background: "var(--ink)", color: "#fff", padding: "11px 18px", borderRadius: "var(--radius-pill)",
      display: "flex", alignItems: "center", gap: 9, boxShadow: "var(--shadow-lg)", animation: "gg-toast-in var(--dur-base) var(--ease-out)", whiteSpace: "nowrap" }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="check" style={{ width: 14, height: 14, color: "#06241B" }} />
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{msg}</span>
    </div>
  );
}

const ALL_ACTIVITIES = GORGON_DATA.activities || [];

/** Anything (raw record, id, or an already-normalised view) -> view model. */
function asView(x) {
  if (!x) return null;
  if (typeof x === "string") {
    const found = ALL_ACTIVITIES.find((a) => a.id === x);
    return found ? ActivityView.toView(found) : null;
  }
  if (x.__view) return x;
  return ActivityView.toView(x);
}

export default function App() {
  // §17: default boot = Workbench home; /?legacy=1 preserves the Phase-1
  // boot (discover) for legacy tests and explicit legacy entry.
  const [tab, setTab] = React.useState(LEGACY_MODE ? "discover" : null);
  // Workbench layer: tracks which Workbench entry is highlighted. The
  // effective screen is resolved from (tab, wbTab) — see the registry below.
  const [wbTab, setWbTab] = React.useState(LEGACY_MODE ? null : "home");
  const [moreOpen, setMoreOpen] = React.useState(false);
  // Task Detail overlay key: the id of the task being inspected (null = none).
  const [detailTaskId, setDetailTaskId] = React.useState(null);
  // My Weekend persists FULL snapshots (id -> view), so a saved search result
  // survives a refresh even when the search session is gone.
  const [weekend, setWeekend] = React.useState(() => Store.getWeekendItems());
  const [favorites, setFavorites] = React.useState(() => Store.getFavorites());
  const [detail, setDetail] = React.useState(null);
  const [mapFocus, setMapFocus] = React.useState(null);
  // ONE district selection for the whole app (Discover / Search / Map / 智能),
  // restored from localStorage so a refresh keeps the user's choice.
  const [district, setDistrictState] = React.useState(() => Store.getDistrict());
  const [toast, setToast] = React.useState("");
  const toastTimer = React.useRef(null);

  // Phase 2 Workbench state. Tasks live in the formal engine (v2 schema);
  // reading via the facade auto-migrates Phase-1 data on first call.
  const [wbTasks, setWbTasks] = React.useState(() => WBStore.getTasks());
  const [wbReview, setWbReview] = React.useState(() => WBStore.ensureReviewSeed());
  const [wbLog, setWbLog] = React.useState(() => WBStore.getLog());
  // Phase 6: REAL proposals backing the Review Center.
  const [wbProposals, setWbProposals] = React.useState(() => WBStore.getProposals());

  // ── Phase 4 (P0-A/B/C): projects, notes and the minimal review ────────
  // The project list is React state so the sidebar/tab surfaces re-render on
  // every mutation; the detail bundle is read through the facade on demand so
  // tasks/notes/places always come from the real repositories (cold restart
  // safe). A "revision" counter forces the bundle to be recomputed after any
  // write that does not change the projects array itself (notes, review).
  const [wbProjects, setWbProjects] = React.useState(() => WBStore.getProjects());
  const [detailProjectId, setDetailProjectId] = React.useState(null);
  const [projectRev, setProjectRev] = React.useState(0);
  // Which existing project an activity should be linked to (picker state).
  const [projectPickerFor, setProjectPickerFor] = React.useState(null);
  // Module D UI (places): React state so the list re-renders on mutation;
  // persistence lives in the opportunities repository via the facade.
  const [wbPlaces, setWbPlaces] = React.useState(() => WBStore.getPlaces());
  // V2.3 Phase 3: notes list for the place-notes panels (all notes; screens
  // filter by placeId). Persistence stays in the opportunities repository.
  const [wbNotes, setWbNotes] = React.useState(() => WBStore.getNotes());
  // V2.3 Phase 5: user-created activities (the honest real data source).
  const [wbUserActs, setWbUserActs] = React.useState(() => WBStore.getUserActivities());

  const { isMobile } = useResponsive();

  const setDistrict = (d) => {
    setDistrictState(Store.setDistrict(d));
  };

  const flash = (m) => {
    setToast(m); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  };

  /** Create a REAL task (§16): goal = full text, title auto-derived. */
  const createTaskFromGoal = (goal) => {
    const text = String(goal || "").trim();
    if (!text) return null;
    setWbTasks(WBStore.addTask(text));
    setWbLog(WBStore.getLog());
    const created = WBStore.getTasks()[0] || null;
    return created;
  };

  const addTaskLocal = (title, opts) => {
    setWbTasks(WBStore.addTask(title, opts));
    setWbLog(WBStore.getLog());
  };

  /** Status changes go through the State Machine only; illegal = no-op. */
  const changeTaskStatus = (id, status) => {
    setWbTasks(WBStore.setTaskStatus(id, status));
    setWbLog(WBStore.getLog());
  };

  /** Throwing variant for detail controls (they pre-check legality). */
  const transitionTask = (id, status) => {
    try {
      setWbTasks(WBStore.transitionTask(id, status));
      setWbLog(WBStore.getLog());
    } catch (e) {
      flash("非法状态流转，已阻止");
    }
  };

  /** Phase 3: run a task through the deterministic Router + Skills engine. */
  const runTaskEngine = async (id, opts) => {
    const out = await WBStore.runTask(id, opts || {});
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    return out;
  };

  const openTaskDetail = (id) => {
    setDetail(null);
    setWbTab("tasks");
    setDetailTaskId(id);
  };

  const decideReview = (id, decision) => {
    setWbReview(WBStore.decideReviewCard(id, decision));
    setWbLog(WBStore.getLog());
  };

  const decideProposal = (id, decision) => {
    setWbProposals(WBStore.decideProposal(id, decision) ? WBStore.getProposals() : WBStore.getProposals());
    // An approved follow-up proposal really creates a task — refresh the list.
    setWbTasks(WBStore.getTasks());
  };

  const resumeReviewTask = (id) => {
    transitionTask(id, "running");
    flash("任务已恢复执行");
  };

  // ── Phase 4 (P0-A/B/C): project + note + review handlers ───────────
  // Every mutation goes through the workbench-store facade (real engine /
  // real repositories), then refreshes the React state that feeds the
  // surfaces. Nothing here writes localStorage directly, and nothing marks
  // an AI suggestion as done.

  /** Re-read the project list and force bundle re-computation. */
  const refreshProjects = () => {
    setWbProjects(WBStore.getProjects());
    setProjectRev((r) => r + 1);
  };

  const handleCreateProject = ({ title, goal }) => {
    const p = WBStore.createProject({ title, goal, origin: WBStore.PROJECT_ORIGIN.MANUAL });
    if (!p) return;
    refreshProjects();
    setWbLog(WBStore.getLog());
    setDetailProjectId(p.id);
    flash("项目已创建");
  };

  const handleCreateProjectFromActivity = (view, opts) => {
    const p = WBStore.createProjectFromActivity(view, opts || {});
    if (!p) return;
    refreshProjects();
    setWbLog(WBStore.getLog());
    flash("已从活动创建项目");
    return p;
  };

  const handleLinkActivityToProject = (projectId, view) => {
    const p = WBStore.linkActivityToProject(projectId, view);
    if (!p) return;
    refreshProjects();
    setWbLog(WBStore.getLog());
    flash("活动已关联到项目");
  };

  const openProjectDetail = (id) => {
    setDetail(null);
    setDetailTaskId(null);
    setWbTab("projects");
    setTab(null);
    setDetailProjectId(id);
  };

  const addProjectTask = (title, projectId) => {
    setWbTasks(WBStore.addTask(title, { source: "项目内创建", projectId }));
    setWbLog(WBStore.getLog());
    setProjectRev((r) => r + 1);
  };

  const addProjectNote = (text, projectId) => {
    const t = String(text || "").trim();
    if (!t) return;
    WBStore.addNote({ kind: "text", text: t, projectId });
    setWbLog(WBStore.getLog());
    setProjectRev((r) => r + 1);
  };

  const updateProjectNote = (id, text) => {
    const t = String(text || "").trim();
    if (!t) return;
    WBStore.updateNote(id, { text: t });
    setProjectRev((r) => r + 1);
  };

  const removeProjectNote = (id) => {
    WBStore.removeNote(id);
    setProjectRev((r) => r + 1);
  };

  // ── V2.2 Stage 2: unified progress handlers ────────────────────────
  const addProjectProgress = (projectId, text, kind) => {
    const t = String(text || "").trim();
    if (!t) return;
    WBStore.addProgress({
      subjectType: "project", subjectId: projectId,
      subjectTitle: (WBStore.getProject(projectId) || {}).title || "",
      kind: kind || "note", text: t,
    });
    setWbLog(WBStore.getLog());
    setProjectRev((r) => r + 1);
    flash("进度已记录");
  };

  const removeProjectProgress = (id) => {
    WBStore.removeProgress(id);
    setProjectRev((r) => r + 1);
  };

  const saveProjectReview = (projectId, patch) => {
    const r = WBStore.setProjectReview(projectId, patch);
    if (r) {
      setWbLog(WBStore.getLog());
      setProjectRev((rev) => rev + 1);
      flash("复盘已保存");
    }
  };

  const archiveProjectAndExit = (id) => {
    const p = WBStore.archiveProject(id);
    if (!p) return;
    refreshProjects();
    setWbLog(WBStore.getLog());
    setDetailProjectId(null);
    flash("项目已归档（数据保留）");
  };

  // ── Module D UI (places): field-visit handlers ─────────────────────
  // Every mutation goes through the workbench-store facade (real
  // repository), then refreshes the React state feeding the screen.

  const refreshPlaces = () => {
    setWbPlaces(WBStore.getPlaces());
    setProjectRev((r) => r + 1); // project detail's places section re-reads
  };

  const handleCreatePlace = ({ name, address, projectId }) => {
    const p = WBStore.upsertPlace({ name, address, projectId });
    if (!p) return;
    refreshPlaces();
    setWbLog(WBStore.getLog());
    flash("走访地点已添加");
  };

  const handlePlaceStatus = (id, status) => {
    const p = WBStore.setPlaceStatus(id, status);
    if (!p) { flash("非法状态，已阻止"); return; }
    refreshPlaces();
    setWbLog(WBStore.getLog());
    flash(`已标记为${{ todo: "待走访", visited: "已走访", revisit: "需复访", unsuitable: "不适合" }[status] || status}`);
  };

  const handlePlaceVisit = (id, visit) => {
    const p = WBStore.addPlaceVisit(id, visit);
    if (!p) return;
    refreshPlaces();
    setWbLog(WBStore.getLog());
    flash("到访已记录");
  };

  const handleRemovePlace = (id) => {
    const ok = WBStore.removePlace(id);
    if (!ok) return;
    refreshPlaces();
    setWbLog(WBStore.getLog());
    flash("走访地点已删除");
  };

  // ── Phase 3 (地点管理): edit + place notes handlers ──────────────────
  const handleEditPlace = (id, patch) => {
    const p = WBStore.upsertPlace({ id, ...patch });
    if (!p) return;
    refreshPlaces();
    setWbLog(WBStore.getLog());
    flash("走访地点已更新");
  };

  const handleAddPlaceNote = (placeId, text) => {
    const n = WBStore.addNote({ text, placeId, kind: "text" });
    if (!n) return;
    setWbPlaces(WBStore.getPlaces());
    setWbNotes(WBStore.getNotes());
    setWbLog(WBStore.getLog());
    flash("地点笔记已保存");
  };

  const handleRemovePlaceNote = (noteId) => {
    const ok = WBStore.removeNote(noteId);
    if (!ok) return;
    setWbNotes(WBStore.getNotes());
    setWbLog(WBStore.getLog());
    flash("笔记已删除");
  };

  // ── V2.3 Phase 5 (真实活动源): user-created activities handlers ──────
  const refreshUserActs = () => {
    setWbUserActs(WBStore.getUserActivities());
    setWbLog(WBStore.getLog());
  };

  const handleCreateUserAct = (input) => {
    const a = WBStore.addUserActivity(input);
    if (!a) return;
    refreshUserActs();
    flash("自建活动已创建");
  };

  const handleRemoveUserAct = (id) => {
    const ok = WBStore.removeUserActivity(id);
    if (!ok) return;
    refreshUserActs();
    flash("自建活动已删除");
  };

  // 自建活动 → 我的周末（与搜索结果同一条 weekend 流）
  const handleSyncUserAct = (a) => {
    toggleSync(a);
  };

  // 自建活动 → 创建项目（origin=activity，REAL 快照链接）
  const handleCreateProjectFromUserAct = (a) => {
    const view = asView(a);
    if (!view) return;
    const p = WBStore.createProjectFromActivity(view);
    if (!p) return;
    setWbProjects(WBStore.getProjects());
    setWbLog(WBStore.getLog());
    flash("已从活动创建项目");
  };

  // ── Module C UI (registrations): honest tracking + ICS handlers ────
  // Opening the official page records「已打开报名页」— NEVER 已报名;
  // REGISTERED is only an explicit user confirm through the status buttons.

  const handleMarkRegistrationOpened = (activityId, sourceUrl) => {
    WBStore.markRegistrationOpened(activityId, sourceUrl);
    setWbLog(WBStore.getLog());
  };

  const handleRegStatus = (activityId, status) => {
    const r = WBStore.setRegistrationStatus(activityId, status);
    if (!r) { flash("非法状态，已阻止"); return; }
    setWbLog(WBStore.getLog());
    flash(status === "registered" ? "已确认报名" : "报名状态已更新");
  };

  const handleExportICS = (activityId, view) => WBStore.exportICS(activityId, view);

  /** Module C UI: prep checklist — seed (null) / add (text) / toggle (id+done). */
  const handlePrepAdd = (activityId, text) => {
    const view = asView(activityId);
    const seed = text === null
      ? WBStore.defaultPrepFor(view)
      : null;
    const items = seed || (() => {
      const r = WBStore.getRegistration(activityId);
      const cur = (r && r.prep) || [];
      return cur.concat([{ title: text, done: false }]);
    })();
    const r = WBStore.setPrep(activityId, items);
    if (r) { setWbLog(WBStore.getLog()); setProjectRev((rev) => rev + 1); }
  };

  const handlePrepToggle = (activityId, prepId, done) => {
    const r = WBStore.getRegistration(activityId);
    if (!r) return;
    const cur = (r.prep || []);
    const items = cur.map((p) => (p.id === prepId ? Object.assign({}, p, { done }) : p));
    const out = WBStore.setPrep(activityId, items);
    if (out) { setWbLog(WBStore.getLog()); setProjectRev((rev) => rev + 1); }
  };

  /** Task status change that also refreshes project surfaces. */
  const changeTaskStatusEverywhere = (id, status) => {
    changeTaskStatus(id, status);
    setProjectRev((r) => r + 1);
  };

  /** P0-C: note attached to a task (inherits the task's project link). */
  const addTaskNote = (text, task) => {
    const t = String(text || "").trim();
    if (!t || !task) return;
    WBStore.addNote({ kind: "text", text: t, taskId: task.id, projectId: task.projectId || null });
    setWbLog(WBStore.getLog());
    setWbTasks(WBStore.getTasks()); // refresh the timeline (note_linked event)
    setProjectRev((r) => r + 1);
  };

  /** P0-B: schedule editor → setTaskSchedule (invalid input is refused). */
  const handleSetSchedule = (id, patch) => {
    const out = WBStore.setTaskSchedule(id, patch);
    if (!out) { flash("日期无效，未保存"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    setProjectRev((r) => r + 1);
    flash("排期已保存");
  };

  /** P0-B: plan suggestions → editable pending todos (never auto-completed). */
  const handleSavePlanTodos = (taskId, steps) => {
    const out = WBStore.savePlanStepsAsTodos(taskId, steps);
    if (!out) return;
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    setProjectRev((r) => r + 1);
  };

  /** P0-A: task ↔ project link from the task detail. */
  const handleLinkTaskToProject = (taskId, projectId) => {
    const out = WBStore.linkTaskToProject(taskId, projectId);
    if (!out) { flash("项目不存在，未关联"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    setProjectRev((r) => r + 1);
    flash(projectId ? "已关联项目" : "已移出项目");
  };

  /** V2.3 (Phase 1): task priority from the task detail (invalid refused). */
  const handleSetPriority = (taskId, priority) => {
    const out = WBStore.setTaskPriority(taskId, priority);
    if (!out) { flash("优先级无效，未保存"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    flash("优先级已更新");
  };

  /** V2.3 (Phase 1): task title edit (empty refused). */
  const handleSetTitle = (taskId, title) => {
    const out = WBStore.setTaskTitle(taskId, title);
    if (!out) { flash("标题不能为空"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    flash("标题已更新");
  };

  /** V2.3 (Phase 1): task ↔ place link (unknown place refused). */
  const handleLinkTaskToPlace = (taskId, placeId) => {
    const out = WBStore.linkTaskToPlace(taskId, placeId);
    if (!out) { flash("地点不存在，未关联"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    flash(placeId ? "已关联地点" : "已移除地点关联");
  };

  // --- My Weekend (persisted, snapshot-carrying) ---
  const toggleSync = (input) => {
    const view = asView(input);
    if (!view || !view.id) return;
    const on = !weekend[view.id];
    const next = Object.assign({}, weekend);
    if (on) next[view.id] = view; else delete next[view.id];
    setWeekend(next);
    Store.setWeekendItems(next);
    flash(on ? "已加入我的周末" : "已从我的周末移除");
  };

  // --- Favorites (persisted) ---
  const toggleFavorite = (id) => {
    const has = favorites.indexOf(id) >= 0;
    const next = has ? favorites.filter((x) => x !== id) : favorites.concat([id]);
    setFavorites(next);
    Store.setFavorites(next);
    flash(has ? "已取消收藏" : "已收藏");
  };

  const openDetail = (x) => { const v = asView(x); if (v) { setProjectPickerFor(null); setDetail(v); } };
  const showOnMap = (v) => { setMapFocus(v.id); setDetail(null); setDetailTaskId(null); setDetailProjectId(null); setTab("map"); setWbTab(null); };
  const changeTab = (t) => { setDetail(null); setDetailTaskId(null); setDetailProjectId(null); setTab(t); setWbTab(null); setMoreOpen(false); };
  const changeWbTab = (t) => {
    setDetail(null); setDetailTaskId(null); setMoreOpen(false);
    if (t !== "projects") setDetailProjectId(null);
    const legacy = WORKBENCH_TO_LEGACY[t];
    if (legacy) { setTab(legacy); setWbTab(t); return; }
    setTab(null); setWbTab(t);
  };
  const pickMobileTab = (t) => {
    setMoreOpen(false);
    if (t === "more") { setMoreOpen(true); return; }
    if (WB_BY_KEY[t] && !LEGACY_BY_KEY[t]) { changeWbTab(t); return; }
    changeTab(t);
  };

  const syncedCount = Object.keys(weekend).length;

  // ── Screen registry ──────────────────────────────────────────────
  // Legacy tabs keep rendering exactly what they always did (the E2E
  // contract). Workbench tabs render the Phase-2 shell screens; 智能搜索
  // maps onto the existing NaturalSearchScreen with a Workbench heading.
  const detailTask = detailTaskId ? wbTasks.find((t) => t.id === detailTaskId) : null;

  // ── Phase 4: project surfaces ─────────────────────────────────────
  // The bundle is read through the facade every render so it always reflects
  // the real repositories (tasks / notes / places / review). projectRev is in
  // the dependency path implicitly: any bump re-renders App and re-reads it.
  const projectBundle = detailProjectId ? WBStore.getProjectBundle(detailProjectId) : null;
  void projectRev;
  // Per-project counts for the list view AND the home summary (P0-D).
  const projectStats = {};
  for (const p of wbProjects) {
    const ts = wbTasks.filter((t) => t.projectId === p.id);
    projectStats[p.id] = {
      tasks: ts.length,
      openTasks: ts.filter((t) => t.status !== "completed" && t.status !== "failed").length,
      notes: WBStore.getNotes({ projectId: p.id }).length,
    };
  }
  // P0-D home data: today's tasks (scheduled/due today) + open count + recent notes.
  const homeToday = WBStore.getTodayTasks();
  const homeOpenCount = WBStore.getOpenTasks().length;
  const homeRecentNotes = WBStore.getNotes({ kind: "text" }).slice(0, 4);
  // V2.2 (Stage 4): progress center data — cross-project plain-language summary.
  const progressCenterData = WBStore.getProgressCenterData();

  const workbenchScreens = {
    home: (
      <WorkbenchHome tasks={wbTasks}
        onCreateTask={createTaskFromGoal}
        onGoSearch={() => changeWbTab("search")} onGoTasks={() => changeWbTab("tasks")}
        onGoSchedule={() => changeWbTab("schedule")}
        onOpenTask={openTaskDetail}
        todayTasks={homeToday}
        openTaskCount={homeOpenCount}
        projects={wbProjects}
        projectStats={projectStats}
        recentNotes={homeRecentNotes}
        onOpenProject={openProjectDetail}
        onGoProjects={() => changeWbTab("projects")} />
    ),
    projects: projectBundle ? (
      <ProjectDetailScreen
        bundle={projectBundle}
        onBack={() => setDetailProjectId(null)}
        onOpenTask={openTaskDetail}
        onTaskStatus={changeTaskStatusEverywhere}
        onAddTask={addProjectTask}
        onAddNote={addProjectNote}
        onUpdateNote={updateProjectNote}
        onRemoveNote={removeProjectNote}
        onSaveReview={saveProjectReview}
        onArchiveProject={archiveProjectAndExit}
        onPlaceVisit={handlePlaceVisit}
        onPrepToggle={handlePrepToggle}
        onPrepAdd={handlePrepAdd}
        onRegStatus={handleRegStatus}
        onAddProgress={addProjectProgress}
        onRemoveProgress={removeProjectProgress}
      />
    ) : (
      <ProjectsScreen
        projects={wbProjects}
        stats={projectStats}
        onCreateProject={handleCreateProject}
        onOpenProject={openProjectDetail}
      />
    ),
    tasks: (
      detailTask ? (
        <TaskDetailScreen task={detailTask}
          onTransition={(to) => transitionTask(detailTask.id, to)}
          onBack={() => setDetailTaskId(null)}
          onAddStep={(title) => { setWbTasks(WBStore.addTaskStep(detailTask.id, { title })); }}
          onUpdateStep={(stepId, patch) => { setWbTasks(WBStore.updateTaskStep(detailTask.id, stepId, patch)); }}
          onSetResult={(r) => { setWbTasks(WBStore.setTaskResult(detailTask.id, r)); }}
          onAddSource={(s) => { setWbTasks(WBStore.addTaskSource(detailTask.id, s)); }}
          onRun={runTaskEngine}
          onSetSchedule={handleSetSchedule}
          onSavePlanTodos={handleSavePlanTodos}
          onLinkProject={handleLinkTaskToProject}
          onSetPriority={handleSetPriority}
          onSetTitle={handleSetTitle}
          onLinkPlace={handleLinkTaskToPlace}
          places={wbPlaces}
          onConflicts={wbTasks}
          projects={wbProjects}
          notes={detailTask ? WBStore.getNotes({ taskId: detailTask.id }) : []}
          onAddNote={addTaskNote} />
      ) : (
        <TasksScreen tasks={wbTasks} onStatusChange={changeTaskStatus}
          onAddTask={(t) => addTaskLocal(t, { source: "任务页输入" })}
          onOpenTask={openTaskDetail} />
      )
    ),
    review: (
      <ReviewCenterScreen cards={wbReview} onDecide={decideReview}
        reviewTasks={wbTasks} onResumeTask={resumeReviewTask}
        proposals={wbProposals} onProposal={decideProposal} />
    ),
    places: (
      <PlacesScreen places={wbPlaces} projects={wbProjects} tasks={wbTasks} notes={wbNotes}
        onCreate={handleCreatePlace} onStatus={handlePlaceStatus}
        onVisit={handlePlaceVisit} onRemove={handleRemovePlace}
        onEditPlace={handleEditPlace} onAddPlaceNote={handleAddPlaceNote}
        onRemovePlaceNote={handleRemovePlaceNote} />
    ),
    schedule: (
      <ScheduleScreen tasks={wbTasks} onOpenTask={openTaskDetail} />
    ),
    notes: (
      <NotesScreen notes={wbNotes} tasks={wbTasks} places={wbPlaces} projects={wbProjects}
        onRemoveNote={handleRemovePlaceNote} onOpenTask={openTaskDetail} flash={flash} />
    ),
    useract: (
      <UserActivitiesScreen activities={wbUserActs} weekend={weekend} projects={wbProjects}
        onCreate={handleCreateUserAct} onRemove={handleRemoveUserAct}
        onSync={handleSyncUserAct} onCreateProject={handleCreateProjectFromUserAct} />
    ),
    progress: (
      <ProgressCenterScreen data={progressCenterData} onOpenProject={openProjectDetail} />
    ),
    history: (
      <HistoryScreen tasks={wbTasks} log={wbLog} onOpenTask={openTaskDetail} />
    ),
    settings: <SettingsScreen />,
  };

  const content = (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      {tab === "discover" && <DiscoverScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} onGoSearch={() => setTab("search")} onGoSmart={() => setTab("smart")} district={district} onDistrictChange={setDistrict} />}
      {tab === "smart" && <NaturalSearchScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} district={district} onDistrictChange={setDistrict} />}
      {tab === "search" && <SearchScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} district={district} onDistrictChange={setDistrict} />}
      {tab === "weekend" && <MyWeekendScreen weekend={weekend} onSync={toggleSync} onOpen={openDetail} onDiscover={() => setTab("discover")} favorites={favorites} onToggleFavorite={toggleFavorite} />}
      {tab === "map" && <MapScreen synced={weekend} onSync={toggleSync} onOpen={openDetail} focusId={mapFocus} district={district} onDistrictChange={setDistrict} />}

      {wbTab && workbenchScreens[wbTab]}

      {detail && (
        <div className="gg-detail-overlay" style={{ animation: "gg-detail-in var(--dur-base) var(--ease-out)" }}>
          <ActivityDetailScreen view={detail} synced={!!weekend[detail.id]} onSync={() => toggleSync(detail)}
            onBack={() => setDetail(null)} onShowMap={() => showOnMap(detail)}
            projects={wbProjects}
            linkedProject={WBStore.findProjectByActivity(detail.id)}
            registration={WBStore.getRegistration(detail.id)}
            onMarkOpened={handleMarkRegistrationOpened}
            onRegStatus={handleRegStatus}
            onExportICS={handleExportICS}
            onCreateProjectFromActivity={(opts) => {
              const p = handleCreateProjectFromActivity(detail, opts);
              if (p) { setDetail(null); openProjectDetail(p.id); }
            }}
            onLinkActivityToProject={(projectId) => {
              handleLinkActivityToProject(projectId, detail);
              setProjectPickerFor(null);
            }}
            onOpenProject={(id) => { setDetail(null); openProjectDetail(id); }}
            pickerOpen={projectPickerFor === detail.id}
            onTogglePicker={() => setProjectPickerFor(projectPickerFor === detail.id ? null : detail.id)}
            onClosePicker={() => setProjectPickerFor(null)} />
        </div>
      )}
      <Toast msg={toast} />
    </div>
  );

  if (isMobile) {
    return (
      <PhoneFrame>
        <StatusBar dark={false} />
        {content}
        <WorkbenchTabBar active={wbTab || (moreOpen ? "more" : tab)} syncedCount={syncedCount}
          onChange={pickMobileTab} />
        <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} active={wbTab || tab}
          onPick={pickMobileTab} syncedCount={syncedCount} />
      </PhoneFrame>
    );
  }

  return (
    <div className="gg-app" data-gg-shell="wide" data-gg-shell-nav="workbench">
      <DesktopHeader district={district} onWorkbenchHome={() => changeWbTab("home")} />
      <div className="gg-body">
        <WorkbenchSidebar
          active={wbTab || tab}
          onWb={changeWbTab}
          onLegacy={changeTab}
          syncedCount={syncedCount}
        />
        <div className="gg-main">
          <div className="gg-frame">
            <div className="gg-container">{content}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
