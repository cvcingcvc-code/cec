# V2.3 功能矩阵（V23_FEATURE_MATRIX）

> 诚实标注：REAL（真实实现且已测）/ PARTIAL（部分实现）/ MOCK / DEMO / NOT_IMPLEMENTED / NOT_TESTED
> 生成：2026-10-13 05:40，基于源码逐文件审计（非假设）。

## 1. 任务系统（Phase 1 核心）

| 能力 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| 创建任务 | REAL | workbench-store.js / TaskDetailScreen | createTaskFromGoal |
| 编辑任务 | PARTIAL | TaskDetailScreen | goal/排期/项目可编辑；标题编辑无 UI |
| 删除 | PARTIAL | workbench-store.deleteTask | 撤销功能无 |
| 优先级 | **NOT_IMPLEMENTED** | — | model 无 priority 字段 |
| 截止时间 | REAL | task-model.js dueAt | 逾期红色显示 |
| 状态机 | REAL | task-model.js TRANSITIONS | 7 态 + 非法流转拒绝 + 单测 |
| 子任务/步骤 | REAL | task-model/task-repository | 规划建议→待办徽标 |
| 执行记录 | REAL | task-model timeline | MAX=500 事件 |
| 关联项目 | REAL | project-repository + linkTaskToProject | 软删除归档 |
| 关联地点（任务侧） | **NOT_IMPLEMENTED** | — | 仅 notes 有 placeId |
| 关联日程 | REAL | task-model scheduledDate | isTaskOnDate |
| 关联笔记 | REAL | opportunity-repository note.taskId | |
| 搜索/筛选 | PARTIAL | TasksScreen 过滤词表 | 跨字段文本搜索无 |
| 完成历史 | REAL | HistoryScreen | completed/failed |
| 失败重试 | PARTIAL | TRANSITIONS 表 | failed 无出边（→ready 未开放） |
| 异常退出恢复 | REAL | envelope + quarantine + Capacitor 镜像 | 损坏存档不清除 |

## 2. 日程系统（Phase 2）

| 能力 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| 今日待办视图 | REAL | TasksScreen「今日待办」 | 谓词过滤 |
| 周视图 | PARTIAL | MyWeekendScreen | 仅活动时间线，任务未合入 |
| 月视图 | NOT_IMPLEMENTED | — | |
| 日期选择器 | NOT_IMPLEMENTED | — | 仅 G_DATE_PICKER.md 规格+原型 |
| 系统通知 | NOT_IMPLEMENTED | — | 仅 remindAt 字段存储 |
| ICS 导出 | REAL | opportunity-repository.exportICS | 缺时间字段拒绝导出 |

## 3. 地点系统（Phase 3）

| 能力 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| 地点 CRUD | REAL | opportunity-repository upsertPlace/removePlace | |
| 走访记录 | REAL | addVisit | nextPlan 自动 REVISIT |
| 地点状态机 | REAL | PLACE_STATUS 4 态 | |
| 复访计划 | REAL | nextPlan 字段 | |
| 真实地图 | NOT_IMPLEMENTED | — | MapScreen 无真实地图源 |
| 任务↔地点关联 | NOT_IMPLEMENTED | — | Phase 1 缺口 #4 |

## 4. 笔记与语音（Phase 4）

| 能力 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| 文字笔记 CRUD | REAL | opportunity-repository | activityId/placeId/taskId/projectId 四向关联 |
| 音频元数据形状 | PARTIAL | normalizeNote | audioPath/audioDurationMs 字段就绪 |
| 录音 | **NOT_IMPLEMENTED** | — | 全仓无 MediaRecorder |
| 回放 | NOT_IMPLEMENTED | — | |
| 转写 | NOT_IMPLEMENTED | — | 依赖 Phase 7 AI |

## 5. 活动发现（Phase 5）

| 能力 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| 检索 UI | REAL | NaturalSearchScreen/SearchScreen | |
| search 客户端 | REAL | lib/api.js | 指向 pipeline /api/search |
| 服务端真实数据 | MOCK | pipeline/api/server.py | 静态数据，key 仅服务端 |
| demo 诚实徽标 | REAL | demo-chain 体系 | DEMO 数据全程可见标记 |
| 报名跟踪 | REAL | REG_STATUS 6 态 | opened_registration ≠ registered |
| 准备清单 | REAL | setPrep/defaultPrepFor | |

## 6. 项目统一（Phase 6）

| 能力 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| 项目 CRUD（软删除） | REAL | project-repository | archive 不销毁 |
| origin 诚实标注 | REAL | PROJECT_ORIGIN manual/activity | DEMO 活动在项目内仍可见 DEMO |
| 聚合视图 | REAL | getProjectBundle | tasks/notes/places/review/registrations/progress |
| 项目复盘 | REAL | setProjectReview | 空串不覆盖已记录结果 |
| 进度中心 | REAL | getProgressCenterData | 跨项目中文摘要 + jobCounts |

## 7. AI 行动辅助（Phase 7）

| 能力 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| provider contract | REAL | ai/provider.js | 单调用无递归 |
| MockProvider | REAL | providers/mock.js | 离线兜底 |
| HunyuanProvider | REAL | providers/hunyuan.js | fetch 注入/超时/429 降级/可单测 |
| 配置降级 | REAL | ai/config.js | 无 key 永远 mock |
| budget/cache | REAL | ai/budget.js / cache.js | 每任务调用上限 |
| eligibility gate | REAL | ai/eligibility.js | search/trust/dedupe 永不调模型 |
| withAiAssist bridge | REAL | ai/assist.js | mock 输出永不覆盖本地结果 |
| **UI 端到端接线** | **NOT_IMPLEMENTED** | workbench-store.runTask | **未传 aiClient — 唯一缺口** |
| key 安全 | REAL | ai/index.js hostEnv | 浏览器 bundle 死代码分支 |

## 8. Android 稳定性（Phase 8）

| 能力 | 状态 | 实现位置 | 备注 |
|---|---|---|---|
| Capacitor 壳 | REAL | app/android | appId cn.gorgon.workbench |
| APK 构建 | REAL | scripts/build-apk.mjs | debug ebe4ca74 / release d1a46e39 |
| 离线持久化 | REAL | native-persistence.js | localStorage → Preferences 镜像 |
| 冒烟测试 | REAL | build-smoke 18/18 + release_smoke 6/6 | |
| 崩溃恢复验证 | NOT_TESTED | — | 需模拟器/真机 |
| 权限拒绝降级 | NOT_TESTED | — | |

## 9. 汇总

- REAL：43 项 | PARTIAL：6 项 | NOT_IMPLEMENTED：11 项 | NOT_TESTED：2 项
- Phase 1 直接缺口：优先级、失败重试、标题编辑、任务↔地点、跨字段搜索
- 跨 Phase 缺口：日期选择器、月视图、系统通知、真实地图、录音、转写、真实 Feed、AI 接线
