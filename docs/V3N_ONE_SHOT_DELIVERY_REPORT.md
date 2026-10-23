# V3N One-Shot 交付报告（2026-10-23）

分支：`feat/one-shot-agent-experience-v1`（远端 cec，HEAD `dcd5c22`）
需求文档：`docs/ONE_SHOT_AGENT_REDESIGN.md`（唯一正式任务书）

## 提交 SHA / 实际修改路径

| Commit | 内容 | 修改路径 |
|---|---|---|
| `76ee7b7` docs(ux) | 任务书落地 | `docs/ONE_SHOT_AGENT_REDESIGN.md` |
| `91e3a87` P0 引擎层 | 原子提交/去重/失败恢复 | `app/src/workbench/one-shot.js`（新，163 行）、`app/src/workbench/task-runner.js`（retryFailedOnly + metadata 持久化）、`app/src/store/workbench-store.js`（submitOneShotGoal 绑定） |
| `cf7c2b4` P0 UI 层 | 首页一句话入口/结果三区/重试恢复 | `app/src/screens/WorkbenchHome.jsx`、`app/src/screens/TaskDetailScreen.jsx`、`app/src/App.jsx`、`app/src/workbench/task-status-labels.js` |
| `4b48d42` P1 闭环 | 搜索→筛选→保存清单 | `app/src/workbench/skills/activity-checklist-skill.js`（新，261 行）、`app/src/workbench/skills/registry.js`、`app/src/workbench/task-router.js`、两屏小改 |
| `a01362e` 回归测试 | 18 单测 + e2e 契约 | `app/tests/v3n-one-shot.test.mjs`（新，386 行）、`app/tests/e2e_workbench_shell.mjs`、v3j e2e ×2、`one-shot.js` explainRunProblem 修复 |
| `dcd5c22` 版本号 | 测试 APK | `app/android/app/build.gradle`（versionCode 18 / 6.0.13） |

## 所执行测试 / 结果

**单测（node --test）**：635 pass / 0 fail / 1 skipped（skipped 为预存在的 codex 真实诊断显式跳过，非回归）。新增 18 个 V3N 测试全过：原子 create→run、双击去重、空白归一化、重启等价、软删=新请求、真实检索+筛选+来源、离线诚实（SEARCH_OFFLINE 不伪装）、中文错误+恢复提示、部分成功+retryFailedOnly、checklist 技能单测。

**E2E（真实生产构建 + headless Edge CDP）**：93 passed / 0 failed（修复前 91/2）。
两个修复：
1. V3N waitFor 表达式是多语句，被 driver 包成 `return (const ...)` 语法错误 → 改为 IIFE 单表达式。
2. review_required 标签改「需要确认」后，line 342 旧断言仍查「待审核」→ 对齐。

**APK 构建**：BUILD SUCCESSFUL（10m51s，246 tasks），正式签名验证通过。

## 6 个验收剧本状态（云端可验证部分）

| # | 剧本 | 结果 | 验证方式 |
|---|---|---|---|
| 1 | 本地整理清单，一次提交即完成，无错误在线搜索 | **PASS（云端）** | 单测场景 1 + e2e §42 本地提取 |
| 2 | 真实检索+筛选+来源清单；缺来源如实部分完成 | **PASS（云端）** | 单测场景 2（在线+离线两路）+ e2e §41 |
| 3 | 双击/重开 APP 去重，一个 task/run | **PASS（云端）** | 单测去重 4 项 + e2e §70 幂等 |
| 4 | 断网/未授权 → 中文原因+可恢复操作，无假成功 | **PASS（云端）** | 单测场景 4 + explainError 表 |
| 5 | 混合任务部分成功，失败步骤单独重试 | **PASS（云端）** | 单测场景 5 + e2e V3N 断言 |
| 6 | 真机完整链路 + 机型/签名/网络报告 | **BLOCKED** | 本环境无 Android 真机，见下 |

## APK 验收说明（v0.3.13-alpha 测试包）

- 文件：`gorgon-v0.3.13-alpha-one-shot-v1.apk`（3.86 MB）
- versionCode **18** / versionName **6.0.13**（aapt 实测）
- SHA-256：`4a9e71b6fea0283f01dec88e006ca555d4decc2728be4f85613ebebbe0eb6be5`
- 签名证书 SHA-256：`45b44236…f47167`（与 v0.3.11/0.3.12 相同正式证书，覆盖安装保留数据）
- 包含：V3N P0+P1 全部提交（`76ee7b7..dcd5c22`）

**真机验收步骤（6 剧本对应）**：
1. 首页输入「帮我整理一份比赛报名资料清单」→ 应一次提交后直接看到清单结果，无需点「运行任务」
2. 输入「找上海未来 7 天真实的免费 AI 活动并整理参加清单」→ 需后端在线：看到带来源的清单；离线：看到明确的部分完成说明
3. 连续双击「开始处理」→ 只有一个任务；杀掉重开 APP → 结果还在，无重复
4. 关掉后端网络再提交找活动 → 应显示具体中文原因 + 恢复按钮，而非假成功
5. 混合任务（如「找活动并规划」+后端故障）→ 详情页应显示「部分完成」+「重试失败的 N 个步骤」按钮
6. 全链路截图：首页输入 → 执行中 → 结果 → 保存

## 尚未打通的真实能力

- **真机 6 剧本**（BLOCKED）：需要 Android 真机 + 实际网络/离线环境
- **真实在线检索**依赖后端 `/api/search` 服务可用（demo API 已验证链路，生产数据源未接）
- WorkBuddy 写任务、通用电脑操作仍未打通（任务书 §3 明确保留 BLOCKED，不反向工程）

## 下一步最短动作

1. 用户在 Android 真机安装 v0.3.13-alpha，按上面 6 步验收，回传结果/截图
2. 真机通过后另行处理 Release 发版与合并 master（任务书 §6：验收完成前不合并不发布）

## 纪律确认

- 全部修改只在 `feat/one-shot-agent-experience-v1` 一条分支
- 未合并 master、未发正式 Release
- 密钥文件（keystore/local.properties）确认为 gitignored，未入库
- 未伪造搜索数据、未把模板当在线查询、未把启动当完成
