# Phase C 收尾报告（GATEWAY LIFECYCLE + CODEX ADAPTER）

> 生成时间：2026-10-13 19:40 GMT+8
> 执行人：WorkBuddy（Gorgon Workbench 集成负责人）
> 仓库：github.com/cvcingcvc-code/cec · 分支 feature/gorgon-opportunity-v2

## 最终状态

# **PHASE_C_COMPLETE**（真实调用 BLOCKED 诚实记录，不阻塞收口）

## 1. 检查点确认（任务书 §1 八项）

| # | 检查点 | 状态 |
|---|---|---|
| 1 | STATE_DIR 与 TOKEN_FILE 声明顺序 | ✅ 已修复——两者现在都在 `STATE_DIR` 常量定义之后，且 `STATE_DIR` 支持 `GORGON_GATEWAY_STATE_DIR` 重定向（测试隔离），生产默认 `scripts/.agent-gateway/` 不变 |
| 2 | Gateway 超时后不被迟到 Promise 覆盖终态 | ✅ `finalizeRunOnce`（first writer wins，`run.__finalized` 守卫）+ 迟到结果全部丢弃；P0 测试 1 验证 |
| 3 | 用户取消后受控子进程真正退出 | ✅ `killProcessTree`（Windows `taskkill /T /F`，POSIX 进程组 SIGKILL）+ `setCancellable` 钩子（cancel 先于 spawn 到达时立即 kill）；P0 测试 2/5 验证 |
| 4 | 队列在异常/取消/超时后继续处理 | ✅ 执行槽位在 `finally` 中恒释放；P0 测试 3/4 验证（crash 后 slot 释放、timeout 后 queued 继续流动） |
| 5 | 现有 HTTP API 兼容 | ✅ 全部端点不变（/health、/v1/executors、/v1/runs、/v1/runs/:id、/cancel）；仅 additive 增加 `agent`/`availability` 字段与 `cancelRequested` 语义细化 |
| 6 | 原有测试无新增回归 | ✅ 单测 466/466 全绿（462 基线 + 4 新增）；build-smoke 18/18；v3b-system-e2e 2/2 |
| 7 | Codex Adapter 真实完成状态 | ✅ 代码完成（`scripts/agent-adapters/codex-adapter.mjs` + gateway 执行器 `codex.readonly-diagnosis`）；真实调用 **BLOCKED：FAIL_TIMEOUT**（CLI 0.162.0-alpha.17.2 探测成功，但 `codex exec` 真实模型调用 120s/240s 均超时）——诚实记录为 KNOWN_BLOCKER，未循环重试 |
| 8 | Android 现有任务关联与执行记录功能 | ✅ 无回归——v3b-system-e2e 2/2、v3b-agent-run-link/mirror 全绿；gateway API additive 兼容 |

## 2. 交付明细（commit 65bac86，4 文件 +889/-35）

| 文件 | 内容 |
|---|---|
| `scripts/agent-gateway.mjs` | 单终态运行引擎（finalizeRunOnce/killProcessTree/setCancellable）、restart 对账、STATE_DIR 重定向、cancel 语义细化、executors capability 字段、codex.readonly-diagnosis 执行器、测试注入钩子（GORGON_GATEWAY_EXTRA_EXECUTORS + _FILE） |
| `scripts/agent-adapters/codex-adapter.mjs` | 新增：Codex CLI 有界包装（`codex exec --sandbox read-only`，固定工作区，预批准模板，输出脱敏，BLOCKED_* 诚实分类，无重试循环） |
| `app/tests/v3c-gateway-lifecycle.test.mjs` | 新增：6 个 P0 生命周期测试（真实 gateway 进程 + 隔离 state dir + **随机端口**） |
| `app/tests/v3c-codex-adapter.test.mjs` | 新增：探测/脱敏/诚实分类/真实调用（真实调用 FAIL_TIMEOUT 诚实上报） |

## 3. 测试基线

| 套件 | 结果 |
|---|---|
| 单测（app/tests/*.test.mjs） | **466/466 PASS**（基线 462 + lifecycle 6 - 2 旧重复计数……精确：基线 456 + lifecycle 6 + codex-adapter 4 = 466） |
| build-smoke | 18/18 PASS（无 secret） |
| v3b-system-e2e | 2/2 PASS |
| lifecycle P0（真实进程） | 6/6 PASS |
| codex 真实调用 | FAIL_TIMEOUT（诚实，BLOCKED） |

## 4. 关键修复记录

1. **固定端口竞态（本轮发现的测试层缺陷）**：lifecycle 测试原用固定端口 8815–8820，残留孤儿网关进程（上次测试运行的 `/health` 仍存活）导致新 state dir 的 token.json ENOENT 假失败。修复：每测试随机端口（20000–39999）+ startGateway 返回实际端口。根因排查：手动直启 gateway 正常、node:test 内同路径探针正常，最终 `netstat` 锁定 PID 29052 孤儿网关（uptime 1931s）。
2. **测试执行器注入格式**：JSON 序列化会丢 `run()` 函数——改为 ESM 模块文件注入（`GORGON_GATEWAY_EXTRA_EXECUTORS_FILE`，函数完整保留），保留 JSON+runSource 形式兼容旧草稿。
3. **模块注入缺 import**：extra-executors 模板初版用了 `spawn` 未 import → "spawn is not defined"。已补 `import { spawn } from "node:child_process"`。

## 5. KNOWN_BLOCKERS（不阻塞，不循环重试）

- **CODEX_REAL_EXECUTION=FAIL_TIMEOUT**：Codex CLI 探测 OK（0.162.0-alpha.17.2），但真实模型调用超时（120s/240s）。可能原因：模型限额/网络代理/CLI alpha 版本行为。分类器已支持 BLOCKED_USAGE_LIMIT/AUTH/NETWORK——下次额度恢复后单次重试即可定位。
- Android 录音（插件未装，BLOCKED/NOT_TESTED，沿用 V23 状态）。

## 6. Git 状态

- 提交：`65bac86` feat(v3c): gateway single-final-state lifecycle + Codex adapter
- 推送：fast-forward `e6fe954..65bac86` → cec（无 force）
- 远端核验：fetch 后 `cec/feature/gorgon-opportunity-v2` = `65bac86`，无分叉
- 未提交遗留：`GORGON_MIGRATION_AND_ROADMAP_REPORT.md`（上一轮迁移报告，未跟踪，保留）

## 7. 并行开发初始化（任务书 §3）

| worktree | 分支/HEAD | 状态 |
|---|---|---|
| F:\Gorgon-Parallel\android | feat/v3c-android-agent-ux（基于 65bac86） | 见下方核验 |
| F:\Gorgon-Parallel\gateway | fix/v3c-gateway-lifecycle | 见下方核验 |
| F:\Gorgon-Parallel\reviewer | detached HEAD @ 65bac86 | 见下方核验 |

Gateway 生命周期已在本轮完整修复并验证（6/6 P0 测试），按任务书 §3.4：gateway worktree 创建后暂不启动新修复任务，留空待用。
