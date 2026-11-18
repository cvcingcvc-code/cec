// Gorgon Lite — archived/frozen modules state & handlers hook.
//
// Isolates legacy weekend/favorites/district, field-visit places, user-created
// activities, and activity registration/ICS handlers out of App.jsx so the
// root component stays focused on the primary Task + Agent closed loop, while
// preserving 100% of historical user data and legacy E2E contracts.

import React from "react";
import * as Store from "../store/store.js";
import * as WBStore from "../store/workbench-store.js";
import * as ActivityView from "../lib/activity-view.js";
import { GORGON_DATA } from "../lib/data.js";

/** Normalize raw activity record, id, or view into ActivityView shape. */
export function asActivityView(x) {
  if (!x) return null;
  if (typeof x === "string") {
    const list = GORGON_DATA.activities || [];
    const found = list.find((a) => a.id === x);
    return found ? ActivityView.toView(found) : null;
  }
  if (x.__view) return x;
  return ActivityView.toView(x);
}

export function useArchivedState({
  flash,
  setWbTasks,
  setWbNotes,
  setWbLog,
  refreshProjects,
  bumpProjectRev,
  openTaskDetail,
}) {
  const [weekend, setWeekend] = React.useState(() => Store.getWeekendItems());
  const [favorites, setFavorites] = React.useState(() => Store.getFavorites());
  const [district, setDistrictState] = React.useState(() => Store.getDistrict());
  const [detail, setDetail] = React.useState(null);
  const [mapFocus, setMapFocus] = React.useState(null);
  const [projectPickerFor, setProjectPickerFor] = React.useState(null);
  const [wbPlaces, setWbPlaces] = React.useState(() => WBStore.getPlaces());
  const [wbUserActs, setWbUserActs] = React.useState(() => WBStore.getUserActivities());

  const setDistrict = (d) => setDistrictState(Store.setDistrict(d));

  const toggleSync = (input) => {
    const view = asActivityView(input);
    if (!view || !view.id) return;
    const on = !weekend[view.id];
    const next = Object.assign({}, weekend);
    if (on) next[view.id] = view; else delete next[view.id];
    setWeekend(next);
    Store.setWeekendItems(next);
    flash(on ? "已加入我的周末" : "已从我的周末移除");
  };

  const toggleFavorite = (id) => {
    const has = favorites.indexOf(id) >= 0;
    const next = has ? favorites.filter((x) => x !== id) : favorites.concat([id]);
    setFavorites(next);
    Store.setFavorites(next);
    flash(has ? "已取消收藏" : "已收藏");
  };

  const openDetail = (x) => {
    const v = asActivityView(x);
    if (v) {
      setProjectPickerFor(null);
      setDetail(v);
    }
  };

  const refreshPlaces = () => {
    setWbPlaces(WBStore.getPlaces());
    bumpProjectRev();
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

  const handleCreateProjectFromUserAct = (a) => {
    const view = asActivityView(a);
    if (!view) return;
    const p = WBStore.createProjectFromActivity(view);
    if (!p) return;
    refreshProjects();
    setWbLog(WBStore.getLog());
    flash("已从活动创建项目");
  };

  const handleExecuteUserAct = (a) => {
    const out = WBStore.executeUserActivity(a);
    if (!out || !out.ok) {
      const reasons = {
        "invalid-activity": "执行失败：活动数据无效",
        "not-found": "执行失败：活动不存在（可能已被删除）",
        "task-create-failed": "执行失败：任务创建未成功，请重试",
        "activity-update-failed": "执行失败：任务已创建，但执行状态保存失败",
      };
      flash((out && reasons[out.reason]) || "执行失败，请重试");
      setWbTasks(WBStore.getTasks());
      setWbLog(WBStore.getLog());
      return;
    }
    setWbTasks(WBStore.getTasks());
    setWbLog(WBStore.getLog());
    refreshUserActs();
    if (out.alreadyExecuted) {
      flash("该活动已执行过，已为你打开关联任务");
    } else {
      flash("已执行：任务已创建" + (out.task && out.task.scheduledDate ? "并写入日程" : "") + "，已加入任务列表");
    }
    openTaskDetail(out.task.id);
  };

  const handleCreateProjectFromActivity = (view, opts) => {
    const p = WBStore.createProjectFromActivity(view, opts || {});
    if (!p) return null;
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

  const handlePrepAdd = (activityId, text) => {
    const view = asActivityView(activityId);
    const seed = text === null ? WBStore.defaultPrepFor(view) : null;
    const items = seed || (() => {
      const r = WBStore.getRegistration(activityId);
      const cur = (r && r.prep) || [];
      return cur.concat([{ title: text, done: false }]);
    })();
    const r = WBStore.setPrep(activityId, items);
    if (r) { setWbLog(WBStore.getLog()); bumpProjectRev(); }
  };

  const handlePrepToggle = (activityId, prepId, done) => {
    const r = WBStore.getRegistration(activityId);
    if (!r) return;
    const cur = r.prep || [];
    const items = cur.map((p) => (p.id === prepId ? Object.assign({}, p, { done }) : p));
    const out = WBStore.setPrep(activityId, items);
    if (out) { setWbLog(WBStore.getLog()); bumpProjectRev(); }
  };

  return {
    weekend,
    favorites,
    district,
    setDistrict,
    detail,
    setDetail,
    mapFocus,
    setMapFocus,
    projectPickerFor,
    setProjectPickerFor,
    wbPlaces,
    wbUserActs,
    syncedCount: Object.keys(weekend).length,
    toggleSync,
    toggleFavorite,
    openDetail,
    handleCreatePlace,
    handlePlaceStatus,
    handlePlaceVisit,
    handleRemovePlace,
    handleEditPlace,
    handleAddPlaceNote,
    handleCreateUserAct,
    handleRemoveUserAct,
    handleSyncUserAct: toggleSync,
    handleCreateProjectFromUserAct,
    handleExecuteUserAct,
    handleCreateProjectFromActivity,
    handleLinkActivityToProject,
    handleMarkRegistrationOpened,
    handleRegStatus,
    handleExportICS,
    handlePrepAdd,
    handlePrepToggle,
  };
}
