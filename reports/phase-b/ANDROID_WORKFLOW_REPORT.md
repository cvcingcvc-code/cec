# ANDROID_WORKFLOW_REPORT — Phase B1 Android 本地工作台闭环

> 生成时间：2026-10-13 GMT+8
> 结论：**Android 本地任务主流程数据层全链路打通（测试层）；真机验收 NOT_TESTED**

## 1. 统一任务数据（§4.1）— REAL

| 字段 | 存在 | 证据 |
|---|---|---|
| 任务唯一 ID | ✅ | `task.id`（randomUUID） |
| 任务标题 | ✅ | `task.title`（goal 自动派生，24 字截断） |
| 任务说明 | ✅ | `task.goal`（完整文本） |
| 创建时间 | ✅ | `task.createdAt` |
| 计划执行时间 | ✅ | `task.dueAt` + `task.scheduledDate` |
| 完成状态 | ✅ | `task.status`（7 态状态机）+ `completedAt` |
| 关联地点 | ✅ | `task.placeId`（additive，V2.3） |
| 关联笔记 | ✅ | note.taskId（笔记侧关联）+ App L673 任务笔记 |
| 提醒时间 | ✅ | `task.remindAt`（V3 Phase A） |
| 数据更新时间 | ✅ | `task.updatedAt`（updateTask 自动维护） |
| **电脑执行记录（Phase B3 新增）** | ✅ | `task.agentRunIds[]`（additive，旧数据归一化为 []） |

复用现有模型，仅做向后兼容扩展，未破坏旧数据（normalizeTask 兼容测试通过）。

## 2. 任务与日程联动（§4.2）— REAL（测试层验证）

- `isTaskOnDate`：scheduledDate 优先、dueAt 本地日期兜底（`localDateStr`，无 UTC 陷阱）
- 调整日期后旧日期不再展示：`scheduledDate` 覆盖语义 + v23-calendar 测试
- 任务完成状态与日程一致：`isOpenTask` 过滤
- 测试：v23-calendar（33 断言）+ v23-schedule-view 全绿

## 3. 地点关联（§4.3）— REAL

- 数据层：`linkTaskToPlace`（幂等，未知地点拒绝）
- UI：任务详情页「关联地点」下拉（TaskDetailScreen L664+）
- 创建时输入地点：**未实现**（WorkbenchHome 快速创建仅 goal 文本）；用户创建后直接跳转详情页，可在详情页补选——评估后决定不额外改创建表单（避免不必要 UI 改动）
- 无地图导航要求；不引入地图平台

## 4. 笔记关联（§4.4）— REAL

- TXT/MD 导入保留（append-only，2MB 上限）
- 任务笔记：TaskDetail「执行记录（笔记）」卡片（记一笔 + 列表）
- 笔记页跳转任务：note.taskId 链接按钮（NotesScreen L211）
- 编辑不丢数据：updateNote patch 合并；重启可读：localStorage + Preferences 镜像

## 5. 本地数据持久化（§4.5）

| 验证项 | 状态 |
|---|---|
| 创建后立即读取 / 修改后再次读取 | ✅ 单测层（store.test + workbench 系列全绿） |
| 应用关闭后重新打开 | ✅ 数据层（Preferences 镜像）；⚠️ Android 真机重启 = NOT_TESTED |
| 新版本兼容旧数据 | ✅ normalizeTask 兼容测试（pre-B3 数据载入 agentRunIds=[]） |
| 导入笔记不清空原数据 | ✅ append-only 测试 |
| **Android 真机持久化验收** | **NOT_TESTED**（无 ADB 设备；不得将浏览器测试等同于真机） |

## 6. 提醒功能（§4.6）

- Capacitor Local Notifications 保留：31-bit hash 通知 id 去重、过期不调度、null 取消
- Android 权限声明：AndroidManifest ✅（V3 Phase A 已加）
- 通知权限请求、添加/修改/取消提醒、时间字段持久化：✅ 模型层 + v3-reminder-model 19 测试
- **系统通知真机实际触发：NOT_TESTED**（无真机；不宣称已触发）

## 7. 本轮改动

- `app/src/workbench/task-model.js`：+agentRunIds 字段 + AGENT_EVENT_TYPES
- `app/src/store/workbench-store.js`：+linkTaskToAgentRun / getTaskAgentRunIds
- 无破坏性改动；441 → 456 全部通过
