# V2.3 → V3.0 总路线图（V23_V30_MASTER_ROADMAP）

> 生成时间：2026-10-13 05:40（审计基线 HEAD `b349f26`）
> 依据：《GORGON WORKBENCH — V2.3 → V3.0 长周期自主研发总任务》任务书
> 诚实标注体系：REAL / DEMO / MOCK / NOT_IMPLEMENTED / BLOCKED / NOT_TESTED
> 排序原则：**以「对用户完成实际任务的影响程度」降序排列**——先让软件真正可用，再做锦上添花。

## 0. 审计确认的现状基线（2026-10-13）

- 分支 `feature/gorgon-opportunity-v2`，HEAD `b349f26`，工作树干净，双远端（origin=geergong 旧 / cec=主）
- 测试基线：单测 **333/333**（已本机复跑验证）、build-smoke **18/18**（已复跑）、Android E2E 55/55 + 29/29（需模拟器）、pipeline 453（需系统 Python）
- 有效 APK：debug `ebe4ca74…`（任务书基线）/ release `d1a46e39…`（versionCode 5，10-12 签名构建）
- 交接文档：`release/HANDOFF_CONTEXT.md`（HEAD d07cf70 已推送 cec；本地 HEAD 在其之后多 6 个 UI 提交，**本地领先远端**）

## 1. Phase 总览（P0 最高优先级）

| Phase | 名称 | 优先级 | 状态 | 对用户可用性影响 |
|---|---|---|---|---|
| 0 | 执行系统四文档 | P0 | ✅ 本次完成 | 低（元工作） |
| 1 | 完整任务系统（16 项能力） | **P0** | ⬜ 部分已有 | **极高** — 核心中的核心 |
| 2 | 日程系统（日/周/月视图 + 通知） | **P0** | ⬜ 仅 ICS 导出 | **高** — 没有日程视图就没有"今天做什么" |
| 3 | 地点系统（坐标可靠来源 + 到访闭环） | P1 | ⬜ 部分（走访记录已有） | 中高 |
| 4 | 笔记与语音（录音/转写） | P1 | ⬜ 仅元数据形状 | 中 |
| 5 | 活动发现（真实 Feed 接入） | P1 | ⬜ MOCK/DEMO 数据 | 中高 — 无真实数据则无真实任务 |
| 6 | 项目统一（跨模块聚合强化） | P2 | ◐ 基础已有 | 中 |
| 7 | AI 行动辅助（端到端真实模型） | P1 | ◐ 链路已有，接线缺口 | 中高 — 最后一公里 |
| 8 | Android 稳定性（崩溃/恢复/权限） | P1 | ◐ 冒烟已有 | 高 |
| 9 | 五个真实场景端到端验证 | **P0** | ⬜ 未开始 | **极高** — 最终验收标准 |
| 10 | 电脑智能体架构预留 | P3 | ⬜ 未开始 | 低（远期） |

## 2. Phase 1 — 完整任务系统（16 项能力）

**目标**：用户能在软件里管理一个真实任务的全生命周期。
**16 项能力清单与现状**：

| # | 能力 | 现状 |
|---|---|---|
| 1 | 创建任务 | ✅ REAL（createTaskFromGoal + TaskDetailScreen） |
| 2 | 编辑任务 | ✅ REAL（goal/排期/项目关联可编辑；标题编辑 ⬜ 待确认） |
| 3 | 删除（软删除/撤销） | ◐ deleteTask 存在，撤销⬜ |
| 4 | 优先级 | ⬜ NOT_IMPLEMENTED（task model 无 priority 字段） |
| 5 | 截止时间 | ✅ REAL（dueAt + 逾期红色显示） |
| 6 | 状态机流转 | ✅ REAL（7 态 + 合法流转表 + 单测覆盖） |
| 7 | 子任务（步骤） | ✅ REAL（addTaskStep/updateTaskStep + 规划建议→待办） |
| 8 | 执行记录 | ✅ REAL（timeline + MAX_TIMELINE_EVENTS=500） |
| 9 | 关联项目 | ✅ REAL（projectId + linkTaskToProject） |
| 10 | 关联地点 | ◐ placeId 在 notes 有；任务↔地点直接关联 ⬜ |
| 11 | 关联日程 | ✅ REAL（scheduledDate + isTaskOnDate） |
| 12 | 关联笔记 | ✅ REAL（note.taskId） |
| 13 | 搜索/筛选 | ✅ REAL（TasksScreen 过滤词表；跨字段搜索 ⬜） |
| 14 | 完成历史 | ✅ REAL（HistoryScreen + completed/failed 状态） |
| 15 | 失败重试 | ◐ failed→running **不在** TRANSITIONS 表（重试需先 review_required 中转或补充流转） |
| 16 | 异常退出恢复 | ✅ REAL（envelope + quarantine + Capacitor Preferences 镜像） |

**Phase 1 缺口（实现顺序）**：
1. 任务优先级字段（additive：`priority`，normalize 填 `normal`）
2. 失败重试：TRANSITIONS 增加 `failed: ["ready"]`（重试 = 重新就绪）——**受保护核心**，须先跑基线再最小 diff
3. 任务标题编辑
4. 任务↔地点直接关联（additive：`task.placeId`）
5. 跨字段搜索（标题/goal/笔记文本）

**验收（DoD）**：用户能创建实际任务 → 设置日期 → 关联地点 → 添加笔记 → 修改 → 完成 → **应用重启后所有记录完整可见**。

## 3. Phase 2 — 日程系统

- ⬜ 日视图（今日待办已有雏形）/ 周视图 / 月视图（MyWeekendScreen 仅周时间线原型）
- ⬜ 系统通知（Android LocalNotifications 插件未接入；当前仅 registration.remindAt 字段存储）
- ⬜ 日历集成强化（ICS 导出已有 REAL）
- 排期视图数据源：`isTaskOnDate` + `scheduledDate`/`dueAt` 已就绪，纯 UI 工作
- **验收**：用户创建带日期任务后，能在周/月视图看到它，到提醒时间收到系统通知

## 4. Phase 3 — 地点系统

- ◐ 已有：走访记录（addVisit + nextPlan 自动 REVISIT）、状态机（todo/visited/revisit/unsuitable）
- ⬜ 缺口：坐标可靠来源（当前 MapScreen 无真实地图源）、任务↔地点关联、到访导航
- **验收**：用户添加真实地点 → 记录到访 → 复访计划自动出现在对应视图

## 5. Phase 4 — 笔记与语音

- ◐ 已有：text/audio 双 kind 元数据形状（audioPath/audioDurationMs）、笔记 CRUD 完整
- ⬜ 缺口：**录音实现**（MediaRecorder/Capacitor 录音插件全仓无引用）、转写（依赖 AI Phase 7）
- **验收**：用户按住说话 → 录音保存 → 能回放 →（Phase 7 后）转写为文字

## 6. Phase 5 — 活动发现（真实数据）

- ⬜ 当前活动数据为 DEMO/MOCK（demo-chain 有明确的 demo 徽标体系，诚实标注良好）
- ⬜ 真实 Feed 来源接入（searchActivities 客户端已指向 pipeline /api/search，服务端为静态数据）
- **验收**：用户搜到的活动至少一类来自真实数据源，DEMO 徽标准确区分

## 7. Phase 6 — 项目统一

- ◐ 已有：ProjectRepository（软删除归档、origin 诚实标注）、getProjectBundle 聚合、项目复盘
- ⬜ 缺口：项目仪表盘强化（进度百分比、跨模块时间线合并）
- **验收**：一个项目页能看到目标→任务→活动→笔记→复盘的完整故事线

## 8. Phase 7 — AI 行动辅助（端到端真实模型）

**审计确认的链路现状**：
- ✅ 完整：config（mock/real 降级）→ provider contract → HunyuanProvider（fetch 注入、超时、429/5xx 降级）→ budget/cache/eligibility gate → withAiAssist bridge → fallback → runner `deps.aiClient`（opt-in）
- ⬜ **关键缺口**：`workbench-store.runTask(id, {skillIds})` **没有传 `aiClient`** —— UI 运行的任务永远走纯确定性路径。浏览器 bundle 内也无 key 注入点（设计如此，key 不能进 bundle）
- ⬜ 需要决策的接线方案：桌面壳注入（hostEnv 已支持 GORGON_AI_API_KEY）或 Android 壳内安全存储 + bridge
- **验收**：用户配置 key 后，复杂任务（长文本/unknown intent/失败重试）在 UI 中真实调用模型，处理方式面板显示真实 provider/model/token

## 9. Phase 8 — Android 稳定性

- ◐ 已有：build-smoke、APK 冒烟 6/6、pwa offline/install 检查、quarantine 持久化
- ⬜ 缺口：崩溃恢复验证（进程被杀后重启数据完整）、权限拒绝降级路径、长会话内存
- **验收**：强杀进程 → 重启 → 全部数据无损；拒绝全部权限 → 核心功能仍可用

## 10. Phase 9 — 五个真实场景端到端（最终验收）

| 场景 | 依赖 Phase | 验收 |
|---|---|---|
| A 参加活动 | 1/2/3/5 | 搜真实活动→报名→日程→到访→笔记→复盘全链路 |
| B 求职 | 1/2/4 | 职位线索→投递任务→面试日程→录音笔记→复盘 |
| C 地推 | 1/3/4 | 地点清单→走访路线→现场笔记→复访计划 |
| D 学习 | 1/2 | 学习计划→每日任务→完成历史 |
| E 个人日常 | 1/2 | 快速待办→提醒→完成 |

**验收方式**：每个场景在模拟器（或真机）完整走一遍，全程不崩溃、数据重启不丢、诚实徽标准确。

## 11. Phase 10 — 电脑智能体架构预留

- ⬜ 仅设计文档（接口预留，不实现）；复用 task-router/eligibility 的确定性边界

## 12. 执行纪律（对齐任务书）

1. 每轮走 10 步迭代：读状态 → 选最高优先级 → 写验收条件 → 实现 → 测试 → 修复 → 场景 → 记录 → 更新状态 → 继续
2. 代码改动前先跑基线测试（当前 333/333 + 18/18）；最小 diff；不删不覆盖稳定代码
3. 受保护核心（trust/dedupe/review/normalize/ranker）未经授权不改
4. TRANSITIONS 表改动属核心模型改动：先补测试再改表
5. API Key 永不入仓库；APK/keystore/dist 不入库
6. 提交走 conventional 前缀；push 前注意本地领先远端 6 提交的现状
7. 禁止无限开发：每项通过验收即停，自动选择下一项
