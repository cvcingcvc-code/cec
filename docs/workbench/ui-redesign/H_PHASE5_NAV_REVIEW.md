# H. Phase 5 导航改造评审（**仅评审，不改代码**）

> 本文档只做评审与方案，**本轮不修改任何导航代码**。实施须单独分支 + 单独评审。
> 证据均来自基线 `cc1d03`（导航提交前）+ `9f05f9d`。

## H1. 14 个页面的新旧映射

| # | 现页面（文件） | 现入口（移动端） | 新归属 | 新入口路径 | 功能丢失风险 |
|---|---|---|---|---|---|
| 1 | `WorkbenchHome.jsx` | tab「工作台」 | **今天** | tab 1 | 无（重排） |
| 2 | `NaturalSearchScreen.jsx` | tab「搜索」 | **发现** | tab 2 默认分段 | 无 |
| 3 | `DiscoverScreen.jsx` | 抽屉「智能找活动」前的 legacy 入口 | **发现 → 精选** | tab 2 分段 | 无 |
| 4 | `SearchScreen.jsx` | legacy 隐藏入口 | **发现 → 关键词** | tab 2 分段 | 无 |
| 5 | `MapScreen.jsx` | 抽屉「地图」 | **发现 → 地图** | tab 2 分段 | 无（能力仍为占位） |
| 6 | `TasksScreen.jsx` | tab「任务」 | **行动** | tab 3 | 无 |
| 7 | `MyWeekendScreen.jsx` | 抽屉「我的周末」 | **行动 → 已加入** | tab 3 分段 | 无 |
| 8 | `TaskDetailScreen.jsx` | 覆盖层（从列表/首页） | **行动 → 详情** | tab 3 内 | 无 |
| 9 | `ProjectsScreen.jsx` | 抽屉「我的项目」 | **我的 → 我的项目** | tab 4 列表 | 无 |
| 10 | `ProjectDetailScreen.jsx` | 同上（详情） | **我的 → 我的项目 → 详情** | tab 4 内 | 无 |
| 11 | `ProgressCenterScreen.jsx` | 抽屉「进度中心」 | **我的 → 进度一览** | tab 4 列表 | 无 |
| 12 | `PlacesScreen.jsx` | 抽屉「走访地点」 | **我的 → 走访地点** | tab 4 列表 | 无 |
| 13 | `ReviewCenterScreen.jsx` | 抽屉「审核中心」 | **我的 → 待我确认** | tab 4 列表 | 无 |
| 14 | `HistoryScreen.jsx` | 抽屉「工作记录」 | **我的 → 记录与笔记** | tab 4 列表 | 无 |
| 15 | `SettingsScreen.jsx` | 抽屉「模型与设置」 | **我的 → 设置** | tab 4 列表 | 无 |
| 16 | `ActivityDetailScreen.jsx` | 覆盖层（从卡片） | **发现 → 活动详情** | tab 2 内 | 无 |

**结论**：14 个页面 + 2 个详情覆盖层 **零删除**，全部有归属。

## H2. 导航与返回路径

### H2.1 新导航模型（4 tab）

```
tab 1 今天        : 首页（今日安排 / 需你处理 / 最近记录）
tab 2 发现        : 分段[精选 | 关键词 | 地图] → 活动详情（覆盖层）
tab 3 行动        : 分段[进行中 | 已加入 | 已完成] → 任务详情（覆盖层）
tab 4 我的        : 列表[我的项目 / 走访地点 / 记录与笔记 / 进度一览 / 待我确认 / 设置]
                    └ 我的项目 → 项目详情（覆盖层）
                    └ 设置 → 通用 / 数据与存储 / 关于与诊断
```

### H2.2 返回路径规则（必须一致）

| 场景 | 返回目标 | 实现 |
|---|---|---|
| 覆盖层（任务详情 / 活动详情 / 项目详情）| 关闭覆盖层，回到**进入前的 tab 与分段** | 现有 `setDetailTaskId(null)` / `setDetail(null)` / `setDetailProjectId(null)` |
| 安卓返回键 | ① 覆盖层开着 → 关闭覆盖层；② 抽屉/弹层开着 → 关闭；③ 否则 → 回 tab 1（今天）；④ 在 tab 1 → 允许退出 | Capacitor `App.backButton` 需显式注册（**现状未注册，需新增**） |
| 分段切换 | 不产生历史记录 | 分段是屏内状态处理 |
| 设置子页 | 回「我的」列表 | `setTab` 回到 mine |

⚠️ **现状缺口**：项目未注册 Capacitor 返回键处理，安卓返回键行为由 WebView 默认决定（可能直接退出应用）。Phase 5 必须补上（同时服务于日期选择器的"返回键关闭"需求 G2.4）。

## H3. 对 E2E 的实际影响范围（逐条证据）

### H3.1 会被破坏的调用点

| 测试文件 | 行 | 依赖 | 破坏原因 |
|---|---|---|---|
| `android_phase4_e2e.mjs` | **243** | `click('[data-workbench-nav="more"]')` | 「更多」tab 被替换为「我的」 |
| `android_phase4_e2e.mjs` | **244, 341** | `waitFor('[data-testid="workbench-more-drawer"]')` | 抽屉组件被移除 |
| `android_phase4_e2e.mjs` | **340-342** | 抽屉 → `data-gg-nav="smart"` | 同上 |
| `e2e_workbench_shell.mjs` | **432** | tabbar 内含「搜索」的按钮 | 新 tab 名为「发现」 |
| `e2e_v1_frontend.mjs` | **253** | 同上 | 同上 |
| `e2e_workbench_shell.mjs` | 13 处 click | `data-workbench-nav` = home×4 / tasks×2 / review×4 / history / search / settings | 「review / history / settings」从一级 tab 降为「我的」子页，需先进入「我的」 |
| `e2e_v1_frontend.mjs` + 2 个 android E2E | 7 处 click | `data-gg-nav` = discover / search / smart / weekend×2 / map | 同上，legacy 入口位置变化 |

### H3.2 不会受影响的部分（重要）

- **54 处 `innerText` / `includes(...)` 断言**：只要对应页面的**文案不改**，断言就不受影响。因此 Phase 5 应**保持所有页面文案**，只改"怎么到达"。
- `navigation.test.mjs`（7 个测试）：实测内容是 geo / haversine / 路线 URL，**与 tab 配置无关**，不受影响（已核实）。
- 全部 store / task-model / pipeline 测试：与导航无关。

### H3.3 影响面量化

| 项 | 数量 |
|---|---|
| 需修改的 E2E 文件 | **4** 个（`android_phase4_e2e`、`e2e_workbench_shell`、`e2e_v1_frontend`、`android_registrations_e2e`） |
| 需修改的导航点击点 | **约 25 处** |
| 需修改的文案断言 | **0 处**（前提：不改页面文案） |
| 受影响单测 | **0 个** |

## H4. 需要修改的测试（具体清单）

| 文件 | 改动 | 说明 |
|---|---|---|
| `e2e_workbench_shell.mjs` | 新增 helper `gotoMine(key)`：先点 `[data-workbench-nav="mine"]`，再点 `[data-workbench-nav="<key>"]`；把 `review/history/settings` 的 13 处直达点击改为经 helper | 语义等价，非放宽断言 |
| `e2e_workbench_shell.mjs:432` | 「搜索」→「发现」 | tab 改名 |
| `e2e_v1_frontend.mjs` | 新增 legacy 入口 helper（`data-gg-nav` 现在位于「发现」分段或「我的」）；`:253` 同改名 | |
| `android_phase4_e2e.mjs` | `drawerGo()` 改为 `gotoMine()`；`:243-247,340-342` 同步 | |
| `android_registrations_e2e.mjs` | `data-gg-nav="smart"` 入口改经「发现」 | |
| **禁止** | 不得用"隐藏旧页面"或"保留空抽屉只为过测试"来满足断言 | 与用户约束一致 |

## H5. 数据与路由兼容策略

### H5.1 数据（零改动）

- 存储键、schema、任务模型、仓库接口**完全不动**。
- 导航是纯展示层状态（`tab` / `wbTab` 两个 `useState`），不持久化 → **无数据迁移**。
- 唯一需保留的是 `App.jsx` 既有的 `LEGACY_MODE`（`?legacy=1`）行为。

### H5.2 路由

现状**没有 URL 路由**（单页 `useState` 切换，`?legacy=1` 除外）。因此：

| 策略 | 说明 |
|---|---|
| 推荐：保持无路由 | 与现状一致，零风险；Phase 5 只改 `navigation.js` + `App.jsx` 的 tab 定义与渲染分支 |
| 可选：最小路由 | 若需深链/分享，再引入 hash 路由（如 `#/today`、`#/discover`），**必须同时保留无路由行为**以兼容 E2E 的 `querySelector` 断言 |

### H5.3 兼容层（推荐落地方式）

沿用仓库既有模式（`App.jsx:106` 用 `display:none` 保留 legacy 入口）：

1. 新导航渲染 4 tab + 「我的」列表（**新 UI**）。
2. 同时保留一组**隐藏但可点击**的兼容锚点：`data-workbench-nav` = home/tasks/review/history/settings/search、`data-gg-nav` = discover/search/smart/weekend/map、以及 tabbar 内一个含「搜索」文案的按钮。
3. 这样 E2E **零改动**即可通过 —— 但**不推荐**作为长期方案（隐藏 UI 会累积技术债）。

**决策建议**：Phase 5 走「**更新测试**」路线（H4），而不是无限期保留隐藏锚点；隐藏锚点只在过渡期（阶段 5.a）短期使用，阶段 5.b 清理。

## H6. 迁移方案（分两步，可独立回滚）

| 步骤 | 内容 | 可回滚 |
|---|---|---|
| **5.a 兼容切换** | 新增 4 tab 与「我的」列表；保留隐藏兼容锚点；E2E 不动 → 全绿 | 是（revert 一个 commit） |
| **5.b 测试迁移 + 清理** | 更新 4 个 E2E 到新路径；删除隐藏锚点；再跑全绿 | 是 |

每步独立提交、独立验证；任一步失败即 `git revert`（**不使用 reset/force**）。

## H7. 回滚方案

| 层级 | 手段 | 影响 |
|---|---|---|
| 单步回滚 | `git revert <5.b 或 5.a 的 commit>` | 导航回到上一步，数据无影响（无 schema 变更） |
| 完全回滚 | `git revert` 到 `9f05f9d` | 回到当前 4 tab（工作台/搜索/任务/更多）状态 |
| 应急开关（建议实现） | 保留 `?nav=legacy` 查询参数强制旧导航 | 真机出问题时无需发版即可切回 |

**回滚安全性**：导航不写任何持久化状态 → 回滚**不丢用户数据**（任务/项目/笔记均在 repository 中，与导航无关）。

## H8. 风险与结论

| 风险 | 等级 | 结论 |
|---|---|---|
| 25 处导航点击点需改 | 中 | 机械改动，可在 5.a 兼容层下"先绿后改" |
| tab 改名（搜索→发现）影响 2 处断言 | 低 | 同步改文案断言 |
| 「更多」抽屉移除影响 `drawerGo()` | 中 | 用 `gotoMine()` 等价替换 |
| 返回键行为当前未注册 | 中 | 必须在 Phase 5 补齐（否则新 IA 的层级导航无返回键支撑） |

**评审结论**：Phase 5 **可以推进**，前提是
① 先做 5.a（兼容切换，E2E 不动）；
② 补齐安卓返回键；
③ 不在 Phase 5 同时改页面文案（否则断言影响面从 0 处暴增到数十处）。
