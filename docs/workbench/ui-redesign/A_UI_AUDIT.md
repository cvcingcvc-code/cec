# A. 现有 UI 问题清单

> 证据均来自基线代码 `ccc1d03`，格式 `文件:行号`。
> 分级：**P0 = 阻碍普通用户完成闭环** · **P1 = 明显降低效率/困惑** · **P2 = 一致性/精致度**。

## A0. 页面与导航实况（审计起点）

真实存在的页面（`app/src/screens/` 共 14 个 screen + 1 个详情 overlay）：

| 页面 | 文件 | 可达路径（移动端） |
|---|---|---|
| 工作台首页 | `WorkbenchHome.jsx` | 底部 tab「工作台」 |
| 我的项目 / 项目详情 | `ProjectsScreen.jsx` / `ProjectDetailScreen.jsx` | 更多抽屉 → 我的项目 |
| 进度中心 | `ProgressCenterScreen.jsx` | 更多抽屉 → 进度中心 |
| 我的任务 / 任务详情 | `TasksScreen.jsx` / `TaskDetailScreen.jsx` | 底部 tab「任务」 |
| 走访地点 | `PlacesScreen.jsx` | 更多抽屉 → 走访地点 |
| 智能搜索 | `NaturalSearchScreen.jsx` | 底部 tab「搜索」 |
| 审核中心 | `ReviewCenterScreen.jsx` | 更多抽屉 → 审核中心 |
| 工作记录 | `HistoryScreen.jsx` | 更多抽屉 → 工作记录 |
| 模型与设置 | `SettingsScreen.jsx` | 更多抽屉 → 模型与设置 |
| 发现 / 搜索 / 我的周末 / 地图 | `DiscoverScreen.jsx` 等 4 个 | 更多抽屉 → 智能找活动/我的周末/地图 + 隐藏的 legacy 入口 |
| 活动详情 | `ActivityDetailScreen.jsx` | 覆盖层（从卡片进入） |

**结论**：4 个底部 tab 承载 14 个页面，其中 9 个藏在"更多"抽屉里（`workbench/navigation.js:68-78`）。

---

## A1. 信息架构与导航（P0）

| # | 问题 | 证据 |
|---|---|---|
| 1.1 | 底部导航 4 项（工作台/搜索/任务/更多），但"更多"是 **9 项抽屉**，无分组、无优先级；普通用户无法预判哪里有他要的东西 | `workbench/navigation.js:59-78` |
| 1.2 | 「工作台」与「任务」两个 tab 的语义边界模糊：首页已经展示"今日待办/最近任务/我的项目/最近记录/工作台状态"，与「任务」tab 大量重复 | `screens/WorkbenchHome.jsx:154-315` vs `screens/TasksScreen.jsx:88-209` |
| 1.3 | 首页把 5 个区块（主输入 → 快捷任务 → 今日待办 → 我的项目 → 最近任务 → 最近记录 → 工作台状态）**全部平铺**，普通用户要滚 4 屏才看到"工作台状态" | `screens/WorkbenchHome.jsx:80-337`（区块 marginTop 全为 22-26px，无折叠/优先级） |
| 1.4 | 「工作台状态」（任务引擎/任务路由/技能/AI 引擎/人工确认）是**开发状态面板**，却占据首页最底部主位置；普通用户不需要它 | `screens/WorkbenchHome.jsx:26-32, 318-337` |
| 1.5 | 没有"日程"入口。"今日待办"只存在于首页与任务页的一个筛选 tab 里，用户无法查看"本周/未来几天安排" | `screens/WorkbenchHome.jsx:154`；`screens/TasksScreen.jsx:36-52` |
| 1.6 | legacy 与 workbench 两套词汇并存：桌面侧栏同时有「我的周末」（legacy）与「我的项目」（workbench），「搜索」与「智能搜索」是两个入口指向两个不同实现 | `workbench/navigation.js:22-45,52-57` |
| 1.7 | 首页 hero 标语"把目标交给工作台，把决定留给你。"无操作指引；下方才是输入框，"今天想完成什么？"才是真入口 | `screens/WorkbenchHome.jsx:86-88, 97-99` |

## A2. 触控与单手操作（P0）

Android 设计基线：可点热区 **≥ 48×48dp**；最少不得低于 44×44。

| # | 问题 | 证据（实测像素） |
|---|---|---|
| 2.1 | `Button size="sm"` 固定 **36px** 高，被大量用作主操作（加入周末/详情/保存到访） | `components/core/Button.jsx` SIZES.sm=36；`screens/NaturalSearchScreen.jsx:223`、`screens/DiscoverScreen.jsx:97`、`screens/MyWeekendScreen.jsx:76`、`screens/PlacesScreen.jsx:278` |
| 2.2 | `.gg-chip` 约 **29px** 高（`padding:7px 14px` + `font-size:12.5px`），用于分类/地区/最近搜索等高频筛选 | `ui_kits/app/responsive.css:576-588`；`screens/SearchScreen.jsx:60,110`、`screens/PlacesScreen.jsx:148`、`screens/MapScreen.jsx:156` |
| 2.3 | 准备清单勾选框 **18×18**（关键勾选动作） | `screens/ProjectDetailScreen.jsx:213` |
| 2.4 | 图标按钮 16-38px：地图 pin 30×30、关闭 32×32、取消收藏 38×38 | `screens/MapScreen.jsx:68`、`components/DistrictPicker.jsx:159`、`screens/MyWeekendScreen.jsx:130` |
| 2.5 | 纯文本按钮 `padding:0` → 命中区仅文字行高（约 16-20px）：返回/筛选/清除/换个问题/删除/编辑 | `screens/ProjectDetailScreen.jsx:121,374,425,431`、`screens/DiscoverScreen.jsx:264,282`、`screens/NaturalSearchScreen.jsx:470`、`screens/TaskDetailScreen.jsx:347` |
| 2.6 | 任务详情的状态操作按钮 `padding:"8px 13px"`（约 34px），却是"标记完成/标记失败"等关键动作 | `screens/TaskDetailScreen.jsx:509-519` |
| 2.7 | 表单输入高度 31-39px（准备/进度输入、项目选择 select、日期输入） | `screens/ProjectDetailScreen.jsx:237,384`、`screens/TaskDetailScreen.jsx:393-401` |
| 2.8 | 卡片整块可点用 `<div onClick>` / `<article onClick>`，**非 button**：无按下反馈、无焦点、无键盘可达 | `screens/DiscoverScreen.jsx:72`、`screens/SearchScreen.jsx:155`、`screens/HistoryScreen.jsx:80`、`screens/MyWeekendScreen.jsx:123`、`screens/MapScreen.jsx:168` |
| 2.9 | 状态仅靠 hover 表达（`.gg-chip:hover`），触屏不可感知 | `ui_kits/app/responsive.css:586` |
| 2.10 | 主操作区位于长滚动底部，单手难以到达（活动详情"报名/导出/加入周末"在正文之后；自然搜索内部面板排在结果之前） | `screens/ActivityDetailScreen.jsx:129,467`、`screens/NaturalSearchScreen.jsx:588` |

## A3. 软键盘与输入（P0/P1）

| # | 问题 | 证据 |
|---|---|---|
| 3.1 | **关键**：真机/模拟器实测，点击输入区上沿不弹软键盘，必须点中 textarea 中心（`[94,739][987,928]`）才 `mInputShown=true`。输入框外层卡片有 `padding:18px 20px 14px`，可点判断落在非输入元素上 | 模拟器实测（本次会话）；`screens/WorkbenchHome.jsx:93-114` |
| 3.2 | 多行 textarea 用 `onKeyDown` 拦截 Enter 提交（`Enter 提交 · Shift+Enter 换行`），**Android 软键盘的 Enter 语义与桌面不同**，且提示文案是桌面键盘术语 | `screens/WorkbenchHome.jsx:107,117`、`screens/NaturalSearchScreen.jsx:93` |
| 3.3 | 提交按钮在输入回车时依赖 `e.preventDefault()`，但移动端软键盘"换行"键无 Shift 概念 → 用户无法输入多行目标 | `screens/WorkbenchHome.jsx:107` |
| 3.4 | 输入框未声明 `inputMode` / `enterKeyHint`，Android 键盘不显示"开始/搜索"动作键 | 全项目无 `enterKeyHint`（grep 为空） |
| 3.5 | 焦点态仅用 `border-color` + `box-shadow` 表达（`SearchField.jsx:25,29`）；只读可点区域（发现/地图上的搜索框）**无任何点击反馈**，用户以为坏了 | `components/ds/SearchField.jsx:25,29`；`screens/MapScreen.jsx:130`、`screens/DiscoverScreen.jsx:223` |

## A4. 面向普通用户的中文与术语（P0）

| # | 问题 | 证据 |
|---|---|---|
| 4.1 | 设置页直接展示存储键 `gorgon_workbench_tasks_v2`、英文行标签 `Schema Version`、`Phase 3 · Task Router + Skills`、`/api（同源代理）` | `screens/SettingsScreen.jsx:17,19,34,38,39,41,65,81` |
| 4.2 | 审核中心把 `JSON.stringify(p.editedPayload)` 原样打印 | `screens/ReviewCenterScreen.jsx:112` |
| 4.3 | 审核中心文案含 "Proposal"、"外部副作用" | `screens/ReviewCenterScreen.jsx:70` |
| 4.4 | 检索失败显示 `检索失败（HTTP 500）` + "请查看服务端日志"；后端 code 原样显示 | `screens/NaturalSearchScreen.jsx:521,522,543` |
| 4.5 | 搜索页把内部检索计划（query 原文、"条原始信息/已确认/待核验"等管线指标）展示给用户 | `screens/NaturalSearchScreen.jsx:276,304-308` |
| 4.6 | 工作记录页暴露 `（Task.timeline）`、"不含后端执行历史" | `screens/HistoryScreen.jsx:63` |
| 4.7 | 英文 kicker/标签散落：`Saved`、`My Weekend`、`This Weekend`、`DEMO DATA`、`DEMO / PREVIEW`、`Livehouse`、`MAP PLACEHOLDER` | `screens/MyWeekendScreen.jsx:179`、`DiscoverScreen.jsx:231`、`NaturalSearchScreen.jsx:535`、`ReviewCenterScreen.jsx:233`、`SearchScreen.jsx:20`、`components/atoms.jsx:234` |
| 4.8 | 状态枚举缺映射时直接显示英文：`PLACE_LABEL[p.status] || p.status`、`JOB_STAGE_LABEL[stage] || stage` | `screens/PlacesScreen.jsx:185`、`screens/ProgressCenterScreen.jsx:156` |
| 4.9 | "同步"按钮未说明同步到哪里（加入"我的周末"） | `components/ds/ActivityCard.jsx:66` |
| 4.10 | 任务详情仍保留一批**面向开发者的模拟控件**（"进入规划/准备就绪/需要审核"），普通用户看不懂"规划中/待审核"是什么 | `screens/TaskDetailScreen.jsx:154-161, 508-525` |

## A5. 状态反馈（P1）

| # | 问题 | 证据 |
|---|---|---|
| 5.1 | 错误被静默吞掉：ICS 导出与分享 `catch(e){}` 无任何提示 | `screens/ActivityDetailScreen.jsx:95,104` |
| 5.2 | 异步无 pending：ICS 导出、保存复盘、创建项目、保存到访、批准/拒绝建议均无 loading/disabled | `screens/ActivityDetailScreen.jsx:203`、`screens/ProjectDetailScreen.jsx:471`、`screens/ProjectsScreen.jsx:81`、`screens/PlacesScreen.jsx:278`、`screens/ReviewCenterScreen.jsx:246,262` |
| 5.3 | 检索成功但结果为空、以及无过滤条件时只渲染前 3 条且**不显示计数/来源说明** | `screens/SearchScreen.jsx:85,141,147` |
| 5.4 | 「清除」按钮在最近搜索为空时仍可点，点击无任何效果（误导） | `screens/SearchScreen.jsx:106` |
| 5.5 | 地图上的定位按钮**没有 onClick**，却是标准可点控件外观 | `screens/MapScreen.jsx:131` |
| 5.6 | 危险操作无确认：取消收藏即删、删除进度/笔记/归档项目均直接执行 | `screens/MyWeekendScreen.jsx:130`、`screens/ProjectDetailScreen.jsx:374,432,481` |
| 5.7 | 删除用原生 `window.confirm`，与应用视觉割裂 | `screens/PlacesScreen.jsx:238` |
| 5.8 | 状态只用颜色区分（报名状态徽章、风险项、地图 chip、分类选中点） | `screens/ActivityDetailScreen.jsx:146-155,288-307`、`screens/MapScreen.jsx:156-157`、`screens/DiscoverScreen.jsx:29-31,46` |

## A6. 视觉一致性（P2）

| # | 问题 | 证据 |
|---|---|---|
| 6.1 | 硬编码色值绕过 token：`#9A6300`（警告文字）、`#047857`（成功文字）、`#fff`、`#06241B`、地图底色 | `screens/*.jsx` 共 14 处文件（见 F 文件清单）；`screens/MapScreen.jsx:114-125` |
| 6.2 | 成功/警告文字色在 token 中**没有语义别名**（`--success` 是 mint-500 #00C28E，对比度不足以做小字文字色），导致各页面各自发明 `#047857/#9A6300` | `tokens/colors.css:75-81` 缺 `--success-ink` / `--warning-ink` |
| 6.3 | 卡片圆角混用（`--radius-md` 14 / `--radius-lg` 20 / `--radius-xl` 28）无规则；同一层级区块圆角不一致 | `screens/WorkbenchHome.jsx:95,110,175` vs `atoms.jsx:269` |
| 6.4 | 分区标题样式重复实现（`fontSize:12.5, fontWeight:700, color:--text-muted`）在 8+ 文件里复制粘贴 | `WorkbenchHome.jsx:135,156,198,246,288,319`、`TaskDetailScreen.jsx:193`、`TasksScreen.jsx:95` |
| 6.5 | 中文字体从 **Google Fonts CDN** 加载（`@import`），APK 离线时 Noto Sans SC 拿不到 → 中文回退到系统字体，字重/字距与设计稿不一致 | `tokens/fonts.css:9` |
| 6.6 | 中文正文缺少专用行高/字距规则（`--leading-normal:1.5` 用于中文偏紧），且未设置 `font-feature-settings` 中文字形 | `tokens/typography.css`、`tokens/base.css:8-17` |
| 6.7 | 桌面/平板为同一业务树但布局写死（`max-width:860`、`padding:"28px 16px"`），移动端顶部留白偏大 | `screens/TasksScreen.jsx:90`、`TaskDetailScreen.jsx:344` |

## A7. 未实现 / 占位（必须在设计中如实标注）

| 项 | 状态 | 证据 |
|---|---|---|
| 地图能力（真实地图、路线、通勤时间） | **占位** | `components/atoms.jsx:220-260`（"地图能力尚未接入""不会给出预估通勤时间"） |
| 求职管线专用管理屏 | **未实现** | 进度中心仅只读摘要（`ProgressCenterScreen.jsx`） |
| 独立"日程"页 | **未实现** | 仅任务详情排期编辑器 + 首页今日待办 |
| AI 引擎接入 | **部分实现** | 首页状态显示"AI 引擎：未连接"（`WorkbenchHome.jsx:30`）；provider 层存在但未配置 |
| 地图页定位按钮 | **未实现** | `MapScreen.jsx:131` 无 onClick |
