# V3E 功能闭环执行状态（V3E_FUNCTIONAL_EXECUTION_STATE）

> 本文档是 V3E 单智能体长周期自主开发任务的持续状态记录。
> 上下文压缩前必须更新此文档。每完成一个任务包追加一节。

## 现场信息（不变量）

- 正式仓库 remote：`cec`（https://github.com/cvcingcvc-code/cec）
- 集成主线：`feature/gorgon-opportunity-v2`，本轮起点 `6bf4116`（v0.3.2-alpha / Android v6.0.3）
- 本轮工作区：worktree `F:\Gorgon-Parallel\functional`，分支 `feat/v3e-functional-closure`
- 测试命令：`cd app && node --test tests/*.test.mjs`（Node 22.22.2 managed）
- 基线：503 tests / 502 pass / 0 fail / 1 skipped（codex adapter REAL read-only 诊断显式跳过）

## 禁止事项（每轮提醒）

- 禁止 `git reset --hard` / `clean -fd` / `push --force` / push 到 geergong
- 禁止删测试制造全绿；禁止在工作树脏时执行破坏性 git 操作
- commit 用 conventional 前缀；push 目标只能是 `cec feat/v3e-functional-closure`

## 任务包 A：任务系统完善（P0）— DONE

### 缺口评估结论（2026-10-13）

按 REAL/PARTIAL/MOCK/DEMO/NOT_IMPLEMENTED 重新审查任务包 A 十项重点：

| # | 重点 | 状态 | 证据 |
|---|------|------|------|
| 1 | 优先级字段（高/中/低） | REAL | `task-model.js TASK_PRIORITY` + `setTaskPriority` + TasksScreen 徽章 + 详情页选择器（旧验收矩阵 A1-6 标记过时） |
| 2 | 失败重试 | REAL | `TRANSITIONS.failed:["ready"]` + NEXT_ACTION 重新就绪按钮 |
| 3 | 删除/撤销/恢复 | **NOT_IMPLEMENTED→REAL（本轮补齐）** | store 有 deleteTask 但无 UI；Notes/Places 用 window.confirm 一键硬删无撤销 |
| 4 | 任务关联地点 | REAL | `placeId` + `linkTaskToPlace` + 详情页 select（A1-8 标记过时） |
| 5 | 任务关联项目 | REAL | `projectId` + `linkTaskToProject` |
| 6 | 任务关联日程/笔记 | REAL | `dueAt/scheduledDate` + `setTaskSchedule` + `setTaskReminder` + 任务笔记 |
| 7 | 跨字段搜索 | REAL | `searchTasks`（title/goal 大小写不敏感）+ TasksScreen 搜索框 |
| 8 | 历史记录 | REAL | `HistoryScreen collectRecentActivity` 全任务 timeline 倒序聚合 |
| 9 | 持久化 | REAL | v2 信封 localStorage + v1 一次性迁移 + 损坏隔离归档 |
| 10 | 异常降级 | REAL | 私有模式/配额内存回退 + normalizeTask 防御性读取 |

### 本轮实现（soft delete / undo / restore）

**语义**：`deleteTask` → 软删除（`deletedAt` 可加性字段，旧数据兼容），30 天窗口内可恢复；彻底删除需显式操作。

**改动文件**：

1. `app/src/store/task-repository.js`
   - `listTasks()` 改为可见列表（过滤 `deletedAt`）；新增 `listTasksRaw()` 全量读取
   - 内部所有变更路径（updateTask/transitionTask/addTaskStep/updateTaskStep/addTaskSource/deleteTask/restoreTask/getDeletedTasks/deleteTaskForever/purgeExpiredDeletedTasks）走 `listTasksRaw()`
   - `deleteTask`：软删除（保留首个 deletedAt，重复删除不覆盖时间戳），返回可见列表
   - 新增 `restoreTask`（清除 deletedAt + `task_restored` timeline 事件，返回可见列表；未删除/缺失安全 no-op 返回 null）
   - 新增 `getDeletedTasks`（仅软删除记录，按删除时间倒序）
   - 新增 `deleteTaskForever`（原硬删除语义，兼容 `task-engine.test.mjs` "deleteTask removes exactly one task"）
   - 新增 `purgeExpiredDeletedTasks(nowIso)`（`DELETED_RETENTION_MS=30 天`，仅清理过期记录）
   - `getTask` 改走全量读取（软删除任务仍可通过详情路由找到）

2. `app/src/store/workbench-store.js`
   - Facade 暴露 `deleteTask`（软删除）/`restoreTask`/`getDeletedTasks`/`deleteTaskForever`/`purgeExpiredDeletedTasks`
   - `restoreTask` 记录 `task_restore` 平面日志事件

3. `app/src/screens/TaskDetailScreen.jsx`
   - 新增 `onDelete` 可选 prop + 详情页底部"删除任务"按钮（`workbench-detail-delete` testid，confirm 说明 30 天恢复路径）
   - EVENT_LABEL/EVENT_ICON 增加 `task_restored`（任务恢复 / rotate-ccw）

4. `app/src/screens/HistoryScreen.jsx`
   - 新增回收站区块（`workbench-history-trash` testid）：已删除任务显示标题/删除时间/剩余天数
   - 新增 `onRestoreTask`（恢复按钮 `workbench-trash-restore`）/`onDeleteTaskForever`（彻底删除按钮 `workbench-trash-delete-forever`，confirm 不可撤销）
   - 新增 `remainingDays(deletedAtIso)` 纯函数导出
   - `deletedTasks` 由 App.jsx 通过独立 prop 传入（可见列表已过滤软删除，不能复用 `tasks` prop）

5. `app/src/App.jsx`
   - TaskDetailScreen 接线 `onDelete`（软删除→刷新→回列表→flash 30 天提示）
   - HistoryScreen 接线 `deletedTasks={WBStore.getDeletedTasks()}` + `onRestoreTask` + `onDeleteTaskForever`

### 测试（v3e-task-delete-undo.test.mjs，8 用例全绿）

1. deleteTask 软删除（deletedAt 设置、列表隐藏、getTask 可找到、重复删除不覆盖时间戳）
2. restoreTask 恢复（清除 deletedAt、task_restored 事件、重新可见）
3. restoreTask 拒绝未删除/缺失任务（安全 no-op）
4. deleteTaskForever 彻底删除（getTask 也找不到）
5. getDeletedTasks 只返回软删除、删除时间倒序
6. purgeExpiredDeletedTasks 窗口边界（未过期保留、未来 cutoff 全清）
7. 软删除任务对 open/overdue/today 辅助函数隐藏
8. 删除→恢复保留用户数据（优先级/排期/标题不变）

### 验证结果

- 新测试：8/8 pass
- 全量：**511 tests / 510 pass / 0 fail / 1 skipped**（基线 503 + 8 新增，零回归）
- Vite build：✓ built in 5.71s（仅既有 chunk 大小警告，非本轮引入）
- Commit：`feat(tasks): ...`（见 git log）

### 下一步

任务包 B：日程与提醒完善（P0）——今日/周/月视图已有（schedule-view/calendar + ScheduleScreen），
本地通知已桥接（native-reminders），重点核对：提醒取消、过期处理、权限降级的真实状态，补缺口。

## 任务包 B：日程与提醒完善（P0）— DONE

### 缺口评估结论（2026-10-13）

| # | 重点 | 状态 | 证据 |
|---|------|------|------|
| 1 | 今日/周/月视图 | REAL | ScheduleScreen 月历+本周 SegmentedControl、WorkbenchHome 今日待办、schedule-view 纯助手（weekRange/monthRange/groupTasksByDate） |
| 2 | 本地通知 | REAL | native-reminders 完整桥接（schedule/cancel/权限/31-bit 哈希去重） |
| 3 | 提醒取消 | REAL | 详情页清除提醒按钮 + cancelReminder + null 清除路径 + fire-and-forget |
| 4 | 过期处理 | REAL | overdueTaskIds banner + isOverdue + 过去时间诚实跳过通知 |
| 5 | 权限降级 | REAL | checkPermission/requestPermission 真实 API + unsupported 诚实提示 |
| 6 | 应用内提醒触发 | **NOT_IMPLEMENTED→REAL（本轮补齐）** | reminderDueTasks 纯查询存在但无 UI 轮询——Web 环境提醒保存后到期无反应 |

### 本轮实现（in-app reminder firing）

1. `app/src/workbench/reminder-fire.js`（新文件，纯模块）
   - `pickDueReminders(tasks, nowIso, { notifiedIds, graceMs })`：到期判定（remindAt ≤ now 且未超过 grace 窗口默认 6h）+ firedKey 去重（`${taskId}:${remindAt}`，同一时间只触发一次，新时间重新武装）
   - 终态任务（completed/failed）永不提醒；无效 remindAt 跳过不猜测
   - 导出 `REMINDER_POLL_MS`（30s）/`NOTIFIED_STORE_KEY`/`REMINDER_GRACE_MS`/`firedKey`

2. `app/src/App.jsx`
   - 30s 轮询 useEffect（cleanup 正确，轮询永不 crash 应用）
   - 去重记录持久化 localStorage（cap 500，§32 边界；私有模式降级 per-session）
   - 每轮最多一条 toast（最早到期的）——永不 toast 风暴；多条时提示"还有 N 条提醒到期"
   - Native shell 已有系统通知，本路径是 Web/无插件会话的诚实 fallback

### 测试（v3e-reminder-fire.test.mjs，5 用例全绿）

1. 到期判定（due 触发、future 等待）
2. firedKey 去重（同时间不重复触发、新时间重新武装）
3. 终态/无提醒/无效日期跳过
4. grace 窗口边界（超 6h 的陈旧提醒诚实跳过）
5. 常量导出（轮询间隔 ≥15s、存储键 gorgon_ 命名空间）

### 验证结果

- 新测试：5/5 pass
- 全量：**516 tests / 515 pass / 0 fail / 1 skipped**（511 + 5 新增，零回归）
- Vite build：✓ built in 10.03s
- Commit：`feat(reminders): in-app reminder firing ...`（见 git log）

### 下一步

任务包 C：地点、走访与笔记（P1）——核对走访状态流转（待走访/已走访/需复访/不适合）、
地点笔记、TXT/MD 导入（v3-note-import 已有测试），补真实缺口。
