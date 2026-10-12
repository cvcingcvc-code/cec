# Gorgon Workbench V2.2 — 第一阶段：初始审计报告

> 生成时间：2026-10-10（V2.2 长周期自主开发 · Stage 1）
> 审计方式：只读盘点（git / docs / reports / src / tests 全量结构 + 核心文件精读 + 测试基线实跑），零代码改动。

---

## 1. 当前代码版本

| 项 | 值 |
|---|---|
| 仓库 | `C:\Users\lin\Documents\Gorgon-Workbench`（GitHub: `cvcingcvc-code/cec`） |
| 分支 | `feature/gorgon-opportunity-v2` |
| HEAD | `395d0a2` — `docs: Android V2.1 acceptance report — real-search fix verified and released` |
| 工作树 | 干净（0 改动，无未提交文件） |
| 与远端关系 | 本地领先 `origin/feature/gorgon-opportunity-v2`（5a47ccd）**11 个提交未推送** |
| 远端分叉 | fetch 显示 remote `geergong` 新增 tag v1.0.0；`docs/ROADMAP.md` 仅存在于远端分支，本地缺失 |
| 测试基线（本轮实跑） | `node --test "tests/*.test.mjs"` → **298/298 全部通过**（4.36s） |

最近提交链（本地未推送部分含）：`f411d60` CORS 白名单 → `360109e` build-apk VITE_API_BASE_URL 注入 → `36631af` 交接文档 → `395d0a2` V2.1 验收报告。V2.1 的两段修复（公网 API 地址 + CORS）已全部提交，**无重复开发必要**。

## 2. 当前功能清单

### 2.1 屏幕（app/src/screens/，15 个）
WorkbenchHome（工作台首页）、ProjectsScreen（项目列表）、ProjectDetailScreen（项目详情）、TasksScreen、TaskDetailScreen、ActivityDetailScreen、DiscoverScreen、HistoryScreen、MapScreen、MyWeekendScreen、NaturalSearchScreen、PlacesScreen、ReviewCenterScreen、SearchScreen、SettingsScreen。

### 2.2 数据层（app/src/store/，6 个文件）
| 文件 | 持久化键 | 核心能力 |
|---|---|---|
| `project-repository.js` | `gorgon_workbench_projects_v1` | PROJECT_ORIGIN {MANUAL, ACTIVITY}；activity 快照保留 isDemo 标记；archiveProject 软删除（永不销毁数据）；findProjectByActivity 幂等防重复关联 |
| `task-repository.js` | `gorgon_workbench_tasks_v2`（schemaVersion 2，v1 只读迁移一次） | transitionTask() 唯一合法状态变更入口；getStorageHealth() 诊断 |
| `opportunity-repository.js` | `gorgon_opportunities_v1` | Modules C/D/E/F 统一 envelope：registrations（按 activityId 索引）/ places / notes / reviews / projectReviews |
| `workbench-store.js` | （facade，不直接触盘） | getProjectBundle()、getHomeData()、setTaskSchedule()、savePlanStepsAsTodos() |
| `store.js` / `proposal-repository.js` | 旧版提案/发现模块 | 保留兼容 |

### 2.3 状态机与词汇表
- **TASK_STATUS**：created / planning / ready / running / review_required / completed / failed；TRANSITIONS 白名单（如 `created→[planning,ready,failed]`、`running→[completed,failed,review_required]`），纯模块 `app/src/workbench/task-model.js`（无 DOM/React/localStorage）。
- **REG_STATUS（报名，六态）**：none → opened_registration → in_progress → registered（仅显式用户确认 + confirmedAt 盖章）→ …。**诚实规则已落实：opened_registration 永不等于 registered**。`markRegistrationOpened()` 仅推进 NONE→OPENED。
- **PLACE_STATUS（四态）**：todo / visited / revisit / unsuitable；`addVisit()` 自动翻转 TODO/REVISIT→VISITED。
- Phase 4 已有 ADDITIVE 字段：task.dueAt、task.scheduledDate、task.projectId；places/notes 带 projectId；MAX_TIMELINE_EVENTS=500。

### 2.4 已实现的 V2.2 相关 UI
- **WorkbenchHome.jsx**（Phase 4 P0-D 已完成）：今日待办（workbench-today）、我的项目（workbench-home-projects）、最近任务、最近记录四大区块，全部来自真实 store 数据。
- **ProjectDetailScreen.jsx**：活动（DEMO 徽标+来源链接）/ 出行准备清单 / 关联任务（nextLegalStatus 推进按钮）/ 日程视图 / 走访地点 / 项目笔记（增删改）/ 执行复盘（outcome+nextAction）/ 归档。
- **ProjectsScreen.jsx**：创建表单（title+可选 goal）+ 项目卡片（origin 徽标、DEMO 徽标、统计计数）。

## 3. 已通过测试

本轮实跑基线：**298/298 PASS**（node --test，含 project-repository、opportunity-repository、task-engine、workbench-store*、ics、router、skills、ai* 等单测）。历史记录（PROJECT_FULL_SUMMARY）：pipeline 298/298、app 277→298/298、E2E 93/93、Phase4 Android E2E 55/55、Places 29/29、Registrations 28/28。

## 4. 未通过测试 / NOT_TESTED

| 项 | 状态 | 依据 |
|---|---|---|
| Android 真机全链路（SHA256、冷启动、REAL SEARCH、保存数据、重启保留） | **NOT_TESTED** | Issue #1（P0，OPEN）；无真机 |
| UI 驱动 REAL SEARCH 徽标断言 | **NOT_TESTED** | 探针 90s evaluate 超时 + 解析 bug（V2.1 报告） |
| 模拟器全链路 | 部分受阻 | qemu 进程生命周期不稳定（Windows 特定）；唯一稳定配方=「清锁→启动→装 APK→am start→探针」单命令闭环，最多两次受控尝试 |
| GitHub Issue #1 | 不能关单 | NOT_TESTED 规则：无真机不得关 |

## 5. 实际缺失能力（对照 V2.2 目标）

1. **Progress（进度）作为统一概念不存在**。全库 grep `progress|进度` 仅命中一处——REG_STATUS 的 `in_progress` 标签（workbench-store.js:430）。项目详情页有「执行复盘」（outcome+nextAction），任务有 timeline 事件，但**没有跨 Project/Task 的统一进度记录与查询能力**。→ 第二阶段需以 ADDITIVE 方式补齐（新 repository 键或 timeline 事件扩展），完成闭环「创建项目→创建任务→安排日程→添加笔记→记录进度→重新进入查看」。
2. **场景 B（求职学习）状态词汇未建模**。现有 REG_STATUS/PLACE_STATUS 面向活动与地点；求职（投递→笔试→面试→offer）需新词汇表或复用 TASK_STATUS + 自定义阶段。→ 第三阶段处理。
3. **多项目进度中心（面向普通人的中文摘要 UI）未建**。WorkbenchHome 四区块是数据罗列，缺少跨项目「每个项目走到哪一步了」的摘要层。→ 第四阶段处理。
4. **`docs/ROADMAP.md` 本地缺失**（仅远端有）。→ 第六阶段交接时从远端恢复或重建。

## 6. 可复用模块（本轮全部复用，不重写）

| V2.2 需求 | 复用 |
|---|---|
| 项目/任务/日程/地点/笔记 | project-repository + task-repository + opportunity-repository + workbench-store facade（已全覆盖） |
| 状态推进与诚实规则 | transitionTask() 白名单 + REG_STATUS 六态（已落实，直接复用） |
| 闭环验证 | workbench-store-phase4/places/registrations 测试模式 + android_*_e2e.mjs E2E 模式 |
| 首页数据 | getHomeData()（今日/开放/最近/项目/记录） |
| Android 验收 | HANDOFF_PHONE_REAL_SEARCH.md §5.1 模拟器配方 + build-apk.mjs（默认域名已固化）+ release_smoke |
| 存储健康诊断 | getStorageHealth()（损坏数据隔离到 `<key>.corrupt-<n>`，内存兜底，永不销毁旧数据） |

## 7. 本轮开发范围（V2.2 八阶段）

1. ✅ 本审计（Stage 1）。
2. **Stage 2**：补 Progress 统一概念（ADDITIVE，不动既有键语义）；闭环「创建项目→创建任务→安排日程→添加笔记→记录进度→重新进入查看」+ E2E。产出 `reports/V22_CORE_MODEL_REPORT.md`。
3. **Stage 3**：三个真实生活场景（A 活动参加优先；B 求职学习；C 地点走访），全部真实 store 数据。产出 `reports/V22_LIFE_SCENARIOS.md`。
4. **Stage 4**：多项目进度中心（面向普通人的中文摘要 UI）。产出 `reports/V22_PROJECT_PROGRESS_REPORT.md`。
5. **Stage 5**：Android 验收与稳定性（模拟器最多两次受控尝试；真机未验收标 NOT_TESTED）。产出 `reports/V22_ANDROID_ACCEPTANCE.md`。
6. **Stage 6**：按功能拆分 commit、推送（Clash 代理 127.0.0.1:7890）、更新 Issues #1/#2 与 ROADMAP。
7. **Stage 7（可选）**：`docs/REMOTE_AGENT_ARCHITECTURE.md` 架构预留。
8. **Stage 8**：`docs/workbench/V22_EXECUTION_STATE.md` + 最终报告 `reports/GORGON_V22_LONG_RUN_FINAL.md`。

**明确不做**：不重写 V2.1 已通过功能（CORS/API 地址已修复）；不做破坏性 git 操作；不销毁旧用户数据（新增能力全部 ADDITIVE + schemaVersion 迁移）；不无限重构；模拟器最多两次启动尝试。

## 8. 主要风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 模拟器 qemu 进程生命周期不稳定，Android 验收可能受阻 | 唯一稳定配方单命令闭环；最多两次尝试；失败即标 NOT_TESTED 并如实记录 |
| R2 | 本地领先远端 11 提交 + 远端有本地没有的 ROADMAP.md（分叉） | push 走 Clash 代理；推送前先 fetch 复核；ROADMAP 在 Stage 6 从远端恢复 |
| R3 | Progress 新概念可能破坏既有数据语义 | 全部 ADDITIVE（新键 / timeline 扩展），schemaVersion 递增 + v1 只读迁移模式（照 task-repository v2 先例） |
| R4 | 真机不可得，Issue #1 无法关单 | 如实标 NOT_TESTED；模拟器证据 + 单测/E2E 全绿作为替代证据链 |
| R5 | 8 小时时间盒内八阶段可能溢出 | 阶段间不询问直接推进；Stage 7 可选可裁剪；每阶段独立交付物可中断续接 |

---

## 结论

工作树干净、基线 298/298 全绿、V2.1 修复已提交无需重做；核心数据模型（Project/Task/Place/Note/Review + 状态机 + 诚实规则）已成型可直接复用。**真实缺口收敛为三点：Progress 统一概念、求职场景状态词汇、多项目进度中心摘要 UI**——分别对应 Stage 2/3/4，全部以 ADDITIVE 方式实现。审计通过，自动进入第二阶段。
