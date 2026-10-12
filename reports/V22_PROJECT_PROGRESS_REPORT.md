# Gorgon Workbench V2.2 — 第四阶段：多项目进度中心报告

> 生成时间：2026-10-10（V2.2 长周期自主开发 · Stage 4）
> 范围：面向普通人的多项目进度中心（中文摘要 UI），跨项目回答「每个项目走到哪一步了」。全部摘要从真实 store 数据派生，绝不编造。

---

## 1. 交付内容

### 1.1 Facade 聚合（workbench-store.js，ADDITIVE）

新增 `getProgressCenterData()`——跨项目进度摘要的唯一数据源：

| 摘要项 | 派生来源（全部真实数据） |
|---|---|
| 每项目 statusLine | 纯派生：无任务→「还没有任务」；有开放任务→「进行中 · N 个任务未完成」；全部完成→「任务全部完成」 |
| latestProgress | progress-repository 中该项目最新一条进度 |
| taskProgressCount | 该项目全部任务的进度记录数 |
| latestNote | opportunity-repository 该项目最新笔记 |
| nextScheduled | 该项目最早安排的任务（scheduledDate/dueAt 排序） |
| completedTasks/totalTasks + 完成率 | 任务状态机真实状态计数 |
| jobCounts/jobTotal | Stage 3 求职管线 countByStage() |

新增求职管线 facade passthrough：`getJobApplications` / `addJobApplication` / `setJobStage`（非法推进安全拒绝 + activity log 轨迹）。屏幕永不直接触仓库。

### 1.2 新屏幕 ProgressCenterScreen（`app/src/screens/ProgressCenterScreen.jsx`）

面向普通人的中文摘要 UI，**零术语、零状态枚举外露**：

- **总览计数**（testid `workbench-progress-overview`）：项目总数 / 未完成任务 / 求职申请，tabular-nums 大数字。
- **项目进度列表**（`workbench-progress-list`）：每项目一张卡——项目名（含 DEMO 徽标）→ **中文状态行**（如「进行中 · 2 个任务未完成（已完成 1/3）」）→ 补充行（最近进度 / 下一个安排 / 任务记录数 / 最新笔记，全部真实数据）→ 完成率百分比（100% 高亮）。点击进项目详情。
- **求职进度区**（`workbench-progress-jobs-section`，仅有申请时显示）：八态诚实词汇计数（收集中/已投递/笔试/面试/Offer/已接受/被拒/无回音）。
- 空状态诚实：「还没有项目。在工作台创建一个……」——空是真实状态，不隐藏。

### 1.3 导航接线（navigation.js + App.jsx）

- WORKBENCH_TABS 在「我的项目」之后新增 `{ key: "progress", label: "进度中心", icon: "trending-up" }`（图标用既有 TrendingUp，不引入新依赖）。
- MOBILE_MORE_TABS 同步新增（移动端更多抽屉可达）。
- App.jsx 注册 `progress` 屏幕 + `progressCenterData` 每渲染经 facade 重读（与既有 projectRev 刷新机制一致）。

## 2. 测试验证（`app/tests/v22-progress-center.test.mjs`，5/5 PASS）

1. **空状态诚实**：无数据时 projects=0/jobTotal=0/openTasks=0。
2. **statusLine 三态派生**：还没有任务 / 进行中 · 1 个任务未完成 / 任务全部完成——全部由真实任务状态机状态派生。
3. **全量摘要流**：latestProgress（最新一条）+ taskProgressCount + nextScheduled（最早安排）+ latestNote 全部正确流入。
4. **求职管线贯通**：facade addJobApplication/setJobStage；非法跳段 applied→accepted 被拒；countByStage 正确。
5. **归档排除**：归档项目从进度中心隐藏，任务数据不受影响（软删除语义）。

导航契约同步：`workbench-shell.test.mjs` 的 tabs 覆盖断言更新为含 `progress`（合法 ADDITIVE 变更），并新增移动端可达性测试。

## 3. 测试与构建结果

| 检查 | 结果 |
|---|---|
| 本轮新增 v22-progress-center | 5/5 PASS |
| 完整套件 | **323/323 PASS，零回归**（298 → +13 Stage2 → +6 Stage3 → +6 Stage4 含导航 1 条更新+1 新增） |
| Vite 生产构建 | ✓ 8.28s |

## 4. 不做什么（已遵守）

- 不发明任何摘要数字（全部派生自真实仓库）。
- 不在摘要层复述状态枚举原文（普通人中文）。
- 不做新持久化键（复用 Stage 2/3 已有键）。

## 5. 遗留与下一阶段

- 求职管线仍无专用管理屏（进度中心只读摘要）；可按需后续增加。
- **Stage 5**：Android 功能验收与稳定性（模拟器最多两次受控尝试；真机未验收标 NOT_TESTED）。
