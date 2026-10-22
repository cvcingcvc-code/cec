# V3K Android UI 改版设计说明（UI-first；不是重写功能）

> 版本：2026-10-21 · 状态：**REFERENCE_ONLY / NOT_IMPLEMENTED / DEVICE_NOT_TESTED**。  
> 唯一视觉参考：[`V3K_MOBILE_REFERENCE.svg`](V3K_MOBILE_REFERENCE.svg)。该图的数字/名称/卡片为**布局示例**，不是线上事实数据。

## 01. 产品与首要用户动作

Gorgon 是 **个人 AI 智能行动工作台**，不是单纯的活动推荐 App，也不是只能聊天的机器人。页面信息架构围绕：**发现信息 → 创建任务 → 安排日程 → 执行/审核 → 笔记/复盘**。优先移动端真实使用、快扫信息、少点击与中文易读；每个卡片都回答「这是什么、现在什么状态、我下一步能做什么」。

## 02. 视觉语言

- 风格：**calm productivity / 轻量专业工具**；浅色、留白、大字标题、柔和圆角、小面积紫色渐变和克制阴影。避免霓虹科技、复杂大面积装饰、虚假数据可视化。
- 基本色（建议 token，可按现有 CSS 名称接入）：`bg #F7F8FC`、`surface #FFFFFF`、`primary #5B47E0`、`primary-soft #EFEDFF`、`text #17192B`、`muted #767D92`、`border #E6E8F1`、`success #16A085`。
- 纵向页面设计基准 390 × 844 **CSS px**，必须实测 360px / 390px / 412px 窄屏及 Android 安全区；不把物理像素当 CSS px。
- 间距基准 4/8/12/16/24/32；主内容水平 16px；卡片半径 16–20px；主操作按钮高 ≥ 48px，点击目标 ≥ 48 × 48px；正文理想 ≥ 14px（辅助说明不小于 12px）；关键状态不能仅依赖颜色。
- 底栏使用现有四入口 **工作台 / 搜索 / 任务 / 更多**，**保留标签及导航测试契约**；不要擅自加第五入口或把「更多」改名。
- 中文为主，技术栈、日志、模型连接状态等按真实情况写，避免显示原始 JSON、技术占位英语与「AI 已完成」之类误导性表述。

## 03. 必需的四张页面参考图

| 编号 | 页面 | 首屏必须回答 | 对应现有实现 |
|---|---|---|---|
| 01 | 工作台首页 | 今天要做什么？一句话新建任务、今日待办、最近项目 | `app/src/screens/WorkbenchHome.jsx` |
| 02 | 发现/搜索 | 能找到什么？关键词、区域、活动卡片、真实图片/缺图回退 | `SearchScreen.jsx`、`ActivityCard.jsx`；另保留 `NaturalSearchScreen.jsx` |
| 03 | 任务 | 哪些任务需要处理？状态、截止时间、任务详情入口 | `TasksScreen.jsx`、`TaskDetailScreen.jsx` |
| 04 | 地图 | 活动在哪里？真坐标点位、详情、导航、无坐标提示 | `MapScreen.jsx` |

**二轮延伸页（只复用组件，不重新设计数据链）**：日程 `ScheduleScreen`、笔记 `NotesScreen`、项目 `ProjectsScreen`、地点 `PlacesScreen`、智能体 `AgentScreen`、更多抽屉与设置。待首批四屏截图通过之后再做。

## 04. 页面与交互规则

### 首页
- 上半屏优先「创建真实任务」+「今日待办」，弱化重复入口与过多功能块。任务状态来自现有 Task Engine；如果 AI/远程 Gateway 未接通，保留明确“未连接/等待执行”。
- 避免静态伪统计；无任务、加载中、失败、离线场景有诚实文案。
- 确保键盘弹起/收起与安卓底栏不会覆盖输入框、提交键。

### 搜索
- 卡片真实图片来自现有数据契约：`imageUrlOf()` / view normalizer；失效链接走原有 probe/onError 回退；无图使用分类渐变；**绝不把 [object Object] 用作 CSS url**。
- 区域与关键词 AND 筛选、recency、DEMO/REAL 标签和结果数量一致；示意图只是布局，不要硬编码示意卡片到生产。
- 搜索页的 legacy `data-gg-nav="search"` 与智能搜索入口并存；不合并破坏。
- 不抓取或生成无版权证据的活动海报做 UI 填充；没有就显示诚实占位。

### 任务
- 状态、时间、提醒与任务关联关系来自现有 Store，不得在 UI 改版时改动业务状态机。
- 截止时间必须保留 V3J 的 `formatCNTime` import 和 UTC ISO → 本地时区正确展示链；不回归 V3J 崩溃。
- 保留重启持久化、任务编辑、活动转任务、日程关联、笔记关联。

### 地图
- 只根据 `coord`、`coordProvider`、`coordSystem` 真坐标绘 pin；无坐标应列表呈现而非假位置。当前是轻量自绘投影，不是地图 SDK。
- 点击 marker 展开活动信息；调用高德 marker URI → `geo:` 兜底的既有逻辑必须不变。
- **视觉参考里的道路线条纯属布局示意**；实现不要把它们写成真实街道底图或伪地理数据。

## 05. 修改范围与禁区

允许：`styles.css`、`ui_kits/app/responsive.css`、共享 UI primitives、`app/src/components/` 及 `app/src/screens/` 中呈现层、`App.jsx` 中无副作用的布局壳。

不得改/删：`pipeline/data/**`、爬虫/去重/审核/地理编码、`app/src/store/**`、Task Engine / State Machine / Gateway 权限与签名、`app/android/**` 签名、已有用户数据、历史报告或 Git 标签。不得删除 `?legacy=1`、`data-workbench-nav`、`data-gg-nav`、`data-gg-screen`、`data-gg-card-id` 等测试契约。

## 06. 阶段门槛

**D0：先拍当前四屏基线截图，不改代码。**  
**D1：首页/搜索两屏落地，单测 + E2E + 前后截图；用户看图决定风格。**  
**D2：任务/地图落地，V3J 回归与图像/地图 E2E；查看其他入口是否被遮挡。**  
**D3：适配 360/390/412、多语言截断、软键盘/安全区、深浅主题退化和无网。**  
**D4：Android 真机手动验收（NOT_TESTED → PASS 才可宣布完成）；另决定是否发布。**

必须上传：实际 Android 或 Playwright 渲染截图（区分来源）、可重复启动命令、测试日志摘要、对照前后 diff、保留旧界面方式、所有未解决事项。无真机不可伪称通过。
