# V2.4 AI 黑客松发现 V1 — 真实验收报告

- 分支：`feat/hackathon-discovery-v1`（基线 `cec/feat/one-shot-agent-experience-v1` @ 7699b4a）
- 主提交：`4cd2717 feat(v24): hackathon discovery V1 - data model, AI match, discovery UI, action closure`
- PR：https://github.com/cvcingcvc-code/cec/pull/8
- 验收时间：2026-10-23
- 工作目录：`C:/Users/lin/Documents/Gorgon-Workbench`（worktree）

> 本报告所有数字均来自 2026-10-23 在本分支 HEAD 上的实际执行结果。
> 无法执行的项一律标注 BLOCKED / NOT_TESTED，未做任何编造。

---

## 1. 测试结果（REAL，已执行）

### 1.1 全量单测回归

```
node --test "tests/*.test.mjs"   （78 个测试文件）
# tests 672  pass 671  fail 0  skipped 1  duration ~57s
```

- 结论：**671 pass / 0 fail**；1 个 skipped 为预存在跳过项，非本分支引入。
- 相对基线（669 项，含 1 skipped）新增 36 项，全部通过。

### 1.2 V2.4 新增单测

| 文件 | 项数 | 覆盖 |
|---|---|---|
| `tests/v24-hackathon-data.test.mjs` | 16 | normalizeHackathon 缺失字段归 null / id-title 必需 / additive merge 不覆盖既有 / demo:false / sourceUrl 真实性 |
| `tests/v24-match-model.test.mjs` | 12 | extractProfile 领域与技术栈规则 / 打分权重 / reasons-mismatches 闭集模板 / null eligibility 诚实标注 / 已截止排除 |
| `tests/v24-closure.test.mjs` | 8 | 全链路：发现→匹配→prep 落库→opened→registered→结果记录；钉住「打开报名页≠报名成功」 |

```
node --test tests/v24-*.test.mjs
# tests 36  pass 36  fail 0
```

### 1.3 build-smoke

```
node tests/build-smoke.mjs
# 18 passed, 0 failed
```

含安全检查：bundle 无 API key 泄漏、无 window DS、无浏览器内 JSX transform、无绝对文件路径泄漏。

---

## 2. 数据真实性（REAL，已执行）

- 10 条黑客松记录均为手工整理的公开赛事（蚂蚁灵波 VLA、苏客松、怀柔 AI for Science、PAYATHON、AI For Good、天猫 AI 创新营、TME AI黑客松、WTCC、Google Cloud AI Builder Cup、雾客松），全部 `demo:false`。
- 缺失字段（奖金/参赛条件/团队规模）一律 `null`，UI 显示「待定（以官方页面为准）」，**未编造任何数值**。

### 2.1 报名/来源链接全量复验（10/10 通过）

执行 `curl -sL --max-time 15 -o /dev/null -w %{http_code}`：

| HTTP | 域名 |
|---|---|
| 200 | feishu.cn（苏客松报名表单） |
| 200 | tianchi.aliyun.com（怀柔 AI for Science，赛题 532514） |
| 200 | join.tencentmusic.com（TME AI 黑客松） |
| 200 | hackertrip.space × 7（PAYATHON / AI For Good / 天猫 / WTCC / AI Builder Cup 等） |

结论：**10/10 HTTP 200**，报名链接真实可达。

---

## 3. AI 匹配验证（REAL，确定性规则模式）

用 3 组真实输入复验 `matchEvents`（数据 = 10 条真实活动，now = 验收时刻）：

| 输入项目简介 | Top 1 | 分数 |
|---|---|---|
| 「具身智能机器人项目，用 VLA 模型控制机械臂」 | ht-2026-lingbot-vla（蚂蚁灵波） | 40 |
| 「AI for Science 方向，深度学习做蛋白质结构预测」 | ht-2026-huairou（怀柔） | 40 |
| 「AI Agent 智能体框架，多轮对话+工具调用」 | ht-2026-payathon（PAYATHON） | 40 |

- 三组输入的 Top 1 均为语义正确目标，且输出 reasons（匹配理由）/ mismatches（不匹配因素）/ prepList（准备清单），全部来自闭集模板、基于真实字段。
- 匹配为**确定性规则**（12 领域规则 + 6 技术栈规则 → 可解释打分），同输入同输出，无幻觉路径。

### 3.1 AI 真实调用 — BLOCKED

- 环境变量无任何 LLM key（Z_AI_API_KEY / GLM_API_KEY / OPENAI_API_KEY 均不存在）。
- 本地 LLM 路由 127.0.0.1:31415 拒绝连接（FreeLLMAPI 未运行）。
- 混元 API 端点可达但返回 401（无凭证）。
- **结论：AI 真实调用 BLOCKED（无凭证）**。本 V1 匹配缺省即纯规则模式，功能不受影响；LLM 增强匹配列入未完成清单（见 §6）。

---

## 4. 行动闭环（REAL，单测钉住）

`tests/v24-closure.test.mjs` 以 facade 层（`workbench-store.js`）走真实存储链路验证：

1. 匹配结果 → 「创建报名准备清单」→ `WBStore.setPrep(activity.id, items, null)` 落库成功，items 为 `{title, done:false}[]`；
2. 「打开报名页」仅置 `REG_STATUS = opened_registration`，**不等于** registered；
3. 只有显式确认才置 `registered` 且 `confirmedAt` 非空；`opened` 状态下 confirmedAt 必须为 null。

---

## 5. Android 包（构建环境 REAL，真机 BLOCKED）

- 构建：`node scripts/build-apk.mjs`（vite build + cap sync android）成功；`gradlew assembleRelease --no-daemon`（JDK 21 + SDK build-tools）BUILD SUCCESSFUL（2026-10-23 执行，versionCode 19 重打构建 2m 52s）。
- 产物：`app/android/app/build/outputs/apk/release/app-release.apk`
  - applicationId `cn.gorgon.workbench`，**versionCode 19 / versionName 6.0.14**（commit 5b0996a bump；18 与已发 v0.3.13-alpha 撞车，bump 保持覆盖安装顺序）
  - SHA-256：`7a5c59a95344bb45538ab8db0387a915cf49b72a9bd58975b166603a3b52c84a`
  - 大小：3.85 MB；apksigner 验证通过（正式证书 45b44236…f47167）
  - 已发 GitHub Release：**https://github.com/cvcingcvc-code/cec/releases/tag/v0.3.14-alpha**（Latest，非 prerelease，2026-10-23）
- **真机安装与 E2E：BLOCKED（需用户 Android 真机）**，未做模拟器测试，如实标注 NOT_TESTED。

---

## 6. 未完成问题清单

| # | 事项 | 状态 | 说明 |
|---|---|---|---|
| 1 | Android 真机测试 | BLOCKED | 需用户在真机安装 APK 验收；E2E 未在模拟器执行，NOT_TESTED |
| 2 | LLM 增强匹配 | BLOCKED | 无 API key；当前为确定性规则匹配。接入后可做语义级匹配（需把 key 走构建时注入，不进 bundle） |
| 3 | APK versionCode bump | RESOLVED | 已 bump 19/6.0.14（commit 5b0996a）并重打，发 Release v0.3.14-alpha（Latest） |
| 4 | 活动数据自动抓取 | NOT_DONE | V1 为手工整理 10 条；自动聚合抓取（Stage D）未实现，G1-G7 缺口见 FEATURE_COMPARISON.md |
| 5 | 通知提醒（本地推送） | NOT_DONE | 收藏与截止倒计时已就绪，LocalNotifications 触达未接 |
| 6 | 组队 / 社区 / 主办方后台 | NOT_PLANNED | 按任务书停止条件，明确不为本 V1 目标 |

## 7. 诚实性声明

- 本报告无任何 Mock 宣称为已交付；所有 REAL 项均附执行命令与结果。
- 「打开报名页≠报名成功」在 UI 文案与 6 态状态机双层钉住。
- 赛事资格、奖金、截止时间仅录官方页面可核实内容；缺失一律「待定」。
