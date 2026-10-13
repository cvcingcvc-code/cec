# END_TO_END_GAP_ANALYSIS — 主链路逐节点缺口分析

> 生成时间：2026-10-13 GMT+8
> 方法：源码审计 + 测试套件核实（441/441 PASS 基线之上）
> 主链路：手机创建任务 → 关联时间地点 → 提醒 → 笔记 → 持久化 → 选电脑任务 → 网关鉴权 → 电脑执行 → 查状态 → 回结果 → 手机显示 → 结果关联原任务 → 完成归档

## 逐节点标记

| # | 节点 | 标记 | 证据 |
|---|---|---|---|
| 1 | 手机创建任务 | **REAL** | `createTask`（task-model L202+，v2 schema 完整）；App L301 `createTaskFromGoal`；441 测试含 task-engine/task-engine 系列全绿 |
| 2 | 关联时间（日期） | **REAL** | `dueAt`/`scheduledDate` 字段 + `localDateStr`/`isTaskOnDate`（本地日期，非 UTC 陷阱）；v23-calendar + v23-schedule-view 测试存在且绿 |
| 3 | 关联地点 | **REAL（部分 UI 弱）** | 数据层 `placeId` + `linkTaskToPlace`（store L269）+ NotesScreen/TaskDetail 可选地点；**TaskNewScreen 创建时无地点输入**（TaskDetailScreen L669 可后补） |
| 4 | 设置提醒 | **REAL（NOT_TESTED 真机）** | `remindAt` 字段 + native-reminders.js（31-bit id 去重、过期跳过、null 取消）+ AndroidManifest 权限 + v3-reminder-model 19 测试；真机系统通知触发未验证 |
| 5 | 保存笔记 | **REAL** | note-import.js（append-only）+ store addNote/updateNote + App L673 任务笔记 + NotesScreen 任务跳转链接 |
| 6 | 数据持久化 | **REAL（真机 NOT_TESTED）** | Capacitor Preferences 镜像 + native-persistence 9 测试；Android 真机重启保留未验证 |
| 7 | 手机选电脑任务 | **REAL（NOT_TESTED 真机）** | AgentScreen `/v1/executors` 白名单下发 + `/v1/runs` 提交；真机 HTTP 连接未验证 |
| 8 | 网关鉴权接收 | **REAL** | X-Gorgon-Token 校验 + auth_fail 审计 + 401；token 0o600 权限存储 |
| 9 | Windows 电脑执行 | **REAL** | 3 个白名单执行器（repo.status / repo.readDoc / host.stats），spawn 无 shell、10s git 超时、60s 硬超时 |
| 10 | 查询执行状态 | **REAL** | GET /v1/runs/:id（timeline 完整）+ 列表轮询 |
| 11 | 返回执行结果 | **REAL** | 结构化 `{ summary, output }`，诚实状态，绝不伪造 |
| 12 | 手机显示结果 | **REAL（NOT_TESTED 真机）** | AgentScreen 状态标签 + 结果渲染；真机显示未验证 |
| 13 | **结果关联到原始任务** | **MISSING** | **全仓 grep 无 agentRunIds/runIds 关联字段**：AgentScreen 的执行记录与任务系统完全割裂，用户需手动复制结果 |
| 14 | 完成任务并归档 | **REAL** | 状态机流转 + timeline + HistoryScreen |

## 缺口汇总（按阻断严重程度排序）

### GAP-1（P0，主链路断点）：任务 ↔ 网关执行记录无关联

- 现象：手机任务系统（workbench-store tasks）与 AgentScreen 执行记录（localStorage + 网关 runs.json）是两套割裂数据。任务详情页看不到任何电脑执行结果。
- 影响：主链路第 13 步断裂，用户必须手动复制粘贴，四大场景之「电脑智能体协助」闭环不成立。
- 修复方向（最小侵入）：
  1. task 增加 `agentRunIds: string[]`（向后兼容，旧数据缺省为 `[]`）。
  2. AgentScreen 提交时可选关联任务（传入 taskId），提交成功后把 runId 写回任务 metadata/timeline。
  3. TaskDetailScreen 显示关联执行记录（状态 + summary + 时间）。
  4. store 提供 `linkTaskToAgentRun(taskId, runId)` 幂等方法。

### GAP-2（P1）：任务创建时无地点输入

- 现象：TaskNewScreen/WorkbenchHome 快速创建只有 goal 文本；地点需进详情页后补。
- 影响：场景 B（外勤）多一步操作；不阻断主链路。
- 修复方向：创建表单加可选地点下拉（数据层已支持 placeId）。
- 决策：**本轮修**（改动小、纯 UI+已有数据层）。

### GAP-3（P1）：电脑执行器缺少「任务生命周期完整状态」

- 现象：Gateway 状态词汇为 queued/running/completed/failed/cancelled；任务书要求 CREATED/QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED/TIMED_OUT。缺 TIMED_OUT 独立状态（超时现归为 failed，error 带 "hard timeout" 前缀——语义可区分但状态不独立）。
- 影响：不阻断；手机端通过 error 字符串可识别超时。
- 决策：**本轮最小增强**——超时时 status 标记为独立值，手机端词汇表同步，保持向后兼容（旧记录不变）。

### GAP-4（P2）：真机侧 NOT_TESTED 项（无 ADB 设备，不可修复）

- 真机通知触发、真机持久化重启保留、真机局域网连网关、真机显示结果。
- 处理：保留 `DEVICE_E2E=NOT_TESTED`，输出用户回家验收清单。

### 非缺口确认

- 日程联动（任务安排到日期、日程页可见、完成后一致）：数据层+测试已齐（v23-calendar/schedule-view 全绿）→ REAL。
- 笔记服务任务：任务笔记 + 跳转已实现 → REAL。
- 提醒重复调度：31-bit hash 通知 id 去重 → REAL。
- 网关安全：白名单、路径逃逸防护、审计、单并发、超时 → REAL，本轮仅强化 TIMED_OUT 与日志脱敏复查。

## 处理顺序

1. GAP-1（P0）：任务↔执行记录关联（Phase B3 核心，先做数据层+store+屏幕）。
2. GAP-3（P1）：TIMED_OUT 独立状态（Gateway + 手机端词汇）。
3. GAP-2（P1）：创建时选地点（小 UI 增强）。
4. GAP-4（P2）：真机项保持 NOT_TESTED + 验收清单。
5. 每步修完跑 441 基线回归。
