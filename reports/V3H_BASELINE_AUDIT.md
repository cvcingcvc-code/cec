# Gorgon Workbench — V3H 基线审计（2026-10-15）

> 本轮以真实可用性为核心的自主开发轮基线。所有数字为实际运行所得，非继承历史报告。

## 一、仓库与工作树现状（实际核实）

- 正式仓库：`cvcingcvc-code/cec`（remote `cec`）；旧 `origin` 指向 `geergong`（不再使用）。
- **最新功能分支**：`feat/v3g-agent-results-zh` @ `974b9a0`（本地 F:/Gorgon-Parallel/v3g 与远端一致，除 gradle 行尾差异 + release-apk/ 未跟踪产物）。
- 主开发分支 `feature/gorgon-opportunity-v2` @ `a48f919`（远端）；v3g 领先其 6 个提交（中文结果展示 + APK 交付），merge-base = `a48f919`。
- 主仓库工作树（Gorgon-Workbench）：仍在 `feature/gorgon-opportunity-v2` @ `6524f44`，**落后远端 25 commits**，且存在大量他人未提交改动（删文件/改文件）与 `v3f2_deploy_backup_20261014/`。**本轮不触碰、不清理、不重置**。
- 其他 worktree：functional（bf25893，pipeline 数据 dirty=运行态正常）、gateway（clean）、reviewer（clean）、android（F 盘）。
- PR #6：OPEN Draft，6 commits（d01f912/d02ebff/db1064c/8023616/0b20a81/974b9a0），等真机验收合并。
- Release：`v0.3.5-alpha`（3,848,241 bytes，SHA256 `3935c609a0d3e195bdedde6ff2afc0a5a9ebdd11e6bfbf343ba04c34b62cce81`）已发布；v0.3.0~v0.3.4 全部保留。

## 二、功能完整度审计（以 974b9a0 代码为准）

| 模块 | 状态 | 证据 |
|---|---|---|
| 统一任务模型 | ✅ 完整 | task-model.js §2 schema：id/title/goal/status/dueAt/scheduledDate/projectId/placeId/priority/remindAt/agentRunIds/steps/result/sources/timeline/failureReason |
| 工作台首页 | ✅ 真实数据 | WorkbenchHome：今日待办（getTodayTasks）/待完成数/项目卡/最近任务/最近笔记/工作台状态，全部来自 store facade |
| 自然语言创建任务 | ✅ 引擎接线 | createTaskFromGoal → WBStore.addTask（真实 createTask 工厂）；unknown 意图如实显示"未识别（需手动选择工具）" |
| 任务生命周期 | ✅ | 状态机 transition（created→ready→running→completed/failed）+ 软删除 30 天回收站 + 复盘 |
| 活动系统 | ✅ | Discover 真实来源 + data-sync 手动刷新（缓存/离线如实）+ activity-recency 时效模型 + demo 泄漏修复 |
| 日程系统 | ✅ | ScheduleScreen + reminder-fire（firedKey 去重）+ native-reminders 桥 |
| 地点系统 | ✅ | PlacesScreen + place 关联 + 走访状态 |
| 笔记与复盘 | ✅ | NotesScreen + note-import + 任务↔笔记关联 + 项目复盘 |
| Gateway（电脑端） | ✅ | agent-gateway.mjs：token 配对（S1）/执行器白名单（S2）/超时（S3）/审计（S4）/真实状态（S5）/默认 loopback（S6）/单并发（S7）；执行器 repo.status、repo.readDoc、host.stats、codex.readonly-diagnosis |
| Codex 适配 | ✅ 代码级 | codex-adapter.mjs：read-only 沙箱、预批准模板、BLOCKED_AUTH/NETWORK/USAGE_LIMIT 诚实状态；真实调用 P1 SKIP（设计如此） |
| 手机端 Agent 界面 | ✅ | AgentScreen：连接/执行器列表/提交/轮询/取消/技术详情折叠/结果关联任务/离线 mirror |
| 手机↔电脑闭环 | ✅ 代码级 / ⚠️ 真机未验 | v3b-system-e2e 真实 HTTP 链路 PASS；DEVICE_NOT_TESTED |

## 三、测试基线（本轮实际运行）

| 套件 | 结果 |
|---|---|
| Node `npm test`（禁用 safe-delete shim：`CODEBUDDY_SAFE_DELETE_ENABLED=0`） | **563 项：562 pass + 1 SKIP + 0 FAIL** |
| Node `npm test`（带 shim，作为对照） | 12 FAIL 全部为 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 环境误报（shim 拦截测试临时目录清理，失败集合两次运行不一致，单文件运行全绿） |
| Python pipeline（unittest discover） | **472 tests OK (skipped=1)** |
| 单独 v3c-gateway-lifecycle | 8/8 |
| 单独 v3c-codex-adapter | 10 pass + 1 SKIP（Codex 真实调用 P1） |
| 单独 v3d-gateway-injection-security | 11/11 |
| 单独 v3b-system-e2e | 2/2（连跑 3 次稳定） |
| skills + task-engine | 45/45 |
| adb devices | 空（无物理设备） |

**环境干扰记录**：WorkBuddy CLI 的 node-safe-delete-shim 会在进程累计删除 >50 个目标时抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`。全量套件（63 文件）清理临时目录必然超阈值 → flaky 12 失败。**非代码缺陷**。全量绿需 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（或无沙箱环境）。

## 四、云端部署现状（实际核实）

- `https://2109679843717304320.app.workbuddy.host`：
  - `/api/health` → 200
  - `/api/activities` → 200，**33 条记录（17 demo=true + 16 demo=false，全部显式布尔 demo）**，generatedAt=2026-10-14T18:48:44+08:00
- V3F2 报告中"部署缺 /api/activities 端点"问题**已解除**（bf25893 逻辑已在线上生效）。

## 五、真实缺口（本轮目标）

1. **【P1·场景 A 阻断】面试准备类目标路由失败**：
   - `明天下午我要去面试，帮我整理准备事项。` → routeTask 返回 `unknown`（conf=0），引擎不产生任何步骤。
   - 根因 1：extract-skill `relDate` 正则负向断言 `(?![一-日])` 字符范围 U+4E00–U+65E5 过宽——"明天下午"的"下"(U+4E0B)、"明天我"的"我"(U+6211) 均落在范围内 → 相对日期全部匹配失败（只有"明天"+标点/EOF 才能匹配）。
   - 根因 2：task-router 关键词表不含"准备/事项/清单"类词——"帮我整理准备事项"既不命中 extract（缺'待办'字面）也不命中 plan。
   - 影响：任务书场景 A（面试准备）与场景 C（个人项目）的自然语言入口直接 unknown。
2. 主工作树落后 25 commits + 他人未提交改动：不动（避免破坏）。
3. PR #6 待真机验收：保持 Draft，不合并。
4. 真机验收 DEVICE_NOT_TESTED：无物理设备，本轮只能交付代码级验证。

## 六、本轮计划（时间盒内）

1. 修复 relDate 正则（负向断言收窄为星期/周末词）+ router 扩词（最小 diff）。
2. 补充对应回归测试（面试场景 A 路由 + 抽取）。
3. 全量回归（Node + Python + build）。
4. 提交推送 v3g 分支 → 更新 PR #6 描述。
5. 重建 APK（versionCode 11 / versionName 6.0.6）→ 新 Pre-release。
6. 生成 GORGON_FINAL_HANDOFF.md。
