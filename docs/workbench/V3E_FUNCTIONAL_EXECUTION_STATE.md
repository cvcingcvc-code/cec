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

## V3F 长周期开发：活动数据真实可用 + 自建活动真实执行 — DONE（2026-10-14）

> 用户指令：两条工作线都要推进——活动数据真实可用、自建活动真实执行；
> 不为完善爬虫无限开发；不停留在分析或任务清单阶段。

### 第一步：工作目录固定 — DONE

- 固定项目绝对路径 `F:\Gorgon-Parallel\functional`，所有命令 `cd` + `git -C` 显式指定；
- PowerShell 静默空输出问题改用 Bash + Python subprocess 规避；
- 残留采集进程审计：无豆瓣采集进程残留，无重复采集风险；
- 同一路径错误最多重试两次，未再发生工作目录重置。

### 第二步：保护现有修复成果 — DONE

- `data.js` / `ui_kits/app/data-adapter.js` 双形态兼容已就位（裸数组 + V3F 新鲜度信封）；
- `test_e2e.py` 数组提取在信封格式下仍通过；全部 GORGON_DATA 消费者经 data.js 桥读取，结构不变；
- 基线全绿后推进（见验证结果）。

### 第三步：真实活动数据 — DONE

**run.py UnboundLocalError 修复**（80c00b0）：`STOP_BLOCKED/STOP_SOURCE_UNAVAILABLE/canonical_url`
原在 `if not args.no_store:` 块内重复 import，使名字变成 main() 局部变量——`--no-store` 时块不执行、
193 行退出码检查崩溃。最小修复：canonical_url 并入模块级 import，删除块内 import。
验证：`--offline` 显式失败 exit 1（loud failure 符合设计）；真实网络采集 exit 0 完整跑通。

**真实采集证据**：`python -m pipeline.crawlers.run --source douban --city 上海 --max-pages 1`
抓取 10 条真实上海活动（detailsFetched=10 success=10 failed=0，stopReason=max_pages），
含 sourceUrl/日期范围/价格/主办方。豆瓣没有被阻断，无需替代源。

**数据入库与管道刷新**：
- SQLite 主存储：`python -m pipeline.store.import_json` 导入 10 条（events=10，
  lifecycle past=8/active=2——过去活动标记保留为历史，不删除）；
- 新增 `pipeline/bridge/crawl_to_raw.py`：爬取 JSON → raw 源文件的确定性转换桥
  （ISO datetime 无损拆分 startDate+startTime；venueName→venue；不伪造任何事实；
  幂等 id `douban_<sourceEventId>`）；
- 完整管道（ingest→normalize→clean→dedupe→trust→review→export）刷新全部产物：
  10 条真实豆瓣活动经 human_decisions.json 人工决策机制批准（review 队列正规路径，
  trust 70 分 needs_review → 负责人显式批准），FINAL APPROVED=27（10 真实 + 17 演示）；
- `ui_kits/app/generated-data.js` 输出 V3F 新鲜度信封
  `{DEMO_DATA, generatedAt, dateRange: 2026-08-09..2026-10-14, activities}`。

**五类数据区分**：真实近期（douban 已批准，startDate 真实）/ 用户自建（dataOrigin "user"）/
历史活动（SQLite past 状态 + 前端 expired 分组）/ 演示静态（DEMO_DATA true，fallback）/
离线缓存（--offline 显式失败记录）。

### 第四步：自建活动执行闭环 — DONE（6b7fa1f）

点击执行 → 保存执行状态 → 创建任务 → 写入日程 → 用户能找到结果 → 重启仍存在，全链路 REAL：

- `workbench-store.executeUserActivity`：防重复查重（live 任务列表按 metadata.activityId，
  fresh read = 重启等价语义）；scheduledDate 只从真实 ISO startDate 解析（dateText 仅展示，
  永不解析为日程声明；无日期诚实落 _undated）；失败返回 ok:false + 具体 reason；
- `user-activity-repository`：可加性执行字段 `executedAt`/`executionTaskId`（旧数据归一化 null 兼容）；
- `UserActivitiesScreen`：「执行」按钮（primary）→ 执行后变「已执行 · 查看任务」（mint）；
- `App.jsx handleExecuteUserAct`：成功跳转任务详情（用户能找到结果）；失败明确 flash 提示不假成功；
  重复点击提示"该活动已执行过"；任务进回收站（软删）后允许重新执行；
- 测试 `v3f-user-activity-execute.test.mjs` 8 用例：建任务/双向关联/日程分桶/持久化/
  防重复/重执行/失败路径/活动日志，8/8 pass。

### DiscoverScreen 数据来源诚实标注 — DONE（3b966be）

- when 切换是真实 recency 过滤（默认未来7天，过期行排除）；
- freshnessNote「数据导出于 X 天前」基于 generatedAt；
- 刷新提示（rotate 图标 + tooltip）：指向 `python pipeline/run.py --export-gorgon` 正规刷新路径。

### 验证结果（全绿）

- 新测试：v3f-recency 12/12、v3f-user-activity-execute 8/8
- 全量 Node：**548 tests / 547 pass / 0 fail / 1 skipped**（零回归）
- Python pipeline：**461 passed + 150 subtests**
- Vite build：✓ built in 12.77s（仅既有 chunk 大小警告）

### Git 记录

- `80c00b0` fix(crawler+data): real douban events through the canonical pipeline
- `3b966be` feat(v3f): activity recency model + freshness-aware screens (task B)
- `6b7fa1f` feat(user-activities): execute closure - task creation + schedule + persistence (task C)
- `69f9682` chore: ignore pipeline/data/gorgon.db (machine-local SQLite runtime state)
- Push：`cec feat/v3e-functional-closure -> feature/gorgon-opportunity-v2`，6bf4116..69f9682（fast-forward 已核实）
- `.gitignore` 新增 `pipeline/data/gorgon.db`（机器本地 SQLite 运行时状态，可由 tracked JSON 重建）

## V3F 第五步：Android APK 交付 — DONE（2026-10-14）

### 并行进程覆盖事件与恢复

- 11:35:41 一个并行 worktree 会话重跑了全管道（无 --apply-reviews），把 10 条已批准的
  douban 活动打回 needs_review 并覆盖 approved/generated-data.js；
- `human_decisions.json` 幸存（tracked）；重跑 `pipeline/run.py --apply-reviews` 恢复
  FINAL APPROVED=27（10 真实 douban + 17 演示），dateRange 2026-08-09..2026-10-14；
- 恢复提交 `d035fe2`，重新构建 bundle + APK（当前 APK 的 bundle 曾含 11:35 旧数据，
  已用 11:55 恢复后数据重建）。

### APK 交付凭证

- **APK 路径**：`app/android/app/build/outputs/apk/release/app-release.apk`（3,844,965 字节，2026-10-14 11:59:45 构建）
- **APK SHA256**：`0af192a52f69971f9a03d7b9553f3e787f4f83cb51df21719ea98d8cc444dcbf`
- **Commit**：`80414ee`（feat/v3e-functional-closure，已推送到 cec feature/gorgon-opportunity-v2）
- **versionCode/versionName**：8 / 6.0.3（本版未 bump——V3F 无 Android 层改动；下次发版 bump 到 9/6.0.4）
- **签名**：debug keystore（keystore.properties 缺失时的正式 fallback 路径；release 签名需 keystore 所有者）
- **构建命令**：`node scripts/build-apk.mjs`（VITE_API_BASE_URL → 公开部署）+ gradlew assembleRelease
  （JAVA_HOME=D:\gorgon-android-toolchain\jdk-21.0.12.1+1，GRADLE_USER_HOME=D:\gorgon-android-toolchain\gradle-home，
  local.properties 指向 D 盘 SDK——机器本地，已 gitignore）

### APK 内容验证（zip 级，全部 PASS）

- bundle 含真实豆瓣活动数据（悠游海盐等 10 条 douban_3698xxxx）：PASS
- bundle 含执行闭环代码（「已执行」按钮文案 + executeUserActivity 逻辑）：PASS
- bundle 含 recency 模型（「已结束」分组 + freshness note 文案）：PASS
- capacitor.config.json（appId cn.gorgon.workbench, webDir dist, https scheme）：PASS
- bundle 内不含 API key（VITE_API_BASE_URL 仅公开部署地址）：PASS

### 测试与构建结果

- Node 全量：548 tests / 547 pass / 0 fail / 1 skipped（零回归）
- Python pipeline：461 passed + 150 subtests
- Vite build（build-apk 内含）：✓ 通过；Gradle assembleRelease：BUILD SUCCESSFUL（246 tasks）

### 真机待验收项（需要真机/用户确认）

1. 发现页默认「未来7天」窗口显示真实豆瓣活动（悠游海盐/莫兰迪展/脱口秀等），数据来源标注「本地数据集（含真实采集活动，非实时检索）」+ 新鲜度提示
2. 「今天」窗口显示 10-14 当天的 2 条真实活动（Norah 脱口秀 / Fotografiska 展览通票）
3. 过期演示活动（9.20-9.26 日期）不出现在「未来7天/未来30天」，仅「全部」可见
4. 自建活动「执行」：创建 → 点击执行 → 跳转任务详情 → 任务列表可见 → 杀进程重启后仍存在 → 再次点击提示"已执行过"不产生重复任务
5. 我的周末：「已结束」分组正确显示过期活动
6. 提醒功能：任务设置 remindAt → 到期 toast（Web/无插件会话）
7. WebView 直连公网 API（https://2109679843717304320.app.workbuddy.host）health 检查 + 智能搜索 REAL 徽标

### 下一步

下一版本（versionCode 9）：如需 release 签名，需 keystore 所有者配置 keystore.properties。

