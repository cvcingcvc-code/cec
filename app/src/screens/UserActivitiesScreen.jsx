// Gorgon Workbench — UserActivitiesScreen (Phase 5: 真实活动源, user-created).
//
// The honest activity entry point that works without any backend: the USER
// creates an activity by hand, it lands in its own envelope store
// (user-activity-repository.js, dataOrigin "user"), and from here it can:
//
//   * 加入我的周末（onSync → weekend flow, same as search results）
//   * 创建项目（onCreateProject → createProjectFromActivity, origin=activity）
//   * 删除（onRemove, confirmation required)
//
// Honesty rules:
//   * user activities are marked 「自建」 — never rendered as DEMO or as
//     pipeline/api data;
//   * title is required; everything else optional;
//   * 删除 asks for confirmation (one click, no undo).
//
// Data + handlers come in through props (App owns the facade calls),
// mirroring NotesScreen. Screen never touches localStorage.

import React from "react";
import { Button } from "../lib/ds.js";
import { Icon } from "../components/Icon.jsx";

const inputStyle = {
  border: "1px solid var(--border-subtle)", outline: "none",
  borderRadius: "var(--radius-md)", padding: "11px 14px", background: "var(--surface-card)",
  fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-strong)",
};

export function UserActivitiesScreen({
  activities, weekend, projects,
  onCreate, onRemove, onSync, onCreateProject,
}) {
  const [title, setTitle] = React.useState("");
  const [dateText, setDateText] = React.useState("");
  const [time, setTime] = React.useState("");
  const [venue, setVenue] = React.useState("");
  const [district, setDistrict] = React.useState("");
  const [price, setPrice] = React.useState("");

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onCreate({
      title: t,
      dateText: dateText.trim() || null,
      time: time.trim() || null,
      venue: venue.trim() || null,
      district: district.trim() || null,
      price: price.trim() || null,
    });
    setTitle(""); setDateText(""); setTime(""); setVenue(""); setDistrict(""); setPrice("");
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-user-activities">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            自建活动
          </h1>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
            {activities.length} 个 · 你手动创建的真实活动 · 本地数据
          </span>
        </div>

        {/* create form */}
        <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <input
            aria-label="活动名称"
            data-testid="workbench-useract-new-title"
            placeholder="活动名称，例如：某技术沙龙第 12 期"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{ ...inputStyle, flex: 2, minWidth: 180 }}
          />
          <input
            aria-label="活动日期"
            data-testid="workbench-useract-new-date"
            placeholder="日期，例如：10月18日 · 周六"
            value={dateText}
            onChange={(e) => setDateText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{ ...inputStyle, flex: 2, minWidth: 150 }}
          />
          <input
            aria-label="活动时间"
            data-testid="workbench-useract-new-time"
            placeholder="时间，例如：14:00"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{ ...inputStyle, flex: 1, minWidth: 110 }}
          />
          <Button variant="primary" onClick={submit} disabled={!title.trim()}
            leadingIcon={<Icon name="plus" style={{ width: 15, height: 15 }} />}>
            创建
          </Button>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <input
            aria-label="活动地点"
            data-testid="workbench-useract-new-venue"
            placeholder="地点（可选），例如：某咖啡馆 2F"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{ ...inputStyle, flex: 2, minWidth: 150 }}
          />
          <input
            aria-label="活动区域"
            data-testid="workbench-useract-new-district"
            placeholder="区域（可选），例如：徐汇"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{ ...inputStyle, flex: 1, minWidth: 110 }}
          />
          <input
            aria-label="活动票价"
            data-testid="workbench-useract-new-price"
            placeholder="票价（可选），例如：免费"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={{ ...inputStyle, flex: 1, minWidth: 110 }}
          />
        </div>

        {activities.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-faint)", padding: "30px 0", lineHeight: 1.7 }}>
            还没有自建活动。用上面的表单创建一个真实活动，它和 DEMO 演示数据完全分开。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }} data-testid="workbench-useract-list">
            {activities.map((a) => {
              const isSynced = !!(weekend && weekend[a.id]);
              const linkedProject = (projects || []).find(
                (p) => !p.archived && (p.activities || []).some((x) => x.activityId === a.id)
              );
              return (
                <div key={a.id} data-testid="workbench-useract-item" style={{
                  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)", padding: "13px 16px", minWidth: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Icon name="compass" style={{ width: 16, height: 16, color: "var(--brand)", flex: "none" }} />
                    <span style={{ minWidth: 0, flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.5 }}>
                      {a.title}
                    </span>
                    <span data-testid="workbench-useract-origin" style={{
                      flex: "none", fontSize: 11, fontWeight: 700, padding: "3px 9px",
                      borderRadius: "var(--radius-pill)", background: "var(--brand-soft)", color: "var(--brand)",
                    }}>
                      自建
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.6 }}>
                    {[a.dateText, a.time, a.venue, a.district, a.price].filter(Boolean).join(" · ") || "未填详情"}
                  </div>
                  {linkedProject && (
                    <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                      <Icon name="folder-kanban" style={{ width: 12, height: 12 }} />
                      项目：{linkedProject.title}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <Button variant={isSynced ? "mint" : "secondary"} size="sm" onClick={() => onSync(a)}
                      leadingIcon={<Icon name={isSynced ? "check" : "plus"} style={{ width: 13, height: 13 }} />}>
                      {isSynced ? "已在我的周末" : "加入我的周末"}
                    </Button>
                    {!linkedProject && (
                      <Button variant="secondary" size="sm" onClick={() => onCreateProject(a)}
                        leadingIcon={<Icon name="folder-plus" style={{ width: 13, height: 13 }} />}>
                        创建项目
                      </Button>
                    )}
                    <span style={{ flex: 1 }} />
                    {onRemove && (
                      <button data-testid="workbench-useract-remove" onClick={() => { if (window.confirm(`删除自建活动「${a.title}」？此操作不可撤销。`)) onRemove(a.id); }}
                        aria-label={"删除自建活动：" + a.title}
                        style={{
                          border: "none", background: "transparent", color: "var(--danger)",
                          fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "10px 10px", minHeight: 44,
                          display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-sans)",
                        }}>
                        <Icon name="trash-2" style={{ width: 13, height: 13 }} />删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
