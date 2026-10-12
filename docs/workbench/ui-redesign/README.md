# Gorgon Workbench — 移动端 UI/UX 重设计（V2.2 设计阶段）

> 设计负责人交付包 · 2026-10-13
> 基线代码：`feature/gorgon-opportunity-v2` @ `ccc1d03`（V2.2 已验收状态）
> **本包为设计阶段交付，未修改任何业务代码。** 现有 `app/src/**`、`store/**`、`workbench/**`、`pipeline/**` 保持原样。

## 产品定位（本设计的出发点）

Gorgon Workbench 是**面向普通人的 Android AI 智能行动工作台**，不是单一的活动检索 App。
核心闭环：**发现信息 → 创建行动 → 安排日程 → 执行 → 记录 → 复盘**。
设计要解决的真实问题不是"更好看"，而是：**普通用户能否独立走完这条闭环。**

## 交付物索引

| 编号 | 交付物 | 文件 |
|---|---|---|
| A | 现有 UI 问题清单（带行号证据） | [`A_UI_AUDIT.md`](A_UI_AUDIT.md) |
| B | 新信息架构 | [`B_INFORMATION_ARCHITECTURE.md`](B_INFORMATION_ARCHITECTURE.md) |
| C | 统一设计规范 | [`C_DESIGN_SYSTEM.md`](C_DESIGN_SYSTEM.md) |
| D | 主要页面高保真规格 + 可预览原型 | [`D_SCREEN_SPECS.md`](D_SCREEN_SPECS.md) · [`prototype/index.html`](prototype/index.html) |
| E | Codex 分阶段实施清单 | [`E_CODEX_PLAN.md`](E_CODEX_PLAN.md) |
| F | 回归风险与验收标准 | [`F_REGRESSION_ACCEPTANCE.md`](F_REGRESSION_ACCEPTANCE.md) |

## 功能状态图例（全包统一使用）

| 标记 | 含义 | 判定依据 |
|---|---|---|
| **已实现** | 代码存在且有测试/真机证据 | 见各文件引用 |
| **部分实现** | 数据层/引擎存在，UI 不完整 | 代码存在但无对应界面 |
| **未实现** | 规划中，代码不存在 | 不得在原型中伪装 |
| **占位** | UI 存在但明确标注"未接入" | 如地图 |

## 执行摘要（5 条）

1. **导航是最大的结构问题**：移动端底部 4 个 tab（工作台/搜索/任务/更多），
   但真实有 **14 个页面**；"更多"是个 9 项抽屉（`workbench/navigation.js:68-78`），
   普通用户无法建立"系统里有几件事、我在哪"的心智模型。
2. **触控目标系统性偏小**：`Button size="sm"` 固定 36px（`components/core/Button.jsx`）、
   `.gg-chip` 约 29px（`ui_kits/app/responsive.css:576`）、准备清单勾选框 18×18
   （`screens/ProjectDetailScreen.jsx:213`）。Android 单手操作的最小可靠热区是 **48dp**，
   现状 **不足 44px 的元素在 15 个文件中出现**。
3. **开发者语言泄漏给普通用户**：设置页直接显示 `Schema Version`、`gorgon_workbench_tasks_v2`
   （`screens/SettingsScreen.jsx:38-39`）、审核中心显示原始 `JSON.stringify`
   （`screens/ReviewCenterScreen.jsx:112`）、检索失败显示 `HTTP 500` + "请查看服务端日志"
   （`screens/NaturalSearchScreen.jsx:521-522`）。
4. **移动端信息层级倒置**：自然语言搜索页把内部检索上下文（理解/计划/汇总）用
   `order:-1` 排在活动结果**之前**（`screens/NaturalSearchScreen.jsx:588`）；
   活动详情把"报名/导出/加入周末"等**主操作**堆在长滚动的正文之后
   （`screens/ActivityDetailScreen.jsx:129,467`）。
5. **好消息**：数据层、状态机、持久化、DEMO/REAL 区分都很扎实，且**已有完整设计令牌系统**
   （`tokens/*.css`：indigo/mint/slate 色板、4px 网格、Space Grotesk + Plus Jakarta Sans + Noto Sans SC）。
   本设计**不推翻令牌**，只做"移动端补齐 + 信息架构重排 + 文案与状态规范化"。

## 硬约束（贯穿全部交付物）

1. 保留任务状态机（`workbench/task-model.js`）—— 设计不得要求新增非法流转。
2. 保留数据持久化（localStorage + Capacitor Preferences 镜像）。
3. 保留 API 接口（`lib/api.js` 单一配置层，`VITE_API_BASE_URL`）。
4. 保留现有业务逻辑；改造以"表现层重排"为主，最小 diff。
5. **DEMO 与真实数据必须视觉可辨**（已有 `ProviderBadge` / `DEMO` 徽章机制，保留并统一）。
6. 不虚构已实现功能；未实现项在原型中显式标注。
