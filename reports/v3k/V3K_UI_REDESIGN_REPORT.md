# V3K D1：首页与搜索页交付

本轮仅替换真实 React/Vite 首页、搜索页及其共享底栏呈现。用户选定 **OBSIDIAN 冰蓝极简**，保留首版 DARK ORBIT 和其他概念方向。未构建或发布 APK，未修改 Android 版本或签名，未合并稳定分支。状态：**D1_BROWSER_PASS / ONLINE_POSTER_BLOCKED / DEVICE_NOT_TESTED**。

## 修改文件与范围

| 文件 | 结果 |
| --- | --- |
| `app/src/screens/WorkbenchHome.jsx`、`styles/v3k-home.css` | 真实目标输入、创建后进详情、今日待办、项目与最近记录；CSS 轨道行动卡、诚实空状态、中文输入法 composing 防误提交 |
| `app/src/screens/SearchScreen.jsx`、`styles/v3k-search.css` | 搜索、区域 AND、原 recency/DEMO 排除逻辑；可读卡片、真实数量、搜索建议、独立智能搜索入口；不再把固定词称作真实历史或热搜 |
| `app/src/components/ds/ActivityCard.jsx` | 追加局部 `variant="search"`；真实 URL / descriptor、加载状态、无图及坏链分类回退；完整标题、来源、REAL/DEMO、时间地点和同步动作 |
| `app/src/styles/v3k-theme.css`、`main.jsx` | 独立可替换 tokens；默认 OBSIDIAN，保留 DARK ORBIT；无新增依赖 |
| `app/src/App.jsx`、`components/AppShell.jsx`、`components/Icon.jsx` | 首两页的品牌栏和局部主题；四入口底栏 48px 触控区、safe-area、动态视口；补齐实际使用的图标 |
| `app/tests/v3k-mobile-ui-e2e.mjs`、`v3k-search-card-e2e.mjs` | 真实构建流程回归及真实 React 图片组件 fixture 回归 |

实施分支：`feat/v3k-android-ui-redesign`。它从 `docs/v3k-mobile-ui-blueprint` @ `eeb64bc1c303359cff8b1312fb1a2ce3559e1136` 创建；已核验 V3J @ `54c5c58b6be9ef65fbc49a44b0bb4c6bcd454a96` 是其祖先。对照 V3J，`pipeline/**`、Store、Task Engine、状态机、Gateway、日期组件、笔记/地图页面及 `app/android/**` 均无改动。

## 可点开的真实前后截图

| 页面 | 改版前 | 当前 OBSIDIAN |
| --- | --- | --- |
| 首页 | [before-home.png](screenshots/before-home.png) | [after-home.png](screenshots/after-home.png) |
| 搜索 | [before-search.png](screenshots/before-search.png) | [after-search.png](screenshots/after-search.png) |

来源为 **Linux Chromium / CDP，390 × 844 CSS px，DPR 1**；不是 Android 真机。改版前使用 Vite dev，最终截图使用实际生产构建的 Vite preview。两次复用同一个独立基线 profile，未注入任务/活动，未清空用户已有存储。主页为空状态，搜索使用现有采集数据；海报网络不可用时如实回退。交互测试另用全新 profile，不污染截图数据。

另保留 [原任务](screenshots/before-tasks.png)、[原地图](screenshots/before-map.png)、[当前任务](screenshots/after-tasks.png)、[当前地图](screenshots/after-map.png)，用于确认本轮未替换其页面内容。共享底栏增加触控面积，原页面仍保留 V3J 呈现。

## 概念图与首版保留

以下均是生成的视觉方向，**不是已运行页面截图，示例不代表真实数据**：

- [原浅色 ORBIT](concept-orbit-light.png)
- [第一版 DARK ORBIT](concept-dark-orbit.png)
- [用户选定 OBSIDIAN](concept-obsidian.png)
- [HOLOGRAM 蓝紫全息](concept-hologram.png)
- [SIGNAL 琥珀工业](concept-signal.png)

第一版真实运行的 [首页](screenshots/dark-orbit-home.png)、[搜索](screenshots/dark-orbit-search.png) 也已保留。开发或预览 URL 附加 `?skin=orbit` 可切换回首版配色；默认无参数为 OBSIDIAN。它只选择 CSS 呈现，不写入任何用户配置或数据；E2E 已验证切换后任务保留。未来换色主要修改 `v3k-theme.css`；更换卡片表现使用独立的 home/search CSS。原 V3J 界面源码仍完整保存在 V3J 分支和上述祖先提交中，未删除 legacy 前端或 `?legacy=1`。

## 本次真实构建与测试

| 检查 | 最终实际结果 | 证据 |
| --- | --- | --- |
| 改版前 App baseline | 592 项：591 passed / 0 failed / 1 skipped | [BASELINE.md](BASELINE.md) |
| 改版后全量 App 单测 | 592 项：591 passed / 0 failed / 1 skipped；真实 Codex 调用按原 opt-in gate 跳过 | [unit-summary.txt](test-output/unit-summary.txt) |
| 真实生产构建与 build-smoke | 18 passed / 0 failed，含 bundle secret-pattern 检查 | [build-output.txt](test-output/build-output.txt) |
| 新首页/搜索及导航 E2E | 54 passed / 0 failed | [mobile-ui-output.txt](test-output/mobile-ui-output.txt) |
| 图片真实 DOM fixture E2E | 24 passed / 0 failed | [image-fixture-output.txt](test-output/image-fixture-output.txt) |
| 原 V3J 截止时间 E2E | 18 passed / 0 failed，Asia/Shanghai 时区 | [v3j-datepicker-output.txt](test-output/v3j-datepicker-output.txt) |
| 原 V3J 笔记新建 E2E | 14 passed / 0 failed | [v3j-notes-output.txt](test-output/v3j-notes-output.txt) |
| 原 V3J 地图 E2E | 11 passed / 0 failed | [v3j-map-output.txt](test-output/v3j-map-output.txt) |
| 原 V3J 图片 E2E | 11 passed / **1 failed**，runner exit 1，完整跑完 | [v3j-image-output.txt](test-output/v3j-image-output.txt) |

新增 54 项回归覆盖 360/390/412px 首页与搜索、四项原导航标签/触控面积、关键词与地区 AND、结果计数、空状态及清除操作、独立智能搜索、日程/笔记/地图/智能体入口、创建真实任务→详情→本地规划执行、刷新持久化、配色切换不丢数据、`?legacy=1` 和应用 console 异常检查。还验证缩小到 390×460 视口时提交键可滚动触及；这不代表物理 Android 输入法验收。

图片 fixture 用本地明确标注 **TEST IMAGE** 的测试图、null、真实 HTTP 404、有效 URL descriptor、非法对象及 placeholder descriptor，挂载实际 React ActivityCard；未向生产活动数据植入海报。验证 `<img>` 实际加载、React onError 后分类渐变、移除破图 probe、无 `[object Object]`、详情/同步回调及三个宽度的触控与溢出。[fixture 截图](screenshots/search-image-fixtures.png) 是组件测试证据，不是活动来源图片。

## 保留的旧契约

- `data-workbench-nav`、`data-gg-nav`、`data-gg-screen`、`data-gg-card-id`、地区属性及既有首页 test IDs；四入口始终是工作台/搜索/任务/更多。
- 原业务回调、Task Engine 状态机、任务/日程/笔记/项目关系、localStorage 与 Capacitor 持久化模型。
- V3J `formatCNTime` import、本地时间展示和 UTC ISO 存储链；笔记新建、真实坐标投影、无坐标列表、高德/geo 导航 URI。
- 真实图片 URL、来源/信任状态、recency/DEMO 排除、关键词和地区 AND。无新功能框架、无数据重爬或重生成。

## 已知限制与下一步最小操作

唯一原 E2E 失败是豆瓣海报实际联网加载：浏览器记录 timeout；同一 HTTPS 图片通过平台代理的只读 HEAD 返回 `403 Forbidden`。保留原断言和失败结果，未用本地图替代真实 CDN 成功结论，未关闭 TLS/完整性检查。Google 字体和图片资源的网络噪声与应用异常分别记录；系统字体和分类渐变正常降级。需要环境允许 `img2.doubanio.com` / `img3.doubanio.com` 后复验这项外部集成。

物理 Android 的输入法、安全区、通知、覆盖安装及外部地图拉起仍为 **DEVICE_NOT_TESTED**。本轮不打 APK、不发布 Release、不更新 versionCode、不合并稳定分支；后端 Python 全套未作为本轮 UI 回归重跑。任务、地图及其他页面的统一改版等待用户确认真实首页/搜索视觉后再进入下一轮。

复现命令和视觉包说明见 [REPRODUCE.md](REPRODUCE.md)。
