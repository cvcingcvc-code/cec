# Gorgon 实现计划（GORGON_IMPLEMENTATION_PLAN.md）

> 2026-10-23。分支 `feat/hackathon-discovery-v1`（基线 cec/feat/one-shot-agent-experience-v1 @ 7699b4a，含 v0.3.13-alpha 链路全部能力）。
> 原则：复用现有系统、增量 additive 改动、最小 diff、不覆盖既有数据库/测试报告/安装包、诚实标注 REAL/DEMO/BLOCKED。

## 0. 审计结论（已完成，依据 FEATURE_COMPARISON.md §2-4）

- 复用资产：activity-view.js 归一化、opportunity-repository.js 6 态报名状态机、workbench-store 门面、task-router/skills/ai 链路、DiscoverScreen/ActivityDetailScreen/UserActivitiesScreen、native-reminders、cap sync + gradle 工具链（F:/gorgon-android-toolchain）。
- 缺口：G1-G7（见 FEATURE_COMPARISON §4）。
- 基线测试：store 9/9、task-engine 28/28、router 16/16、task-runner 12/12、opportunity-repository 16/16、activity-view 11/11、navigation 7/7、ics 6/6、v23-ai-client 8/8、ai-eligibility 31/31、build-smoke 18/18 — 全绿。

## 1. 阶段拆解

### Stage A — 数据层（G1/G3）

**A1. 黑客松活动数据**（新增，不改 generated-data.js 管线产物）：
- 新文件 `app/src/data/hackathons.js`：手工整理的真实黑客松记录（来源：hackertrip.space 公开页面展示的活动 + 各官方报名页，公开信息），字段对齐 pipeline canonical shape：
  `{ id, title, category:"hackathon"|"ai", city, mode:"online"|"offline"|"hybrid", startDate, endDate, registrationDeadline, prize, prizeType, eligibility, teamSize, venue, address, organizer, description, tags[], trustScore, trustReasons, registrationUrl, sourceUrl, sourceName:"hackertrip_public", collectedAt, demo:false }`
- **数据规则**：只记录公开页面可验证的事实（标题/时间/城市/奖金/报名链接原文照录）；不确定的留 null（UI 显示「待定」）；每条带 sourceUrl 指向公开页面；绝不编造资格、奖金、截止时间、报名状态。
- 接线：`lib/data.js` 增加 hackathons 合并逻辑（additive：`GORGON_DATA.activities = [...gen, ...hackathons]`），DEMO 徽标体系不变。

**A2. 字段扩展**（activity-view.js，additive）：
- 归一化增加 `mode`（线上/线下/混合）、`registrationDeadline`、`prize`、`eligibility`、`teamSize`；缺失填 null。
- 新增 `formatDeadlineCountdown(deadline, now)`：返回「X天X时」/「今天截止」/「已截止」/null。
- 新增过滤函数 `filterActivities(list, { city, mode, category, timeframe, query })`。

**A3. 测试**：`tests/v24-hackathon-data.test.mjs` — 数据形状校验（必填字段/时间格式/URL 格式/无编造字段）、倒计时函数、过滤函数。

### Stage B — 移动端体验（G2/G4/G6）

**B1. DiscoverScreen 扩展**（最小 diff）：
- 分类 Rail 增「黑客松」「AI 活动」pill。
- 筛选条增：城市（文本/常用城市 chips）、形式（全部/线上/线下/混合）、排序（综合/截止优先）。
- 卡片：增 mode 徽标 + 报名截止倒计时（有 deadline 才显示）。

**B2. ActivityDetailScreen 扩展**：
- 字段卡增：参赛形式、奖金、参赛条件、团队规模、报名截止+倒计时。
- 行动区：收藏（已有 favorites 体系）/ 设置提醒（remindAt）/ 「打开官方报名页」按钮（window.open registrationUrl + markRegistrationOpened，不改变「≠报名成功」规则）/ 报名状态选择器（6 态）。

**B3. UserActivitiesScreen（我的活动）强化**：
- 每条显示报名状态徽标（6 态中文标签，复用 REG_LABEL）+ 截止倒计时。
- 已报名（用户确认）的记录高亮；报名后可记录结果（failed/cancelled 原因）。

**B4. 测试**：UI 逻辑通过 Stage A 的纯函数测试覆盖；e2e 契约补 data-testid（遵循 v3N 教训：单表达式 waitFor）。

### Stage C — AI 匹配（G5）

**C1. 新模块 `app/src/workbench/match/match-model.js`**（纯函数，无网络）：
- 输入：`{ projectInput, activities }`。
- Step1 提取：关键词规则抽 `{ domains[], techStack[] }`（复用 task-router 风格的关键词表：AI/Agent/RAG/MCP/Web3/硬件/机器人/支付/音乐… + JS/TS/Python/Rust/Go…）。
- Step2 匹配：对每条 activity 的 tags/description/eligibility 计算匹配分（领域命中 + 技术栈命中 + 线上/线下可用性 + 截止时间未过），0-100。
- Step3 输出：Top N 排序 `{ activity, score, reasons[], mismatches[], unknowns[], prepList[] }`。
- **诚实规则**：reasons 只引用 activity 记录里真实存在的字段；eligibility 为 null → unknowns[]（「未知条件」）；deadline 已过 → 直接降权并标注；**绝不编造资格/奖金/截止/报名状态**。

**C2. AI 增强（可选注入，复用 ai 链路）**：aiClient 存在时对长项目简介调 summarize/extract 提升提取质量；缺省纯规则。eligibility gate 规则不破。

**C3. 新界面 NaturalSearchScreen 增「AI 匹配」入口**（或 DiscoverScreen 内 Tab）：输入框（项目简介或 GitHub 地址）→ 匹配结果卡（分数+理由+不匹配因素+「创建准备清单」按钮→ setPrep）。

**C4. 测试**：`tests/v24-match-model.test.mjs` — 提取、匹配分、排序稳定性、诚实标注（null eligibility → unknowns）、过期赛事降权、准备清单生成。

### Stage D — 行动闭环（G7）

**D1. 状态机接线**（全部复用现有 store 函数）：
发现（DiscoverScreen）→ 详情（ActivityDetailScreen）→ AI 匹配（match → prepList）→ 收藏（favorites）→ 创建任务（addTask + linkActivityToProject 可选）→ 设置提醒（setPrep + remindAt + native-reminders）→ 报名状态（markRegistrationOpened / setRegistrationStatus 6 态）→ 结果记录（registered/failed/cancelled + note）。
- **规则**：点击报名链接只记 opened_registration；registered 必须用户显式确认（现有机会库规则，UI 上加确认对话框）。

**D2. 测试**：`tests/v24-closure.test.mjs` — 全链路：加数据 → 筛选 → 匹配 → 收藏 → 建任务 → 提醒 → 打开报名页（状态≠registered）→ 显式确认 → registered → 结果记录。

### Stage E — 构建、回归、交付

**E1.** 全量单测回归（所有 tests/*.test.mjs）+ build-smoke（含 secret 扫描）。
**E2.** `node scripts/build-apk.mjs`（VITE_API_BASE_URL 指向公网部署）+ cap sync + gradle assembleRelease（JDK 21 + SDK F:/gorgon-android-toolchain；apksigner 在 build-tools/36.0.0）。versionCode 18→19。
**E3.** 推送分支 cec 远端 + 创建 PR（gh，走 Clash 代理 127.0.0.1:7890）。
**E4.** 真实调用测试：AI 匹配真实调用（报告模型提供方与环境）；报名链接真实性（curl 验证 registrationUrl 可达）；未进行的测试标 BLOCKED（Android 真机需用户）。

## 2. 明确不做

组队/社区/主办方后台/赛事直播/身份卡/小程序（任务书 §五）；不改 trust/dedupe/review/normalize/ranker 受保护核心；不动 legacy ui_kits；不覆盖既有 release/ 安装包与测试报告。

## 3. 风险与对策

| 风险 | 对策 |
|---|---|
| generated-data.js 重新生成覆盖 hackathons | hackathons 独立文件 + data.js 合并顺序固定 |
| activity-view 改动破坏 legacy | additive 字段 + 全量单测回归 |
| CDP waitFor 语法错误（v3N 坑） | 单表达式 + 显式断言 |
| cap sync 删除拦截（safe-delete shim） | `NODE_OPTIONS="" CODEBUDDY_SAFE_DELETE_ENABLED=0` |
| gradle/apksigner 路径 | build-tools/36.0.0 + jdk-21 全路径 |
| AI key 不能进 bundle | key 只在服务端/桌面壳注入，Android 匹配缺省纯规则模式 |
