# E. Codex 分阶段实施清单

> **总原则**：表现层重排为主，最小 diff；不动 `task-model.js` 状态机、`*-repository.js` 持久化、`lib/api.js` 接口。
> 每阶段独立可交付、可回归；**每阶段必须全绿**：`npm test`（app 单测）、`npm run test:e2e:workbench`、`npm run test:build`、`pipeline` unittest。

## ⚠️ 前置：E2E 契约（决定改造边界，务必先读）

现有测试**硬依赖**这些钩子，改造时必须保留（可隐藏，不可删除）：

| 依赖 | 位置 | 要求 |
|---|---|---|
| `data-workbench-nav` | `e2e_workbench_shell.mjs` | 必须有 `home` `search` `tasks` `review` `history` `settings` 六个可点击入口 |
| `data-gg-nav` | `e2e_v1_frontend.mjs` / `android_phase4` / `android_registrations` | 必须有 `discover` `search` `smart` `weekend` `map` |
| 移动端 tab 文案「搜索」 | `e2e_workbench_shell.mjs:431` | tabbar 内必须存在含「搜索」的按钮 |
| `data-gg-screen="workbench-home"` | 多处 | 首页容器属性保留 |
| 首页按钮文案「开始任务」 | `:128,179` | 保留该按钮（可改位置，不可改文案） |
| `data-testid`（workbench-*） | 全量 | 已加的 testid 保留 |

**做法**：沿用仓库既有模式（`App.jsx:106` 的 `display:none` 兼容入口）——新导航渲染新 UI，同时保留一组隐藏的兼容钩子。
**或者**在同一次提交里同步更新 E2E 并说明理由；不得静默让测试变红。

---

## 阶段 0：设计令牌补齐（无 UI 变化，零风险）

| 项 | 内容 |
|---|---|
| 新增文件 | `tokens/mobile.css`（`--success-ink`/`--warning-ink`/`--info-ink`/`--demo-*`/`--real-*`/移动端字阶 `--t-*`） |
| 修改文件 | `styles.css`（追加一行 `@import "tokens/mobile.css";`）；`tokens/fonts.css`（中文栈改系统优先，去 CDN 依赖） |
| 改动 | 仅新增令牌与字体栈，**不修改任何页面** |
| DoD | `npm run build` 通过；build-smoke 18/18；APK 内不再依赖 Google Fonts |
| 不做 | 不改任何 screen、不改色板基色 |
| 回归点 | 视觉零变化（仅字体回退更稳） |

## 阶段 1：通用组件落地（不改页面）

| 项 | 内容 |
|---|---|
| 新增文件 | `app/src/components/mobile/{ListRow,Chip,SegmentedTabs,PrimaryBar,StatusBadge,EmptyState}.jsx` |
| 规格 | 见 `C_DESIGN_SYSTEM.md` C7：ListRow 56dp / Chip 40dp / 主操作 52dp / 徽章带图标 |
| 改动 | 纯新增组件 + 对应单测（新增 `tests/mobile-components.test.mjs`） |
| DoD | 新组件单测通过；`npm test` 总数只增不减 |
| 不做 | 不改任何现有 screen 的引用 |
| 回归点 | 现有 333 项单测不受影响 |

## 阶段 2：触控与可达性修复（P0，逐屏小改）

| 项 | 内容 | 涉及文件 |
|---|---|---|
| 2.1 | `.gg-chip` 高度 29 → 40（`responsive.css`），选中态加勾选图标 | `ui_kits/app/responsive.css:576` |
| 2.2 | `div/article onClick` → `button`（保 testid），补按下反馈 | `DiscoverScreen:72`、`SearchScreen:155`、`HistoryScreen:80`、`MyWeekendScreen:123` |
| 2.3 | `padding:0` 的文本按钮热区撑到 ≥48px | `ProjectDetailScreen:121,374,425,431`、`DiscoverScreen:264,282`、`NaturalSearchScreen:470`、`TaskDetailScreen:347` |
| 2.4 | 准备清单勾选框 18×18 → 44×44 热区（视觉可保持 20） | `ProjectDetailScreen:213` |
| 2.5 | `Button size="sm"` 由 36 → 44（改 `components/core/Button.jsx` SIZES） | 全局受益 |
| DoD | E2E 93/93；新增热区断言（可选：静态检查 `< 44px` 的可点元素清单） |
| 不做 | 不改业务逻辑与文案 |
| 回归点 | 布局可能变高 → 需目视核对 6 个主要页面不溢出 |

## 阶段 3：文案去术语（P0，纯字符串）

| 项 | 内容 | 涉及文件 |
|---|---|---|
| 3.1 | 状态枚举补全中文映射（禁止 `|| status` 兜底英文） | `PlacesScreen:185`、`ProgressCenterScreen:156` |
| 3.2 | 检索错误改「暂时没连上服务，请稍后重试」+ 重试按钮；去掉 HTTP 码与"服务端日志" | `NaturalSearchScreen:521-522,543` |
| 3.3 | 审核中心 JSON → 中文摘要 | `ReviewCenterScreen:112` |
| 3.4 | 设置页去 `Schema Version`/存储键/`Phase 3 · Task Router` | `SettingsScreen:17,19,34,38,39,41,65,81` |
| 3.5 | 记录页去 `（Task.timeline）` | `HistoryScreen:63` |
| 3.6 | 英文 kicker 中文化（`Saved`/`My Weekend`/`DEMO DATA`/`DEMO / PREVIEW`） | `MyWeekendScreen:179`、`atoms.jsx:138-141`、`ReviewCenterScreen:233` |
| 3.7 | "同步" → "加入行动"（明确目的地） | `ActivityCard:66` |
| DoD | **文案断言更新**：涉及 E2E 文案断言的必须同步改测试（现有先例：Issue #3 已改 §status/§41/§72/settings） |
| 不做 | 不改数据结构、不改存储键本身（只改展示） |
| 回归点 | E2E 文案断言是最大风险点，需逐一核对 |

## 阶段 4：任务详情重排（P0，核心闭环）

| 项 | 内容 |
|---|---|
| 4.1 | 结果摘要上移到头部之后（「结论」区），`workbench-detail-result` 及其子 testid 全部保留 |
| 4.2 | 步骤/来源/处理方式/路由/时间线 合并进 `执行详情` 折叠区（**保留所有 testid 在 DOM 中**，折叠不影响 E2E 的 querySelector） |
| 4.3 | 主操作改为底部固定条（`开始执行`），文案保持"运行任务"或新增别名 |
| 4.4 | 面向开发者的模拟流转按钮收进"开发者选项"折叠（保留 testid，E2E 可能直接点击 → **先查 E2E**） |
| 文件 | `TaskDetailScreen.jsx`（仅此一个），保持对外 props 不变 |
| DoD | 单测 333/333；E2E §40-42/§71/§72 全绿；真机/模拟器手工核对 |
| 不做 | 不改 props 签名、不改状态流转、不删任何 testid |
| 回归点 | **折叠不能删 DOM**；`workbench-detail-sim-*` 若被 E2E 点击必须仍可点 |

## 阶段 5：信息架构切换（P1，最大改动，需单独评审）

| 项 | 内容 |
|---|---|
| 5.1 | 底部导航 4 项：今天/发现/行动/我的（`workbench/navigation.js` 新增 `MOBILE_TABS_V2`） |
| 5.2 | 「我的」列表页替代 9 项抽屉（`MineScreen.jsx` 新增） |
| 5.3 | 保留隐藏兼容层：`data-workbench-nav` × 6 + `data-gg-nav` × 5 + tabbar「搜索」按钮 |
| 5.4 | 「今天」聚合今日安排 + 需处理 + 最近记录；工作台状态面板迁到 设置→关于与诊断 |
| 5.5 | 行动页 7 筛选 → 3 分段（保留 `workbench-task-filter-*` testid） |
| 文件 | `App.jsx`、`navigation.js`、`WorkbenchHome.jsx`、`TasksScreen.jsx` + 新增 `MineScreen.jsx` |
| DoD | 全部 E2E 绿（尤其 workbench 93/93 与 v1 frontend）；真机走通三场景 |
| 不做 | 不删任何 screen；不改 store 层 |
| 回归点 | **导航改造是最高风险项**；必须先在分支做，逐条跑 E2E 定位缺失钩子 |

## 阶段 6：反馈与状态补全（P1）

| 项 | 内容 | 文件 |
|---|---|---|
| 6.1 | 所有异步操作补 pending/disabled（ICS、分享、保存复盘、创建项目、批准/拒绝） | `ActivityDetailScreen`、`ProjectDetailScreen`、`ProjectsScreen`、`ReviewCenterScreen` |
| 6.2 | 静默 `catch{}` 改为内联错误 + 重试 | `ActivityDetailScreen:95,104` |
| 6.3 | 危险操作二次确认（取消收藏、删除进度/笔记、归档项目），统一用应用内弹层替代 `window.confirm` | `MyWeekendScreen`、`ProjectDetailScreen:374,432,481`、`PlacesScreen:238` |
| 6.4 | 修掉死控件（地图定位无 onClick）或明确置灰 | `MapScreen:131,130` |
| DoD | E2E 全绿；新增"无静默失败"静态检查（可选） |
| 回归点 | 确认弹层不能阻塞现有 E2E 点击路径（E2E 直接点删除时需先确认） |

## 阶段 7：软键盘与输入（P0/P1）

| 项 | 内容 | 文件 |
|---|---|---|
| 7.1 | 首页输入区：整块可点即聚焦（修复"点卡片不弹键盘"） | `WorkbenchHome.jsx:92-114` |
| 7.2 | 输入框加 `inputMode` / `enterKeyHint="search"`；移动端提交改为显式按钮主路径 | `WorkbenchHome`、`TasksScreen`、`NaturalSearchScreen`、`TaskDetailScreen` |
| 7.3 | 移动端不依赖 `Shift+Enter`；改为"提交"/"换行"两个显式动作 | 同上 |
| 7.4 | 底部固定操作条与软键盘避让（`visualViewport` 或 Capacitor keyboard 插件已存在则复用） | `App.jsx` / 布局层 |
| DoD | 模拟器/真机：点击输入区任意位置弹键盘；键盘弹起时底部主操作不被遮挡 |
| 回归点 | 桌面不受影响（`enterKeyHint` 无副作用） |

## 阶段 8：日程周视图（P2，新增能力）

| 项 | 内容 |
|---|---|
| 8.1 | 「今天」增加 `列表 | 周视图` 分段；周聚合由 `scheduledDate`/`dueAt` 计算（新增纯函数 + 单测） |
| DoD | 新纯函数单测通过；未实现时不得伪造数据 |
| 不做 | 不新建数据仓库、不改任务模型 |

---

## 实施顺序与依赖

```
阶段0 (令牌) ─→ 阶段1 (组件) ─→ 阶段2 (触控) ─→ 阶段3 (文案)
                                        └→ 阶段4 (任务详情) ─→ 阶段5 (IA 切换)
                                                                  └→ 阶段6 (反馈)
                                                                     └→ 阶段7 (键盘)
                                                                        └→ 阶段8 (周视图)
```

- 阶段 0–4 可独立合并，风险低，**建议先做完这五个**（覆盖 P0 问题）。
- 阶段 5 是 IA 切换，必须单独分支 + 单独评审。
- 每阶段结束更新 `docs/workbench/DELIVERY_STATE.md`。
