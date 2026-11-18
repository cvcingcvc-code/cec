// Gorgon Lite — root application orchestrator.
//
// Primary daily loop (eagerly loaded, zero suspense delay):
//   1. WorkbenchHome    ("首页"   — 一句话建任务、今日任务、最近执行与复盘)
//   2. TasksScreen / TaskDetailScreen ("任务" — 7态状态机、排期/提醒、步骤、笔记与项目关联)
//   3. AgentScreen      ("智能体" — 受控只读执行、离线记录镜像、人工审批、写回任务)
//
// Secondary user-data views (Schedule / Notes / Projects / History / Review / Settings)
// and frozen/archived modules (Discover / Search / NaturalSearch / MyWeekend / Map /
// Places / UserActivities / ProgressCenter) are lazy-loaded on demand so the main
// Gorgon Lite bundle stays compact while keeping 100% of user data reachable.

import React from "react";
import { StatusBar, PhoneFrame, DesktopHeader } from "./components/AppShell.jsx";
import { WorkbenchHome } from "./screens/WorkbenchHome.jsx";
import { TasksScreen } from "./screens/TasksScreen.jsx";
import { TaskDetailScreen } from "./screens/TaskDetailScreen.jsx";
import { AgentScreen } from "./screens/AgentScreen.jsx";
import {
  LiteMobileHeader, WorkbenchSidebar, WorkbenchTabBar, MoreDrawer, Toast,
} from "./components/LiteChrome.jsx";
import { useResponsive } from "./lib/useResponsive.js";
import * as WBStore from "./store/workbench-store.js";
import {
  WORKBENCH_SETTINGS, LEGACY_TABS, WORKBENCH_TO_LEGACY,
  CLASSIC_WORKBENCH_TABS, getNavMode, setNavMode,
} from "./workbench/navigation.js";
import { isImportableFileName, parseNoteText, MAX_IMPORT_BYTES } from "./lib/note-import.js";
import { readAgentRunsMirror } from "./lib/agent-runs-mirror.js";
import * as NativeReminders from "./lib/native-reminders.js";
import {
  pickDueReminders, firedKey, NOTIFIED_STORE_KEY, REMINDER_POLL_MS,
} from "./workbench/reminder-fire.js";
import { useArchivedState } from "./hooks/useArchivedState.js";

/* ── Lazy-loaded secondary & archived screens (on-demand chunks) ───── */
const ScheduleScreen = React.lazy(() => import("./screens/ScheduleScreen.jsx").then((m) => ({ default: m.ScheduleScreen })));
const NotesScreen = React.lazy(() => import("./screens/NotesScreen.jsx").then((m) => ({ default: m.NotesScreen })));
const ProjectsScreen = React.lazy(() => import("./screens/ProjectsScreen.jsx").then((m) => ({ default: m.ProjectsScreen })));
const ProjectDetailScreen = React.lazy(() => import("./screens/ProjectDetailScreen.jsx").then((m) => ({ default: m.ProjectDetailScreen })));
const HistoryScreen = React.lazy(() => import("./screens/HistoryScreen.jsx").then((m) => ({ default: m.HistoryScreen })));
const ReviewCenterScreen = React.lazy(() => import("./screens/ReviewCenterScreen.jsx").then((m) => ({ default: m.ReviewCenterScreen })));
const SettingsScreen = React.lazy(() => import("./screens/SettingsScreen.jsx").then((m) => ({ default: m.SettingsScreen })));

const DiscoverScreen = React.lazy(() => import("./screens/DiscoverScreen.jsx").then((m) => ({ default: m.DiscoverScreen })));
const ActivityDetailScreen = React.lazy(() => import("./screens/ActivityDetailScreen.jsx").then((m) => ({ default: m.ActivityDetailScreen })));
const SearchScreen = React.lazy(() => import("./screens/SearchScreen.jsx").then((m) => ({ default: m.SearchScreen })));
const NaturalSearchScreen = React.lazy(() => import("./screens/NaturalSearchScreen.jsx").then((m) => ({ default: m.NaturalSearchScreen })));
const MyWeekendScreen = React.lazy(() => import("./screens/MyWeekendScreen.jsx").then((m) => ({ default: m.MyWeekendScreen })));
const MapScreen = React.lazy(() => import("./screens/MapScreen.jsx").then((m) => ({ default: m.MapScreen })));
const PlacesScreen = React.lazy(() => import("./screens/PlacesScreen.jsx").then((m) => ({ default: m.PlacesScreen })));
const UserActivitiesScreen = React.lazy(() => import("./screens/UserActivitiesScreen.jsx").then((m) => ({ default: m.UserActivitiesScreen })));
const ProgressCenterScreen = React.lazy(() => import("./screens/ProgressCenterScreen.jsx").then((m) => ({ default: m.ProgressCenterScreen })));

function isLegacyBoot() {
  try {
    return new URLSearchParams(window.location.search).get("legacy") === "1";
  } catch {
    return false;
  }
}
const LEGACY_MODE = typeof window !== "undefined" ? isLegacyBoot() : false;

function visualSkin() {
  try { return new URLSearchParams(window.location.search).get("skin") === "orbit" ? "orbit-dark" : "obsidian"; }
  catch { return "obsidian"; }
}
const V3K_SKIN = visualSkin();

const ALL_WB_ENTRIES = CLASSIC_WORKBENCH_TABS.concat([WORKBENCH_SETTINGS]);
const LEGACY_BY_KEY = LEGACY_TABS.reduce((m, t) => { m[t.key] = t; return m; }, {});
const WB_BY_KEY = ALL_WB_ENTRIES.reduce((m, t) => { m[t.key] = t; return m; }, {});

function hasPairedGatewayToken() {
  try { return Boolean(localStorage.getItem("gorgon_agent_gateway_token")); }
  catch { return false; }
}

const LAZY_FALLBACK = (
  <div style={{ flex: 1, padding: "28px 16px", fontSize: 13, color: "var(--text-faint)" }}>
    正在加载…
  </div>
);

export default function App() {
  const [tab, setTab] = React.useState(LEGACY_MODE ? "discover" : null);
  const [wbTab, setWbTab] = React.useState(LEGACY_MODE ? null : "home");
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [detailTaskId, setDetailTaskId] = React.useState(null);
  const [agentContextTaskId, setAgentContextTaskId] = React.useState(null);
  const [toast, setToast] = React.useState("");
  const toastTimer = React.useRef(null);

  const [wbTasks, setWbTasks] = React.useState(() => WBStore.getTasks());
  const [wbReview, setWbReview] = React.useState(() => WBStore.ensureReviewSeed());
  const [wbLog, setWbLog] = React.useState(() => WBStore.getLog());
  const [wbProposals, setWbProposals] = React.useState(() => WBStore.getProposals());
  const [wbProjects, setWbProjects] = React.useState(() => WBStore.getProjects());
  const [detailProjectId, setDetailProjectId] = React.useState(null);
  const [projectRev, setProjectRev] = React.useState(0);
  const [wbNotes, setWbNotes] = React.useState(() => WBStore.getNotes());
  const [navMode, setNavModeState] = React.useState(() => getNavMode());
  const [submittingGoal, setSubmittingGoal] = React.useState(false);

  const { isMobile } = useResponsive();

  const flash = (m) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  };

  const bumpProjectRev = () => setProjectRev((r) => r + 1);
  const refreshProjects = () => {
    setWbProjects(WBStore.getProjects());
    bumpProjectRev();
  };

  const openTaskDetail = (id) => {
    archived.setDetail(null);
    setWbTab("tasks");
    setTab(null);
    setDetailTaskId(id);
  };

  const archived = useArchivedState({
    flash,
    setWbTasks,
    setWbNotes,
    setWbLog,
    refreshProjects,
    bumpProjectRev,
    openTaskDetail,
  });

  /* ── In-app due reminder polling (web fallback + dedupe) ─────────── */
  React.useEffect(() => {
    let alive = true;
    const readNotified = () => {
      try {
        const v = JSON.parse(localStorage.getItem(NOTIFIED_STORE_KEY) || "[]");
        return Array.isArray(v) ? v : [];
      } catch { return []; }
    };
    const persistNotified = (keys) => {
      try { localStorage.setItem(NOTIFIED_STORE_KEY, JSON.stringify(keys.slice(-500))); }
      catch { /* private mode */ }
    };
    const tick = () => {
      if (!alive) return;
      try {
        const tasks = WBStore.getTasks();
        const notified = readNotified();
        const due = pickDueReminders(tasks, new Date().toISOString(), { notifiedIds: new Set(notified) });
        if (due.length > 0) {
          persistNotified(notified.concat(due.map((t) => firedKey(t.id, t.remindAt))));
          flash(`⏰ 提醒：${due[0].title}` + (due.length > 1 ? `（还有 ${due.length - 1} 条提醒到期）` : ""));
        }
      } catch { /* never crash */ }
    };
    const timer = setInterval(tick, REMINDER_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Core task & one-shot handlers ───────────────────────────────── */
  const createTaskFromGoal = (goal) => {
    const text = String(goal || "").trim();
    if (!text) return null;
    setWbTasks(WBStore.addTask(text));
    setWbLog(WBStore.getLog());
    return WBStore.getTasks()[0] || null;
  };

  const submitGoalOnce = async (goal) => {
    const text = String(goal || "").trim();
    if (!text || submittingGoal) return { ok: false, task: null, deduped: false, run: null, message: "请先写下你想完成的事" };
    setSubmittingGoal(true);
    try {
      const out = await WBStore.submitOneShotGoal(text);
      setWbTasks(WBStore.getTasks());
      setWbLog(WBStore.getLog());
      return out;
    } catch (e) {
      return { ok: false, task: null, deduped: false, run: null, code: "SUBMIT_THREW", message: String((e && e.message) || e) };
    } finally {
      setSubmittingGoal(false);
    }
  };

  const addTaskLocal = (title, opts) => {
    setWbTasks(WBStore.addTask(title, opts));
    setWbLog(WBStore.getLog());
  };

  const changeTaskStatus = (id, status) => {
    setWbTasks(WBStore.setTaskStatus(id, status));
    setWbLog(WBStore.getLog());
  };

  const transitionTask = (id, status) => {
    try {
      setWbTasks(WBStore.transitionTask(id, status));
      setWbLog(WBStore.getLog());
    } catch {
      flash("非法状态流转，已阻止");
    }
  };

  const runTaskEngine = async (id, opts) => {
    const out = await WBStore.runTask(id, opts || {});
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    return out;
  };

  const retryFailedSteps = async (id) => {
    const task = WBStore.getTask(id);
    const retryable = task && task.metadata && Array.isArray(task.metadata.retryableSkillIds)
      ? task.metadata.retryableSkillIds : [];
    if (!retryable.length) {
      flash("没有可重试的失败步骤");
      return { ok: false, code: "NOTHING_TO_RETRY" };
    }
    transitionTask(id, "ready");
    const out = await runTaskEngine(id, { skillIds: retryable, retryFailedOnly: true });
    if (out && out.ok) flash(out.failed ? "已重试失败步骤（部分仍未成功）" : "失败步骤已全部恢复完成");
    else flash((out && out.message) || "重试未成功");
    return out;
  };

  const handleSetSchedule = (id, patch) => {
    const out = WBStore.setTaskSchedule(id, patch);
    if (!out) { flash("日期无效，未保存"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    bumpProjectRev();
    flash("排期已保存");
  };

  const handleSavePlanTodos = (taskId, steps) => {
    const out = WBStore.savePlanStepsAsTodos(taskId, steps);
    if (!out) return;
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    bumpProjectRev();
  };

  const handleLinkTaskToProject = (taskId, projectId) => {
    const out = WBStore.linkTaskToProject(taskId, projectId);
    if (!out) { flash("项目不存在，未关联"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    bumpProjectRev();
    flash(projectId ? "已关联项目" : "已移出项目");
  };

  const handleSetPriority = (taskId, priority) => {
    const out = WBStore.setTaskPriority(taskId, priority);
    if (!out) { flash("优先级无效，未保存"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    flash("优先级已更新");
  };

  const handleSetTitle = (taskId, title) => {
    const out = WBStore.setTaskTitle(taskId, title);
    if (!out) { flash("标题不能为空"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    flash("标题已更新");
  };

  const handleSetReminder = async (taskId, { remindAt }) => {
    const out = WBStore.setTaskReminder(taskId, { remindAt });
    if (!out) { flash("提醒时间无效，未保存"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    bumpProjectRev();
    if (!remindAt) {
      const c = await NativeReminders.cancelReminder(taskId);
      flash(c.cancelled ? "提醒已清除" : "提醒已清除（无系统通知可取消）");
      return;
    }
    if (NativeReminders.hasLocalNotifications()) {
      const perm = await NativeReminders.checkPermission();
      if (perm.value !== "granted") {
        const req = await NativeReminders.requestPermission();
        if (req.value !== "granted") {
          flash("提醒已保存，但未获得通知授权（可在系统设置中开启）");
          return;
        }
      }
      const st = await NativeReminders.scheduleReminder(out);
      if (st.scheduled) flash("提醒已保存，系统通知已安排");
      else if (st.reason === "permission-denied") flash("提醒已保存，但未获得通知授权（可在系统设置中开启）");
      else if (st.reason === "past") flash("提醒已保存（时间已过，不再通知）");
      else flash("提醒已保存（当前环境仅应用内提示）");
    } else {
      flash("提醒已保存（当前环境仅应用内提示）");
    }
  };

  const handleLinkTaskToPlace = (taskId, placeId) => {
    const out = WBStore.linkTaskToPlace(taskId, placeId);
    if (!out) { flash("地点不存在，未关联"); return; }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    flash(placeId ? "已关联地点" : "已移除地点关联");
  };

  /* ── Notes, Projects & Approvals handlers ────────────────────────── */
  const addTaskNote = (text, task) => {
    const t = String(text || "").trim();
    if (!t || !task) return;
    WBStore.addNote({ kind: "text", text: t, taskId: task.id, projectId: task.projectId || null });
    setWbNotes(WBStore.getNotes());
    setWbLog(WBStore.getLog());
    setWbTasks(WBStore.getTasks());
    bumpProjectRev();
  };

  const handleCreateNote = (text, links) => {
    const t = String(text || "").trim();
    if (!t) return;
    const l = links || {};
    const n = WBStore.addNote({
      kind: "text", text: t,
      taskId: l.taskId || null, projectId: l.projectId || null, placeId: l.placeId || null,
    });
    if (!n) { flash("笔记创建失败"); return; }
    setWbNotes(WBStore.getNotes());
    setWbLog(WBStore.getLog());
    flash("笔记已保存");
  };

  const handleUpdateNote = (noteId, text) => {
    const t = String(text || "").trim();
    if (!t) return;
    const n = WBStore.updateNote(noteId, { text: t });
    if (!n) { flash("笔记保存失败（不存在）"); return; }
    setWbNotes(WBStore.getNotes());
    setWbLog(WBStore.getLog());
    flash("笔记已更新");
  };

  const handleRemoveNote = (noteId) => {
    if (!WBStore.removeNote(noteId)) return;
    setWbNotes(WBStore.getNotes());
    setWbLog(WBStore.getLog());
    flash("笔记已删除");
  };

  const handleImportNotes = async (file) => {
    if (!file) return;
    const fileName = file.name || "";
    if (!isImportableFileName(fileName)) { flash("仅支持 .txt / .md 文件"); return; }
    if (file.size > MAX_IMPORT_BYTES) { flash("文件过大（上限 2MB）"); return; }
    let rawText = "";
    try { rawText = await file.text(); }
    catch (e) { flash("读取文件失败：" + String((e && e.message) || e)); return; }
    const parsed = parseNoteText(fileName, rawText);
    if (!parsed || !parsed.ok) {
      const why = parsed && parsed.reason === "empty" ? "文件内容为空"
        : parsed && parsed.reason === "too-large" ? "文件过大（上限 2MB）" : "不支持的文件类型";
      flash("导入失败：" + why);
      return;
    }
    let added = 0;
    let failed = 0;
    for (const n of parsed.notes) {
      try { if (WBStore.addNote({ kind: "text", text: n.text, source: "导入" })) added += 1; else failed += 1; }
      catch { failed += 1; }
    }
    setWbNotes(WBStore.getNotes());
    setWbLog(WBStore.getLog());
    bumpProjectRev();
    if (added > 0 && failed === 0) flash(`已导入 ${added} 条笔记（未覆盖任何已有数据）`);
    else if (added > 0) flash(`已导入 ${added} 条，${failed} 条失败`);
    else flash("导入失败：没有任何笔记写入");
  };

  const handleCreateProject = ({ title, goal }) => {
    const p = WBStore.createProject({ title, goal, origin: WBStore.PROJECT_ORIGIN.MANUAL });
    if (!p) return;
    refreshProjects();
    setWbLog(WBStore.getLog());
    setDetailProjectId(p.id);
    flash("项目已创建");
  };

  const openProjectDetail = (id) => {
    archived.setDetail(null);
    setDetailTaskId(null);
    setWbTab("projects");
    setTab(null);
    setDetailProjectId(id);
  };

  const decideReview = (id, decision) => {
    setWbReview(WBStore.decideReviewCard(id, decision));
    setWbLog(WBStore.getLog());
  };

  const decideProposal = (id, decision) => {
    WBStore.decideProposal(id, decision);
    setWbProposals(WBStore.getProposals());
    setWbTasks(WBStore.getTasks());
  };

  const resumeReviewTask = (id) => {
    transitionTask(id, "running");
    flash("任务已恢复执行");
  };

  const handleChangeNavMode = (next) => {
    const saved = setNavMode(next);
    setNavModeState(saved);
    flash(saved === "classic" ? "已切换为旧版完整导航（数据不变）" : "已切换为 Gorgon Lite 三入口");
  };

  /* ── Navigation helpers ──────────────────────────────────────────── */
  const showOnMap = (v) => {
    archived.setMapFocus(v.id);
    archived.setDetail(null);
    setDetailTaskId(null);
    setDetailProjectId(null);
    setTab("map");
    setWbTab(null);
  };
  const changeTab = (t) => {
    archived.setDetail(null);
    setDetailTaskId(null);
    setDetailProjectId(null);
    setTab(t);
    setWbTab(null);
    setMoreOpen(false);
  };
  const changeWbTab = (t) => {
    archived.setDetail(null);
    setDetailTaskId(null);
    setMoreOpen(false);
    if (t !== "projects") setDetailProjectId(null);
    const legacy = WORKBENCH_TO_LEGACY[t];
    if (legacy) { setTab(legacy); setWbTab(t); return; }
    setTab(null);
    setWbTab(t);
  };
  const pickMobileTab = (t) => {
    setMoreOpen(false);
    if (t === "more") { setMoreOpen(true); return; }
    if (WB_BY_KEY[t] && !LEGACY_BY_KEY[t]) { changeWbTab(t); return; }
    changeTab(t);
  };

  /* ── Derived view state ──────────────────────────────────────────── */
  const detailTask = detailTaskId ? wbTasks.find((t) => t.id === detailTaskId) : null;
  const agentContextTask = agentContextTaskId ? wbTasks.find((t) => t.id === agentContextTaskId) : null;
  const detailAgentRuns = detailTask && detailTask.agentRunIds && detailTask.agentRunIds.length
    ? readAgentRunsMirror(detailTask.agentRunIds) : [];
  const projectBundle = detailProjectId ? WBStore.getProjectBundle(detailProjectId) : null;
  void projectRev;

  const projectStats = {};
  for (const p of wbProjects) {
    const ts = wbTasks.filter((t) => t.projectId === p.id);
    projectStats[p.id] = {
      tasks: ts.length,
      openTasks: ts.filter((t) => t.status !== "completed" && t.status !== "failed").length,
      notes: WBStore.getNotes({ projectId: p.id }).length,
    };
  }
  const homeToday = WBStore.getTodayTasks();
  const homeOpenCount = WBStore.getOpenTasks().length;
  const pendingReviewCount =
    wbProposals.filter((p) => p && p.status === "proposed").length +
    wbTasks.filter((t) => t && t.status === "review_required").length;

  const workbenchScreens = {
    home: (
      <WorkbenchHome tasks={wbTasks}
        onCreateTask={createTaskFromGoal}
        onSubmitGoal={submitGoalOnce}
        submittingGoal={submittingGoal}
        onGoTasks={() => changeWbTab("tasks")}
        onGoSchedule={() => changeWbTab("schedule")}
        onGoAgent={() => changeWbTab("agent")}
        onOpenTask={openTaskDetail}
        todayTasks={homeToday}
        openTaskCount={homeOpenCount}
        agentPaired={hasPairedGatewayToken()} />
    ),
    tasks: detailTask ? (
      <TaskDetailScreen task={detailTask}
        onTransition={(to) => transitionTask(detailTask.id, to)}
        onBack={() => setDetailTaskId(null)}
        onAddStep={(title) => { setWbTasks(WBStore.addTaskStep(detailTask.id, { title })); }}
        onUpdateStep={(stepId, patch) => { setWbTasks(WBStore.updateTaskStep(detailTask.id, stepId, patch)); }}
        onSetResult={(r) => { setWbTasks(WBStore.setTaskResult(detailTask.id, r)); }}
        onAddSource={(s) => { setWbTasks(WBStore.addTaskSource(detailTask.id, s)); }}
        onRun={runTaskEngine}
        onRetryFailed={retryFailedSteps}
        onSetSchedule={handleSetSchedule}
        onSavePlanTodos={handleSavePlanTodos}
        onLinkProject={handleLinkTaskToProject}
        onSetPriority={handleSetPriority}
        onSetTitle={handleSetTitle}
        onLinkPlace={handleLinkTaskToPlace}
        onSetReminder={handleSetReminder}
        places={archived.wbPlaces}
        onConflicts={wbTasks}
        projects={wbProjects}
        notes={WBStore.getNotes({ taskId: detailTask.id })}
        onAddNote={addTaskNote}
        onDelete={(id) => {
          WBStore.deleteTask(id);
          setWbTasks(WBStore.getTasks());
          setWbLog(WBStore.getLog());
          setDetailTaskId(null);
          flash("任务已删除（30 天内可在工作记录回收站恢复）");
        }}
        agentRuns={detailAgentRuns}
        onGoProjects={() => changeWbTab("projects")}
        onOpenProject={openProjectDetail}
        onGoNotes={() => changeWbTab("notes")}
        onGoAgent={() => { setAgentContextTaskId(detailTask.id); changeWbTab("agent"); }} />
    ) : (
      <TasksScreen tasks={wbTasks} onStatusChange={changeTaskStatus}
        onAddTask={(t) => addTaskLocal(t, { source: "任务页输入" })}
        onOpenTask={openTaskDetail}
        projects={wbProjects}
        notes={wbNotes}
        onGoSchedule={() => changeWbTab("schedule")}
        onGoNotes={() => changeWbTab("notes")}
        onGoProjects={() => changeWbTab("projects")}
        onGoHistory={() => changeWbTab("history")} />
    ),
    agent: (
      <AgentScreen flash={flash}
        linkTask={(runId, taskId, run) => {
          const updated = WBStore.linkTaskToAgentRun(taskId, runId, {
            executor: run && run.executor ? run.executor : null,
            summary: run && run.summary ? run.summary : null,
          });
          if (updated) {
            setWbTasks(WBStore.getTasks());
            setWbLog(WBStore.getLog());
            flash(`结果已关联到任务「${updated.title}」`);
          } else {
            flash("关联失败（任务不存在或已关联）");
          }
        }}
        linkableTasks={wbTasks}
        proposals={wbProposals}
        reviewTasks={wbTasks}
        onDecideProposal={decideProposal}
        onResumeTask={resumeReviewTask}
        onOpenTask={openTaskDetail}
        onOpenReviewCenter={() => changeWbTab("review")}
        contextTask={agentContextTask}
        onClearContextTask={() => setAgentContextTaskId(null)} />
    ),
    projects: projectBundle ? (
      <ProjectDetailScreen
        bundle={projectBundle}
        onBack={() => setDetailProjectId(null)}
        onOpenTask={openTaskDetail}
        onTaskStatus={(id, status) => { changeTaskStatus(id, status); bumpProjectRev(); }}
        onAddTask={(title, projectId) => { setWbTasks(WBStore.addTask(title, { source: "项目内创建", projectId })); setWbLog(WBStore.getLog()); bumpProjectRev(); }}
        onAddNote={(text, projectId) => { const t = String(text || "").trim(); if (!t) return; WBStore.addNote({ kind: "text", text: t, projectId }); setWbNotes(WBStore.getNotes()); setWbLog(WBStore.getLog()); bumpProjectRev(); }}
        onUpdateNote={(id, text) => { const t = String(text || "").trim(); if (!t) return; WBStore.updateNote(id, { text: t }); setWbNotes(WBStore.getNotes()); bumpProjectRev(); }}
        onRemoveNote={(id) => { WBStore.removeNote(id); setWbNotes(WBStore.getNotes()); bumpProjectRev(); }}
        onSaveReview={(projectId, patch) => { if (WBStore.setProjectReview(projectId, patch)) { setWbLog(WBStore.getLog()); bumpProjectRev(); flash("复盘已保存"); } }}
        onArchiveProject={(id) => { if (WBStore.archiveProject(id)) { refreshProjects(); setWbLog(WBStore.getLog()); setDetailProjectId(null); flash("项目已归档（数据保留）"); } }}
        onPlaceVisit={archived.handlePlaceVisit}
        onPrepToggle={archived.handlePrepToggle}
        onPrepAdd={archived.handlePrepAdd}
        onRegStatus={archived.handleRegStatus}
        onAddProgress={(projectId, text, kind) => {
          const t = String(text || "").trim();
          if (!t) return;
          WBStore.addProgress({ subjectType: "project", subjectId: projectId, subjectTitle: (WBStore.getProject(projectId) || {}).title || "", kind: kind || "note", text: t });
          setWbLog(WBStore.getLog()); bumpProjectRev(); flash("进度已记录");
        }}
        onRemoveProgress={(id) => { WBStore.removeProgress(id); bumpProjectRev(); }}
      />
    ) : (
      <ProjectsScreen projects={wbProjects} stats={projectStats} onCreateProject={handleCreateProject} onOpenProject={openProjectDetail} />
    ),
    review: <ReviewCenterScreen cards={wbReview} onDecide={decideReview} reviewTasks={wbTasks} onResumeTask={resumeReviewTask} proposals={wbProposals} onProposal={decideProposal} />,
    places: <PlacesScreen places={archived.wbPlaces} projects={wbProjects} tasks={wbTasks} notes={wbNotes} onCreate={archived.handleCreatePlace} onStatus={archived.handlePlaceStatus} onVisit={archived.handlePlaceVisit} onRemove={archived.handleRemovePlace} onEditPlace={archived.handleEditPlace} onAddPlaceNote={archived.handleAddPlaceNote} onRemovePlaceNote={handleRemoveNote} />,
    schedule: <ScheduleScreen tasks={wbTasks} onOpenTask={openTaskDetail} />,
    notes: <NotesScreen notes={wbNotes} tasks={wbTasks} places={archived.wbPlaces} projects={wbProjects} onRemoveNote={handleRemoveNote} onOpenTask={openTaskDetail} flash={flash} onImportNotes={handleImportNotes} onCreateNote={handleCreateNote} onUpdateNote={handleUpdateNote} />,
    useract: <UserActivitiesScreen activities={archived.wbUserActs} weekend={archived.weekend} projects={wbProjects} onCreate={archived.handleCreateUserAct} onRemove={archived.handleRemoveUserAct} onSync={archived.handleSyncUserAct} onCreateProject={archived.handleCreateProjectFromUserAct} onExecute={archived.handleExecuteUserAct} tasks={wbTasks} />,
    progress: <ProgressCenterScreen data={WBStore.getProgressCenterData()} onOpenProject={openProjectDetail} />,
    history: (
      <HistoryScreen tasks={wbTasks} log={wbLog} onOpenTask={openTaskDetail}
        deletedTasks={WBStore.getDeletedTasks()}
        onRestoreTask={(id) => {
          if (WBStore.restoreTask(id)) { setWbTasks(WBStore.getTasks()); setWbLog(WBStore.getLog()); flash("任务已恢复"); }
          else flash("恢复失败（任务不存在或未删除）");
        }}
        onDeleteTaskForever={(id) => { WBStore.deleteTaskForever(id); setWbTasks(WBStore.getTasks()); flash("已彻底删除"); }} />
    ),
    settings: <SettingsScreen navMode={navMode} onChangeNavMode={handleChangeNavMode} onOpenWb={changeWbTab} onOpenLegacy={changeTab} />,
  };

  const content = (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      <React.Suspense fallback={LAZY_FALLBACK}>
        {tab === "discover" && <DiscoverScreen synced={archived.weekend} onSync={archived.toggleSync} onOpen={archived.openDetail} onGoSearch={() => setTab("search")} onGoSmart={() => setTab("smart")} district={archived.district} onDistrictChange={archived.setDistrict} />}
        {tab === "smart" && <NaturalSearchScreen synced={archived.weekend} onSync={archived.toggleSync} onOpen={archived.openDetail} district={archived.district} onDistrictChange={archived.setDistrict} />}
        {tab === "search" && <SearchScreen synced={archived.weekend} onSync={archived.toggleSync} onOpen={archived.openDetail} district={archived.district} onDistrictChange={archived.setDistrict} onGoSmart={() => changeTab("smart")} />}
        {tab === "weekend" && <MyWeekendScreen weekend={archived.weekend} onSync={archived.toggleSync} onOpen={archived.openDetail} onDiscover={() => setTab("discover")} favorites={archived.favorites} onToggleFavorite={archived.toggleFavorite} />}
        {tab === "map" && <MapScreen synced={archived.weekend} onSync={archived.toggleSync} onOpen={archived.openDetail} focusId={archived.mapFocus} district={archived.district} onDistrictChange={archived.setDistrict} />}

        {wbTab && workbenchScreens[wbTab]}

        {archived.detail && (
          <div className="gg-detail-overlay" style={{ animation: "gg-detail-in var(--dur-base) var(--ease-out)" }}>
            <ActivityDetailScreen view={archived.detail} synced={!!archived.weekend[archived.detail.id]} onSync={() => archived.toggleSync(archived.detail)}
              onBack={() => archived.setDetail(null)} onShowMap={() => showOnMap(archived.detail)}
              projects={wbProjects}
              linkedProject={WBStore.findProjectByActivity(archived.detail.id)}
              registration={WBStore.getRegistration(archived.detail.id)}
              onMarkOpened={archived.handleMarkRegistrationOpened}
              onRegStatus={archived.handleRegStatus}
              onExportICS={archived.handleExportICS}
              onCreateProjectFromActivity={(opts) => {
                const p = archived.handleCreateProjectFromActivity(archived.detail, opts);
                if (p) { archived.setDetail(null); openProjectDetail(p.id); }
              }}
              onLinkActivityToProject={(projectId) => {
                archived.handleLinkActivityToProject(projectId, archived.detail);
                archived.setProjectPickerFor(null);
              }}
              onOpenProject={(id) => { archived.setDetail(null); openProjectDetail(id); }}
              pickerOpen={archived.projectPickerFor === archived.detail.id}
              onTogglePicker={() => archived.setProjectPickerFor(archived.projectPickerFor === archived.detail.id ? null : archived.detail.id)}
              onClosePicker={() => archived.setProjectPickerFor(null)} />
          </div>
        )}
      </React.Suspense>
      <Toast msg={toast} />
    </div>
  );

  const redesignedPage = !archived.detail && (wbTab === "home" || tab === "search");
  const effectiveNavMode = LEGACY_MODE ? "classic" : navMode;

  if (isMobile) {
    return (
      <PhoneFrame appearance={redesignedPage ? V3K_SKIN : undefined}>
        {effectiveNavMode === "classic" ? (
          redesignedPage ? (
            <header className="v3k-mobile-header">
              <button type="button" data-workbench-nav="home" aria-label="回到工作台" onClick={() => changeWbTab("home")}>
                <span className="v3k-brand-mark" aria-hidden="true">G</span><span>GORGON</span>
              </button>
              <span className="v3k-header-caption">行动工作台</span>
            </header>
          ) : <StatusBar dark={false} />
        ) : (
          <LiteMobileHeader
            active={wbTab || tab}
            dark={redesignedPage}
            onHome={() => changeWbTab("home")}
            onOpenTools={() => setMoreOpen(true)}
            onOpenSettings={() => changeWbTab("settings")}
            pendingReviewCount={pendingReviewCount}
          />
        )}
        {content}
        <WorkbenchTabBar
          active={wbTab || (moreOpen ? "more" : tab)}
          syncedCount={archived.syncedCount}
          navMode={effectiveNavMode}
          pendingReviewCount={pendingReviewCount}
          onChange={pickMobileTab}
        />
        <MoreDrawer
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          active={wbTab || tab}
          onPick={pickMobileTab}
          syncedCount={archived.syncedCount}
          navMode={effectiveNavMode}
          pendingReviewCount={pendingReviewCount}
        />
      </PhoneFrame>
    );
  }

  return (
    <div className={"gg-app" + (redesignedPage ? " v3k-theme" : "")} data-v3k-theme={redesignedPage ? V3K_SKIN : undefined} data-gg-shell="wide" data-gg-shell-nav="workbench">
      <DesktopHeader district={archived.district} showDistrict={Boolean(tab) || effectiveNavMode === "classic"} onWorkbenchHome={() => changeWbTab("home")} />
      <div className="gg-body">
        <WorkbenchSidebar
          active={wbTab || tab}
          onWb={changeWbTab}
          onLegacy={changeTab}
          syncedCount={archived.syncedCount}
          navMode={effectiveNavMode}
          pendingReviewCount={pendingReviewCount}
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
