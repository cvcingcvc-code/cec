# SYSTEM_E2E_REPORT — Phase B5+B6 系统级集成与稳定性

> 生成时间：2026-10-13 GMT+8
> 结论：**SYSTEM_INTEGRATION_PASS（电脑端集成，有证据支持）；真机 E2E = NOT_TESTED**

## 1. 四大场景串联（§8）

### 场景一：面试行动流程 — REAL（数据层 + 测试层）

- 创建「准备下午的面试」→ dueAt/scheduledDate → placeId → 提醒 → 笔记 → 状态机流转
- 验证：task-engine + v23-calendar + v3-reminder-model + v22-life-scenarios 测试全绿
- 测试成功来自真实程序执行；无生产界面假记录

### 场景二：地推外勤流程 — REAL（数据层 + 测试层）

- 创建「拜访某个地点」→ Places store → 拜访状态 → 工作笔记
- 验证：workbench-store-places + v23-place-scenario 全绿；已完成/待处理可区分
- 无地图路线规划（按任务书不要求）

### 场景三：活动参与流程 — REAL（数据层 + 测试层）

- 活动记录 → 来源链接手动保存 → 报名任务 → 参与笔记
- 检索链路：现有 NaturalSearchScreen 走真实检索 API（VITE_API_BASE_URL 注入，公网部署）
- 手动保存来源链接能力保留，主流程不依赖外部搜索

### 场景四：电脑协助流程 — REAL（电脑端集成，**本轮最重要验收**）

手机建立任务 → 选择授权电脑操作 → Gateway 接收 → Windows 执行 → 结果返回 → 关联回原任务

**自动化闭环证据**（`app/tests/v3b-system-e2e.test.mjs` 2/2 PASS）：
1. createTaskEntry 建真实任务（workbench-store + 持久化）
2. POST /v1/runs 提交 repo.status 到真实网关进程
3. 轮询至 completed，输出含真实分支名
4. linkTaskToAgentRun 写回 agentRunIds + timeline
5. 持久化重读，agent_run_linked 事件存在
6. 状态机 created→ready→running→completed，link 全程存活

**标记：电脑端集成通过（PC-SIDE INTEGRATION PASS）**。无真实安卓手机参与，不标记真机 E2E。

## 2. 稳定性与异常处理（§9）

| 异常 | 检查结果 |
|---|---|
| 9.1 手机离线 | ✅ 本地数据（localStorage + Preferences 镜像）继续可用；**Phase B3 镜像模块让执行记录离线可查**（agent-runs-mirror.js，6 测试） |
| 9.2 电脑关闭 | ✅ AgentScreen 如实显示「连接失败：<原因>」，不假装在线 |
| 9.3 网关重启 | ✅ runs.json 持久（loadRuns）；重启后接受新任务；运行中任务按实际状态标记（不伪装继续执行）；无执行恢复机制已如实记录 |
| 9.4 执行器超时 | ✅ 60s 硬超时 → **timed_out 独立状态**（本轮新增）；无后台无上限进程（git 子命令另有 10s 超时） |
| 9.5 认证失败 | ✅ 错误 token 401，只返回 `unauthorized`，无任务信息泄漏（真实测试） |
| 9.6 数据格式变更 | ✅ normalizeTask 兼容（pre-V2.3/pre-B3 数据载入字段归一化）；append-only 导入不清空 |

## 3. 测试汇总

| 套件 | 结果 |
|---|---|
| 全量单测（app/ 下） | **456/456 PASS**（441 基线 + 15 新增：agent-run-link 7 + system-e2e 2 + runs-mirror 6） |
| Build Smoke | **18/18 PASS** |
| Gateway 本机 E2E（10 步） | **全部通过**（见 GATEWAY_INTEGRATION_REPORT.md） |
| 前端生产构建 | ✅ 8s（chunk 警告为已知非阻断） |
| Android 构建 | ✅ BUILD SUCCESSFUL（debug + release，versionCode 7 / versionName 6.0.2） |

## 4. 未完成（如实标记）

- **DEVICE_E2E = NOT_TESTED**：无 ADB 设备，真机九步链路未验证
- Windows 防火墙局域网规则未配置（需用户授权）
- Codex Adapter：ADAPTER_BLOCKED_USAGE_LIMIT（接口已验证，用量受限）
